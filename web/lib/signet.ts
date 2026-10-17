// 真实 Signet: an opt-in on the demo site (NEXT_PUBLIC_DEMO=1) that sends a 礼物 over the real
// Bitcoin signet instead of the demo's pretend chain. The demo still has no server: lib/demo.ts
// keeps standing in for unimap (the capsule, its 封存 payment, and unimap's half of the backup key,
// all in this browser's storage), but the gift network's tip, the wallet's coins, the commit and
// reveal, and the sweep are all real signet, through a public Esplora API. The switch is per
// browser (localStorage), off by default. Signet only: mainnet stays impossible in demo mode.
//
// No React and nothing from lib/demo.ts here, so demo.ts and the node tests can import it.

const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

export const SIGNET_ESPLORA = "https://mempool.space/signet/api";
export const SIGNET_EXPLORER = "https://mempool.space/signet";
export const SIGNET_BLOCK_SECONDS = 600;
const KEY = "unimap.demo.signet";
const EVENT = "unimap:signet";

/** The switch is on in this browser (and this is the demo site). */
export function liveSignet(): boolean {
  if (!DEMO) return false;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setLiveSignet(on: boolean) {
  if (!DEMO) return;
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {}
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {}
}

/** Calls back when the switch changes, here or in another tab; returns the unsubscribe. */
export function onLiveSignet(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const storage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", storage);
  };
}

async function get(url: string, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The signet tip, read fresh from Esplora; null when it can't be had. unimap's half is released on this. */
export async function signetTip(base = SIGNET_ESPLORA, timeoutMs = 8_000): Promise<number | null> {
  try {
    const r = await get(`${base.replace(/\/+$/, "")}/blocks/tip/height`, timeoutMs);
    if (!r.ok) return null;
    const n = Number((await r.text()).trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

let cached: { at: number; tip: number } | null = null;
/** signetTip, kept for 20 seconds: for showing, never for releasing a key. */
export async function cachedSignetTip(): Promise<number | null> {
  if (cached && Date.now() - cached.at < 20_000) return cached.tip;
  const tip = await signetTip();
  if (tip != null) cached = { at: Date.now(), tip };
  return tip;
}

export type EsploraTx = { txid: string; vin: { txid: string; vout: number }[]; vout: { scriptpubkey_address?: string; value: number }[] };

/** A transaction as Esplora describes it; {} if it doesn't know it (yet), null if it can't be asked. */
export async function signetTx(txid: string, base = SIGNET_ESPLORA): Promise<EsploraTx | Record<string, never> | null> {
  try {
    const r = await get(`${base.replace(/\/+$/, "")}/tx/${txid}`, 8_000);
    if (r.status === 404 || r.status === 400) return {};
    if (!r.ok) return null;
    return (await r.json()) as EsploraTx;
  } catch {
    return null;
  }
}

/** As api/gift.py _check_reveal: true if the reveal pays the gift address its amount and spends the
 * commit, false if Esplora doesn't know it yet; a reason string if it says otherwise. */
export function checkReveal(tx: EsploraTx | Record<string, never> | null, o: { address: string; sats: number; commit: string }): true | false | string {
  if (!tx || !("vout" in tx)) return false;
  const out = tx.vout?.[0], input = tx.vin?.[0];
  if (!out || out.scriptpubkey_address !== o.address || Number(out.value ?? 0) < o.sats) return "the reveal's first output doesn't pay the gift address its amount";
  if (!input || input.txid !== o.commit) return "the reveal doesn't spend the commit";
  return true;
}

/** Why opening with drand failed, for the page: not out yet (with when), or drand unreachable. */
export function drandProblem(round: number, roundTime: number, now: number, e: unknown): { kind: "early"; at: number } | { kind: "down"; why: string } {
  if (roundTime > now) return { kind: "early", at: roundTime };
  const why = e instanceof Error ? e.message : String(e);
  const m = why.match(/decryptable at round (\d+)/);
  return m && +m[1] === round ? { kind: "early", at: roundTime } : { kind: "down", why };
}
