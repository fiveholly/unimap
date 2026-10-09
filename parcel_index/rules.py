"""Bitmap parcel validity rules.

A parcel is valid when all five rules hold (see docs/parcel-rules.md):
  1. content is exactly `{tx_index}.{block_height}.bitmap`, no leading zeros
  2. inscription number >= 0 and content type starts with text/plain
  3. its first parent is the valid district inscription for block_height
  4. tx_index < transaction count of block_height
  5. first is first: lowest inscription number wins for each (block_height, tx_index)

Rules 1, 2 and 4 are pure and live here. Rules 3 and 5 need the database
and are applied by the indexer.
"""

import hashlib
from dataclasses import dataclass
from typing import Optional

SUFFIX = ".bitmap"
EVENT_SEPARATOR = "|"
# Same check as OPI's is_valid_bitmap: hex of "text/plain".
TEXT_PLAIN = "text/plain"
# "{tx}.{height}.bitmap" never exceeds this many bytes on any realistic chain.
MAX_CONTENT_BYTES = 64


@dataclass(frozen=True)
class ParcelClaim:
    tx_index: int
    block_height: int


def _parse_number(s: str) -> Optional[int]:
    # Mirrors OPI get_bitmap_number: ASCII digits only, no leading zeros except "0".
    if len(s) == 0:
        return None
    for ch in s:
        if ch < "0" or ch > "9":
            return None
    if s[0] == "0" and len(s) != 1:
        return None
    return int(s)


def parse_parcel(content: bytes) -> Optional[ParcelClaim]:
    """Rule 1. Returns the claim, or None when content is not a parcel."""
    if len(content) > MAX_CONTENT_BYTES:
        return None
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if not text.endswith(SUFFIX):
        return None
    parts = text[: -len(SUFFIX)].split(".")
    if len(parts) != 2:
        return None
    tx_index = _parse_number(parts[0])
    block_height = _parse_number(parts[1])
    if tx_index is None or block_height is None:
        return None
    return ParcelClaim(tx_index=tx_index, block_height=block_height)


def is_candidate_inscription(inscription_number: int, content_type: Optional[str]) -> bool:
    """Rule 2."""
    if inscription_number < 0:
        return False
    if content_type is None:
        return False
    return content_type.lower().startswith(TEXT_PLAIN)


def within_block(claim: ParcelClaim, transaction_count: int) -> bool:
    """Rule 4."""
    return claim.tx_index < transaction_count


def event_str(inscription_id: str, claim: ParcelClaim) -> str:
    return f"parcel;{inscription_id};{claim.tx_index};{claim.block_height}"


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def block_event_hash(events: list) -> str:
    """Same construction as OPI: events joined by '|', then SHA-256."""
    return sha256_hex(EVENT_SEPARATOR.join(events))


def cumulative_hash(previous: Optional[str], block_hash: str) -> str:
    if previous is None:
        return block_hash
    return sha256_hex(previous + block_hash)


@dataclass(frozen=True)
class AcceptedParcel:
    inscription_id: str
    inscription_number: int
    claim: ParcelClaim
    district_inscription_id: str


def select_parcels(inscriptions, parent_of, district_of, tx_count_of, is_taken):
    """Apply all five rules to one block's new text inscriptions.

    inscriptions: dicts with inscription_id, inscription_number, content_hex,
      sorted by inscription_number (as OPI's db_reader returns them).
    parent_of(inscription_id) -> first parent id or None
    district_of(block_height) -> valid district inscription id or None
    tx_count_of(block_height) -> int
    is_taken(block_height, tx_index) -> True when an earlier block already holds it
    Returns AcceptedParcel list in acceptance order.
    """
    accepted = []
    taken_here = set()
    for ins in inscriptions:
        try:
            content = bytes.fromhex(ins["content_hex"])
        except ValueError:
            continue
        claim = parse_parcel(content)
        if claim is None:
            continue
        key = (claim.block_height, claim.tx_index)
        if key in taken_here or is_taken(*key):
            continue  # rule 5
        district = district_of(claim.block_height)
        if district is None or parent_of(ins["inscription_id"]) != district:
            continue  # rule 3
        if not within_block(claim, tx_count_of(claim.block_height)):
            continue  # rule 4
        taken_here.add(key)
        accepted.append(
            AcceptedParcel(ins["inscription_id"], ins["inscription_number"], claim, district)
        )
    return accepted
