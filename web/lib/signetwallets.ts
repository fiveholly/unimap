// The real browser wallets on signet, for the demo site's 真实 Signet mode (lib/signet.ts). In demo
// mode a login is simulated (lib/demo.ts), so whichever wallet signed in, the gift is funded by a
// real one: the signed-in wallet if it is UniSat, Xverse or OKX, else the first of them installed.
// Each checks it is on signet before it gives an address, and says so when it isn't.

import { t } from "./i18n/index.ts";
import { hexSigner, walletById, type PsbtAccounts, type PsbtSigner, type WalletId } from "./wallets.ts";
import { isTestAddress } from "./gift.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const w = (): any => (typeof window === "undefined" ? {} : (window as any));

export type SignetWalletId = "unisat" | "xverse" | "okx";
export type SignetSigner = PsbtSigner & { id: SignetWalletId; name: string };

/** The wallet is on another network: switch it to signet. canSwitch: this page can ask it to. */
export class WrongNetwork extends Error {
  constructor(
    public wallet: string,
    public found: string | null,
    public canSwitch: boolean,
  ) {
    super(
      found
        ? t("{wallet} 现在在 {found} 上，不是 Signet：请在 {wallet} 里切到 Signet（测试网），再试一次。", { wallet, found })
        : t("{wallet} 现在不在 Signet 上：请在 {wallet} 里切到 Signet（测试网），再试一次。", { wallet }),
    );
  }
}

/** UniSat's chain: getChain() where it has it (enum BITCOIN_SIGNET), else getNetwork() ("testnet" covers signet). */
async function unisatOnSignet(u: any) {
  if (typeof u.getChain === "function") {
    const c = await u.getChain();
    if (c?.enum !== "BITCOIN_SIGNET") throw new WrongNetwork("UniSat", c?.name ?? c?.enum ?? null, typeof u.switchChain === "function");
  } else if (typeof u.getNetwork === "function") {
    const n = await u.getNetwork();
    if (n !== "testnet") throw new WrongNetwork("UniSat", n === "livenet" ? "Mainnet" : n, false);
  }
}

const unisatSigner = hexSigner(
  () => w().unisat,
  async () => {
    const u = w().unisat;
    await unisatOnSignet(u);
    const [address] = await u.requestAccounts();
    return { address, publicKey: await u.getPublicKey() };
  },
);

// OKX keeps signet apart: window.okxwallet.bitcoinSignet, with the same calls as its mainnet provider.
const okxSigner = hexSigner(
  () => w().okxwallet.bitcoinSignet,
  async () => {
    const p = w().okxwallet.bitcoinSignet;
    const r = await p.connect();
    return { address: r.address, publicKey: r.publicKey ?? (await p.getPublicKey()) };
  },
);

async function xverseOnSignet() {
  const p = w().XverseProviders?.BitcoinProvider || w().BitcoinProvider;
  let name: string | null = null;
  try {
    const res = await p.request("wallet_getNetwork", null);
    name = res?.result?.bitcoin?.name ?? null;
  } catch {}
  // Older Xverse has no wallet_getNetwork; then only the address (tb1…) and the coins on signet tell.
  if (name && name.toLowerCase() !== "signet") throw new WrongNetwork("Xverse", name, false);
}

const SIGNERS: Record<SignetWalletId, { name: string; available: () => boolean; signer: PsbtSigner; before?: () => Promise<void> }> = {
  unisat: { name: "UniSat", available: () => !!w().unisat, signer: unisatSigner },
  okx: { name: "OKX Wallet", available: () => !!w().okxwallet?.bitcoinSignet, signer: okxSigner },
  xverse: { name: "Xverse", available: () => !!(w().XverseProviders?.BitcoinProvider || w().BitcoinProvider), signer: walletById("xverse")!.psbt!, before: xverseOnSignet },
};
const ORDER: SignetWalletId[] = ["unisat", "okx", "xverse"];

/** The real wallet that funds (or signs for) a signet gift: the signed-in one if it can, else the first installed. */
export function signetSigner(preferred: WalletId | null | undefined): SignetSigner | null {
  const id = preferred && (ORDER as string[]).includes(preferred) && SIGNERS[preferred as SignetWalletId].available() ? (preferred as SignetWalletId) : ORDER.find((x) => SIGNERS[x].available());
  if (!id) return null;
  const s = SIGNERS[id];
  return {
    id,
    name: s.name,
    accounts: async (): Promise<PsbtAccounts> => {
      await s.before?.();
      const acc = await s.signer.accounts();
      // A tb1… (or 2…/m…/n…) address at least: a mainnet one means the wallet is on mainnet.
      if (!isTestAddress(acc.payment_address)) throw new WrongNetwork(s.name, "Mainnet", id === "unisat");
      return acc;
    },
    sign: s.signer.sign,
  };
}

/** Ask the wallet to switch to signet itself, where it can (UniSat). */
export async function switchToSignet(id: SignetWalletId): Promise<void> {
  const u = w().unisat;
  if (id !== "unisat" || typeof u?.switchChain !== "function") throw new Error(t("请在钱包里手动切到 Signet。"));
  await u.switchChain("BITCOIN_SIGNET");
}
