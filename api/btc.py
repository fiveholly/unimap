"""Bitcoin transactions and PSBTs (BIP-174, version 0), as far as the market (api/market.py) needs:
reading and writing them, the signature hashes of segwit v0 (BIP-143) and taproot key-path
(BIP-341) inputs, and checking a signature against them.

Nothing here signs or holds keys: wallets sign, and unimap only checks what they signed.
Fields this module doesn't know are kept as they are, so a PSBT goes back to the wallet with
everything the wallet put in it.
"""

import base64
import struct
from dataclasses import dataclass, field

from coincurve import PublicKey, PublicKeyXOnly

from api.bip322 import (
    _BECH32_CHARSET,
    _bech32_polymod,
    _read_varint,
    _varint,
    dsha256,
    hash160,
    script_pubkey,
    sha256,
    tagged_hash,
)


class BadTx(ValueError):
    pass


SIGHASH_DEFAULT = 0x00  # taproot only: like ALL, with a 64-byte signature
SIGHASH_ALL = 0x01
SIGHASH_NONE = 0x02
SIGHASH_SINGLE = 0x03
SIGHASH_ANYONECANPAY = 0x80
SINGLE_ACP = SIGHASH_SINGLE | SIGHASH_ANYONECANPAY  # a listing: "this input, for that output"

NETWORKS = {"mainnet": "bc", "testnet": "tb", "testnet4": "tb", "signet": "tb", "regtest": "bcrt"}


# --- transactions --------------------------------------------------------------------------


@dataclass
class TxIn:
    txid: str  # as explorers show it (big-endian hex)
    vout: int
    script_sig: bytes = b""
    sequence: int = 0xFFFFFFFD  # opts in to replace-by-fee
    witness: list = field(default_factory=list)

    @property
    def outpoint(self):
        return f"{self.txid}:{self.vout}"

    def _prevout(self):
        return bytes.fromhex(self.txid)[::-1] + struct.pack("<I", self.vout)


@dataclass
class TxOut:
    value: int
    script_pubkey: bytes

    def serialize(self):
        return struct.pack("<q", self.value) + _varint(len(self.script_pubkey)) + self.script_pubkey


@dataclass
class Tx:
    version: int = 2
    inputs: list = field(default_factory=list)
    outputs: list = field(default_factory=list)
    locktime: int = 0

    def serialize(self, witness=True):
        witness = witness and any(i.witness for i in self.inputs)
        out = struct.pack("<i", self.version)
        if witness:
            out += b"\x00\x01"
        out += _varint(len(self.inputs))
        for i in self.inputs:
            out += i._prevout() + _varint(len(i.script_sig)) + i.script_sig + struct.pack("<I", i.sequence)
        out += _varint(len(self.outputs)) + b"".join(o.serialize() for o in self.outputs)
        if witness:
            for i in self.inputs:
                out += _varint(len(i.witness)) + b"".join(_varint(len(w)) + w for w in i.witness)
        return out + struct.pack("<I", self.locktime)

    @property
    def txid(self):
        return dsha256(self.serialize(witness=False))[::-1].hex()

    def vsize(self):
        base = len(self.serialize(witness=False))
        total = len(self.serialize())
        return (base * 3 + total + 3) // 4

    @classmethod
    def parse(cls, raw):
        try:
            tx, i = _parse_tx(raw, 0)
        except (IndexError, struct.error) as e:
            raise BadTx("truncated transaction") from e
        if i != len(raw):
            raise BadTx("trailing bytes after the transaction")
        return tx


def _parse_tx(b, i):
    version = struct.unpack_from("<i", b, i)[0]
    i += 4
    segwit = b[i] == 0 and b[i + 1] == 1
    if segwit:
        i += 2
    n, i = _read_varint(b, i)
    inputs = []
    for _ in range(n):
        txid = b[i : i + 32][::-1].hex()
        vout = struct.unpack_from("<I", b, i + 32)[0]
        i += 36
        k, i = _read_varint(b, i)
        script_sig = b[i : i + k]
        i += k
        sequence = struct.unpack_from("<I", b, i)[0]
        i += 4
        inputs.append(TxIn(txid, vout, script_sig, sequence))
    n, i = _read_varint(b, i)
    outputs = []
    for _ in range(n):
        value = struct.unpack_from("<q", b, i)[0]
        i += 8
        k, i = _read_varint(b, i)
        outputs.append(TxOut(value, b[i : i + k]))
        i += k
    if segwit:
        for txin in inputs:
            n, i = _read_varint(b, i)
            for _ in range(n):
                k, i = _read_varint(b, i)
                txin.witness.append(b[i : i + k])
                i += k
    locktime = struct.unpack_from("<I", b, i)[0]
    return Tx(version, inputs, outputs, locktime), i + 4


# --- PSBT ------------------------------------------------------------------------------------

# Key types (BIP-174, BIP-371) this module reads or writes.
GLOBAL_UNSIGNED_TX = 0x00
IN_WITNESS_UTXO = 0x01
IN_PARTIAL_SIG = 0x02
IN_SIGHASH_TYPE = 0x03
IN_REDEEM_SCRIPT = 0x04
IN_FINAL_SCRIPTSIG = 0x07
IN_FINAL_SCRIPTWITNESS = 0x08
IN_TAP_KEY_SIG = 0x13
IN_TAP_INTERNAL_KEY = 0x17
MAGIC = b"psbt\xff"


class Psbt:
    """A PSBT as its unsigned transaction plus one key-value map per input and output.
    Maps are {key bytes (type byte first): value bytes}, in the order they were read."""

    def __init__(self, tx, globals_=None, inputs=None, outputs=None):
        self.tx = tx
        self.globals = globals_ or {}
        self.inputs = inputs or [{} for _ in tx.inputs]
        self.outputs = outputs or [{} for _ in tx.outputs]

    @classmethod
    def from_tx(cls, tx):
        bare = Tx(tx.version, [TxIn(i.txid, i.vout, b"", i.sequence) for i in tx.inputs], list(tx.outputs), tx.locktime)
        return cls(bare)

    # reading and writing

    @classmethod
    def parse(cls, data):
        """From base64 or hex text, or raw bytes."""
        raw = data
        if isinstance(data, str):
            s = data.strip()
            try:
                raw = bytes.fromhex(s) if s[:10].lower() == MAGIC.hex() else base64.b64decode(s, validate=True)
            except ValueError as e:
                raise BadTx("not a PSBT") from e
        if not raw.startswith(MAGIC):
            raise BadTx("not a PSBT")
        try:
            i = len(MAGIC)
            globals_, i = _read_map(raw, i)
            unsigned = globals_.pop(bytes([GLOBAL_UNSIGNED_TX]), None)
            if unsigned is None:
                raise BadTx("PSBT has no unsigned transaction")
            tx = Tx.parse(unsigned)
            if any(t.script_sig or t.witness for t in tx.inputs):
                raise BadTx("the PSBT's transaction must be unsigned")
            inputs, outputs = [], []
            for _ in tx.inputs:
                m, i = _read_map(raw, i)
                inputs.append(m)
            for _ in tx.outputs:
                m, i = _read_map(raw, i)
                outputs.append(m)
        except (IndexError, struct.error) as e:
            raise BadTx("truncated PSBT") from e
        if i != len(raw):
            raise BadTx("trailing bytes after the PSBT")
        return cls(tx, globals_, inputs, outputs)

    def serialize(self):
        out = MAGIC + _write_map({bytes([GLOBAL_UNSIGNED_TX]): self.tx.serialize(witness=False), **self.globals})
        for m in self.inputs + self.outputs:
            out += _write_map(m)
        return out

    def b64(self):
        return base64.b64encode(self.serialize()).decode()

    # input fields

    def get(self, i, key_type, key_data=b""):
        return self.inputs[i].get(bytes([key_type]) + key_data)

    def set(self, i, key_type, value, key_data=b""):
        self.inputs[i][bytes([key_type]) + key_data] = value

    def witness_utxo(self, i):
        raw = self.get(i, IN_WITNESS_UTXO)
        if raw is None:
            return None
        value = struct.unpack_from("<q", raw, 0)[0]
        n, j = _read_varint(raw, 8)
        return TxOut(value, raw[j : j + n])

    def set_witness_utxo(self, i, txout):
        self.set(i, IN_WITNESS_UTXO, txout.serialize())

    def partial_sigs(self, i):
        """{pubkey: signature with its sighash byte}."""
        return {k[1:]: v for k, v in self.inputs[i].items() if k[0] == IN_PARTIAL_SIG}

    def final_witness(self, i):
        raw = self.get(i, IN_FINAL_SCRIPTWITNESS)
        if raw is None:
            return None
        n, j = _read_varint(raw, 0)
        items = []
        for _ in range(n):
            k, j = _read_varint(raw, j)
            items.append(raw[j : j + k])
            j += k
        return items

    def set_final(self, i, witness, script_sig=b""):
        """Finalize input i: only the final fields, the UTXO and unknown keys stay (BIP-174)."""
        keep = {bytes([IN_WITNESS_UTXO])}
        known = {IN_PARTIAL_SIG, IN_SIGHASH_TYPE, IN_REDEEM_SCRIPT, 0x05, 0x06, IN_TAP_KEY_SIG, 0x14, 0x15, 0x16, IN_TAP_INTERNAL_KEY, 0x18}
        self.inputs[i] = {k: v for k, v in self.inputs[i].items() if k in keep or k[0] not in known}
        self.set(i, IN_FINAL_SCRIPTWITNESS, _varint(len(witness)) + b"".join(_varint(len(w)) + w for w in witness))
        if script_sig:
            self.set(i, IN_FINAL_SCRIPTSIG, script_sig)

    def extract(self):
        """The signed transaction, once every input is final."""
        tx = Tx(self.tx.version, [], list(self.tx.outputs), self.tx.locktime)
        for n, t in enumerate(self.tx.inputs):
            witness = self.final_witness(n)
            if witness is None:
                raise BadTx(f"input {n} isn't signed")
            tx.inputs.append(TxIn(t.txid, t.vout, self.get(n, IN_FINAL_SCRIPTSIG) or b"", t.sequence, witness))
        return tx


def _read_map(b, i):
    out = {}
    while True:
        n, i = _read_varint(b, i)
        if n == 0:
            return out, i
        key = b[i : i + n]
        i += n
        n, i = _read_varint(b, i)
        if i + n > len(b):
            raise BadTx("truncated PSBT")
        if key in out:
            raise BadTx("duplicate PSBT key")
        out[key] = b[i : i + n]
        i += n


def _write_map(m):
    return b"".join(_varint(len(k)) + k + _varint(len(v)) + v for k, v in m.items()) + b"\x00"


# --- signature hashes --------------------------------------------------------------------------


def sighash_segwit_v0(tx, index, script_code, amount, hash_type):
    """BIP-143. script_code with its length prefix."""
    base, acp = hash_type & 0x1F, hash_type & SIGHASH_ANYONECANPAY
    zero = b"\x00" * 32
    prevouts = zero if acp else dsha256(b"".join(i._prevout() for i in tx.inputs))
    sequences = zero if acp or base in (SIGHASH_SINGLE, SIGHASH_NONE) else dsha256(
        b"".join(struct.pack("<I", i.sequence) for i in tx.inputs))
    if base not in (SIGHASH_SINGLE, SIGHASH_NONE):
        outputs = dsha256(b"".join(o.serialize() for o in tx.outputs))
    elif base == SIGHASH_SINGLE and index < len(tx.outputs):
        outputs = dsha256(tx.outputs[index].serialize())
    else:
        outputs = zero
    txin = tx.inputs[index]
    preimage = (
        struct.pack("<i", tx.version) + prevouts + sequences + txin._prevout() + script_code
        + struct.pack("<q", amount) + struct.pack("<I", txin.sequence) + outputs
        + struct.pack("<I", tx.locktime) + struct.pack("<I", hash_type)
    )
    return dsha256(preimage)


def sighash_taproot(tx, index, spent, hash_type):
    """BIP-341 key path, no annex. spent: the TxOut each input spends (all of them, unless ANYONECANPAY)."""
    if hash_type not in (0x00, 0x01, 0x02, 0x03, 0x81, 0x82, 0x83):
        raise BadTx("bad sighash type")
    base, acp = hash_type & 0x03, hash_type & SIGHASH_ANYONECANPAY
    msg = bytes([hash_type]) + struct.pack("<i", tx.version) + struct.pack("<I", tx.locktime)
    if not acp:
        msg += sha256(b"".join(i._prevout() for i in tx.inputs))
        msg += sha256(b"".join(struct.pack("<q", o.value) for o in spent))
        msg += sha256(b"".join(_varint(len(o.script_pubkey)) + o.script_pubkey for o in spent))
        msg += sha256(b"".join(struct.pack("<I", i.sequence) for i in tx.inputs))
    if base not in (SIGHASH_NONE, SIGHASH_SINGLE):
        msg += sha256(b"".join(o.serialize() for o in tx.outputs))
    msg += b"\x00"  # spend type: key path, no annex
    if acp:
        txin, out = tx.inputs[index], spent[index]
        msg += txin._prevout() + struct.pack("<q", out.value) + _varint(len(out.script_pubkey)) + out.script_pubkey
        msg += struct.pack("<I", txin.sequence)
    else:
        msg += struct.pack("<I", index)
    if base == SIGHASH_SINGLE:
        if index >= len(tx.outputs):
            raise BadTx("SIGHASH_SINGLE without a matching output")
        msg += sha256(tx.outputs[index].serialize())
    return tagged_hash("TapSighash", b"\x00" + msg)


def p2wpkh_script_code(pubkey_hash):
    return b"\x19\x76\xa9\x14" + pubkey_hash + b"\x88\xac"


def kind_of(spk):
    """'p2tr', 'p2wpkh', 'p2sh' or None for a scriptPubKey."""
    if len(spk) == 34 and spk[:2] == b"\x51\x20":
        return "p2tr"
    if len(spk) == 22 and spk[:2] == b"\x00\x14":
        return "p2wpkh"
    if len(spk) == 23 and spk[:2] == b"\xa9\x14" and spk[-1] == 0x87:
        return "p2sh"
    return None


def nested_redeem_script(pubkey):
    """P2SH-P2WPKH (Xverse's payment address): the redeem script for a compressed key."""
    return b"\x00\x14" + hash160(pubkey)


def check_signature(tx, index, spent, sig, pubkey=None, redeem_script=None):
    """Whether sig (with its sighash byte, or a 64-byte taproot DEFAULT signature) signs input index of tx.
    spent: list of TxOut for every input (only spent[index] matters with ANYONECANPAY).
    Returns the sighash type. Raises BadTx when it doesn't check out."""
    out = spent[index]
    kind = kind_of(out.script_pubkey)
    if kind == "p2tr":
        if len(sig) == 64:
            hash_type, raw = SIGHASH_DEFAULT, sig
        elif len(sig) == 65 and sig[64] != 0:
            hash_type, raw = sig[64], sig[:64]
        else:
            raise BadTx("bad taproot signature")
        msg = sighash_taproot(tx, index, spent, hash_type)
        try:
            ok = PublicKeyXOnly(out.script_pubkey[2:]).verify(raw, msg)
        except (ValueError, TypeError):
            ok = False
    elif kind in ("p2wpkh", "p2sh"):
        if pubkey is None or len(pubkey) != 33:
            raise BadTx("a segwit v0 signature needs its compressed public key")
        if kind == "p2wpkh" and out.script_pubkey[2:] != hash160(pubkey):
            raise BadTx("the public key doesn't match the address")
        if kind == "p2sh":
            if redeem_script != nested_redeem_script(pubkey) or out.script_pubkey[2:22] != hash160(redeem_script):
                raise BadTx("only P2SH-wrapped P2WPKH is supported")
        hash_type, der = sig[-1], sig[:-1]
        msg = sighash_segwit_v0(tx, index, p2wpkh_script_code(hash160(pubkey)), out.value, hash_type)
        try:
            ok = PublicKey(pubkey).verify(der, msg, hasher=None)
        except (ValueError, TypeError):
            ok = False
    else:
        raise BadTx("only P2TR, P2WPKH and P2SH-P2WPKH inputs are supported")
    if not ok:
        raise BadTx(f"input {index}'s signature doesn't check out")
    return hash_type


def input_signature(psbt, i):
    """(sig, pubkey, redeem_script) a wallet left on input i, final or not; None when unsigned."""
    spk = psbt.witness_utxo(i).script_pubkey
    witness = psbt.final_witness(i)
    if kind_of(spk) == "p2tr":
        if witness:
            return (witness[0], None, None) if len(witness) == 1 else None
        sig = psbt.get(i, IN_TAP_KEY_SIG)
        return (sig, None, None) if sig else None
    redeem = psbt.get(i, IN_REDEEM_SCRIPT)
    if witness:
        script_sig = psbt.get(i, IN_FINAL_SCRIPTSIG) or b""
        if script_sig:
            redeem = script_sig[1:] if script_sig[0] == len(script_sig) - 1 else None
        return (witness[0], witness[1], redeem) if len(witness) == 2 else None
    sigs = psbt.partial_sigs(i)
    if len(sigs) != 1:
        return None
    pubkey, sig = next(iter(sigs.items()))
    return sig, pubkey, redeem


def finalize_input(psbt, i):
    """Turn input i's signature into its final witness (and scriptSig for P2SH-P2WPKH)."""
    found = input_signature(psbt, i)
    if found is None:
        raise BadTx(f"input {i} isn't signed")
    sig, pubkey, redeem = found
    spk = psbt.witness_utxo(i).script_pubkey
    if kind_of(spk) == "p2tr":
        psbt.set_final(i, [sig])
    elif kind_of(spk) == "p2sh":
        psbt.set_final(i, [sig, pubkey], script_sig=bytes([len(redeem)]) + redeem)
    else:
        psbt.set_final(i, [sig, pubkey])


# --- addresses ---------------------------------------------------------------------------------


def address_script(address, network):
    """scriptPubKey of an address on network; P2TR, P2WPKH or P2SH. Raises BadTx otherwise."""
    hrp = NETWORKS[network]
    a = address.strip()
    try:
        kind, spk, _ = script_pubkey(a)
    except ValueError as e:
        raise BadTx(f"not an address: {e}") from e
    if kind not in ("p2tr", "p2wpkh", "p2sh"):
        raise BadTx("only P2TR, P2WPKH and P2SH addresses are supported")
    if kind == "p2sh":
        version = _base58_version(a)
        if (version == 0x05) != (network == "mainnet"):
            raise BadTx(f"that address isn't on {network}")
    elif a.lower().rsplit("1", 1)[0] != hrp:
        raise BadTx(f"that address isn't on {network}")
    return spk


def _base58_version(address):
    from api.bip322 import _decode_base58check

    return _decode_base58check(address)[0]


def script_address(spk, network):
    """Address of a P2TR or P2WPKH scriptPubKey, or None."""
    kind = kind_of(spk)
    if kind not in ("p2tr", "p2wpkh"):
        return None
    hrp, version = NETWORKS[network], 1 if kind == "p2tr" else 0
    data = [version] + _to5(spk[2:])
    const = 0x2BC830A3 if version else 1
    values = [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp] + data
    poly = _bech32_polymod(values + [0] * 6) ^ const
    checksum = [(poly >> 5 * (5 - i)) & 31 for i in range(6)]
    return hrp + "1" + "".join(_BECH32_CHARSET[d] for d in data + checksum)


def _to5(data):
    acc = bits = 0
    out = []
    for v in data:
        acc = (acc << 8) | v
        bits += 8
        while bits >= 5:
            bits -= 5
            out.append((acc >> bits) & 31)
    if bits:
        out.append((acc << (5 - bits)) & 31)
    return out


def dust_limit(spk):
    """Smallest output Bitcoin Core relays to spk."""
    return {"p2tr": 330, "p2wpkh": 294, "p2sh": 540}.get(kind_of(spk), 546)


# Rough vbytes of each input once signed, for fee estimates.
INPUT_VBYTES = {"p2tr": 58, "p2wpkh": 68, "p2sh": 91}
