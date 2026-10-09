"""Data sources: OPI's ord db_reader (JSON-RPC), upstream ord server (JSON API)
and bitcoind (JSON-RPC)."""

import requests


class RpcError(Exception):
    pass


def _call(url, method, params, auth=None):
    r = requests.post(
        url,
        json={"jsonrpc": "2.0", "id": "unimap", "method": method, "params": params},
        auth=auth,
        timeout=60,
    )
    if r.status_code != 200 and not r.headers.get("content-type", "").startswith("application/json"):
        raise RpcError(f"{method}: HTTP {r.status_code}")
    js = r.json()
    if js.get("error"):
        raise RpcError(f"{method}: {js['error']}")
    return js.get("result")


class OrdReader:
    """OPI ord's db_reader server (DB_READER_API_URL, default port 11030)."""

    def __init__(self, url):
        self.url = url

    def latest_block_height(self):
        return _call(self.url, "getLatestBlockHeight", [])

    def block_text_inscriptions(self, block_height):
        # Despite the name, this returns every new non-cursed, non-JSON
        # text/plain inscription of the block, sorted by inscription number.
        # OPI's bitmap_index filters it down to "N.bitmap"; we filter to parcels.
        return _call(self.url, "getBlockBitmapInscrs", [block_height]) or []

    def parent_id(self, inscription_id):
        info = _call(self.url, "getInscriptionInfo", [inscription_id])
        if info is None:
            return None
        return info["info"]["parent_id"]


class OrdServer:
    """Upstream ord's HTTP server (ORD_API_URL). Tracks where every inscription is now;
    OPI's fork only records the first transfers of each inscription."""

    def __init__(self, url):
        self.url = url.rstrip("/")

    def _get(self, path):
        r = requests.get(self.url + path, headers={"Accept": "application/json"}, timeout=60)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    def block_height(self):
        """Highest block ord has indexed."""
        return self._get("/blockheight")

    def location(self, inscription_id):
        """(outpoint, address, value) of the inscription's current output, or None.
        address is None for scripts ord can't render as an address."""
        info = self._get(f"/inscription/{inscription_id}")
        if info is None:
            return None
        outpoint = info["satpoint"].rsplit(":", 1)[0]
        return outpoint, info.get("address"), info.get("value")


class Bitcoind:
    def __init__(self, url, user, password):
        self.url = url
        self.auth = (user, password) if user else None

    def block_hash(self, block_height):
        return _call(self.url, "getblockhash", [block_height], self.auth)

    def tx_count(self, block_hash):
        return _call(self.url, "getblockheader", [block_hash], self.auth)["nTx"]

    def spent_outpoints(self, block_hash):
        """Every "txid:vout" spent by the block's non-coinbase inputs."""
        block = _call(self.url, "getblock", [block_hash, 2], self.auth)
        return [
            f"{vin['txid']}:{vin['vout']}"
            for tx in block["tx"]
            for vin in tx["vin"]
            if "txid" in vin
        ]
