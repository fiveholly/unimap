import unittest

from parcel_index.rules import ParcelClaim, select_parcels


def ins(iid, num, text):
    return {"inscription_id": iid, "inscription_number": num, "content_hex": text.encode().hex()}


DISTRICTS = {404: "d404i0", 500: "d500i0"}
TX_COUNTS = {404: 3, 500: 1}


def run(inscriptions, parents, taken=()):
    return select_parcels(
        inscriptions,
        parent_of=lambda i: parents.get(i),
        district_of=DISTRICTS.get,
        tx_count_of=TX_COUNTS.__getitem__,
        is_taken=lambda h, t: (h, t) in taken,
    )


class SelectParcelsTest(unittest.TestCase):
    def test_valid_parcel(self):
        out = run([ins("p1i0", 10, "0.404.bitmap")], {"p1i0": "d404i0"})
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].claim, ParcelClaim(0, 404))
        self.assertEqual(out[0].district_inscription_id, "d404i0")

    def test_wrong_parent(self):
        self.assertEqual(run([ins("p1i0", 10, "0.404.bitmap")], {"p1i0": "d500i0"}), [])

    def test_no_parent(self):
        self.assertEqual(run([ins("p1i0", 10, "0.404.bitmap")], {}), [])

    def test_unclaimed_district(self):
        self.assertEqual(run([ins("p1i0", 10, "0.777.bitmap")], {"p1i0": "x"}), [])

    def test_tx_index_out_of_range(self):
        self.assertEqual(run([ins("p1i0", 10, "3.404.bitmap")], {"p1i0": "d404i0"}), [])
        self.assertEqual(len(run([ins("p1i0", 10, "2.404.bitmap")], {"p1i0": "d404i0"})), 1)

    def test_first_is_first_within_block(self):
        out = run(
            [ins("p1i0", 10, "1.404.bitmap"), ins("p2i0", 11, "1.404.bitmap")],
            {"p1i0": "d404i0", "p2i0": "d404i0"},
        )
        self.assertEqual([p.inscription_id for p in out], ["p1i0"])

    def test_invalid_first_does_not_block_valid_second(self):
        out = run(
            [ins("p1i0", 10, "1.404.bitmap"), ins("p2i0", 11, "1.404.bitmap")],
            {"p1i0": "d500i0", "p2i0": "d404i0"},
        )
        self.assertEqual([p.inscription_id for p in out], ["p2i0"])

    def test_taken_in_earlier_block(self):
        self.assertEqual(
            run([ins("p1i0", 10, "1.404.bitmap")], {"p1i0": "d404i0"}, taken={(404, 1)}), []
        )

    def test_district_inscriptions_ignored(self):
        self.assertEqual(run([ins("d1i0", 10, "404.bitmap")], {}), [])


if __name__ == "__main__":
    unittest.main()
