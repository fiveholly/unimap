// Browser wallets that can sign messages for login and posts.
//
// Each wallet gives the address that holds the user's inscriptions (the
// ordinals / taproot address) and signs with BIP-322 where it can.

import { DEMO, DEMO_ADDRESS, DEMO_SECOND_ADDRESS } from "./demo";
import { t } from "./i18n/index.ts";

export type WalletId = "unisat" | "xverse" | "okx" | "manual" | "demo" | "demo2";

export type Wallet = {
  id: WalletId;
  name: string;
  available: () => boolean;
  connect: () => Promise<string>;
  sign: (address: string, message: string) => Promise<string>;
  psbt?: PsbtSigner; // 站内交易: wallets that can sign transactions
};

/** The addresses a purchase pays from and receives the inscription at, with the keys a PSBT needs. */
export type PsbtAccounts = { payment_address: string; payment_public_key: string | null; receive_address: string; receive_public_key: string | null };
/** One input for the wallet to sign; sighash only for a listing (SIGHASH_SINGLE|ANYONECANPAY = 0x83). */
export type ToSign = { index: number; address: string; sighash?: number };
export type PsbtSigner = { accounts: () => Promise<PsbtAccounts>; sign: (psbtBase64: string, inputs: ToSign[]) => Promise<string> };

const toHex = (b64: string) => Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
const toBase64 = (hex: string) => btoa(String.fromCharCode(...(hex.match(/../g) ?? []).map((h) => parseInt(h, 16))));

/** UniSat and OKX: one address pays and receives; signPsbt takes hex and the inputs to sign. */
function hexSigner(provider: () => any, account: () => Promise<{ address: string; publicKey: string | null }>): PsbtSigner {
  return {
    accounts: async () => {
      const { address, publicKey } = await account();
      return { payment_address: address, payment_public_key: publicKey, receive_address: address, receive_public_key: publicKey };
    },
    sign: async (psbt, inputs) => {
      const toSignInputs = inputs.map((i) => ({ index: i.index, address: i.address, ...(i.sighash != null ? { sighashTypes: [i.sighash] } : {}) }));
      return toBase64(await provider().signPsbt(toHex(psbt), { autoFinalized: false, toSignInputs }));
    },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const w = (): any => (typeof window === "undefined" ? {} : (window as any));

const unisat: Wallet = {
  id: "unisat",
  name: "UniSat",
  available: () => !!w().unisat,
  connect: async () => (await w().unisat.requestAccounts())[0],
  sign: (_address, message) => w().unisat.signMessage(message, "bip322-simple"),
  psbt: hexSigner(
    () => w().unisat,
    async () => ({ address: (await w().unisat.getAccounts())[0], publicKey: await w().unisat.getPublicKey() }),
  ),
};

const okx: Wallet = {
  id: "okx",
  name: "OKX Wallet",
  available: () => !!w().okxwallet?.bitcoin,
  connect: async () => (await w().okxwallet.bitcoin.connect()).address,
  sign: (_address, message) => w().okxwallet.bitcoin.signMessage(message, "bip322-simple"),
  psbt: hexSigner(
    () => w().okxwallet.bitcoin,
    async () => {
      const r = await w().okxwallet.bitcoin.connect();
      return { address: r.address, publicKey: r.publicKey ?? (await w().okxwallet.bitcoin.getPublicKey()) };
    },
  ),
};

function xverseProvider() {
  return w().XverseProviders?.BitcoinProvider || w().BitcoinProvider;
}

async function xverseRequest(method: string, params: unknown) {
  const res = await xverseProvider().request(method, params);
  if (res?.error) throw new Error(res.error.message || String(res.error));
  return res?.result ?? res;
}

const xverse: Wallet = {
  id: "xverse",
  name: "Xverse",
  available: () => !!xverseProvider(),
  connect: async () => {
    const result = await xverseRequest("getAccounts", { purposes: ["ordinals"], message: "Sign in to unimap" });
    const accounts = Array.isArray(result) ? result : result.addresses || [];
    const ordinals = accounts.find((a: any) => a.purpose === "ordinals") || accounts[0];
    if (!ordinals) throw new Error("Xverse returned no address");
    return ordinals.address;
  },
  sign: async (address, message) => (await xverseRequest("signMessage", { address, message, protocol: "BIP322" })).signature,
  // Xverse keeps inscriptions and coins at two addresses, and signs with the sighash the PSBT asks for.
  psbt: {
    accounts: async () => {
      const result = await xverseRequest("getAccounts", { purposes: ["ordinals", "payment"], message: "unimap market" });
      const accounts = Array.isArray(result) ? result : result.addresses || [];
      const ordinals = accounts.find((a: any) => a.purpose === "ordinals"), payment = accounts.find((a: any) => a.purpose === "payment");
      if (!ordinals || !payment) throw new Error("Xverse returned no address");
      return { payment_address: payment.address, payment_public_key: payment.publicKey, receive_address: ordinals.address, receive_public_key: ordinals.publicKey };
    },
    sign: async (psbt, inputs) => {
      const signInputs: Record<string, number[]> = {};
      for (const i of inputs) (signInputs[i.address] ??= []).push(i.index);
      return (await xverseRequest("signPsbt", { psbt, signInputs, broadcast: false })).psbt;
    },
  },
};

// Paste a signature made elsewhere, e.g. `ord wallet sign`. Handy on regtest and for
// wallets without a browser extension. The UI supplies the address and the signature.
export type ManualPrompt = {
  askAddress: () => Promise<string>;
  askSignature: (address: string, message: string) => Promise<string>;
};

let manualPrompt: ManualPrompt | null = null;
export function setManualPrompt(p: ManualPrompt | null) {
  manualPrompt = p;
}

const manual: Wallet = {
  id: "manual",
  name: "Paste a signature",
  available: () => true,
  connect: () => {
    if (!manualPrompt) throw new Error("manual signing is not ready");
    return manualPrompt.askAddress();
  },
  sign: (address, message) => {
    if (!manualPrompt) throw new Error("manual signing is not ready");
    return manualPrompt.askSignature(address, message);
  },
};

// Demo mode only: a pretend wallet that holds a couple of districts and a parcel.
const demo: Wallet = {
  id: "demo",
  get name() {
    return t("演示钱包");
  },
  available: () => DEMO,
  connect: async () => DEMO_ADDRESS,
  sign: async () => "demo-" + Math.random().toString(36).slice(2),
  // The demo market (lib/demo.ts) takes any PSBT back; nothing is signed or sent.
  psbt: {
    accounts: async () => ({ payment_address: DEMO_ADDRESS, payment_public_key: null, receive_address: DEMO_ADDRESS, receive_public_key: null }),
    sign: async (psbt) => psbt,
  },
};

// Demo mode only: a second pretend wallet to link to the first (关联钱包).
const demo2: Wallet = {
  id: "demo2",
  get name() {
    return t("演示钱包 2");
  },
  available: () => DEMO,
  connect: async () => DEMO_SECOND_ADDRESS,
  sign: async () => "demo-" + Math.random().toString(36).slice(2),
};

export const WALLETS: Wallet[] = DEMO ? [demo, unisat, xverse, okx, manual] : [unisat, xverse, okx, manual];
/** Wallets that can sign to link another address while signed in (关联钱包). */
export const LINK_WALLETS: Wallet[] = DEMO ? [demo2, unisat, xverse, okx, manual] : WALLETS;

export function walletById(id: WalletId | null | undefined): Wallet | undefined {
  return WALLETS.find((x) => x.id === id);
}
