"""礼物: bitcoin sent with a 时间胶囊 (api/capsule.py), locked by Bitcoin itself until block H.

Test networks only (GIFT_NETWORK = signet, testnet or testnet4; anything else, mainnet included,
turns gifts off). Everything that holds value happens in the sender's browser and wallet:

- The gift sits at a fresh Taproot address whose internal key is the BIP-341 NUMS point (nobody
  knows its private key), with one or two script leaves:
    1. <H> OP_CHECKLOCKTIMEVERIFY OP_DROP <recipient> OP_CHECKSIG           the recipient, from H
    2. <H + 262800> OP_CHECKLOCKTIMEVERIFY OP_DROP <sender> OP_CHECKSIG     a refund, ~5 years later
  Leaf 2 is on by default and the sender may leave it out. Nobody, unimap included, can spend
  before H. The recipient's key is their wallet's, or a fresh "礼物钥匙" made in the browser and
  handed over in the 时间锁 card; unimap never sees it.
- The letter's ciphertext is inscribed (ord envelope, commit/reveal) and the reveal's first output
  is the gift address, so the letter's sat and the gift are one UTXO.
- The letter's AES key K is timelock-encrypted to the drand quicknet round at H's estimated time,
  and also split K = S xor R: S is the capsule's escrow_key here, R is in the 时间锁 card. This
  module hands out S only once the gift network's tip is at or past H (backup()). S alone opens
  nothing, and neither does R.

The checks that keep the release honest: H is not taken on trust; the address the sats go to is
rebuilt here from the keys and H (taproot_address), so a capsule registered with a small H can't
be one whose sats are locked to a later block. The tip comes from the operator's own sources
(GIFT_BITCOIN_RPC_URL, a bitcoind on the gift network, and/or GIFT_ESPLORA_URL); with both, the
lower answer is used, and with none reachable nothing is released.

Charging is the 封存 fee alone (api/billing.py, product capsule); a gift is never priced.
"""

import logging
import os
import re
import time

import requests
from coincurve import PublicKeyXOnly
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import btc
from api.auth import current_address
from api.bip322 import _varint, tagged_hash
from api.db import cursor

router = APIRouter()
log = logging.getLogger(__name__)

NETWORKS = ("signet", "testnet", "testnet4")  # never mainnet
TIERS = (50_000, 100_000, 200_000, 300_000, 500_000)
MIN_SATS = 50_000
MAX_SATS = 1_000_000  # a cap for the test networks; GIFT_MAX_SATS
REFUND_BLOCKS = 262_800  # about five years of blocks after H
BLOCK_SECONDS = 600
MAX_BLOCKS = 100 * 52_600  # a hundred years, as capsules
MAX_TLOCK = 4000
TXID = re.compile(r"^[0-9a-f]{64}$")
XONLY = re.compile(r"^[0-9a-f]{64}$")
# BIP-341's NUMS point: lift_x(sha256 of the generator, uncompressed); nobody knows its discrete log.
NUMS = bytes.fromhex("50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0")
ESPLORA = {
    "signet": "https://mempool.space/signet/api",
    "testnet": "https://mempool.space/testnet/api",
    "testnet4": "https://mempool.space/testnet4/api",
}
EXPLORER = {"signet": "https://mempool.space/signet", "testnet": "https://mempool.space/testnet", "testnet4": "https://mempool.space/testnet4"}


def network():
    """The gift network, or None while gifts are off. Mainnet is never one."""
    n = (os.getenv("GIFT_NETWORK") or "").strip().lower()
    return n if n in NETWORKS else None


def max_sats():
    try:
        return max(MIN_SATS, int(os.getenv("GIFT_MAX_SATS") or MAX_SATS))
    except ValueError:
        return MAX_SATS


def esplora_url(net):
    url = (os.getenv("GIFT_ESPLORA_URL") or "").strip()
    if url.lower() == "off":
        return None
    return (url or ESPLORA[net]).rstrip("/")


# --- scripts and the address -------------------------------------------------------------------


def script_num(n):
    """A minimal CScriptNum push of a non-negative n, as Bitcoin Core and @scure/btc-signer write it."""
    if n == 0:
        return b"\x00"
    if 1 <= n <= 16:
        return bytes([0x50 + n])
    b = bytearray()
    while n:
        b.append(n & 0xFF)
        n >>= 8
    if b[-1] & 0x80:
        b.append(0)
    return bytes([len(b)]) + bytes(b)


def lock_leaf(height, xonly):
    """<height> OP_CHECKLOCKTIMEVERIFY OP_DROP <xonly> OP_CHECKSIG"""
    return script_num(height) + b"\xb1\x75\x20" + xonly + b"\xac"


def leaves(height, recipient, sender, refund):
    """The gift's leaf scripts: the recipient's, then the refund's if there is one."""
    out = [lock_leaf(height, recipient)]
    if refund:
        out.append(lock_leaf(height + REFUND_BLOCKS, sender))
    return out


def leaf_hash(script):
    return tagged_hash("TapLeaf", b"\xc0" + _varint(len(script)) + script)


def merkle_root(scripts):
    hashes = [leaf_hash(s) for s in scripts]
    if len(hashes) == 1:
        return hashes[0]
    a, b = sorted(hashes)
    return tagged_hash("TapBranch", a + b)


def output_key(scripts):
    """The tweaked x-only output key: NUMS + tagged_hash(TapTweak, NUMS || root)·G."""
    key = PublicKeyXOnly(NUMS)
    key.tweak_add(tagged_hash("TapTweak", NUMS + merkle_root(scripts)))
    return key.format()


def taproot_address(net, height, recipient, sender, refund):
    """The gift's address on net. Must match giftTaproot in web/lib/gift.ts."""
    return btc.script_address(b"\x51\x20" + output_key(leaves(height, recipient, sender, refund)), net)


def xonly(hexkey, what):
    """An x-only public key from 64 hex (or a 66-hex compressed key, whose prefix is dropped)."""
    s = (hexkey or "").strip().lower()
    if len(s) == 66 and s[:2] in ("02", "03"):
        s = s[2:]
    if not XONLY.match(s):
        raise HTTPException(400, f"{what} must be a 32-byte x-only public key in hex")
    try:
        PublicKeyXOnly(bytes.fromhex(s))
    except ValueError:
        raise HTTPException(400, f"{what} is not a point on the curve")
    return bytes.fromhex(s)


def gift_line(g):
    """The line the capsule's signed text gains with a gift (api/capsule.py capsule_message)."""
    return f"gift: {g['sats']} sats to {g['address']} unlocking at block {g['height']} on {g['network']}"


# --- the gift network's tip -----------------------------------------------------------------------

_tip_cache = {"at": 0.0, "tip": None}


def _rpc_tip():
    url = os.getenv("GIFT_BITCOIN_RPC_URL")
    if not url:
        return None
    from parcel_index.sources import Bitcoind

    try:
        return int(Bitcoind(url, os.getenv("GIFT_BITCOIN_RPC_USER"), os.getenv("GIFT_BITCOIN_RPC_PASSWD")).block_count())
    except Exception:
        log.warning("gift: bitcoind on %s didn't answer", network())
        return None


def _esplora_tip(net):
    url = esplora_url(net)
    if url is None:
        return None
    try:
        r = requests.get(f"{url}/blocks/tip/height", timeout=8)
        r.raise_for_status()
        return int(r.text.strip())
    except (requests.RequestException, ValueError):
        log.warning("gift: %s didn't give a tip", url)
        return None


def fetch_tip(net):
    """The gift network's tip from the operator's sources, the lower if both answer; None if none
    does. Tests replace this."""
    found = [t for t in (_rpc_tip(), _esplora_tip(net)) if t is not None]
    return min(found) if found else None


def tip(net):
    """fetch_tip, kept for 20 seconds."""
    now = time.monotonic()
    if _tip_cache["tip"] is not None and now - _tip_cache["at"] < 20 and _tip_cache.get("net") == net:
        return _tip_cache["tip"]
    t = fetch_tip(net)
    if t is not None:
        _tip_cache.update(at=now, tip=t, net=net)
    return t


def fetch_tx(net, txid):
    """A transaction as esplora describes it (vin, vout), or None if it can't be had. Tests replace this."""
    url = esplora_url(net)
    if url is None:
        return None
    try:
        r = requests.get(f"{url}/tx/{txid}", timeout=8)
        if r.status_code == 404:
            return {}
        r.raise_for_status()
        return r.json()
    except (requests.RequestException, ValueError):
        return None


# --- sealing (called from api/capsule.py seal) ----------------------------------------------------


class GiftIn(BaseModel):
    network: str
    sats: int
    height: int  # H, a block of the gift network
    refund: bool = True
    recipient_key: str = Field(max_length=66)  # x-only hex: the recipient's wallet key, or the 礼物钥匙's
    sender_key: str | None = Field(default=None, max_length=66)  # x-only hex, for the refund leaf
    bearer: bool  # the recipient key is a 礼物钥匙 made in the browser (it rides in the 时间锁 card)
    address: str = Field(max_length=100)
    drand_round: int
    tlock: str = Field(max_length=MAX_TLOCK)  # age-armored: K timelock-encrypted to drand_round


def check_new(g: GiftIn):
    """Check a gift before its capsule is stored: the network, the amount, H against the tip, the
    keys, and that address really is the gift address for these keys and H. Returns what to store."""
    net = network()
    if net is None:
        raise HTTPException(403, "gifts are off on this server")
    if g.network != net:
        raise HTTPException(400, f"gifts here are on {net}")
    if g.sats < MIN_SATS or g.sats > max_sats():
        raise HTTPException(400, f"a gift is {MIN_SATS} to {max_sats()} sats")
    current = tip(net)
    if current is None:
        raise HTTPException(503, f"can't see the {net} tip right now")
    if g.height <= current:
        raise HTTPException(400, f"the gift's block must be after the {net} tip ({current})")
    if g.height > current + MAX_BLOCKS or g.height + REFUND_BLOCKS >= 500_000_000:
        raise HTTPException(400, "the gift's block is too far off")
    recipient = xonly(g.recipient_key, "recipient_key")
    sender = xonly(g.sender_key, "sender_key") if g.refund else None
    if g.refund and sender == recipient:
        raise HTTPException(400, "the refund key must differ from the recipient's")
    address = taproot_address(net, g.height, recipient, sender, g.refund)
    if g.address.strip().lower() != address:
        raise HTTPException(400, "address isn't the gift address for these keys and block")
    if g.drand_round < 1 or not g.tlock.startswith("-----BEGIN AGE ENCRYPTED FILE-----"):
        raise HTTPException(400, "tlock must be an armored drand timelock ciphertext")
    return {
        "network": net,
        "sats": g.sats,
        "height": g.height,
        "refund": g.refund,
        "recipient_key": recipient.hex(),
        "sender_key": sender.hex() if sender else None,
        "bearer": g.bearer,
        "address": address,
        "drand_round": g.drand_round,
        "tlock": g.tlock,
    }


def store(cur, capsule_id, g):
    cur.execute(
        "insert into social.capsule_gifts (capsule_id, network, sats, height, refund, recipient_key, sender_key, bearer, "
        "address, drand_round, tlock) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
        (capsule_id, g["network"], g["sats"], g["height"], g["refund"], g["recipient_key"], g["sender_key"], g["bearer"],
         g["address"], g["drand_round"], g["tlock"]),
    )


# --- routes ------------------------------------------------------------------------------------


def rules():
    """The gift part of /v1/capsules/rules, or None while gifts are off."""
    net = network()
    if net is None:
        return None
    return {
        "network": net,
        "tiers": list(TIERS),
        "min_sats": MIN_SATS,
        "max_sats": max_sats(),
        "refund_blocks": REFUND_BLOCKS,
        "block_seconds": BLOCK_SECONDS,
        "tip": tip(net),
        "esplora": esplora_url(net) or ESPLORA[net],
        "explorer": EXPLORER[net],
    }


GIFT_COLUMNS = (
    "g.capsule_id, g.network, g.sats, g.height, g.refund, g.recipient_key, g.sender_key, g.bearer, g.address, "
    "g.drand_round, g.tlock, g.commit_txid, g.reveal_txid, g.verified, g.funded_at, c.author, c.status, c.escrow_key"
)


def _row(cur, capsule_id):
    cur.execute(f"select {GIFT_COLUMNS} from social.capsule_gifts g join social.capsules c on c.id = g.capsule_id where g.capsule_id = %s;", (capsule_id,))
    row = cur.fetchone()
    if row is None or row["status"] != "sealed":
        raise HTTPException(404, "no gift on this capsule")
    return row


def _view(row, current):
    return {
        "capsule_id": row["capsule_id"],
        "network": row["network"],
        "sats": row["sats"],
        "height": row["height"],
        "refund": row["refund"],
        "refund_height": row["height"] + REFUND_BLOCKS if row["refund"] else None,
        "recipient_key": row["recipient_key"],
        "sender_key": row["sender_key"],
        "bearer": row["bearer"],
        "address": row["address"],
        "author": row["author"],
        "drand_round": row["drand_round"],
        "tlock": row["tlock"],
        "commit_txid": row["commit_txid"],
        "reveal_txid": row["reveal_txid"],
        "inscription_id": f"{row['reveal_txid']}i0" if row["reveal_txid"] else None,
        "verified": row["verified"],
        "funded": row["funded_at"] is not None,
        "tip": current,
        "unlocked": current is not None and current >= row["height"],
        "explorer": EXPLORER[row["network"]],
    }


@router.get("/v1/capsules/{capsule_id}/gift")
def get_gift(capsule_id: str):
    """What anyone with the link may see of a gift: amount, address, scripts' keys, H, txids. Never
    unimap's backup half (that is backup(), from H on)."""
    with cursor(dict_rows=True) as cur:
        row = _row(cur, capsule_id)
    return _view(row, tip(row["network"]))


@router.get("/v1/capsules/{capsule_id}/gift/backup")
def backup(capsule_id: str):
    """unimap's half of the backup key, once the gift network's tip is at or past H. Before that,
    or when the tip can't be seen, nothing."""
    with cursor(dict_rows=True) as cur:
        row = _row(cur, capsule_id)
    current = fetch_tip(row["network"])  # never the cache: a release is decided on a fresh look
    if current is None:
        raise HTTPException(503, f"can't see the {row['network']} tip right now; try again soon")
    if current < row["height"]:
        raise HTTPException(403, f"locked until block {row['height']}; the {row['network']} tip is {current}")
    return {"half": row["escrow_key"], "height": row["height"], "tip": current}


class GiftTxs(BaseModel):
    commit_txid: str = Field(max_length=64)
    reveal_txid: str = Field(max_length=64)


def _check_reveal(row, commit, reveal):
    """True if the reveal is on the network and pays the gift address, False if the explorer can't
    tell yet; raises if it says otherwise."""
    tx = fetch_tx(row["network"], reveal)
    if not tx:
        return False
    outs, ins = tx.get("vout") or [], tx.get("vin") or []
    if not outs or outs[0].get("scriptpubkey_address") != row["address"] or int(outs[0].get("value") or 0) < row["sats"]:
        raise HTTPException(400, "the reveal's first output doesn't pay the gift address its amount")
    if not ins or ins[0].get("txid") != commit:
        raise HTTPException(400, "the reveal doesn't spend the commit")
    return True


@router.post("/v1/capsules/{capsule_id}/gift/txs")
def gift_txs(capsule_id: str, req: GiftTxs, address: str = Depends(current_address)):
    """The sender's browser reports the commit and reveal it broadcast. Checked against the gift
    network's explorer when it can be reached; kept either way, and checked again on later calls."""
    commit, reveal = req.commit_txid.lower(), req.reveal_txid.lower()
    if not TXID.match(commit) or not TXID.match(reveal) or commit == reveal:
        raise HTTPException(422, "txids are 64 hex characters each")
    with cursor(dict_rows=True) as cur:
        row = _row(cur, capsule_id)
        if row["author"] != address:
            raise HTTPException(404, "no gift of yours on this capsule")
        if row["reveal_txid"] and row["reveal_txid"] != reveal and row["verified"]:
            raise HTTPException(409, "this gift is funded already")
        verified = _check_reveal(row, commit, reveal)
        cur.execute(
            "update social.capsule_gifts set commit_txid = %s, reveal_txid = %s, verified = %s, funded_at = coalesce(funded_at, now()) "
            "where capsule_id = %s;",
            (commit, reveal, verified, capsule_id),
        )
        row.update(commit_txid=commit, reveal_txid=reveal, verified=verified, funded_at=row["funded_at"] or True)
    return _view(row, tip(row["network"]))


def public(cur, capsule_id):
    """A gift's summary for the capsule's own view (api/capsule.py), or None."""
    cur.execute("select network, sats, height, refund, address, reveal_txid from social.capsule_gifts where capsule_id = %s;", (capsule_id,))
    r = cur.fetchone()
    if r is None:
        return None
    r = dict(r) if isinstance(r, dict) else dict(zip(("network", "sats", "height", "refund", "address", "reveal_txid"), r))
    return {**r, "funded": r["reveal_txid"] is not None}


