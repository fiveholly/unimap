"""Bitcoin message signature verification for wallet login.

Supports what Bitcoin wallets (UniSat, Xverse, OKX, ord) actually produce:

- BIP-322 "simple" signatures for P2WPKH and single-key P2TR (key path) addresses,
  with or without the "smp" variant prefix.
- Legacy BIP-137 "Bitcoin Signed Message" ECDSA signatures for P2PKH, P2SH-P2WPKH
  and P2WPKH addresses, and for P2TR addresses whose output key is the signing
  key tweaked with no script tree (UniSat's "ecdsa" mode on taproot accounts).

verify(address, message, signature) returns True or False; it raises
Unsupported for address or signature kinds outside that list.
"""

import base64
import hashlib
import struct

from coincurve import PublicKey, PublicKeyXOnly


class Unsupported(ValueError):
    pass


class Invalid(ValueError):
    pass


# --- hashing -----------------------------------------------------------------


def sha256(b):
    return hashlib.sha256(b).digest()


def dsha256(b):
    return sha256(sha256(b))


def tagged_hash(tag, msg):
    t = sha256(tag.encode())
    return sha256(t + t + msg)


def _ripemd160(b):
    try:
        return hashlib.new("ripemd160", b).digest()
    except ValueError:  # OpenSSL 3 without the legacy provider
        return _ripemd160_py(b)


def hash160(b):
    return _ripemd160(sha256(b))


def _ripemd160_py(msg):
    # Straightforward RIPEMD-160 (only used when OpenSSL lacks it).
    def rol(x, n):
        return ((x << n) | (x >> (32 - n))) & 0xFFFFFFFF

    f = [
        lambda x, y, z: x ^ y ^ z,
        lambda x, y, z: (x & y) | (~x & z),
        lambda x, y, z: (x | ~y) ^ z,
        lambda x, y, z: (x & z) | (y & ~z),
        lambda x, y, z: x ^ (y | ~z),
    ]
    kl = [0x00000000, 0x5A827999, 0x6ED9EBA1, 0x8F1BBCDC, 0xA953FD4E]
    kr = [0x50A28BE6, 0x5C4DD124, 0x6D703EF3, 0x7A6D76E9, 0x00000000]
    rl = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
        3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
        1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
        4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
    ]
    rr = [
        5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
        6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
        15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
        8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
        12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
    ]
    sl = [
        11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
        7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
        11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
        11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
        9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
    ]
    sr = [
        8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
        9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
        9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
        15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
        8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
    ]
    h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]
    ml = len(msg) * 8
    msg = msg + b"\x80" + b"\x00" * ((55 - len(msg)) % 64) + struct.pack("<Q", ml)
    for i in range(0, len(msg), 64):
        x = struct.unpack("<16I", msg[i : i + 64])
        al, bl, cl, dl, el = h
        ar, br, cr, dr, er = h
        for j in range(80):
            r = j // 16
            t = rol((al + (f[r](bl, cl, dl) & 0xFFFFFFFF) + x[rl[j]] + kl[r]) & 0xFFFFFFFF, sl[j]) + el
            al, el, dl, cl, bl = el, dl, rol(cl, 10), bl, t & 0xFFFFFFFF
            t = rol((ar + (f[4 - r](br, cr, dr) & 0xFFFFFFFF) + x[rr[j]] + kr[r]) & 0xFFFFFFFF, sr[j]) + er
            ar, er, dr, cr, br = er, dr, rol(cr, 10), br, t & 0xFFFFFFFF
        t = (h[1] + cl + dr) & 0xFFFFFFFF
        h[1] = (h[2] + dl + er) & 0xFFFFFFFF
        h[2] = (h[3] + el + ar) & 0xFFFFFFFF
        h[3] = (h[4] + al + br) & 0xFFFFFFFF
        h[4] = (h[0] + bl + cr) & 0xFFFFFFFF
        h[0] = t
    return struct.pack("<5I", *h)


# --- addresses -----------------------------------------------------------------

_BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
_BECH32_HRPS = ("bc", "tb", "bcrt")
_P2PKH_VERSIONS = (0x00, 0x6F)
_P2SH_VERSIONS = (0x05, 0xC4)


def _bech32_polymod(values):
    gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ v
        for i in range(5):
            chk ^= gen[i] if ((b >> i) & 1) else 0
    return chk


def _convertbits(data, frombits, tobits):
    acc = bits = 0
    out = []
    for v in data:
        acc = (acc << frombits) | v
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            out.append((acc >> bits) & ((1 << tobits) - 1))
    if bits >= frombits or ((acc << (tobits - bits)) & ((1 << tobits) - 1)):
        raise Invalid("bad bech32 padding")
    return out


def _decode_segwit(address):
    if address.lower() != address and address.upper() != address:
        raise Invalid("mixed-case bech32")
    address = address.lower()
    pos = address.rfind("1")
    hrp, data = address[:pos], address[pos + 1 :]
    if hrp not in _BECH32_HRPS or len(data) < 6:
        raise Invalid("not a segwit address")
    values = [_BECH32_CHARSET.find(c) for c in data]
    if -1 in values:
        raise Invalid("bad bech32 character")
    const = _bech32_polymod([ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp] + values)
    version = values[0]
    if const != (1 if version == 0 else 0x2BC830A3):
        raise Invalid("bad bech32 checksum")
    program = bytes(_convertbits(values[1:-6], 5, 8))
    if not 2 <= len(program) <= 40 or version > 16:
        raise Invalid("bad witness program")
    return version, program


_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _decode_base58check(address):
    n = 0
    for c in address:
        i = _B58.find(c)
        if i < 0:
            raise Invalid("bad base58 character")
        n = n * 58 + i
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    raw = b"\x00" * (len(address) - len(address.lstrip("1"))) + raw
    if len(raw) != 25 or dsha256(raw[:21])[:4] != raw[21:]:
        raise Invalid("bad base58 checksum")
    return raw[0], raw[1:21]


def script_pubkey(address):
    """(kind, scriptPubKey, program) for an address."""
    if address[:2].lower() in ("bc", "tb"):
        version, program = _decode_segwit(address)
        if version == 0 and len(program) == 20:
            return "p2wpkh", b"\x00\x14" + program, program
        if version == 1 and len(program) == 32:
            return "p2tr", b"\x51\x20" + program, program
        raise Unsupported("only P2WPKH and P2TR segwit addresses are supported")
    version, h = _decode_base58check(address)
    if version in _P2PKH_VERSIONS:
        return "p2pkh", b"\x76\xa9\x14" + h + b"\x88\xac", h
    if version in _P2SH_VERSIONS:
        return "p2sh", b"\xa9\x14" + h + b"\x87", h
    raise Invalid("unknown address version")


# --- BIP-322 simple ---------------------------------------------------------------


def _varint(n):
    if n < 0xFD:
        return bytes([n])
    if n <= 0xFFFF:
        return b"\xfd" + struct.pack("<H", n)
    return b"\xfe" + struct.pack("<I", n)


def _read_varint(b, i):
    n = b[i]
    if n < 0xFD:
        return n, i + 1
    if n == 0xFD:
        return struct.unpack_from("<H", b, i + 1)[0], i + 3
    if n == 0xFE:
        return struct.unpack_from("<I", b, i + 1)[0], i + 5
    raise Invalid("varint too large")


def message_hash(message):
    return tagged_hash("BIP0322-signed-message", message)


def to_spend_txid(spk, message):
    """Internal byte order (as used in to_sign's prevout)."""
    script_sig = b"\x00\x20" + message_hash(message)
    tx = (
        b"\x00\x00\x00\x00"  # version 0
        + b"\x01" + b"\x00" * 32 + b"\xff\xff\xff\xff"
        + _varint(len(script_sig)) + script_sig
        + b"\x00\x00\x00\x00"  # sequence
        + b"\x01" + b"\x00" * 8 + _varint(len(spk)) + spk
        + b"\x00\x00\x00\x00"  # locktime
    )
    return dsha256(tx)


_OP_RETURN_OUTPUT = b"\x00" * 8 + b"\x01\x6a"


def _bip143_sighash(prevout, pubkey_hash, hash_type):
    script_code = b"\x19\x76\xa9\x14" + pubkey_hash + b"\x88\xac"
    preimage = (
        b"\x00\x00\x00\x00"
        + dsha256(prevout)
        + dsha256(b"\x00\x00\x00\x00")
        + prevout
        + script_code
        + b"\x00" * 8  # amount
        + b"\x00\x00\x00\x00"  # sequence
        + dsha256(_OP_RETURN_OUTPUT)
        + b"\x00\x00\x00\x00"  # locktime
        + struct.pack("<I", hash_type)
    )
    return dsha256(preimage)


def _bip341_sighash(prevout, spk, hash_type):
    sigmsg = (
        b"\x00"  # epoch
        + bytes([hash_type])
        + b"\x00\x00\x00\x00"  # version
        + b"\x00\x00\x00\x00"  # locktime
        + sha256(prevout)
        + sha256(b"\x00" * 8)
        + sha256(_varint(len(spk)) + spk)
        + sha256(b"\x00\x00\x00\x00")
        + sha256(_OP_RETURN_OUTPUT)
        + b"\x00"  # spend type: key path, no annex
        + b"\x00\x00\x00\x00"  # input index
    )
    return tagged_hash("TapSighash", sigmsg)


def _parse_witness(raw):
    count, i = _read_varint(raw, 0)
    items = []
    for _ in range(count):
        n, i = _read_varint(raw, i)
        if i + n > len(raw):
            raise Invalid("truncated witness")
        items.append(raw[i : i + n])
        i += n
    if i != len(raw):
        raise Invalid("trailing bytes after witness")
    return items


def _ecdsa_verify(pubkey, sig_der, msg32):
    try:
        return PublicKey(pubkey).verify(sig_der, msg32, hasher=None)
    except (ValueError, TypeError):
        return False


def verify_simple(address, message, witness_raw):
    kind, spk, program = script_pubkey(address)
    witness = _parse_witness(witness_raw)
    prevout = to_spend_txid(spk, message) + b"\x00\x00\x00\x00"
    if kind == "p2wpkh":
        if len(witness) != 2 or len(witness[1]) != 33 or hash160(witness[1]) != program:
            return False
        sig = witness[0]
        if len(sig) < 9 or sig[-1] != 0x01:  # SIGHASH_ALL only
            return False
        return _ecdsa_verify(witness[1], sig[:-1], _bip143_sighash(prevout, program, 0x01))
    if kind == "p2tr":
        if len(witness) != 1:
            return False
        sig = witness[0]
        if len(sig) == 64:
            hash_type = 0x00
        elif len(sig) == 65 and sig[64] == 0x01:
            hash_type, sig = 0x01, sig[:64]
        else:
            return False
        try:
            return PublicKeyXOnly(program).verify(sig, _bip341_sighash(prevout, spk, hash_type))
        except ValueError:
            return False
    raise Unsupported(f"BIP-322 simple signatures for {kind} addresses are not supported")


# --- BIP-137 legacy -------------------------------------------------------------------


def legacy_message_hash(message):
    prefix = b"\x18Bitcoin Signed Message:\n"
    return dsha256(prefix + _varint(len(message)) + message)


def verify_legacy(address, message, sig65):
    header = sig65[0]
    if not 27 <= header <= 42:
        return False
    recid = (header - 27) & 3
    compressed = header >= 31
    try:
        pub = PublicKey.from_signature_and_message(sig65[1:] + bytes([recid]), legacy_message_hash(message), hasher=None)
    except (ValueError, TypeError):
        return False
    kind, _, program = script_pubkey(address)
    pub_c = pub.format(compressed=True)
    if kind == "p2pkh":
        return hash160(pub.format(compressed=compressed)) == program
    if not compressed:
        return False
    if kind == "p2wpkh":
        return hash160(pub_c) == program
    if kind == "p2sh":  # P2SH-P2WPKH
        return hash160(b"\x00\x14" + hash160(pub_c)) == program
    if kind == "p2tr":
        x = pub_c[1:]
        out = PublicKeyXOnly(x)
        out.tweak_add(tagged_hash("TapTweak", x))
        return out.format() == program
    return False


# --- entry point ------------------------------------------------------------------------


def verify(address, message, signature):
    """Check signature (base64) over message (str or bytes) for address."""
    if isinstance(message, str):
        message = message.encode()
    if signature.startswith("ful"):
        raise Unsupported("BIP-322 full signatures are not supported")
    if signature.startswith("smp"):
        signature = signature[3:]
    try:
        raw = base64.b64decode(signature, validate=True)
    except ValueError:
        return False
    if not raw:
        return False
    try:
        # A 65-byte blob with a BIP-137 header is a legacy signature; a witness
        # starts with its item count (1 or 2), never 27..42.
        if len(raw) == 65 and 27 <= raw[0] <= 42:
            return verify_legacy(address, message, raw)
        return verify_simple(address, message, raw)
    except (Invalid, IndexError, struct.error):
        return False
