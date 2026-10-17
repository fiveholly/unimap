import os

# api/prices.py asks mempool.space for BTC/USD; tests never do.
os.environ.setdefault("PRICE_URL", "off")
