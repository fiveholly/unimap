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

The market runs only when MARKET_NETWORK is set (testnet4, signet or regtest), and refuses
mainnet unless MARKET_MAINNET_AUDITED=1, which is for after the outside audit.
"""

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import btc, notify, wallets
from api.auth import current_address
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
    txid, vout = outpoint.rsplit(":", 1)
    tx = btc.Tx(2, [btc.TxIn(txid, int(vout), sequence=SEQUENCE)], [btc.TxOut(req.price_sats, pay_spk)])
    psbt = btc.Psbt.from_tx(tx)
    psbt.set_witness_utxo(0, btc.TxOut(value, spk))
    psbt.set(0, btc.IN_SIGHASH_TYPE, btc.SINGLE_ACP.to_bytes(4, "little"))
    _describe_inputs(psbt, 0, spk, req.public_key)
    return {"psbt": psbt.b64(), "psbt_hex": psbt.serialize().hex(), "sign_inputs": [0], "sighash": btc.SINGLE_ACP,
            "inscription_id": inscription_id, "postage_sats": value}


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
    tx = psbt.tx
    if len(tx.inputs) != 1 or len(tx.outputs) != 1:
        raise HTTPException(400, "a listing is one input and one output")
    with cursor() as cur:
        inscription_id, owner, outpoint = _land(cur, req.bitmap_number, req.tx_index)
    if owner != address:
        raise HTTPException(403, "only the address holding it can sell it")
    if tx.inputs[0].outpoint != outpoint:
        raise HTTPException(409, "this listing spends an output that no longer holds the inscription")
    value, spk = _sellable(inscription_id, outpoint)
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
    with cursor() as cur:
        cur.execute(
            "update social.market_listings set status = 'replaced', updated_at = now() where inscription_id = %s and status = 'active';",
            (inscription_id,),
        )
        cur.execute(
            "insert into social.market_listings (inscription_id, bitmap_number, tx_index, seller, price_sats, pay_to_script, outpoint, postage_sats, psbt) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id;",
            (inscription_id, req.bitmap_number, req.tx_index, address, pay.value, pay.script_pubkey.hex(), outpoint, value, psbt.b64()),
        )
        listing_id = cur.fetchone()[0]
        return _listing(cur, listing_id)


LISTING_COLUMNS = (
    "m.id, m.inscription_id, m.bitmap_number, m.tx_index, m.seller, m.price_sats, m.outpoint, m.postage_sats, m.status, "
    "m.created_at, m.sold_txid, m.buyer, o.outpoint = m.outpoint as fresh"
)
LISTING_FROM = "from social.market_listings m left join inscription_owners o on o.inscription_id = m.inscription_id "


def _view(row):
    lid, iid, n, tx_index, seller, price, outpoint, postage, status, created_at, sold_txid, buyer, fresh = row
    if status == "active" and not fresh:
        status = "gone"  # the inscription moved some other way
    return {
        "id": lid, "inscription_id": iid, "bitmap_number": n, "tx_index": tx_index, "seller": seller, "price_sats": price,
        "postage_sats": postage, "status": status, "created_at": created_at.isoformat(), "txid": sold_txid, "buyer": buyer,
    }


def _listing(cur, listing_id):
    cur.execute(f"select {LISTING_COLUMNS} {LISTING_FROM} where m.id = %s;", (listing_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "no such listing")
    return _view(row)


@router.get("/v1/market/listings")
def market_listings(bitmap_number: int | None = None, limit: int = 50):
    """Live listings, cheapest first; with bitmap_number, the district's and its parcels'."""
    if network() is None:
        return {"listings": []}
    limit = max(1, min(limit, 200))
    with cursor() as cur:
        cur.execute(
            f"select {LISTING_COLUMNS} {LISTING_FROM} where m.status = 'active' and o.outpoint = m.outpoint "
            "and (%(n)s::int4 is null or m.bitmap_number = %(n)s) order by m.price_sats, m.id limit %(limit)s;",
            {"n": bitmap_number, "limit": limit},
        )
        return {"listings": [_view(r) for r in cur.fetchall()]}


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


@router.post("/v1/market/listings/{listing_id}/quote")
def quote(listing_id: int, req: QuoteBody, address: str = Depends(current_address)):
    """The purchase for the buyer's wallet to sign: every input but the seller's (index 2), SIGHASH_ALL."""
    net = _need_market()
    pay_spk = _script(req.payment_address, net)
    recv_spk = _script(req.receive_address, net)
    if btc.kind_of(recv_spk) != "p2tr":
        raise HTTPException(400, "inscriptions go to a taproot (bc1p…) address")
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
    seller_out, seller_utxo = seller.tx.outputs[0], seller.witness_utxo(0)
    if _chain().txout(seller.tx.inputs[0].outpoint) is None:
        raise HTTPException(409, "the inscription's output is already being spent")
    if seller_utxo.value < btc.dust_limit(recv_spk):
        raise HTTPException(409, "the inscription's output is too small to send on")

    coins = [c for c in _coins(net, req.payment_address) if c[0] != seller.tx.inputs[0].outpoint]
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
    tx.inputs.append(btc.TxIn(seller.tx.inputs[0].txid, seller.tx.inputs[0].vout, sequence=seller.tx.inputs[0].sequence))
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
    psbt.inputs[2] = dict(seller.inputs[0])  # final already: the witness UTXO and the seller's witness
    for i, coin in enumerate(dummies + [None] + chosen):
        if coin is None:
            continue
        _, value, spk = coin
        psbt.set_witness_utxo(i, btc.TxOut(value, spk))
        _describe_inputs(psbt, i, spk, req.payment_public_key)
        sign.append(i)
    with cursor() as cur:
        cur.execute(
            "insert into social.market_quotes (listing_id, buyer, psbt, expires_at) values (%s, %s, %s, now() + make_interval(mins => %s)) returning id;",
            (listing_id, address, psbt.b64(), QUOTE_MINUTES),
        )
        quote_id = cur.fetchone()[0]
    spent = sum(v for _, v, _ in dummies + chosen)
    back = a + b + DUMMY * 2 + change
    return {
        "quote_id": quote_id, "psbt": psbt.b64(), "psbt_hex": psbt.serialize().hex(), "sign_inputs": sign,
        "price_sats": seller_out.value, "fee_sats": fee_out, "network_fee_sats": miners, "fee_rate": rate,
        "postage_sats": seller_utxo.value, "total_sats": spent - back, "expires_in": QUOTE_MINUTES * 60,
    }


class SubmitBody(BaseModel):
    psbt: str = Field(max_length=400_000)


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
    if signed.tx.serialize(witness=False) != quoted.tx.serialize(witness=False):
        raise HTTPException(400, "the signed transaction isn't the one quoted")
    spent = [quoted.witness_utxo(i) for i in range(len(quoted.tx.inputs))]
    for i in range(len(quoted.tx.inputs)):
        if i == 2:
            continue
        found = btc.input_signature(_with_utxo(signed, i, spent[i]), i)
        if found is None:
            raise HTTPException(400, f"input {i} isn't signed")
        try:
            hash_type = btc.check_signature(quoted.tx, i, spent, *found)
        except btc.BadTx as e:
            raise HTTPException(400, str(e)) from e
        if hash_type not in (btc.SIGHASH_DEFAULT, btc.SIGHASH_ALL):
            raise HTTPException(400, "the buyer's inputs are signed with SIGHASH_ALL")
        quoted.inputs[i] = {**quoted.inputs[i], **_signature_fields(signed, i)}
        try:
            btc.finalize_input(quoted, i)
        except btc.BadTx as e:
            raise HTTPException(400, str(e)) from e
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
            "where id = %s and status = 'active' returning seller, bitmap_number;",
            (address, quoted.tx.txid, listing_id),
        )
        sold = cur.fetchone()
        if sold is None:
            raise HTTPException(409, "this listing is no longer for sale")
        txid = c.send(raw)
        notify.notify(cur, sold[0], "sold", address, sold[1])
    return {"txid": txid, "listing_id": listing_id}


def _with_utxo(psbt, i, utxo):
    if psbt.witness_utxo(i) is None:
        psbt.set_witness_utxo(i, utxo)
    return psbt


def _signature_fields(psbt, i):
    keep = (btc.IN_PARTIAL_SIG, btc.IN_TAP_KEY_SIG, btc.IN_FINAL_SCRIPTWITNESS, btc.IN_FINAL_SCRIPTSIG, btc.IN_REDEEM_SCRIPT)
    return {k: v for k, v in psbt.inputs[i].items() if k[0] in keep}


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
