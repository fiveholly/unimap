#!/usr/bin/env bash
# How far each part of the unimap node has synced.  Usage: sudo deploy/status.sh
set -uo pipefail
set -a; . /etc/unimap/unimap.env; set +a

cli() { /opt/unimap/bin/bitcoin-cli -conf=/etc/unimap/bitcoin.conf -datadir="$DATA_DIR/bitcoin" "$@" 2>/dev/null; }
sql() { PGPASSWORD="$DB_PASSWD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_DATABASE" -Atc "$1" 2>/dev/null; }
row() { printf '%-26s %s\n' "$1" "${2:-—}"; }

info=$(cli getblockchaininfo)
if [ -n "$info" ]; then
  row "bitcoind" "$(jq -r '"\(.blocks) / \(.headers) blocks, \((.verificationprogress * 1000 | floor) / 10)% verified"' <<<"$info")"
else
  row "bitcoind" "not answering (starting, or see journalctl -u unimap-bitcoind)"
fi
row "ord server" "$(curl -sf http://127.0.0.1:8080/blockcount)"
row "OPI ord" "$(curl -sf -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getLatestBlockHeight","params":[]}' "$DB_READER_API_URL" | jq -r .result 2>/dev/null)"
row "OPI bitmap_index" "$(sql 'select max(block_height) from bitmap_block_hashes')"
row "parcel_index" "$(sql 'select max(block_height) from parcel_cumulative_event_hashes')"
row "owners" "$(sql 'select max(block_height) from owner_block_hashes')"
row "zones" "$(sql 'select max(block_height) from block_stats')"
row "API" "$(curl -sf http://127.0.0.1:8000/v1/status)"
row "web" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/)"
echo
systemctl --no-pager --plain list-units 'unimap-*' --all | sed -n '1,12p'
