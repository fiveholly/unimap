"""Data sources: OPI's ord db_reader (JSON-RPC) and bitcoind (JSON-RPC)."""

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


class Bitcoind:
    def __init__(self, url, user, password):
        self.url = url
        self.auth = (user, password) if user else None

    def block_hash(self, block_height):
        return _call(self.url, "getblockhash", [block_height], self.auth)

    def tx_count(self, block_hash):
        return _call(self.url, "getblockheader", [block_hash], self.auth)["nTx"]
