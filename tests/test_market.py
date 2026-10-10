"""Transactions and PSBTs for 站内交易 (api/btc.py), and test signers the market tests share.

The taproot signature hash is checked against BIP-341's own wallet test vectors
(tests/data/bip341_wallet_vectors.json, from github.com/bitcoin/bips, BSD-licensed)."""

import json
import os
import unittest

from coincurve import PrivateKey

from api import bip322, btc
from tests.test_bip322 import bech32_address

ROOT = os.path.dirname(os.path.abspath(__file__))
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141


class SegwitKey:
    """A P2WPKH key (or, nested, P2SH-P2WPKH)."""

    def __init__(self, seed):
        self.key = PrivateKey(bytes([seed]) * 32)
        self.pubkey = self.key.public_key.format(compressed=True)
        self.hash = bip322.hash160(self.pubkey)

    def address(self, hrp="bcrt"):
        return bech32_address(hrp, 0, self.hash)

    def sign(self, psbt, i, spent, hash_type=btc.SIGHASH_ALL):
        msg = btc.sighash_segwit_v0(psbt.tx, i, btc.p2wpkh_script_code(self.hash), spent[i].value, hash_type)
        psbt.set(i, btc.IN_PARTIAL_SIG, self.key.sign(msg, hasher=None) + bytes([hash_type]), key_data=self.pubkey)


class TaprootKey:
    """A single-key P2TR key, spent by key path (BIP-86 style tweak, no script tree)."""

    def __init__(self, seed):
        d = int.from_bytes(bytes([seed]) * 32, "big")
        point = PrivateKey(d.to_bytes(32, "big")).public_key.format(compressed=True)
        if point[0] == 3:
            d = N - d
        self.internal = point[1:]
        d = (d + int.from_bytes(bip322.tagged_hash("TapTweak", self.internal), "big")) % N
        self.tweaked = PrivateKey(d.to_bytes(32, "big"))
        self.output = self.tweaked.public_key.format(compressed=True)[1:]

    def address(self, hrp="bcrt"):
        return bech32_address(hrp, 1, self.output)

    def sign(self, psbt, i, spent, hash_type=btc.SIGHASH_DEFAULT):
        msg = btc.sighash_taproot(psbt.tx, i, spent, hash_type)
        sig = self.tweaked.sign_schnorr(msg) + (bytes([hash_type]) if hash_type else b"")
        psbt.set(i, btc.IN_TAP_KEY_SIG, sig)


def txid(n):
    return f"{n:064x}"


class Codec(unittest.TestCase):
    def test_bip341_vectors(self):
        with open(os.path.join(ROOT, "data", "bip341_wallet_vectors.json")) as f:
            case = json.load(f)["keyPathSpending"][0]
        tx = btc.Tx.parse(bytes.fromhex(case["given"]["rawUnsignedTx"]))
        spent = [btc.TxOut(u["amountSats"], bytes.fromhex(u["scriptPubKey"])) for u in case["given"]["utxosSpent"]]
        for inp in case["inputSpending"]:
            i, hash_type = inp["given"]["txinIndex"], inp["given"]["hashType"]
            with self.subTest(index=i, hash_type=hash_type):
                self.assertEqual(btc.sighash_taproot(tx, i, spent, hash_type).hex(), inp["intermediary"]["sigHash"])
        self.assertEqual(tx.serialize(witness=False).hex(), case["given"]["rawUnsignedTx"])

    def test_psbt_round_trip_keeps_unknown_fields(self):
        tx = btc.Tx(2, [btc.TxIn(txid(1), 0), btc.TxIn(txid(2), 3)], [btc.TxOut(1000, b"\x00\x14" + b"\x11" * 20)])
        p = btc.Psbt.from_tx(tx)
        p.set_witness_utxo(0, btc.TxOut(5000, b"\x51\x20" + b"\x22" * 32))
        p.inputs[1][b"\xfc\x05hello"] = b"proprietary"
        p.outputs[0][b"\x02"] = b"\x33" * 32
        again = btc.Psbt.parse(p.b64())
        self.assertEqual(again.serialize(), p.serialize())
        self.assertEqual(btc.Psbt.parse(p.serialize().hex()).serialize(), p.serialize())
        self.assertEqual(again.witness_utxo(0), btc.TxOut(5000, b"\x51\x20" + b"\x22" * 32))
        for bad in ("", "cHNidP8=", "aGVsbG8=", p.b64()[:-8]):
            with self.assertRaises(btc.BadTx, msg=bad):
                btc.Psbt.parse(bad)

    def test_addresses(self):
        tr, wpkh = TaprootKey(7), SegwitKey(8)
        for net, hrp in (("regtest", "bcrt"), ("testnet4", "tb"), ("mainnet", "bc")):
            for a in (tr.address(hrp), wpkh.address(hrp)):
                self.assertEqual(btc.script_address(btc.address_script(a, net), net), a)
        with self.assertRaises(btc.BadTx):
            btc.address_script(tr.address("bc"), "testnet4")
        with self.assertRaises(btc.BadTx):
            btc.address_script("not an address", "regtest")

    def test_a_listing_signature_binds_its_output_only(self):
        seller = TaprootKey(9)
        utxo = btc.TxOut(546, b"\x51\x20" + seller.output)
        listing = btc.Psbt.from_tx(btc.Tx(2, [btc.TxIn(txid(5), 1)], [btc.TxOut(50_000, b"\x00\x14" + b"\x44" * 20)]))
        seller.sign(listing, 0, [utxo], btc.SINGLE_ACP)
        sig = listing.get(0, btc.IN_TAP_KEY_SIG)
        self.assertEqual(btc.check_signature(listing.tx, 0, [utxo], sig), btc.SINGLE_ACP)
        # Moved to index 2 of a bigger transaction, with its output at index 2, it still holds.
        other = [btc.TxOut(600, b"\x00\x14" + b"\x55" * 20), btc.TxOut(700, b"\x00\x14" + b"\x55" * 20)]
        big = btc.Tx(2, [btc.TxIn(txid(6), 0), btc.TxIn(txid(7), 0), listing.tx.inputs[0], btc.TxIn(txid(8), 2)],
                     [btc.TxOut(1300, b"\x00\x14" + b"\x55" * 20), btc.TxOut(546, b"\x51\x20" + b"\x66" * 32), listing.tx.outputs[0]])
        spent = other + [utxo, btc.TxOut(90_000, b"\x00\x14" + b"\x55" * 20)]
        self.assertEqual(btc.check_signature(big, 2, spent, sig), btc.SINGLE_ACP)
        # Paying the seller less, or somewhere else, breaks it.
        for out in (btc.TxOut(49_999, listing.tx.outputs[0].script_pubkey), btc.TxOut(50_000, b"\x00\x14" + b"\x45" * 20)):
            big.outputs[2] = out
            with self.assertRaises(btc.BadTx):
                btc.check_signature(big, 2, spent, sig)

    def test_segwit_v0_and_nested_signatures(self):
        key = SegwitKey(10)
        nested_spk = b"\xa9\x14" + bip322.hash160(btc.nested_redeem_script(key.pubkey)) + b"\x87"
        for spk, redeem in ((b"\x00\x14" + key.hash, None), (nested_spk, btc.nested_redeem_script(key.pubkey))):
            p = btc.Psbt.from_tx(btc.Tx(2, [btc.TxIn(txid(11), 0)], [btc.TxOut(9_000, b"\x51\x20" + b"\x77" * 32)]))
            spent = [btc.TxOut(10_000, spk)]
            p.set_witness_utxo(0, spent[0])
            if redeem:
                p.set(0, btc.IN_REDEEM_SCRIPT, redeem)
            key.sign(p, 0, spent)
            sig, pub, rs = btc.input_signature(p, 0)
            self.assertEqual(btc.check_signature(p.tx, 0, spent, sig, pub, rs), btc.SIGHASH_ALL)
            btc.finalize_input(p, 0)
            signed = p.extract()
            self.assertEqual(signed.inputs[0].witness, [sig, key.pubkey])
            self.assertEqual(signed.inputs[0].script_sig, bytes([22]) + redeem if redeem else b"")
            self.assertEqual(btc.Tx.parse(signed.serialize()).serialize(), signed.serialize())
            with self.assertRaises(btc.BadTx):
                btc.check_signature(p.tx, 0, [btc.TxOut(10_001, spk)], sig, pub, rs)


if __name__ == "__main__":
    unittest.main()
