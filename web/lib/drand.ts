// drand timelock encryption for 礼物 (lib/gift.ts): the letter's key is encrypted to a future
// round of drand quicknet, the League of Entropy's 3-second beacon, and anyone can decrypt it once
// that round's signature is out, with or without unimap. tlock-js does the work; it is loaded only
// when a gift is sealed or opened.
//
// Encrypting needs only the network's public key, which is fixed and kept here, so sealing works
// offline. Decrypting fetches the round's beacon from drand's relays and checks its signature.

/** drand quicknet (unchained BLS on G1, RFC 9380): what tlock-js calls mainnet. */
export const QUICKNET = {
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  genesis: 1692803367,
  period: 3,
  url: "https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
};

/** The first quicknet round out at or after unix time t (seconds). */
export function roundAtOrAfter(t: number): number {
  return Math.max(1, Math.ceil((t - QUICKNET.genesis) / QUICKNET.period) + 1);
}

/** When a round comes out (unix seconds). */
export const roundTime = (round: number) => QUICKNET.genesis + (round - 1) * QUICKNET.period;

type Tlock = typeof import("tlock-js");
/** tlock-js is CommonJS: its exports are on default under Node, on the namespace under a bundler. */
async function load(): Promise<Tlock> {
  const m = (await import("tlock-js")) as Tlock & { default?: Tlock };
  return m.default?.timelockEncrypt ? m.default : m;
}

/** bytes, timelock-encrypted to round: an armored age file (-----BEGIN AGE ENCRYPTED FILE-----). */
export async function tlockEncrypt(round: number, bytes: Uint8Array): Promise<string> {
  const tl = await load();
  const info = tl.defaultChainInfo; // quicknet's public key and scheme, as shipped with tlock-js
  if (info.hash !== QUICKNET.hash) throw new Error("tlock-js isn't on drand quicknet");
  const offline = { options: {}, chain: () => ({ baseUrl: QUICKNET.url, info: async () => info }), latest: () => Promise.reject(new Error("offline")), get: () => Promise.reject(new Error("offline")) };
  return tl.timelockEncrypt(round, tl.Buffer.from(bytes), offline as unknown as Parameters<typeof tl.timelockEncrypt>[2]);
}

/** tlockEncrypt's bytes back, once the round is out; throws before then, or if drand can't be reached in time. */
export async function tlockDecrypt(armored: string, timeoutMs = 10_000): Promise<Uint8Array> {
  const tl = await load();
  const work = tl.timelockDecrypt(armored, tl.mainnetClient()).then((b) => new Uint8Array(b));
  const late = new Promise<never>((_, no) => setTimeout(() => no(new Error("drand didn't answer")), timeoutMs));
  return Promise.race([work, late]);
}
