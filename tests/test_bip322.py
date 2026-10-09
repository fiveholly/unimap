import base64
import json
import os
import unittest

from coincurve import PrivateKey

from api import bip322

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
SUPPORTED = {"p2wpkh", "p2tr"}


def load(name):
    with open(os.path.join(FIXTURES, f"bip322-{name}-test-vectors.json")) as f:
        return json.load(f)


def kind_of(address):
    try:
        return bip322.script_pubkey(address)[0]
    except bip322.Unsupported:
        return None


class Bip322Vectors(unittest.TestCase):
    """Vectors from bitcoin/bips bip-0322/*.json (CC0)."""

    def test_hashes(self):
        for v in load("basic")["tx_hashes"]:
            self.assertEqual(bip322.message_hash(v["message"].encode()).hex(), v["message_hash"])
            spk = bip322.script_pubkey(v["address"])[1]
            self.assertEqual(bip322.to_spend_txid(spk, v["message"].encode())[::-1].hex(), v["to_spend_tx_hash"])

    def test_simple_valid(self):
        n = 0
        for name in ("basic", "generated"):
            for v in load(name)["simple"]:
                if v["type"] not in SUPPORTED:
                    continue
                for sig in v["bip322_signatures"]:
                    with self.subTest(name=name, type=v["type"], message=v["message"]):
                        self.assertTrue(bip322.verify(v["address"], v["message"], sig))
                        n += 1
        self.assertGreaterEqual(n, 6)

    def test_simple_invalid(self):
        n = 0
        for name in ("basic", "generated"):
            for v in load(name)["error"]:
                if kind_of(v["address"]) not in SUPPORTED or v["signature"].startswith("ful"):
                    continue
                with self.subTest(name=name, description=v["description"]):
                    self.assertFalse(bip322.verify(v["address"], v["message"], v["signature"]))
                    n += 1
        self.assertGreaterEqual(n, 8)

    def test_unsupported(self):
        v = load("basic")["simple"][2]  # p2wsh multisig
        with self.assertRaises(bip322.Unsupported):
            bip322.verify(v["address"], v["message"], v["bip322_signatures"][0])
        full = next(v for v in load("generated")["full"] if v["type"] == "p2wpkh")
        with self.assertRaises(bip322.Unsupported):
            bip322.verify(full["address"], full["message"], full["bip322_signatures"][0])


def legacy_sign(key, message, header_base):
    sig = key.sign_recoverable(bip322.legacy_message_hash(message.encode()), hasher=None)
    return base64.b64encode(bytes([header_base + sig[64]]) + sig[:64]).decode()


def bech32_address(hrp, version, program):
    acc = bits = 0
    five = []
    for b in program:
        acc = (acc << 8) | b
        bits += 8
        while bits >= 5:
            bits -= 5
            five.append((acc >> bits) & 31)
    if bits:
        five.append((acc << (5 - bits)) & 31)
    values = [version] + five
    const = 1 if version == 0 else 0x2BC830A3
    poly = bip322._bech32_polymod([ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp] + values + [0] * 6) ^ const
    checksum = [(poly >> 5 * (5 - i)) & 31 for i in range(6)]
    return hrp + "1" + "".join(bip322._BECH32_CHARSET[d] for d in values + checksum)


def base58check(version, payload):
    raw = bytes([version]) + payload
    raw += bip322.dsha256(raw)[:4]
    n = int.from_bytes(raw, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = bip322._B58[r] + s
    return "1" * (len(raw) - len(raw.lstrip(b"\x00"))) + s


class LegacySignatures(unittest.TestCase):
    key = PrivateKey(bytes.fromhex("11" * 32))
    pub = key.public_key.format(compressed=True)

    def test_address_kinds(self):
        h = bip322.hash160(self.pub)
        x = self.pub[1:]
        from coincurve import PublicKeyXOnly

        q = PublicKeyXOnly(x)
        q.tweak_add(bip322.tagged_hash("TapTweak", x))
        addresses = {
            "p2pkh": (base58check(0x00, h), 31),
            "p2sh-p2wpkh": (base58check(0x05, bip322.hash160(b"\x00\x14" + h)), 35),
            "p2wpkh": (bech32_address("bc", 0, h), 39),
            "p2tr": (bech32_address("bc", 1, q.format()), 31),
        }
        for kind, (address, header) in addresses.items():
            with self.subTest(kind=kind):
                sig = legacy_sign(self.key, "unimap login", header)
                self.assertTrue(bip322.verify(address, "unimap login", sig))
                self.assertFalse(bip322.verify(address, "unimap login!", sig))
        other = PrivateKey(bytes.fromhex("22" * 32))
        self.assertFalse(bip322.verify(addresses["p2wpkh"][0], "unimap login", legacy_sign(other, "unimap login", 39)))

    def test_ripemd160_fallback(self):
        for data in (b"", b"abc", b"a" * 1000):
            self.assertEqual(bip322._ripemd160_py(data), bip322._ripemd160(data))


if __name__ == "__main__":
    unittest.main()
