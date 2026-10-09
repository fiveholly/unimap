#!/usr/bin/env bash
# End-to-end check of OPI's bitmap_index + unimap's parcel_index on regtest.
#
# Inscribes a set of valid and invalid districts and parcels with upstream ord,
# indexes them with OPI's ord fork, OPI bitmap_index and unimap parcel_index,
# then asserts which ones were accepted.
#
# Required env:
#   BITCOIND, BITCOIN_CLI  bitcoind / bitcoin-cli binaries (Bitcoin Core 28)
#   ORD                    upstream ord 0.23.2 (wallet + server, for inscribing)
#   OPI_ORD                OPI's ord fork binary (ord/target/release/ord)
#   OPI_DIR                OPI checkout (for modules/bitmap_index)
#   PGURL                  postgres URL of an empty database, e.g. postgresql://postgres@localhost/unimap_e2e
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-$(mktemp -d)}"
RPC_USER=unimap RPC_PASS=unimap RPC_PORT=18443
ORD_HTTP=18080
mkdir -p "$WORK"/{btc,ord,opi-ord}
echo "work dir: $WORK"

PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  "$BITCOIN_CLI" -regtest -datadir="$WORK/btc" -rpcuser=$RPC_USER -rpcpassword=$RPC_PASS stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

cli() { "$BITCOIN_CLI" -regtest -datadir="$WORK/btc" -rpcport=$RPC_PORT -rpcuser=$RPC_USER -rpcpassword=$RPC_PASS "$@"; }
ordw() {
  "$ORD" --regtest --datadir "$WORK/ord" --bitcoin-rpc-url 127.0.0.1:$RPC_PORT \
    --bitcoin-rpc-username $RPC_USER --bitcoin-rpc-password $RPC_PASS "$@"
}
wallet() { ordw wallet --server-url http://127.0.0.1:$ORD_HTTP "$@"; }
psqlq() { psql "$PGURL" -At -c "$1"; }

wait_for() { # wait_for <description> <command...>
  local what="$1"; shift
  for _ in $(seq 1 240); do "$@" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "timed out waiting for $what" >&2; exit 1
}

# ---- bitcoind -------------------------------------------------------------
"$BITCOIND" -regtest -datadir="$WORK/btc" -daemon -txindex=1 -server -rpcport=$RPC_PORT \
  -rpcuser=$RPC_USER -rpcpassword=$RPC_PASS -fallbackfee=0.0001 -listen=0
wait_for bitcoind cli getblockcount

# ---- ord wallet -----------------------------------------------------------
ordw server --http-port $ORD_HTTP >"$WORK/ord-server.log" 2>&1 &
PIDS+=($!)
wait_for "ord server" curl -sf http://127.0.0.1:$ORD_HTTP/blockcount
wallet create >/dev/null
ADDR=$(wallet receive | python3 -c 'import json,sys; print(json.load(sys.stdin)["addresses"][0])')
mine() { cli generatetoaddress "${1:-1}" "$ADDR" >/dev/null; }
mine 101
wait_sync() { wait_for "ord sync" sh -c "[ \$(curl -sf http://127.0.0.1:$ORD_HTTP/blockcount) -gt \$(cli getblockcount) ]"; }

FILES="$WORK/files"; mkdir -p "$FILES"
# inscribe <name> <text> [parent_id]  -> prints inscription id, mines a block
inscribe() {
  local name="$1" text="$2" parent="${3:-}"
  printf '%s' "$text" >"$FILES/$name.txt"
  wait_sync
  local args=(inscribe --fee-rate 1 --file "$FILES/$name.txt")
  [ -n "$parent" ] && args+=(--parent "$parent")
  local id
  id=$(wallet "${args[@]}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["inscriptions"][0]["id"])')
  mine 1
  echo "$id"
}

# Block B: one inscription's commit + reveal -> 3 transactions (coinbase, commit, reveal).
FILLER=$(inscribe filler "hello")
B=$(cli getblockcount)
[ "$(cli getblockheader "$(cli getblockhash "$B")" | python3 -c 'import json,sys; print(json.load(sys.stdin)["nTx"])')" = 3 ]

D_VALID=$(inscribe d_valid "$B.bitmap")
D_DUP=$(inscribe d_dup "$B.bitmap")
D_ZERO=$(inscribe d_zero "0$B.bitmap")
D_FUTURE=$(inscribe d_future "99999.bitmap")
D_OTHER=$(inscribe d_other "1.bitmap")

P_VALID0=$(inscribe p_valid0 "0.$B.bitmap" "$D_VALID")
P_DUP0=$(inscribe p_dup0 "0.$B.bitmap" "$D_VALID")
P_RANGE=$(inscribe p_range "3.$B.bitmap" "$D_VALID")
P_ZERO=$(inscribe p_zero "01.$B.bitmap" "$D_VALID")
P_NOPARENT=$(inscribe p_noparent "1.$B.bitmap")
P_WRONGPARENT=$(inscribe p_wrongparent "1.$B.bitmap" "$D_OTHER")
P_DUPDISTRICT=$(inscribe p_dupdistrict "1.$B.bitmap" "$D_DUP")
P_VALID2=$(inscribe p_valid2 "2.$B.bitmap" "$D_VALID")
P_VALID1=$(inscribe p_valid1 "1.$B.bitmap" "$D_VALID")
mine 1
TIP=$(cli getblockcount)

# ---- OPI ord + bitmap_index ------------------------------------------------
"$OPI_ORD" --regtest --data-dir "$WORK/opi-ord" --bitcoin-rpc-url 127.0.0.1:$RPC_PORT \
  --bitcoin-rpc-username $RPC_USER --bitcoin-rpc-password $RPC_PASS index run >"$WORK/opi-ord.log" 2>&1 &
PIDS+=($!)
rpc() { curl -sf -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":[]}" http://127.0.0.1:11030/; }
wait_for "OPI ord at tip" sh -c "[ \"\$(curl -sf -H 'content-type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getLatestBlockHeight\",\"params\":[]}' http://127.0.0.1:11030/ | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"result\"])')\" = $TIP ]"

DB_URL_PARTS=$(python3 - "$PGURL" <<'PY'
import sys, urllib.parse as u
p = u.urlparse(sys.argv[1])
print(f"DB_HOST={p.hostname or 'localhost'}\nDB_PORT={p.port or 5432}\nDB_DATABASE={p.path.lstrip('/')}\nDB_USER={p.username or 'postgres'}\nDB_PASSWD={p.password or ''}")
PY
)
BM="$WORK/bitmap_index"; cp -r "$OPI_DIR/modules/bitmap_index" "$BM"
printf '%s\nNETWORK_TYPE=regtest\nDB_READER_API_URL=http://127.0.0.1:11030/\nREPORT_TO_INDEXER=false\n' "$DB_URL_PARTS" >"$BM/.env"
psql "$PGURL" -q -f "$BM/db_init.sql"
(cd "$BM" && python3 bitmap_index.py >"$WORK/bitmap_index.log" 2>&1) &
PIDS+=($!)
wait_for "bitmap_index at tip" sh -c "[ \"\$(psql '$PGURL' -At -c 'select max(block_height) from bitmap_block_hashes')\" = $TIP ]"

# ---- unimap parcel_index ----------------------------------------------------
psql "$PGURL" -q -f "$ROOT/parcel_index/db_init.sql"
PI="$WORK/parcel_env"; mkdir -p "$PI"
printf '%s\nNETWORK_TYPE=regtest\nDB_READER_API_URL=http://127.0.0.1:11030/\nBITCOIN_RPC_URL=http://127.0.0.1:%s/\nBITCOIN_RPC_USER=%s\nBITCOIN_RPC_PASSWD=%s\n' \
  "$DB_URL_PARTS" $RPC_PORT $RPC_USER $RPC_PASS >"$PI/.env"
(cd "$PI" && PYTHONPATH="$ROOT" python3 -m parcel_index.indexer --once)

# ---- assertions -------------------------------------------------------------
fail=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected '$2', got '$3'"; fail=1; fi
}
check "district $B is the first claim" "$D_VALID" "$(psqlq "select inscription_id from bitmaps where bitmap_number=$B")"
check "leading-zero district ignored" "0" "$(psqlq "select count(*) from bitmaps where inscription_id='$D_ZERO'")"
check "future district ignored" "0" "$(psqlq "select count(*) from bitmaps where bitmap_number=99999")"
check "parcel 0 is the first valid claim" "$P_VALID0" "$(psqlq "select inscription_id from parcels where bitmap_number=$B and tx_index=0")"
check "parcel 1 skips no-parent, wrong-parent, duplicate-district parents" "$P_VALID1" "$(psqlq "select inscription_id from parcels where bitmap_number=$B and tx_index=1")"
check "parcel 2 valid" "$P_VALID2" "$(psqlq "select inscription_id from parcels where bitmap_number=$B and tx_index=2")"
check "out-of-range parcel ignored" "0" "$(psqlq "select count(*) from parcels where inscription_id='$P_RANGE'")"
check "leading-zero parcel ignored" "0" "$(psqlq "select count(*) from parcels where inscription_id='$P_ZERO'")"
check "parcel count" "3" "$(psqlq "select count(*) from parcels")"
check "parcel hashes cover every block" "$TIP" "$(psqlq "select max(block_height) from parcel_cumulative_event_hashes")"
exit $fail
