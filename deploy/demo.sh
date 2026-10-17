#!/usr/bin/env bash
# The demo site on one small Ubuntu 24.04 VPS: the made-up city of `npm run demo`, with no
# Bitcoin node or database, served on port 80 (or HTTPS on a domain) and kept up to date with
# a branch of the repository every few minutes.
#
#   curl -fsSL https://raw.githubusercontent.com/fiveholly/unimap/preview/deploy/demo.sh | sudo bash
#
# Settings, read from the environment on the first run and kept in /etc/unimap/demo.env:
#   BRANCH  the branch to follow (default: preview)
#   DOMAIN  a domain pointing at this machine; empty serves plain http on the IP (default: empty)
# To change them later, edit /etc/unimap/demo.env and run this script again.
# To put the site behind a password, run `sudo /opt/unimap-demo/password.sh` afterwards.
# 2 GB of memory is enough; the script adds swap on smaller machines so the build doesn't run out.
set -euo pipefail

NODE_VERSION=22.22.0
REPO=https://github.com/fiveholly/unimap.git
DIR=/opt/unimap-demo
ENV=/etc/unimap/demo.env

[ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
. /etc/os-release
[ "$ID" = ubuntu ] || echo "warning: tested on Ubuntu 24.04, this is $PRETTY_NAME" >&2

install -d -m 755 /etc/unimap
if [ ! -f "$ENV" ]; then
  printf 'BRANCH=%s\nDOMAIN=%s\n' "${BRANCH:-preview}" "${DOMAIN:-}" > "$ENV"
fi
set -a; . "$ENV"; set +a
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "BRANCH may only contain letters, digits and . _ / -" >&2; exit 1; }
[[ -z "$DOMAIN" || "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "DOMAIN looks wrong: $DOMAIN" >&2; exit 1; }

# ---- packages, user, swap --------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git curl xz-utils rsync caddy
id unimap >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/unimap --shell /usr/sbin/nologin unimap
install -d -o unimap -g unimap "$DIR" "$DIR/releases"

mem_mb=$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 3000 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Node for Next.js 16 (Ubuntu's is too old), checked against SHASUMS256.
if [ "$("$DIR/node/bin/node" --version 2>/dev/null)" != "v$NODE_VERSION" ]; then
  DL=$(mktemp -d)
  f="node-v$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSL -o "$DL/$f" "https://nodejs.org/dist/v$NODE_VERSION/$f"
  curl -fsSL -o "$DL/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$DL" && grep " $f\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$DIR/node" && install -d -o unimap -g unimap "$DIR/node"
  tar -xJf "$DL/$f" -C "$DIR/node" --strip-components 1
  rm -rf "$DL"
fi

if [ ! -d "$DIR/src/.git" ]; then
  sudo -u unimap -H git clone --quiet "$REPO" "$DIR/src"
fi

# ---- the updater: fetch the branch, build a new release next to the live one, switch ----
cat > "$DIR/update.sh" <<'EOF'
#!/usr/bin/env bash
# Run by unimap-demo-update.timer as the unimap user. Builds only when the branch moved.
set -euo pipefail
DIR=/opt/unimap-demo
. /etc/unimap/demo.env
export PATH="$DIR/node/bin:/usr/bin:/bin"
cd "$DIR/src"
git fetch --quiet origin "$BRANCH"
sha=$(git rev-parse --short=12 "origin/$BRANCH")
live=$(readlink "$DIR/current" 2>/dev/null | xargs -r basename || true)
[ "$sha" = "$live" ] && [ "${1:-}" != "--force" ] && exit 0
echo "building $BRANCH at $sha"
rel="$DIR/releases/$sha"
rm -rf "$rel" && mkdir -p "$rel"
git archive "origin/$BRANCH" web | tar -x -C "$rel"
cd "$rel/web"
# Reuse the live release's packages when the lockfile didn't change.
if [ -n "$live" ] && cmp -s package-lock.json "$DIR/releases/$live/web/package-lock.json"; then
  cp -a "$DIR/releases/$live/web/node_modules" .
else
  npm ci --no-audit --no-fund --loglevel=error
fi
site="http://$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
[ -n "${DOMAIN:-}" ] && site="https://$DOMAIN"
NEXT_PUBLIC_DEMO=1 NEXT_PUBLIC_SITE_URL="$site" NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build >/dev/null
ln -sfn "$rel" "$DIR/current.new" && mv -T "$DIR/current.new" "$DIR/current"
touch "$DIR/restart"  # unimap-demo-restart.path picks this up as root
# Keep the live release and the one before it.
ls -1t "$DIR/releases" | tail -n +3 | while read -r old; do rm -rf "$DIR/releases/$old"; done
echo "live: $sha"
EOF
chmod 755 "$DIR/update.sh"
chown unimap:unimap "$DIR/update.sh"

# ---- services ---------------------------------------------------------------------
cat > /etc/systemd/system/unimap-demo-web.service <<EOF
[Unit]
Description=unimap demo: web (Next.js, demo mode)
After=network.target

[Service]
User=unimap
Group=unimap
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
WorkingDirectory=$DIR/current/web
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
ExecStart=$DIR/node/bin/node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/unimap-demo-update.service <<EOF
[Unit]
Description=unimap demo: build the branch if it moved
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=unimap
Group=unimap
Nice=10
ExecStart=$DIR/update.sh
EOF
cat > /etc/systemd/system/unimap-demo-update.timer <<EOF
[Unit]
Description=unimap demo: check the branch every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
# The updater runs unprivileged; it asks for a restart by touching a file.
cat > /etc/systemd/system/unimap-demo-restart.path <<EOF
[Unit]
Description=unimap demo: restart the web after a new build

[Path]
PathChanged=$DIR/restart

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/unimap-demo-restart.service <<EOF
[Unit]
Description=unimap demo: restart the web

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl restart unimap-demo-web.service
EOF

if [ -n "$DOMAIN" ]; then site="$DOMAIN"; else site=":80"; fi
cat > /etc/caddy/Caddyfile <<EOF
# Written by deploy/demo.sh. With a domain, Caddy fetches the TLS certificate itself.
$site {
	# The password from password.sh, when one is set.
	import /etc/unimap/demo-auth*.caddy
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
EOF

# Asks for a password and puts the whole site behind it. --off removes it again.
cat > "$DIR/password.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
AUTH=/etc/unimap/demo-auth.caddy
if [ "${1:-}" = --off ]; then
  rm -f "$AUTH"
  systemctl reload caddy
  echo "The password is off; anyone can open the site again."
  exit 0
fi
user=${1:-unimap}
[[ "$user" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "the user name may only contain letters, digits and . _ -" >&2; exit 1; }
hash=$(caddy hash-password)  # asks for the password twice and prints only its bcrypt hash
printf 'basicauth {\n\t%s %s\n}\n' "$user" "$hash" > "$AUTH.new"
chmod 644 "$AUTH.new" && mv "$AUTH.new" "$AUTH"
systemctl reload caddy
echo "Done. The site now asks for user \"$user\" and the password you typed."
EOF
chmod 700 "$DIR/password.sh"

touch "$DIR/restart" && chown unimap:unimap "$DIR/restart"
systemctl daemon-reload
echo "Building the site the first time; this takes a few minutes…"
sudo -u unimap -H "$DIR/update.sh" --force
systemctl enable --now unimap-demo-web.service unimap-demo-update.timer unimap-demo-restart.path >/dev/null
systemctl restart unimap-demo-web.service
systemctl reload caddy || systemctl restart caddy

ip=$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo "The demo is up: ${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$ip}"
echo "It follows the $BRANCH branch and rebuilds within about 5 minutes of a push."
echo "Password: sudo $DIR/password.sh    Remove it: sudo $DIR/password.sh --off"
echo "Logs: journalctl -u unimap-demo-update -n 50    Rebuild now: sudo systemctl start unimap-demo-update"
