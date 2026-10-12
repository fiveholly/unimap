"""站内交易: buying and selling districts and parcels in unimap itself, with PSBTs. unimap never holds
the inscription or the money; it only puts together what the two wallets sign.

Selling: the owner's wallet signs a half-made transaction, "this inscription's output, for an
output paying me P sats", with SIGHASH_SINGLE|ANYONECANPAY. That signature stays good for any
transaction that pays P to that address at the same position, and for no other.

Buying: unimap completes it with the buyer's own coins, laid out so the inscription's sats land
in the buyer's output and the seller's output sits at the index the seller signed:

    inputs                       outputs
    0  buyer's dummy A           0  buyer: A + B (gives the dummies back)
    1  buyer's dummy B           1  buyer: V, the inscription (V = the seller's output value)
    2  seller's inscription      2  seller: P (what the seller signed)
    3+ buyer's coins             3  unimap's fee, when MARKET_FEE_BPS is set
                                 +  two new 600-sat dummies for the buyer's next purchase
                                 +  change

Sats move through a transaction in order, so output 0 takes exactly the dummies' sats and
output 1 takes exactly the inscription's output, wherever on it the inscription sits. Dummies
and coins are outputs ord says hold no inscriptions or runes, so nothing else moves. The buyer's
wallet signs everything but input 2 with SIGHASH_ALL; unimap checks the transaction is exactly
the one it quoted, asks bitcoind to test it, and broadcasts it.

Taking a listing down here stops unimap from offering it, but the seller's signature stays good
until the inscription moves; the page says so and offers moving it to make sure.

Offers (出价) run the other way round, for things nobody listed: the buyer signs the same purchase
first, and the holder signs input 2 to accept it. See the offers section below.

A whole park (园区打包卖) sells the same way once its districts sit in one output; see the parks
section below.

The market runs only when MARKET_NETWORK is set (testnet4, signet or regtest), and refuses
mainnet unless MARKET_MAINNET_AUDITED=1, which is for after the outside audit.
"""

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import btc, game, notify, parks, prosperity, recruit, wallets
from api.auth import current_address, optional_address
from api.db import cursor
from api.land import _bitcoind
from parcel_index.sources import OrdServer

router = APIRouter()

MIN_PRICE = 1_000
MAX_PRICE = 2_100_000_000_000_000
DUMMY = 600  # value of each dummy output made for the buyer
DUMMY_MAX = 1_000  # largest output used as a dummy
MAX_COINS = 60  # buyer outputs looked at when funding a purchase
QUOTE_MINUTES = 10
MAX_FEE_RATE = 1_000
SEQUENCE = 0xFFFFFFFD
OUT_VBYTES = {"p2tr": 43, "p2wpkh": 31, "p2sh": 32}


def network():
    """The network the market runs on, or None while it's off."""
    n = (os.getenv("MARKET_NETWORK") or "").strip().lower()
    if n not in btc.NETWORKS:
        return None
    if n == "mainnet" and os.getenv("MARKET_MAINNET_AUDITED") != "1":
        return None
    return n


def fee_terms():
    """(basis points, scriptPubKey) of unimap's fee, or (0, None)."""
    net = network()
    try:
        bps = max(0, min(int(os.getenv("MARKET_FEE_BPS") or 0), 500))
    except ValueError:
        bps = 0
    address = os.getenv("MARKET_FEE_ADDRESS")
    if not bps or not address or not net:
        return 0, None
    try:
        return bps, btc.address_script(address, net)
    except btc.BadTx:
        return 0, None  # a fee address on the wrong network charges nothing rather than breaking every sale


class Chain:
    """bitcoind and ord, behind one object so tests can replace it."""

    def __init__(self):
        self.node = _bitcoind()
        self.ord = OrdServer(os.getenv("ORD_API_URL") or "http://localhost:8080/")

    def txout(self, outpoint):
        return self.node.txout(outpoint)

    def satpoint(self, inscription_id):
        return self.ord.satpoint(inscription_id)

    def output(self, outpoint):
        return self.ord.output(outpoint)

    def cardinal_outputs(self, address):
        return self.ord.cardinal_outputs(address)

    def fee_rate(self):
        return self.node.fee_rate()

    def test_accept(self, raw_hex):
        return self.node.test_accept(raw_hex)

    def send(self, raw_hex):
        return self.node.send(raw_hex)


chain = None


def _chain():
    global chain
    if chain is None:
        chain = Chain()
    return chain


def _need_market():
    net = network()
    if net is None:
        raise HTTPException(404, "the market isn't open")
    return net


def _clean(info):
    """Whether ord's view of an output says it holds nothing but sats."""
    runes = info.get("runes") or {}
    return info.get("indexed", True) is not False and not info.get("inscriptions") and not runes and not info.get("spent")


def _x_only(public_key):
    if not public_key:
        return None
    raw = bytes.fromhex(public_key)
    if len(raw) == 33:
        raw = raw[1:]
    if len(raw) != 32:
        raise HTTPException(400, "public_key is 32 or 33 bytes of hex")
    return raw


def _describe_inputs(psbt, i, spk, public_key):
    """What a wallet needs on input i to sign it: the taproot internal key or the P2SH redeem script."""
    kind = btc.kind_of(spk)
    if kind == "p2tr" and public_key:
        psbt.set(i, btc.IN_TAP_INTERNAL_KEY, _x_only(public_key))
    elif kind == "p2sh":
        pub = bytes.fromhex(public_key or "")
        if len(pub) != 33 or spk[2:22] != btc.hash160(btc.nested_redeem_script(pub)):
            raise HTTPException(400, "a P2SH payment address needs its compressed public key")
        psbt.set(i, btc.IN_REDEEM_SCRIPT, btc.nested_redeem_script(pub))


# --- what is for sale ------------------------------------------------------------------------


def _land(cur, bitmap_number, tx_index):
    """(inscription_id, owner, outpoint) of a district (tx_index None) or a parcel, by our index."""
    if tx_index is None:
        cur.execute(
            "select b.inscription_id, o.address, o.outpoint from bitmaps b join inscription_owners o on o.inscription_id = b.inscription_id "
            "where b.bitmap_number = %s;",
            (bitmap_number,),
        )
    else:
        cur.execute(
            "select p.inscription_id, o.address, o.outpoint from parcels p join inscription_owners o on o.inscription_id = p.inscription_id "
            "where p.bitmap_number = %s and p.tx_index = %s;",
            (bitmap_number, tx_index),
        )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "no such district or parcel, or it isn't indexed yet")
    return row


def _sellable(inscription_id, outpoint):
    """(value, scriptPubKey) of the output holding the inscription, after checking it holds nothing else."""
    c = _chain()
    satpoint = c.satpoint(inscription_id)
    if not satpoint or satpoint.rsplit(":", 1)[0] != outpoint:
        raise HTTPException(409, "the inscription has just moved; refresh and try again")
    info = c.output(outpoint) or {}
    if info.get("indexed") is False:
        raise HTTPException(409, "ord hasn't caught up with this output yet; try again in a few minutes")
    if list(info.get("inscriptions") or []) != [inscription_id] or (info.get("runes") or {}):
        raise HTTPException(409, "this output holds other inscriptions or runes too; send the inscription to its own output first")
    out = c.txout(outpoint)
    if out is None:
        raise HTTPException(409, "the inscription's output is already being spent")
    return out


class ListBody(BaseModel):
    bitmap_number: int
    tx_index: int | None = None  # a parcel; none for the district itself
    price_sats: int = Field(ge=MIN_PRICE, le=MAX_PRICE)
    pay_to: str = Field(max_length=100)  # where the seller wants the sats
    public_key: str | None = Field(default=None, max_length=66)  # the inscription address's key, for the wallet


@router.get("/v1/market")
def market_info():
    net = network()
    bps, _ = fee_terms()
    return {"open": net is not None, "network": net, "fee_bps": bps, "dummy_sats": DUMMY}


@router.post("/v1/market/listings/prepare")
def prepare_listing(req: ListBody, address: str = Depends(current_address)):
    """The half-made transaction for the seller's wallet to sign (input 0, SIGHASH_SINGLE|ANYONECANPAY)."""
    net = _need_market()
    pay_spk = _script(req.pay_to, net)
    with cursor() as cur:
        inscription_id, owner, outpoint = _land(cur, req.bitmap_number, req.tx_index)
    if owner != address:
        raise HTTPException(403, "only the address holding it can sell it")
    value, spk = _sellable(inscription_id, outpoint)
    return {**_listing_psbt(outpoint, value, spk, req.price_sats, pay_spk, req.public_key), "inscription_id": inscription_id}


def _listing_psbt(outpoint, value, spk, price, pay_spk, public_key):
    txid, vout = outpoint.rsplit(":", 1)
    tx = btc.Tx(2, [btc.TxIn(txid, int(vout), sequence=SEQUENCE)], [btc.TxOut(price, pay_spk)])
    psbt = btc.Psbt.from_tx(tx)
    psbt.set_witness_utxo(0, btc.TxOut(value, spk))
    psbt.set(0, btc.IN_SIGHASH_TYPE, btc.SINGLE_ACP.to_bytes(4, "little"))
    _describe_inputs(psbt, 0, spk, public_key)
    return {"psbt": psbt.b64(), "psbt_hex": psbt.serialize().hex(), "sign_inputs": [0], "sighash": btc.SINGLE_ACP, "postage_sats": value}


def _script(address, net):
    try:
        return btc.address_script(address, net)
    except btc.BadTx as e:
        raise HTTPException(400, str(e)) from e


class SignedBody(BaseModel):
    psbt: str = Field(max_length=200_000)
    bitmap_number: int
    tx_index: int | None = None


def _psbt(text):
    try:
        return btc.Psbt.parse(text)
    except btc.BadTx as e:
        raise HTTPException(400, str(e)) from e


@router.post("/v1/market/listings", status_code=201)
def create_listing(req: SignedBody, address: str = Depends(current_address)):
    """Put up a listing the seller's wallet signed. Replaces their earlier listing of the same thing."""
    net = _need_market()
    psbt = _psbt(req.psbt)
    with cursor() as cur:
        inscription_id, owner, outpoint = _land(cur, req.bitmap_number, req.tx_index)
    if owner != address:
        raise HTTPException(403, "only the address holding it can sell it")
    pay = _seller_signed(net, psbt, outpoint, *_sellable(inscription_id, outpoint))
    with cursor() as cur:
        cur.execute(
            "update social.market_listings set status = 'replaced', updated_at = now() where inscription_id = %s and status = 'active';",
            (inscription_id,),
        )
        cur.execute(
            "insert into social.market_listings (inscription_id, bitmap_number, tx_index, seller, price_sats, pay_to_script, outpoint, postage_sats, psbt) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id;",
            (inscription_id, req.bitmap_number, req.tx_index, address, pay.value, pay.script_pubkey.hex(), outpoint, psbt.witness_utxo(0).value, psbt.b64()),
        )
        listing_id = cur.fetchone()[0]
        return _listing(cur, listing_id)


def _seller_signed(net, psbt, outpoint, value, spk):
    """The output a listing pays, after checking the seller's wallet signed it over outpoint with SIGHASH_SINGLE|ANYONECANPAY.
    Finalizes input 0."""
    tx = psbt.tx
    if len(tx.inputs) != 1 or len(tx.outputs) != 1:
        raise HTTPException(400, "a listing is one input and one output")
    if tx.inputs[0].outpoint != outpoint:
        raise HTTPException(409, "this listing spends an output that no longer holds the inscription")
    pay = tx.outputs[0]
    if not MIN_PRICE <= pay.value <= MAX_PRICE or btc.kind_of(pay.script_pubkey) is None:
        raise HTTPException(400, "the price or the address paid is out of bounds")
    if btc.kind_of(pay.script_pubkey) != "p2sh" and btc.script_address(pay.script_pubkey, net) is None:
        raise HTTPException(400, f"the address paid isn't on {net}")
    found = btc.input_signature(psbt, 0) if psbt.witness_utxo(0) else None
    if found is None:
        raise HTTPException(400, "the listing isn't signed")
    try:
        hash_type = btc.check_signature(tx, 0, [btc.TxOut(value, spk)], *found)
    except btc.BadTx as e:
        raise HTTPException(400, str(e)) from e
    if hash_type != btc.SINGLE_ACP:
        raise HTTPException(400, "a listing is signed with SIGHASH_SINGLE|ANYONECANPAY")
    psbt.set_witness_utxo(0, btc.TxOut(value, spk))
    btc.finalize_input(psbt, 0)
    return pay


LISTING_COLUMNS = (
    "m.id, m.inscription_id, m.bitmap_number, m.tx_index, m.seller, m.price_sats, m.outpoint, m.postage_sats, m.status, "
    "m.created_at, m.sold_txid, m.buyer, m.park_id, m.members, o.outpoint = m.outpoint as fresh"
)
LISTING_FROM = "from social.market_listings m left join inscription_owners o on o.inscription_id = m.inscription_id "


def _view(row):
    lid, iid, n, tx_index, seller, price, outpoint, postage, status, created_at, sold_txid, buyer, park_id, members, fresh = row
    if status == "active" and not fresh:
        status = "gone"  # the inscription moved some other way
    return {
        "id": lid, "inscription_id": iid, "bitmap_number": n, "tx_index": tx_index, "seller": seller, "price_sats": price,
        "postage_sats": postage, "status": status, "created_at": created_at.isoformat(), "txid": sold_txid, "buyer": buyer,
        "park_id": park_id, "members": members,
    }


def _listing(cur, listing_id):
    cur.execute(f"select {LISTING_COLUMNS} {LISTING_FROM} where m.id = %s;", (listing_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "no such listing")
    return _view(row)


@router.get("/v1/market/listings")
def market_listings(bitmap_number: int | None = None, limit: int = 50):
    """Live listings, cheapest first; with bitmap_number, the district's and its parcels', and its park's if sold whole."""
    if network() is None:
        return {"listings": []}
    limit = max(1, min(limit, 200))
    with cursor() as cur:
        cur.execute(
            f"select {LISTING_COLUMNS} {LISTING_FROM} where m.status = 'active' and o.outpoint = m.outpoint "
            "and (%(n)s::int4 is null or m.bitmap_number = %(n)s or %(n)s = any(m.members)) order by m.price_sats, m.id limit %(limit)s;",
            {"n": bitmap_number, "limit": limit},
        )
        return {"listings": [_view(r) for r in cur.fetchall()]}


@router.get("/v1/market/parcels")
def parcels_for_sale(limit: int = 50):
    """Parcels listed in unimap across the city, for someone looking for a place to live: districts that are
    recruiting first, then the liveliest, then the cheapest. Whoever buys one is a resident there."""
    if network() is None:
        return {"parcels": []}
    limit = max(1, min(limit, 200))
    with cursor() as cur:
        cur.execute(
            f"select {LISTING_COLUMNS}, exists(select 1 {recruit.ACTIVE} where r.bitmap_number = m.bitmap_number) {LISTING_FROM} "
            "where m.status = 'active' and o.outpoint = m.outpoint and m.tx_index is not null order by m.price_sats, m.id limit 200;"
        )
        rows = cur.fetchall()
        numbers = list({r[2] for r in rows})
        cur.execute("select block_height, zone from block_zones where block_height = any(%s);", (numbers,))
        zones = dict(cur.fetchall())
        districts = {}
        for n in numbers:
            levels, _ = parks.scored(cur, n, n)
            parts = prosperity.parts_for(cur, n, n).get(n) or prosperity.empty_parts()
            districts[n] = {"level": levels[n], "residents": parts["residents"], "zone": zones.get(n)}
    out = [{**_view(r[:-1]), **districts[r[2]], "recruiting": r[-1]} for r in rows]
    out.sort(key=lambda p: (not p["recruiting"], -p["level"], p["price_sats"]))
    return {"parcels": out[:limit]}


def parcels_listed(cur, bitmap_number):
    """[{listing_id, tx_index, price_sats, seller}] of the district's parcels listed in unimap, cheapest first."""
    if network() is None:
        return []
    cur.execute(
        f"select m.id, m.tx_index, m.price_sats, m.seller {LISTING_FROM} where m.bitmap_number = %s and m.tx_index is not null "
        "and m.status = 'active' and o.outpoint = m.outpoint order by m.price_sats, m.id;",
        (bitmap_number,),
    )
    return [{"listing_id": i, "tx_index": x, "price_sats": p, "seller": who} for i, x, p, who in cur.fetchall()]


@router.get("/v1/market/listings/{listing_id}")
def market_listing(listing_id: int):
    with cursor() as cur:
        return _listing(cur, listing_id)


@router.delete("/v1/market/listings/{listing_id}")
def cancel_listing(listing_id: int, address: str = Depends(current_address)):
    with cursor() as cur:
        listing = _listing(cur, listing_id)
        if wallets.main_of(cur, listing["seller"]) != wallets.main_of(cur, address):
            raise HTTPException(403, "only the seller can take it down")
        cur.execute("update social.market_listings set status = 'cancelled', updated_at = now() where id = %s and status = 'active';", (listing_id,))
        return _listing(cur, listing_id)


# --- buying ----------------------------------------------------------------------------------


class QuoteBody(BaseModel):
    payment_address: str = Field(max_length=100)  # where the buyer's coins are
    payment_public_key: str | None = Field(default=None, max_length=66)
    receive_address: str = Field(max_length=100)  # where the inscription goes (the buyer's ordinals address)
    receive_public_key: str | None = Field(default=None, max_length=66)
    fee_rate: float | None = Field(default=None, gt=0, le=MAX_FEE_RATE)  # sats per vbyte


def _coins(net, address):
    """[(outpoint, value, scriptPubKey)] of address's outputs holding only sats, smallest first, checked with bitcoind."""
    c = _chain()
    spk = _script(address, net)
    out = []
    for o in c.cardinal_outputs(address)[: MAX_COINS * 2]:
        if not _clean(o) or not o.get("outpoint"):
            continue
        live = c.txout(o["outpoint"])
        if live is None or live[1] != spk:
            continue
        out.append((o["outpoint"], live[0], spk))
        if len(out) >= MAX_COINS:
            break
    return sorted(out, key=lambda x: (x[1], x[0]))


def _vbytes(kinds_in, kinds_out):
    return 11 + sum(btc.INPUT_VBYTES[k] for k in kinds_in) + sum(OUT_VBYTES[k] for k in kinds_out)


def _purchase(net, req, seller_in, seller_utxo, seller_out):
    """The purchase laid out as above, with input 2 (the seller's) left for the caller to fill in.
    (psbt, sign_inputs, the sums for the buyer)."""
    pay_spk = _script(req.payment_address, net)
    recv_spk = _script(req.receive_address, net)
    if btc.kind_of(recv_spk) != "p2tr":
        raise HTTPException(400, "inscriptions go to a taproot (bc1p…) address")
    if _chain().txout(seller_in.outpoint) is None:
        raise HTTPException(409, "the inscription's output is already being spent")
    if seller_utxo.value < btc.dust_limit(recv_spk):
        raise HTTPException(409, "the inscription's output is too small to send on")

    coins = [c for c in _coins(net, req.payment_address) if c[0] != seller_in.outpoint]
    dummies = [c for c in coins if c[1] <= DUMMY_MAX][:2]
    if len(dummies) < 2:
        raise HTTPException(409, f"need_dummies: the paying address needs two small outputs (up to {DUMMY_MAX} sats) first")
    rest = sorted([c for c in coins if c not in dummies], key=lambda x: -x[1])

    rate = req.fee_rate or _chain().fee_rate() or 2.0
    bps, fee_spk = fee_terms()
    fee_out = seller_out.value * bps // 10_000 if fee_spk else 0
    if fee_out and fee_out < btc.dust_limit(fee_spk):
        fee_out = 0
    pay_kind, seller_kind = btc.kind_of(pay_spk), btc.kind_of(seller_utxo.script_pubkey)
    outs = [pay_kind, "p2tr", btc.kind_of(seller_out.script_pubkey)] + ([btc.kind_of(fee_spk)] if fee_out else []) + [pay_kind, pay_kind]
    a, b = dummies[0][1], dummies[1][1]
    # Coming in: the dummies, the inscription's V and the coins; going out: A+B, V, P, the fee, two new dummies and the miners' fee.
    need = seller_out.value + fee_out + 2 * DUMMY
    chosen, have = [], 0
    for coin in rest:
        chosen.append(coin)
        have += coin[1]
        miners = int(rate * _vbytes([pay_kind, pay_kind, seller_kind] + [pay_kind] * len(chosen), outs + [pay_kind])) + 1
        if have >= need + miners:
            break
    else:
        raise HTTPException(409, "not enough sats in the paying address")
    change = have - need - miners
    keep_change = change >= btc.dust_limit(pay_spk) + int(rate * OUT_VBYTES[pay_kind])
    if not keep_change:
        miners += change
        change = 0

    tx = btc.Tx(2)
    for outpoint, _, _ in dummies:
        txid, vout = outpoint.rsplit(":", 1)
        tx.inputs.append(btc.TxIn(txid, int(vout), sequence=SEQUENCE))
    tx.inputs.append(btc.TxIn(seller_in.txid, seller_in.vout, sequence=seller_in.sequence))
    for outpoint, _, _ in chosen:
        txid, vout = outpoint.rsplit(":", 1)
        tx.inputs.append(btc.TxIn(txid, int(vout), sequence=SEQUENCE))
    tx.outputs = [btc.TxOut(a + b, pay_spk), btc.TxOut(seller_utxo.value, recv_spk), seller_out]
    if fee_out:
        tx.outputs.append(btc.TxOut(fee_out, fee_spk))
    tx.outputs += [btc.TxOut(DUMMY, pay_spk), btc.TxOut(DUMMY, pay_spk)]
    if keep_change:
        tx.outputs.append(btc.TxOut(change, pay_spk))

    psbt = btc.Psbt.from_tx(tx)
    sign = []
    for i, coin in enumerate(dummies + [None] + chosen):
        if coin is None:
            continue
        _, value, spk = coin
        psbt.set_witness_utxo(i, btc.TxOut(value, spk))
        _describe_inputs(psbt, i, spk, req.payment_public_key)
        sign.append(i)
    spent = sum(v for _, v, _ in dummies + chosen)
    back = a + b + DUMMY * 2 + change
    sums = {"price_sats": seller_out.value, "fee_sats": fee_out, "network_fee_sats": miners, "fee_rate": rate,
            "postage_sats": seller_utxo.value, "total_sats": spent - back}
    return psbt, sign, sums


@router.post("/v1/market/listings/{listing_id}/quote")
def quote(listing_id: int, req: QuoteBody, address: str = Depends(current_address)):
    """The purchase for the buyer's wallet to sign: every input but the seller's (index 2), SIGHASH_ALL."""
    net = _need_market()
    with cursor() as cur:
        cur.execute(f"select {LISTING_COLUMNS}, m.psbt {LISTING_FROM} where m.id = %s;", (listing_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "no such listing")
        listing, listing_psbt = _view(row[:-1]), row[-1]
        if listing["status"] != "active":
            raise HTTPException(409, "this listing is no longer for sale")
        if wallets.main_of(cur, listing["seller"]) == wallets.main_of(cur, address):
            raise HTTPException(400, "you can't buy your own listing")
    seller = btc.Psbt.parse(listing_psbt)
    psbt, sign, sums = _purchase(net, req, seller.tx.inputs[0], seller.witness_utxo(0), seller.tx.outputs[0])
    psbt.inputs[2] = dict(seller.inputs[0])  # final already: the witness UTXO and the seller's witness
    with cursor() as cur:
        cur.execute(
            "insert into social.market_quotes (listing_id, buyer, psbt, expires_at) values (%s, %s, %s, now() + make_interval(mins => %s)) returning id;",
            (listing_id, address, psbt.b64(), QUOTE_MINUTES),
        )
        quote_id = cur.fetchone()[0]
    return {"quote_id": quote_id, "psbt": psbt.b64(), "psbt_hex": psbt.serialize().hex(), "sign_inputs": sign,
            **sums, "expires_in": QUOTE_MINUTES * 60}


class SubmitBody(BaseModel):
    psbt: str = Field(max_length=400_000)


def _take_signatures(quoted, signed, inputs):
    """Check signed carries SIGHASH_ALL signatures on exactly the quoted transaction for these inputs, and finalize them in quoted."""
    if signed.tx.serialize(witness=False) != quoted.tx.serialize(witness=False):
        raise HTTPException(400, "the signed transaction isn't the one quoted")
    spent = [quoted.witness_utxo(i) for i in range(len(quoted.tx.inputs))]
    for i in inputs:
        found = btc.input_signature(_with_utxo(signed, i, spent[i]), i)
        if found is None:
            raise HTTPException(400, f"input {i} isn't signed")
        try:
            hash_type = btc.check_signature(quoted.tx, i, spent, *found)
        except btc.BadTx as e:
            raise HTTPException(400, str(e)) from e
        if hash_type not in (btc.SIGHASH_DEFAULT, btc.SIGHASH_ALL):
            raise HTTPException(400, "these inputs are signed with SIGHASH_ALL")
        quoted.inputs[i] = {**quoted.inputs[i], **_signature_fields(signed, i)}
        try:
            btc.finalize_input(quoted, i)
        except btc.BadTx as e:
            raise HTTPException(400, str(e)) from e


@router.post("/v1/market/quotes/{quote_id}/submit")
def submit(quote_id: int, req: SubmitBody, address: str = Depends(current_address)):
    """Check the buyer's signatures are on exactly the quoted transaction, then test and broadcast it."""
    _need_market()
    signed = _psbt(req.psbt)
    with cursor() as cur:
        cur.execute(
            "select q.listing_id, q.buyer, q.psbt, q.expires_at, q.used_at, m.status from social.market_quotes q "
            "join social.market_listings m on m.id = q.listing_id where q.id = %s;",
            (quote_id,),
        )
        row = cur.fetchone()
    if row is None or row[1] != address:
        raise HTTPException(404, "no such quote")
    listing_id, _, quoted_b64, expires_at, used_at, status = row
    if used_at is not None:
        raise HTTPException(409, "this quote was already used")
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(410, "this quote expired; ask for a new one")
    if status != "active":
        raise HTTPException(409, "this listing is no longer for sale")
    quoted = btc.Psbt.parse(quoted_b64)
    _take_signatures(quoted, signed, [i for i in range(len(quoted.tx.inputs)) if i != 2])
    raw = quoted.extract().serialize().hex()
    c = _chain()
    allowed, reason = c.test_accept(raw)
    if not allowed:
        raise HTTPException(409, f"bitcoind won't take this transaction: {reason}")
    with cursor() as cur:
        cur.execute("update social.market_quotes set used_at = now() where id = %s and used_at is null returning id;", (quote_id,))
        if cur.fetchone() is None:
            raise HTTPException(409, "this quote was already used")
        cur.execute(
            "update social.market_listings set status = 'sold', buyer = %s, sold_txid = %s, updated_at = now() "
            "where id = %s and status = 'active' returning seller, bitmap_number, inscription_id, park_id, members;",
            (address, quoted.tx.txid, listing_id),
        )
        sold = cur.fetchone()
        if sold is None:
            raise HTTPException(409, "this listing is no longer for sale")
        txid = c.send(raw)
        seller, n, inscription_id, park_id, members = sold
        if park_id is None:
            _settle_offers(cur, inscription_id)
        else:
            cur.execute("select inscription_id from bitmaps where bitmap_number = any(%s);", (members,))
            for (iid,) in cur.fetchall():
                _settle_offers(cur, iid)
            # The park changes hands with its districts: it is the address they went to that holds them now.
            new_owner = btc.script_address(quoted.tx.outputs[1].script_pubkey, network())
            cur.execute("update social.parks set owner_address = %s where id = %s;", (new_owner, park_id))
        notify.notify(cur, seller, "sold", address, n)
    return {"txid": txid, "listing_id": listing_id}


def _with_utxo(psbt, i, utxo):
    if psbt.witness_utxo(i) is None:
        psbt.set_witness_utxo(i, utxo)
    return psbt


def _signature_fields(psbt, i):
    keep = (btc.IN_PARTIAL_SIG, btc.IN_TAP_KEY_SIG, btc.IN_FINAL_SCRIPTWITNESS, btc.IN_FINAL_SCRIPTSIG, btc.IN_REDEEM_SCRIPT)
    return {k: v for k, v in psbt.inputs[i].items() if k[0] in keep}


# --- offers ---------------------------------------------------------------------------------
# 出价: a buyer offers a price for something nobody listed. The buyer's wallet signs the whole
# purchase as above, every input but the inscription's, with SIGHASH_ALL, paying the price to the
# address holding the inscription. If the holder accepts, their wallet signs input 2 and it goes
# out. The buyer's signatures hold only while every input stays unspent, so the offer ends by itself
# when the inscription moves or the buyer spends those coins; withdrawing it here only hides it.

OFFER_DAYS = 30
OFFER_COLUMNS = (
    "f.id, f.inscription_id, f.bitmap_number, f.tx_index, f.buyer, f.seller, f.price_sats, f.status, f.created_at, f.expires_at, "
    "f.txid, o.outpoint = f.outpoint and o.address = f.seller as fresh"
)
OFFER_FROM = "from social.market_offers f left join inscription_owners o on o.inscription_id = f.inscription_id "


def _offer_view(row):
    oid, iid, n, tx_index, buyer, seller, price, status, created_at, expires_at, txid, fresh = row
    if status == "active" and not fresh:
        status = "gone"  # the inscription moved
    elif status == "active" and expires_at < datetime.now(timezone.utc):
        status = "expired"
    return {"id": oid, "inscription_id": iid, "bitmap_number": n, "tx_index": tx_index, "buyer": buyer, "seller": seller,
            "price_sats": price, "status": status, "created_at": created_at.isoformat(), "expires_at": expires_at.isoformat(), "txid": txid}


def _offer(cur, offer_id, extra=""):
    cur.execute(f"select {OFFER_COLUMNS}{extra} {OFFER_FROM} where f.id = %s;", (offer_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "no such offer")
    return row


def _settle_offers(cur, inscription_id):
    """Once the inscription is sold, the other offers on it can no longer go through."""
    cur.execute("update social.market_offers set status = 'expired', updated_at = now() where inscription_id = %s and status in ('active', 'unsigned');",
                (inscription_id,))
    cur.execute("update social.market_listings set status = 'cancelled', updated_at = now() where inscription_id = %s and status = 'active';",
                (inscription_id,))


class OfferBody(QuoteBody):
    bitmap_number: int
    tx_index: int | None = None
    price_sats: int = Field(ge=MIN_PRICE, le=MAX_PRICE)


@router.post("/v1/market/offers/prepare")
def prepare_offer(req: OfferBody, address: str = Depends(current_address)):
    """The purchase at the buyer's price, for the buyer's wallet to sign (every input but 2, SIGHASH_ALL)."""
    net = _need_market()
    with cursor() as cur:
        inscription_id, owner, outpoint = _land(cur, req.bitmap_number, req.tx_index)
        if not owner:
            raise HTTPException(404, "nobody holds it yet")
        if wallets.main_of(cur, owner) == wallets.main_of(cur, address):
            raise HTTPException(400, "it's already yours")
    value, spk = _sellable(inscription_id, outpoint)
    seller_spk = _script(owner, net)  # the price goes to the address holding the inscription
    txid, vout = outpoint.rsplit(":", 1)
    psbt, sign, sums = _purchase(net, req, btc.TxIn(txid, int(vout), sequence=SEQUENCE), btc.TxOut(value, spk), btc.TxOut(req.price_sats, seller_spk))
    psbt.set_witness_utxo(2, btc.TxOut(value, spk))  # taproot signatures cover every input's amount and script
    with cursor() as cur:
        cur.execute("delete from social.market_offers where status = 'unsigned' and created_at < now() - interval '1 day';")
        cur.execute(
            "insert into social.market_offers (inscription_id, bitmap_number, tx_index, buyer, seller, price_sats, outpoint, psbt, expires_at) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, now() + make_interval(mins => %s)) returning id;",
            (inscription_id, req.bitmap_number, req.tx_index, address, owner, req.price_sats, outpoint, psbt.b64(), QUOTE_MINUTES),
        )
        offer_id = cur.fetchone()[0]
    return {"offer_id": offer_id, "psbt": psbt.b64(), "psbt_hex": psbt.serialize().hex(), "sign_inputs": sign, **sums}


class SignedOffer(BaseModel):
    psbt: str = Field(max_length=400_000)
    days: int = Field(default=7, ge=1, le=OFFER_DAYS)


@router.post("/v1/market/offers/{offer_id}/sign")
def sign_offer(offer_id: int, req: SignedOffer, address: str = Depends(current_address)):
    """Keep the buyer's signed offer and tell the holder about it."""
    _need_market()
    signed = _psbt(req.psbt)
    with cursor() as cur:
        row = _offer(cur, offer_id, ", f.psbt")
    view, prepared = _offer_view(row[:-1]), row[-1]
    if view["buyer"] != address:
        raise HTTPException(404, "no such offer")
    with cursor() as cur:
        cur.execute("select status, expires_at > now() from social.market_offers where id = %s;", (offer_id,))
        status, fresh = cur.fetchone()
    if status != "unsigned" or not fresh:
        raise HTTPException(409, "this offer was already signed, or took too long; make it again")
    quoted = btc.Psbt.parse(prepared)
    _take_signatures(quoted, signed, [i for i in range(len(quoted.tx.inputs)) if i != 2])
    with cursor() as cur:
        cur.execute(
            "update social.market_offers set status = 'expired', updated_at = now() where buyer = %s and inscription_id = %s and status = 'active';",
            (address, view["inscription_id"]),
        )
        cur.execute(
            "update social.market_offers set status = 'active', psbt = %s, expires_at = now() + make_interval(days => %s), updated_at = now() "
            "where id = %s and status = 'unsigned';",
            (quoted.b64(), req.days, offer_id),
        )
        notify.notify(cur, view["seller"], "offer", address, view["bitmap_number"], block_height=game.top(cur))  # each new offer is told
        return _offer_view(_offer(cur, offer_id))


@router.get("/v1/market/offers")
def offers(bitmap_number: int | None = None, mine: bool = False, address: str | None = Depends(optional_address)):
    """Live offers on a district and its parcels, best first; or, with mine, the ones the viewer made or got."""
    if network() is None:
        return {"offers": []}
    with cursor() as cur:
        if mine:
            if not address:
                raise HTTPException(401, "connect a wallet first")
            group = wallets.group(cur, address)
            cur.execute(f"select {OFFER_COLUMNS} {OFFER_FROM} where f.status <> 'unsigned' and (f.buyer = any(%s) or f.seller = any(%s)) "
                        "order by f.id desc limit 50;", (group, group))
        else:
            cur.execute(f"select {OFFER_COLUMNS} {OFFER_FROM} where f.status = 'active' and f.expires_at > now() "
                        "and o.outpoint = f.outpoint and o.address = f.seller and (%(n)s::int4 is null or f.bitmap_number = %(n)s) "
                        "order by f.price_sats desc, f.id limit 50;", {"n": bitmap_number})
        return {"offers": [_offer_view(r) for r in cur.fetchall()]}


@router.delete("/v1/market/offers/{offer_id}")
def withdraw_offer(offer_id: int, address: str = Depends(current_address)):
    """The buyer withdraws it, or the holder turns it down. Either way unimap stops showing it."""
    with cursor() as cur:
        view = _offer_view(_offer(cur, offer_id))
        me = wallets.main_of(cur, address)
        if me == wallets.main_of(cur, view["buyer"]):
            status = "cancelled"
        elif me == wallets.main_of(cur, view["seller"]):
            status = "declined"
        else:
            raise HTTPException(403, "only the buyer or the holder can do this")
        cur.execute("update social.market_offers set status = %s, updated_at = now() where id = %s and status = 'active';", (status, offer_id))
        return _offer_view(_offer(cur, offer_id))


class AcceptBody(BaseModel):
    public_key: str | None = Field(default=None, max_length=66)  # the inscription address's key, for the wallet


def _live_offer(cur, offer_id, address):
    row = _offer(cur, offer_id, ", f.psbt")
    view = _offer_view(row[:-1])
    if wallets.main_of(cur, view["seller"]) != wallets.main_of(cur, address):
        raise HTTPException(403, "only the holder can accept it")
    if view["status"] != "active":
        raise HTTPException(409, "this offer can't be accepted any more")
    return view, btc.Psbt.parse(row[-1])


@router.post("/v1/market/offers/{offer_id}/accept/prepare")
def prepare_accept(offer_id: int, req: AcceptBody, address: str = Depends(current_address)):
    """The buyer's signed purchase, for the holder's wallet to sign input 2 with SIGHASH_ALL."""
    _need_market()
    with cursor() as cur:
        view, psbt = _live_offer(cur, offer_id, address)
    if any(_chain().txout(t.outpoint) is None for t in psbt.tx.inputs):
        with cursor() as cur:
            cur.execute("update social.market_offers set status = 'expired', updated_at = now() where id = %s;", (offer_id,))
        raise HTTPException(409, "the buyer's coins have moved, so this offer can't go through any more")
    utxo = psbt.witness_utxo(2)
    _describe_inputs(psbt, 2, utxo.script_pubkey, req.public_key)
    return {"psbt": psbt.b64(), "psbt_hex": psbt.serialize().hex(), "sign_inputs": [2], "price_sats": view["price_sats"],
            "postage_sats": utxo.value}


@router.post("/v1/market/offers/{offer_id}/accept")
def accept(offer_id: int, req: SubmitBody, address: str = Depends(current_address)):
    """Check the holder's signature, then test and broadcast the sale."""
    _need_market()
    signed = _psbt(req.psbt)
    with cursor() as cur:
        view, offered = _live_offer(cur, offer_id, address)
    _take_signatures(offered, signed, [2])
    raw = offered.extract().serialize().hex()
    c = _chain()
    allowed, reason = c.test_accept(raw)
    if not allowed:
        raise HTTPException(409, f"bitcoind won't take this transaction: {reason}")
    with cursor() as cur:
        cur.execute("update social.market_offers set status = 'accepted', txid = %s, updated_at = now() where id = %s and status = 'active' "
                    "returning id;", (offered.tx.txid, offer_id))
        if cur.fetchone() is None:
            raise HTTPException(409, "this offer can't be accepted any more")
        txid = c.send(raw)
        _settle_offers(cur, view["inscription_id"])
        notify.notify(cur, view["buyer"], "offer_accepted", address, view["bitmap_number"])
    return {"txid": txid, "offer_id": offer_id}


# --- parks ----------------------------------------------------------------------------------
# 园区打包卖: a whole park in one sale. A listing's signature covers one input, so the park's
# districts first go into one output (pack): a transaction that only moves the owner's own
# inscription outputs to the owner's own address, those inputs first and their sats in order, with
# the payment address's coins paying the miners and getting the change. That one output is then
# listed and bought like any district, and the park changes hands with it. Whoever holds it can
# split it back into one output per district (unpack), each starting at a district's sat.

def _park_land(cur, park_id):
    """(park, [(bitmap_number, inscription_id, outpoint)]) for the districts its owner still holds."""
    park = parks.get(cur, park_id)
    if park is None:
        raise HTTPException(404, "no such park")
    cur.execute(
        "select b.bitmap_number, b.inscription_id, o.outpoint from bitmaps b join inscription_owners o on o.inscription_id = b.inscription_id "
        "where b.bitmap_number = any(%s) order by b.bitmap_number;",
        (park["members"],),
    )
    return park, cur.fetchall()


def _park_listing(cur, park_id):
    cur.execute(f"select {LISTING_COLUMNS} {LISTING_FROM} where m.park_id = %s and m.status = 'active' and o.outpoint = m.outpoint "
                "order by m.id desc limit 1;", (park_id,))
    row = cur.fetchone()
    return _view(row) if row else None


def _pieces(net, owner, land):
    """[(outpoint, value, scriptPubKey)] of the outputs holding a park's districts, in district order, after checking
    with ord and bitcoind that they hold those districts and nothing else."""
    c = _chain()
    owner_spk = _script(owner, net)
    held = {}
    for _, iid, outpoint in land:
        held.setdefault(outpoint, set()).add(iid)
    out = []
    for outpoint, ids in held.items():
        info = c.output(outpoint) or {}
        if info.get("indexed") is False:
            raise HTTPException(409, "ord hasn't caught up with these outputs yet; try again in a few minutes")
        if set(info.get("inscriptions") or []) != ids or (info.get("runes") or {}):
            raise HTTPException(409, f"{outpoint} holds other inscriptions or runes too; send them elsewhere first")
        live = c.txout(outpoint)
        if live is None or live[1] != owner_spk:
            raise HTTPException(409, "a district has just moved; refresh and try again")
        out.append((outpoint, live[0], live[1]))
    return out


def _own_park_land(cur, park_id, address):
    park, land = _park_land(cur, park_id)
    if park["owner"] != address:
        raise HTTPException(403, "only the address holding the park can do this")
    return park, land


@router.get("/v1/market/parks/{park_id}")
def park_sale(park_id: int):
    """Whether a park's districts are in one output yet, and its live listing."""
    _need_market()
    with cursor() as cur:
        park, land = _park_land(cur, park_id)
        listing = _park_listing(cur, park_id)
    outpoints = {outpoint for _, _, outpoint in land}
    return {"park_id": park_id, "name": park["name"], "owner": park["owner"], "members": park["members"],
            "packed": len(outpoints) == 1, "listing": listing}


class MoveBody(BaseModel):
    payment_address: str = Field(max_length=100)  # whose coins pay the miners
    payment_public_key: str | None = Field(default=None, max_length=66)
    public_key: str | None = Field(default=None, max_length=66)  # the inscription address's key, for the wallet
    fee_rate: float | None = Field(default=None, gt=0, le=MAX_FEE_RATE)


def _move(cur, net, req, kind, park_id, owner, pieces, outs):
    """The owner's outputs pieces moved, in order, into outputs of the values outs at the same address; kept for submit."""
    own_spk = pieces[0][2]
    pay_spk = _script(req.payment_address, net)
    pay_kind = btc.kind_of(pay_spk)
    rate = req.fee_rate or _chain().fee_rate() or 2.0
    taken = {p[0] for p in pieces}
    coins = sorted([c for c in _coins(net, req.payment_address) if c[1] > DUMMY_MAX and c[0] not in taken], key=lambda x: -x[1])
    kinds_in = [btc.kind_of(p[2]) for p in pieces]
    kinds_out = [btc.kind_of(own_spk)] * len(outs) + [pay_kind]
    chosen, have = [], 0
    for coin in coins:
        chosen.append(coin)
        have += coin[1]
        miners = int(rate * _vbytes(kinds_in + [pay_kind] * len(chosen), kinds_out)) + 1
        if have >= miners + btc.dust_limit(pay_spk):
            break
    else:
        raise HTTPException(409, "not enough sats in the paying address for the network fee")
    tx = btc.Tx(2)
    for outpoint, _, _ in pieces + chosen:
        txid, vout = outpoint.rsplit(":", 1)
        tx.inputs.append(btc.TxIn(txid, int(vout), sequence=SEQUENCE))
    tx.outputs = [btc.TxOut(v, own_spk) for v in outs] + [btc.TxOut(have - miners, pay_spk)]
    psbt = btc.Psbt.from_tx(tx)
    for i, (_, value, spk) in enumerate(pieces + chosen):
        psbt.set_witness_utxo(i, btc.TxOut(value, spk))
        _describe_inputs(psbt, i, spk, req.public_key if i < len(pieces) else req.payment_public_key)
    cur.execute(
        "insert into social.market_moves (kind, park_id, owner, psbt, expires_at) values (%s, %s, %s, %s, now() + make_interval(mins => %s)) returning id;",
        (kind, park_id, owner, psbt.b64(), QUOTE_MINUTES),
    )
    return {"move_id": cur.fetchone()[0], "psbt": psbt.b64(), "psbt_hex": psbt.serialize().hex(), "sign_inputs": list(range(len(tx.inputs))),
            "own_inputs": list(range(len(pieces))), "network_fee_sats": miners, "fee_rate": rate}


@router.post("/v1/market/parks/{park_id}/pack")
def pack(park_id: int, req: MoveBody, address: str = Depends(current_address)):
    """A transaction putting every district of the park into one output at the owner's address, for their wallet to sign."""
    net = _need_market()
    with cursor() as cur:
        _, land = _own_park_land(cur, park_id, address)
    pieces = _pieces(net, address, land)
    if len(pieces) < 2:
        raise HTTPException(409, "the park's districts are already in one output")
    with cursor() as cur:
        return _move(cur, net, req, "pack", park_id, address, pieces, [sum(p[1] for p in pieces)])


@router.post("/v1/market/parks/{park_id}/unpack")
def unpack(park_id: int, req: MoveBody, address: str = Depends(current_address)):
    """A transaction splitting the park's one output into one output per district, each starting at its district's sat."""
    net = _need_market()
    with cursor() as cur:
        _, land = _own_park_land(cur, park_id, address)
    pieces = _pieces(net, address, land)
    if len(pieces) != 1:
        raise HTTPException(409, "the park's districts aren't in one output")
    outpoint, value, spk = pieces[0]
    offsets = []
    for _, iid, _ in land:
        satpoint = _chain().satpoint(iid) or ""
        if satpoint.rsplit(":", 1)[0] != outpoint:
            raise HTTPException(409, "a district has just moved; refresh and try again")
        offsets.append(int(satpoint.rsplit(":", 1)[1]))
    starts = [0] + sorted(offsets)[1:]
    outs = [end - start for start, end in zip(starts, starts[1:] + [value])]
    if min(outs) < btc.dust_limit(spk):
        raise HTTPException(409, "the districts sit too close together in this output to split it here")
    with cursor() as cur:
        return _move(cur, net, req, "unpack", park_id, address, pieces, outs)


@router.post("/v1/market/moves/{move_id}/submit")
def submit_move(move_id: int, req: SubmitBody, address: str = Depends(current_address)):
    """Check the owner signed exactly the pack or unpack handed out, then test and broadcast it."""
    _need_market()
    signed = _psbt(req.psbt)
    with cursor() as cur:
        cur.execute("select owner, psbt, expires_at > now(), txid from social.market_moves where id = %s;", (move_id,))
        row = cur.fetchone()
    if row is None or row[0] != address:
        raise HTTPException(404, "no such transaction")
    _, quoted_b64, fresh, sent = row
    if sent is not None:
        raise HTTPException(409, "this transaction was already sent")
    if not fresh:
        raise HTTPException(410, "this took too long; start again")
    quoted = btc.Psbt.parse(quoted_b64)
    _take_signatures(quoted, signed, range(len(quoted.tx.inputs)))
    raw = quoted.extract().serialize().hex()
    c = _chain()
    allowed, reason = c.test_accept(raw)
    if not allowed:
        raise HTTPException(409, f"bitcoind won't take this transaction: {reason}")
    with cursor() as cur:
        cur.execute("update social.market_moves set txid = %s where id = %s and txid is null returning id;", (quoted.tx.txid, move_id))
        if cur.fetchone() is None:
            raise HTTPException(409, "this transaction was already sent")
        return {"txid": c.send(raw)}


class ParkListBody(BaseModel):
    price_sats: int = Field(ge=MIN_PRICE, le=MAX_PRICE)
    pay_to: str = Field(max_length=100)
    public_key: str | None = Field(default=None, max_length=66)


def _one_piece(cur, net, park_id, address):
    park, land = _own_park_land(cur, park_id, address)
    pieces = _pieces(net, address, land)
    if len(pieces) != 1:
        raise HTTPException(409, "put the park's districts into one output first")
    return park, land, pieces[0]


@router.post("/v1/market/parks/{park_id}/listing/prepare")
def prepare_park_listing(park_id: int, req: ParkListBody, address: str = Depends(current_address)):
    """The half-made sale of the park's one output, for the owner's wallet to sign like a district's listing."""
    net = _need_market()
    pay_spk = _script(req.pay_to, net)
    with cursor() as cur:
        park, _, (outpoint, value, spk) = _one_piece(cur, net, park_id, address)
    return {**_listing_psbt(outpoint, value, spk, req.price_sats, pay_spk, req.public_key), "members": park["members"]}


class SignedParkListing(BaseModel):
    psbt: str = Field(max_length=200_000)


@router.post("/v1/market/parks/{park_id}/listing", status_code=201)
def create_park_listing(park_id: int, req: SignedParkListing, address: str = Depends(current_address)):
    """Put the whole park up for sale. Replaces earlier listings of it or of any of its districts."""
    net = _need_market()
    psbt = _psbt(req.psbt)
    with cursor() as cur:
        park, land, (outpoint, value, spk) = _one_piece(cur, net, park_id, address)
    pay = _seller_signed(net, psbt, outpoint, value, spk)
    ids = [iid for _, iid, _ in land]
    with cursor() as cur:
        cur.execute(
            "update social.market_listings set status = 'replaced', updated_at = now() where (inscription_id = any(%s) or park_id = %s) and status = 'active';",
            (ids, park_id),
        )
        cur.execute(
            "insert into social.market_listings (inscription_id, bitmap_number, tx_index, seller, price_sats, pay_to_script, outpoint, postage_sats, psbt, park_id, members) "
            "values (%s, %s, null, %s, %s, %s, %s, %s, %s, %s, %s) returning id;",
            (ids[0], land[0][0], address, pay.value, pay.script_pubkey.hex(), outpoint, value, psbt.b64(), park_id, park["members"]),
        )
        return _listing(cur, cur.fetchone()[0])


# --- dummies ----------------------------------------------------------------------------------


@router.post("/v1/market/dummies")
def dummies(req: QuoteBody, address: str = Depends(current_address)):
    """A transaction making the two small outputs a purchase needs, from the buyer's own coins, for their wallet to sign."""
    net = _need_market()
    pay_spk = _script(req.payment_address, net)
    kind = btc.kind_of(pay_spk)
    rate = req.fee_rate or _chain().fee_rate() or 2.0
    coins = sorted([c for c in _coins(net, req.payment_address) if c[1] > DUMMY_MAX], key=lambda x: -x[1])
    chosen, have = [], 0
    for coin in coins:
        chosen.append(coin)
        have += coin[1]
        miners = int(rate * _vbytes([kind] * len(chosen), [kind] * 3)) + 1
        if have >= 2 * DUMMY + miners + btc.dust_limit(pay_spk):
            break
    else:
        raise HTTPException(409, "not enough sats in the paying address")
    tx = btc.Tx(2)
    for outpoint, _, _ in chosen:
        txid, vout = outpoint.rsplit(":", 1)
        tx.inputs.append(btc.TxIn(txid, int(vout), sequence=SEQUENCE))
    tx.outputs = [btc.TxOut(DUMMY, pay_spk), btc.TxOut(DUMMY, pay_spk), btc.TxOut(have - 2 * DUMMY - miners, pay_spk)]
    psbt = btc.Psbt.from_tx(tx)
    for i, (_, value, spk) in enumerate(chosen):
        psbt.set_witness_utxo(i, btc.TxOut(value, spk))
        _describe_inputs(psbt, i, spk, req.payment_public_key)
    return {"psbt": psbt.b64(), "psbt_hex": psbt.serialize().hex(), "sign_inputs": list(range(len(chosen))), "network_fee_sats": miners}


class BroadcastBody(BaseModel):
    psbt: str = Field(max_length=400_000)


@router.post("/v1/market/dummies/broadcast")
def broadcast_dummies(req: BroadcastBody, address: str = Depends(current_address)):
    """Send the buyer's signed dummy-making transaction. It only moves the buyer's own sats to themselves."""
    net = _need_market()
    psbt = _psbt(req.psbt)
    spks = {o.script_pubkey for o in psbt.tx.outputs}
    if len(spks) != 1 or len(psbt.tx.outputs) != 3 or any(psbt.witness_utxo(i) is None or psbt.witness_utxo(i).script_pubkey not in spks for i in range(len(psbt.tx.inputs))):
        raise HTTPException(400, "this isn't a dummy-making transaction")
    if btc.script_address(next(iter(spks)), net) is None and btc.kind_of(next(iter(spks))) != "p2sh":
        raise HTTPException(400, f"that address isn't on {net}")
    for t in psbt.tx.inputs:
        if not _clean(_chain().output(t.outpoint) or {"spent": True}):
            raise HTTPException(400, "a dummy-making transaction only spends outputs holding nothing but sats")
    try:
        for i in range(len(psbt.tx.inputs)):
            btc.finalize_input(psbt, i)
    except btc.BadTx as e:
        raise HTTPException(400, str(e)) from e
    raw = psbt.extract().serialize().hex()
    allowed, reason = _chain().test_accept(raw)
    if not allowed:
        raise HTTPException(409, f"bitcoind won't take this transaction: {reason}")
    return {"txid": _chain().send(raw)}
