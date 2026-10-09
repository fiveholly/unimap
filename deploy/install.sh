#!/usr/bin/env bash
# Set up (or update) a unimap mainnet node on one Ubuntu 24.04 VPS.
#
#   sudo deploy/install.sh [--restart-all]
#
# First run: copies deploy/unimap.env.example to /etc/unimap/unimap.env and stops so you can
# fill it in. Second run: installs everything and starts the services. Later runs update the
# code from this checkout, rebuild the web app and restart what changed; data is kept.
# See deploy/README.md for the machine size and how long the first sync takes.
set -euo pipefail

BITCOIN_VERSION=28.1
ORD_VERSION=0.23.2
ORD_SHA256=cfc0c84a49aca759bf361558ac418ad62321d2ee9c8037a3f926d92b9e10fb4e
NODE_VERSION=22.22.0

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV=/etc/unimap/unimap.env
OPT=/opt/unimap

[ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
. /etc/os-release
[ "$ID" = ubuntu ] || echo "warning: tested on Ubuntu 24.04, this is $PRETTY_NAME" >&2

# ---- settings -----------------------------------------------------------------
install -d -m 755 /etc/unimap
if [ ! -f "$ENV" ]; then
  install -m 600 "$ROOT/deploy/unimap.env.example" "$ENV"
  echo "Wrote $ENV. Fill in DOMAIN and both passwords, then run this script again."
  exit 0
fi
if grep -qE '^(BITCOIN_RPC_PASSWD|DB_PASSWD)=change-me|^DOMAIN=unimap\.example\.com' "$ENV"; then
  echo "$ENV still has the example DOMAIN or passwords; edit it first." >&2
  exit 1
fi
set -a; . "$ENV"; set +a
: "${DOMAIN:?}" "${DATA_DIR:?}" "${BITCOIN_RPC_USER:?}" "${BITCOIN_RPC_PASSWD:?}" "${DB_DATABASE:?}" "${DB_USER:?}" "${DB_PASSWD:?}"
# These end up in config files and SQL, so keep them to plain characters.
for v in BITCOIN_RPC_USER BITCOIN_RPC_PASSWD DB_DATABASE DB_USER DB_PASSWD; do
  [[ "${!v}" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "$v may only contain letters, digits, '.', '_' and '-'" >&2; exit 1; }
done

# ---- packages -----------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q build-essential pkg-config libssl-dev clang git curl jq rsync \
  postgresql python3-venv python3-dev caddy

id unimap >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/unimap --shell /usr/sbin/nologin unimap
install -d -o unimap -g unimap "$OPT" "$OPT/bin" "$DATA_DIR" "$DATA_DIR/bitcoin" "$DATA_DIR/ord" "$DATA_DIR/opi-ord"
as_unimap() { sudo -u unimap -H --preserve-env=HTTPS_PROXY,HTTP_PROXY,NO_PROXY,NODE_EXTRA_CA_CERTS env PATH="$OPT/node/bin:/home/unimap/.cargo/bin:/usr/local/bin:/usr/bin:/bin" "$@"; }

DL=$(mktemp -d)
trap 'rm -rf "$DL"' EXIT

# Bitcoin Core, checked against the release's SHA256SUMS. For a stronger check, also verify
# SHA256SUMS.asc against the builder keys (https://github.com/bitcoin-core/guix.sigs).
if ! "$OPT/bin/bitcoind" -version 2>/dev/null | head -1 | grep -q " v$BITCOIN_VERSION"; then
  f="bitcoin-$BITCOIN_VERSION-x86_64-linux-gnu.tar.gz"
  curl -fsSL -o "$DL/$f" "https://bitcoincore.org/bin/bitcoin-core-$BITCOIN_VERSION/$f"
  curl -fsSL -o "$DL/SHA256SUMS" "https://bitcoincore.org/bin/bitcoin-core-$BITCOIN_VERSION/SHA256SUMS"
  (cd "$DL" && grep " $f\$" SHA256SUMS | sha256sum -c -)
  tar -xzf "$DL/$f" -C "$DL"
  install -m 755 "$DL/bitcoin-$BITCOIN_VERSION/bin/bitcoind" "$DL/bitcoin-$BITCOIN_VERSION/bin/bitcoin-cli" "$OPT/bin/"
fi

# Upstream ord, pinned by hash.
if ! "$OPT/bin/ord" --version 2>/dev/null | grep -q "$ORD_VERSION"; then
  f="ord-$ORD_VERSION-x86_64-unknown-linux-gnu.tar.gz"
  curl -fsSL -o "$DL/$f" "https://github.com/ordinals/ord/releases/download/$ORD_VERSION/$f"
  echo "$ORD_SHA256  $DL/$f" | sha256sum -c -
  tar -xzf "$DL/$f" -C "$DL"
  install -m 755 "$DL/ord-$ORD_VERSION/ord" "$OPT/bin/ord"
fi

# Node for the web app (Ubuntu's is too old for Next.js 16), checked against SHASUMS256.
if [ "$("$OPT/node/bin/node" --version 2>/dev/null)" != "v$NODE_VERSION" ]; then
  f="node-v$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSL -o "$DL/$f" "https://nodejs.org/dist/v$NODE_VERSION/$f"
  curl -fsSL -o "$DL/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$DL" && grep " $f\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$OPT/node" && install -d -o unimap -g unimap "$OPT/node"
  tar -xJf "$DL/$f" -C "$OPT/node" --strip-components 1
fi
ln -sf "$OPT/node/bin/node" /usr/local/bin/node
ln -sf "$OPT/node/bin/npm" /usr/local/bin/npm
ln -sf "$OPT/node/bin/npx" /usr/local/bin/npx

# Rust, to build OPI's ord fork.
[ -x /home/unimap/.cargo/bin/cargo ] || as_unimap sh -c 'curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal'

# ---- code ---------------------------------------------------------------------
rsync -a --delete --exclude .git --exclude node_modules --exclude .next --exclude __pycache__ --exclude .env \
  "$ROOT/" "$OPT/src/"
chown -R unimap:unimap "$OPT/src"

as_unimap "$OPT/src/scripts/setup_opi.sh" "$OPT/opi"

[ -x "$OPT/venv/bin/python3" ] || as_unimap python3 -m venv "$OPT/venv"
as_unimap "$OPT/venv/bin/pip" install -q -r "$OPT/src/requirements.txt"
[ -x "$OPT/opi-venv/bin/python3" ] || as_unimap python3 -m venv "$OPT/opi-venv"
as_unimap "$OPT/opi-venv/bin/pip" install -q -r "$OPT/opi/modules/requirements.txt"

# ---- Postgres -----------------------------------------------------------------
pg() { sudo -u postgres psql -v ON_ERROR_STOP=1 -q "$@"; }
pg -tc "select 1 from pg_roles where rolname = '$DB_USER'" | grep -q 1 ||
  pg -c "create role \"$DB_USER\" login password '$DB_PASSWD'"
pg -tc "select 1 from pg_database where datname = '$DB_DATABASE'" | grep -q 1 ||
  pg -c "create database \"$DB_DATABASE\" owner \"$DB_USER\""
upg() { PGPASSWORD="$DB_PASSWD" psql -v ON_ERROR_STOP=1 -q -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_DATABASE" "$@"; }
# OPI's schema has no IF NOT EXISTS, so only on a fresh database; ours are safe to re-run.
upg -tc "select to_regclass('public.bitmaps')" | grep -q bitmaps || upg -f "$OPT/opi/modules/bitmap_index/db_init.sql"
upg -f "$OPT/src/parcel_index/db_init.sql"
upg -f "$OPT/src/api/social.sql"

# ---- config files -------------------------------------------------------------
dbcache=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 / 4 ))
sed -e "s|@BITCOIN_RPC_USER@|$BITCOIN_RPC_USER|" -e "s|@BITCOIN_RPC_PASSWD@|$BITCOIN_RPC_PASSWD|" -e "s|@DBCACHE@|$dbcache|" \
  "$OPT/src/deploy/bitcoin.conf.template" >/etc/unimap/bitcoin.conf
printf 'ORD_BITCOIN_RPC_URL=127.0.0.1:8332\nORD_BITCOIN_RPC_USERNAME=%s\nORD_BITCOIN_RPC_PASSWORD=%s\n' \
  "$BITCOIN_RPC_USER" "$BITCOIN_RPC_PASSWD" >/etc/unimap/ord.env
chown root:unimap /etc/unimap/*.env /etc/unimap/bitcoin.conf
chmod 640 /etc/unimap/*.env /etc/unimap/bitcoin.conf
sed "s|@DOMAIN@|$DOMAIN|" "$OPT/src/deploy/Caddyfile" >/etc/caddy/Caddyfile

# ---- web app ------------------------------------------------------------------
(cd "$OPT/src/web" && as_unimap npm ci --no-audit --no-fund && as_unimap env NEXT_PUBLIC_API_URL="https://$DOMAIN" NEXT_PUBLIC_SITE_URL="https://$DOMAIN" npm run build)

# ---- services -----------------------------------------------------------------
install -m 644 "$OPT/src/deploy/systemd/"*.service /etc/systemd/system/
systemctl daemon-reload
# The node and the two ord indexers are only started if they aren't running: restarting them
# costs minutes of cache flushing. Pass --restart-all after changing their versions.
for s in bitcoind ord opi-ord; do
  systemctl enable "unimap-$s" >/dev/null
  if [ "${1:-}" = --restart-all ]; then systemctl restart "unimap-$s"; else systemctl start "unimap-$s"; fi
done
for s in bitmap-index indexer owners zones api web; do
  systemctl enable "unimap-$s" >/dev/null
  systemctl restart "unimap-$s"
done
systemctl reload-or-restart caddy

echo
echo "Started. The first mainnet sync takes days; follow it with: $OPT/src/deploy/status.sh"
echo "Site: https://$DOMAIN (the map fills in as the indexers catch up)"
