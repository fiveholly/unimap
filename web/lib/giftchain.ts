// The gift network as the browser sees it (lib/gift.ts): an Esplora API (mempool.space's signet or
// testnet by default; the server names one in /v1/capsules/rules), asked directly, so the 时间锁
// page needs nothing from unimap to show the tip, find the gift and broadcast a sweep. Demo mode
// answers from lib/demo.ts instead: a pretend chain whose blocks come every 75 seconds.

import { DEMO, demoChain } from "./demo";
import type { GiftNetwork } from "./gift.ts";

export type ChainUtxo = { txid: string; vout: number; value: number; status?: { confirmed: boolean; block_height?: number } };
export type Chain = {
  tip: () => Promise<number>;
  utxos: (address: string) => Promise<ChainUtxo[]>;
  txHex: (txid: string) => Promise<string>;
  broadcast: (hex: string) => Promise<string>;
  feeRate: () => Promise<number>; // sats/vB for a block or so
};

/** Esplora's API for each test network, as api/gift.py has it. */
export const ESPLORA: Record<GiftNetwork, string> = {
  signet: "https://mempool.space/signet/api",
  testnet: "https://mempool.space/testnet/api",
  testnet4: "https://mempool.space/testnet4/api",
};
export const EXPLORER: Record<GiftNetwork, string> = {
  signet: "https://mempool.space/signet",
  testnet: "https://mempool.space/testnet",
  testnet4: "https://mempool.space/testnet4",
};

async function get(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
}

export function esplora(base: string): Chain {
  const b = base.replace(/\/+$/, "");
  return {
    tip: async () => Number(await (await get(`${b}/blocks/tip/height`)).text()),
    utxos: async (address) => (await get(`${b}/address/${address}/utxo`)).json(),
    txHex: async (txid) => (await (await get(`${b}/tx/${txid}/hex`)).text()).trim(),
    broadcast: async (hex) => {
      const r = await fetch(`${b}/tx`, { method: "POST", body: hex });
      const text = (await r.text()).trim();
      if (!r.ok) throw new Error(text.slice(0, 300) || String(r.status));
      return text;
    },
    feeRate: async () => {
      try {
        const est = (await (await get(`${b}/fee-estimates`)).json()) as Record<string, number>;
        return Math.max(1, Math.ceil(est["2"] ?? est["3"] ?? est["6"] ?? 1));
      } catch {
        return 2;
      }
    },
  };
}

/** The chain for a network: the server's Esplora if given, else the default one; demo mode's own. */
export function chainFor(network: GiftNetwork, base?: string | null): Chain {
  return DEMO ? demoChain : esplora(base || ESPLORA[network]);
}

/** Explorer links (mempool.space-style) for an address or a transaction. */
export const explorerAddress = (network: GiftNetwork, address: string) => (DEMO ? "#demo-explorer" : `${EXPLORER[network]}/address/${address}`);
export const explorerTx = (network: GiftNetwork, txid: string) => (DEMO ? "#demo-explorer" : `${EXPLORER[network]}/tx/${txid}`);
