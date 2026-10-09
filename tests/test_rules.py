import unittest

from parcel_index.rules import (
    ParcelClaim,
    block_event_hash,
    cumulative_hash,
    event_str,
    is_candidate_inscription,
    parse_parcel,
    sha256_hex,
    within_block,
)


class ParseParcelTest(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(parse_parcel(b"0.404.bitmap"), ParcelClaim(0, 404))
        self.assertEqual(parse_parcel(b"12.840000.bitmap"), ParcelClaim(12, 840000))
        self.assertEqual(parse_parcel(b"0.0.bitmap"), ParcelClaim(0, 0))

    def test_leading_zeros(self):
        self.assertIsNone(parse_parcel(b"01.404.bitmap"))
        self.assertIsNone(parse_parcel(b"1.0404.bitmap"))

    def test_wrong_shape(self):
        for bad in [
            b"404.bitmap",  # a district, not a parcel
            b"1.2.3.bitmap",
            b".404.bitmap",
            b"1..bitmap",
            b"1.404.Bitmap",
            b"1.404.bitmap ",
            b" 1.404.bitmap",
            b"1.404.bitmap\n",
            b"-1.404.bitmap",
            b"+1.404.bitmap",
            b"1.4e2.bitmap",
            "١.404.bitmap".encode(),  # non-ASCII digit
            b"\xff.404.bitmap",
            b"",
        ]:
            with self.subTest(bad=bad):
                self.assertIsNone(parse_parcel(bad))

    def test_too_long(self):
        self.assertIsNone(parse_parcel(b"1." + b"9" * 70 + b".bitmap"))


class CandidateTest(unittest.TestCase):
    def test_content_type(self):
        self.assertTrue(is_candidate_inscription(5, "text/plain;charset=utf-8"))
        self.assertTrue(is_candidate_inscription(0, "TEXT/PLAIN"))
        self.assertFalse(is_candidate_inscription(5, "text/html"))
        self.assertFalse(is_candidate_inscription(5, None))

    def test_cursed(self):
        self.assertFalse(is_candidate_inscription(-1, "text/plain"))


class WithinBlockTest(unittest.TestCase):
    def test_bounds(self):
        self.assertTrue(within_block(ParcelClaim(0, 1), 1))
        self.assertTrue(within_block(ParcelClaim(2, 1), 3))
        self.assertFalse(within_block(ParcelClaim(3, 1), 3))


class HashTest(unittest.TestCase):
    def test_event_hash_matches_opi_construction(self):
        events = [event_str("abci0", ParcelClaim(1, 2)), event_str("defi0", ParcelClaim(0, 2))]
        self.assertEqual(
            block_event_hash(events),
            sha256_hex("parcel;abci0;1;2|parcel;defi0;0;2"),
        )
        self.assertEqual(block_event_hash([]), sha256_hex(""))

    def test_cumulative(self):
        self.assertEqual(cumulative_hash(None, "aa"), "aa")
        self.assertEqual(cumulative_hash("aa", "bb"), sha256_hex("aabb"))


if __name__ == "__main__":
    unittest.main()
