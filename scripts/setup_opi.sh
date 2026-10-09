#!/usr/bin/env bash
# Fetch OPI at the pinned commit, apply unimap's patches and build its ord fork.
# Usage: scripts/setup_opi.sh <target-dir>
set -euo pipefail

OPI_REPO=https://github.com/bestinslot-xyz/OPI.git
OPI_COMMIT=0a09b987c87692ec3cabd404c8bcc7367707ee9a

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:?usage: setup_opi.sh <target-dir>}"

if [ ! -d "$DEST/.git" ]; then
  git clone "$OPI_REPO" "$DEST"
fi
git -C "$DEST" fetch --depth 1 origin "$OPI_COMMIT"
git -C "$DEST" checkout --detach "$OPI_COMMIT"
for p in "$ROOT"/patches/*.patch; do
  if git -C "$DEST" apply --reverse --check "$p" 2>/dev/null; then
    echo "already applied: $(basename "$p")"
  else
    git -C "$DEST" apply "$p"
    echo "applied: $(basename "$p")"
  fi
done
(cd "$DEST/ord" && cargo build --release)
echo "OPI ord: $DEST/ord/target/release/ord"
