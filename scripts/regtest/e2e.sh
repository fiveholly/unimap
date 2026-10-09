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
# Optional: KEEP_RUNNING=1 keeps bitcoind, ord and the API up after the checks.
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
if curl -sf http://127.0.0.1:$ORD_HTTP/blockcount >/dev/null 2>&1; then
  echo "port $ORD_HTTP already serves an ord server; stop it first" >&2; exit 1
fi
"$ORD" --regtest --datadir "$WORK/ord" --bitcoin-rpc-url 127.0.0.1:$RPC_PORT \
  --bitcoin-rpc-username $RPC_USER --bitcoin-rpc-password $RPC_PASS \
  server --http-port $ORD_HTTP >"$WORK/ord-server.log" 2>&1 &
PIDS+=($!)
wait_for "ord server" curl -sf http://127.0.0.1:$ORD_HTTP/blockcount
wallet create >/dev/null
ADDR=$(wallet receive | python3 -c 'import json,sys; print(json.load(sys.stdin)["addresses"][0])')
mine() { cli generatetoaddress "${1:-1}" "$ADDR" >/dev/null; }
# Start past regtest's jubilee (height 110). Before it, ord marks child inscriptions
# cursed (negative numbers) and OPI's db_reader drops cursed inscriptions.
mine 111
ord_synced() { [ "$(curl -sf http://127.0.0.1:$ORD_HTTP/blockcount)" -gt "$(cli getblockcount)" ]; }
wait_sync() { wait_for "ord sync" ord_synced; }

FILES="$WORK/files"; mkdir -p "$FILES"
# inscribe <name> <text> [parent_id]  -> prints inscription id, mines a block
inscribe() {
  local name="$1" text="$2" parent="${3:-}"
  echo "inscribing $name: $text" >&2
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
opi_height() {
  curl -sf -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getLatestBlockHeight","params":[]}' http://127.0.0.1:11030/ |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["result"])'
}
opi_at_tip() { [ "$(opi_height)" = "$TIP" ]; }
wait_for "OPI ord at tip" opi_at_tip

DB_URL_PARTS=$(python3 - "$PGURL" <<'PY'
import sys, urllib.parse as u
p = u.urlparse(sys.argv[1])
print(f"DB_HOST={p.hostname or 'localhost'}\nDB_PORT={p.port or 5432}\nDB_DATABASE={p.path.lstrip('/')}\nDB_USER={p.username or 'postgres'}\nDB_PASSWD={p.password or ''}")
PY
)
BM="$WORK/bitmap_index"; cp -r "$OPI_DIR/modules/bitmap_index" "$BM"
printf '%s\nNETWORK_TYPE=regtest\nDB_READER_API_URL=http://127.0.0.1:11030/\nREPORT_TO_INDEXER=false\n' "$DB_URL_PARTS" >"$BM/.env"
psql "$PGURL" -q -f "$BM/db_init.sql"
(cd "$BM" && exec python3 bitmap_index.py >"$WORK/bitmap_index.log" 2>&1) &
PIDS+=($!)
bitmap_at_tip() { [ "$(psqlq 'select max(block_height) from bitmap_block_hashes')" = "$TIP" ]; }
wait_for "bitmap_index at tip" bitmap_at_tip

# ---- unimap parcel_index + owner tracker ------------------------------------
psql "$PGURL" -q -f "$ROOT/parcel_index/db_init.sql"
PI="$WORK/parcel_env"; mkdir -p "$PI"
printf '%s\nNETWORK_TYPE=regtest\nDB_READER_API_URL=http://127.0.0.1:11030/\nORD_API_URL=http://127.0.0.1:%s/\nBITCOIN_RPC_URL=http://127.0.0.1:%s/\nBITCOIN_RPC_USER=%s\nBITCOIN_RPC_PASSWD=%s\n' \
  "$DB_URL_PARTS" $ORD_HTTP $RPC_PORT $RPC_USER $RPC_PASS >"$PI/.env"
unimap_index() { # bring OPI, parcel_index and owners up to the current tip
  TIP=$(cli getblockcount)
  wait_for "OPI ord at tip" opi_at_tip
  wait_for "bitmap_index at tip" bitmap_at_tip
  wait_sync
  (cd "$PI" && PYTHONPATH="$ROOT" python3 -m parcel_index.indexer --once)
  (cd "$PI" && PYTHONPATH="$ROOT" python3 -m parcel_index.owners --once)
}
unimap_index
OWNER_BEFORE=$(psqlq "select address from inscription_owners where inscription_id='$P_VALID1'")

# Move parcel 1 to an address outside the ord wallet.
cli -named createwallet wallet_name=ext >/dev/null
EXT=$(cli -rpcwallet=ext getnewaddress "" bech32m)
wallet send --fee-rate 1 "$EXT" "$P_VALID1" >/dev/null
mine 1
unimap_index

# ---- API (land + social) ------------------------------------------------------
psql "$PGURL" -q -f "$ROOT/api/social.sql"
API_PORT=18090
(cd "$PI" && PYTHONPATH="$ROOT" exec python3 -m uvicorn api.app:app --port $API_PORT >"$WORK/api.log" 2>&1) &
PIDS+=($!)
wait_for "land API" curl -sf http://127.0.0.1:$API_PORT/v1/status
api() { curl -sf "http://127.0.0.1:$API_PORT$1"; }
jq_() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
apipost() { curl -s -X POST -H 'content-type: application/json' ${3:+-H "Authorization: Bearer $3"} -d "$2" "http://127.0.0.1:$API_PORT$1"; }
ord_sign() { wallet sign --signer "$1" --text "$2" | jq_ 'd["witness"]'; }

# The district owner signs in with a BIP-322 signature from ord's wallet and posts.
OWNER_ADDR=$(psqlq "select address from inscription_owners where inscription_id='$D_VALID'")
NONCE_JSON=$(apipost /v1/auth/nonce "{\"address\": \"$OWNER_ADDR\"}")
LOGIN_MSG=$(printf '%s' "$NONCE_JSON" | jq_ 'd["message"]')
LOGIN_SIG=$(ord_sign "$OWNER_ADDR" "$LOGIN_MSG")
TOKEN=$(apipost /v1/auth/login "$(python3 -c 'import json,sys; print(json.dumps({"address": sys.argv[1], "nonce": json.loads(sys.argv[2])["nonce"], "signature": sys.argv[3]}))' "$OWNER_ADDR" "$NONCE_JSON" "$LOGIN_SIG")" | jq_ 'd["token"]')
SIGNED_AT=$(date +%s)
POST_MSG=$(PYTHONPATH="$ROOT" python3 -c 'import sys; from api.social import post_message; sys.stdout.write(post_message(int(sys.argv[1]), None, None, int(sys.argv[2]), [], "gm from the owner"))' "$B" "$SIGNED_AT")
POST_SIG=$(ord_sign "$OWNER_ADDR" "$POST_MSG")
POST_JSON=$(apipost /v1/districts/$B/posts "$(python3 -c 'import json,sys; print(json.dumps({"body": "gm from the owner", "signed_at": int(sys.argv[1]), "signature": sys.argv[2]}))' "$SIGNED_AT" "$POST_SIG")" "$TOKEN")

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
check "owners cover every block" "$TIP" "$(psqlq "select max(block_height) from owner_block_hashes")"
check "every district and parcel has an owner row" "$(psqlq "select (select count(*) from bitmaps) + (select count(*) from parcels)")" "$(psqlq "select count(*) from inscription_owners")"
check "district owner matches ord" "$(curl -sf -H 'Accept: application/json' http://127.0.0.1:$ORD_HTTP/inscription/$D_VALID | jq_ 'd["address"]')" "$(psqlq "select address from inscription_owners where inscription_id='$D_VALID'")"
check "parcel 1 was held by the ord wallet before the transfer" "yes" "$([ -n "$OWNER_BEFORE" ] && [ "$OWNER_BEFORE" != "$EXT" ] && echo yes)"
check "parcel 1 owner follows the transfer" "$EXT" "$(psqlq "select address from inscription_owners where inscription_id='$P_VALID1'")"
check "parcel 1 owner updated at the transfer block" "$TIP" "$(psqlq "select updated_height from inscription_owners where inscription_id='$P_VALID1'")"
check "API land: district" "$D_VALID" "$(api /v1/land/$B | jq_ 'd["district"]["inscription_id"]')"
check "API land: parcels" "0,1,2" "$(api /v1/land/$B | jq_ '",".join(str(p["tx_index"]) for p in d["parcels"])')"
check "API land: tx_count" "3" "$(api /v1/land/$B | jq_ 'd["tx_count"]')"
check "API land: unclaimed block" "False" "$(api /v1/land/5 | jq_ 'd["claimed"]')"
check "API parcel owner" "$EXT" "$(api /v1/land/$B/parcels/1 | jq_ 'd["owner"]["address"]')"
check "API address land" "1 0" "$(api /v1/addresses/$EXT/land | jq_ 'len(d["parcels"]), len(d["districts"])')"
check "API land events: parcel 1 transfer" "$OWNER_BEFORE>$EXT" "$(api /v1/land/$B/events | jq_ '[e["from_address"] + ">" + e["to_address"] for e in d["events"] if e["kind"] == "transfer"][0]')"
check "API land events: district claim" "1" "$(api /v1/land/$B/events | jq_ 'sum(e["kind"] == "district_claimed" for e in d["events"])')"
check "social: owner signs in with ord's BIP-322 signature" "yes" "$([ -n "$TOKEN" ] && [ "$TOKEN" != None ] && echo yes)"
check "social: owner post accepted" "owner" "$(printf '%s' "$POST_JSON" | jq_ 'd["author"]["role"]')"
check "social: post listed on district page" "gm from the owner" "$(api /v1/districts/$B/posts | jq_ 'd["posts"][0]["body"]')"
check "API future block 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$API_PORT/v1/land/999999)"
if [ -n "${KEEP_RUNNING:-}" ]; then
  # Leave everything up for manual or browser testing (API_CORS_ORIGINS reaches uvicorn).
  echo "services running: API http://127.0.0.1:$API_PORT, ord http://127.0.0.1:$ORD_HTTP, district $B owner $OWNER_ADDR"
  printf '%s\n' "$B" "$OWNER_ADDR" "$EXT" >"$WORK/dev-info"
  wait
fi
exit $fail
