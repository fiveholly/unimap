// Browser wallets that can sign messages for login and posts.
//
// Each wallet gives the address that holds the user's inscriptions (the
// ordinals / taproot address) and signs with BIP-322 where it can.

export type WalletId = "unisat" | "xverse" | "okx" | "manual";

export type Wallet = {
  id: WalletId;
  name: string;
  available: () => boolean;
  connect: () => Promise<string>;
  sign: (address: string, message: string) => Promise<string>;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const w = (): any => (typeof window === "undefined" ? {} : (window as any));

const unisat: Wallet = {
  id: "unisat",
  name: "UniSat",
  available: () => !!w().unisat,
  connect: async () => (await w().unisat.requestAccounts())[0],
  sign: (_address, message) => w().unisat.signMessage(message, "bip322-simple"),
};

const okx: Wallet = {
  id: "okx",
  name: "OKX Wallet",
  available: () => !!w().okxwallet?.bitcoin,
  connect: async () => (await w().okxwallet.bitcoin.connect()).address,
  sign: (_address, message) => w().okxwallet.bitcoin.signMessage(message, "bip322-simple"),
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

export const WALLETS: Wallet[] = [unisat, xverse, okx, manual];

export function walletById(id: WalletId | null | undefined): Wallet | undefined {
  return WALLETS.find((x) => x.id === id);
}
