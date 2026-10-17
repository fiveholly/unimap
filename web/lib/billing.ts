// 平台收费 (api/billing.py): paying unimap for a product. On-chain is the default: the connected
// wallet sends the amount to unimap's address and the page posts the txid, which the server checks
// with bitcoind. Lightning (an invoice) is the second way, when the server has a Lightning address.

export type PayMethod = "onchain" | "lightning";

const TXID = /^[0-9a-f]{64}$/;

/** A txid from what someone pasted: the bare 64 hex characters, or an explorer link ending in one. */
export function parseTxid(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (TXID.test(s)) return s;
  const m = s.match(/(?:^|[/=#:])([0-9a-f]{64})(?:[/?#:]|$)/);
  return m ? m[1] : null;
}

/** The txid a wallet's send gave back: a string (UniSat, OKX) or { txid } (Xverse's sendTransfer). */
export function walletTxid(result: unknown): string {
  const raw = typeof result === "string" ? result : (result as { txid?: unknown } | null)?.txid;
  const txid = typeof raw === "string" ? parseTxid(raw) : null;
  if (!txid) throw new Error("the wallet didn't return a transaction id");
  return txid;
}

/** Sats as BTC with no trailing zeros: 2000 → "0.00002". */
export function btcAmount(sats: number): string {
  const whole = Math.floor(sats / 1e8), frac = String(sats % 1e8).padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/** The ways to pay that the server offers, in its order (the default first); unknown ones dropped. */
export function payMethods(methods: readonly string[] | undefined): PayMethod[] {
  return (methods ?? []).filter((m): m is PayMethod => m === "onchain" || m === "lightning");
}

/** A fake txid for the demo wallet. */
export function demoTxid(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}
