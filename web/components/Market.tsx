"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useSession } from "./Session";
import { api, type MarketInfo, type MarketListing, type Quote } from "@/lib/api";
import { btc } from "@/lib/format";
import { t } from "@/lib/i18n";
import { walletById, type PsbtSigner } from "@/lib/wallets";

const SINGLE_ACP = 0x83; // the seller signs "this input, for that output"
const sats = (n: number) => n.toLocaleString("en-US");
const EXPLORERS: Record<string, string> = {
  mainnet: "https://mempool.space/tx/",
  testnet: "https://mempool.space/testnet/tx/",
  testnet4: "https://mempool.space/testnet4/tx/",
  signet: "https://mempool.space/signet/tx/",
};

let info: Promise<MarketInfo> | null = null;
/** Whether unimap's own market is open, and on which network. Asked once per page load. */
export function useMarket() {
  const [m, setM] = useState<MarketInfo | null>(null);
  useEffect(() => {
    info ??= api<MarketInfo>("/v1/market").catch(() => ({ open: false, network: null, fee_bps: 0, dummy_sats: 600 }));
    info.then(setM);
  }, []);
  return m;
}

function useSigner(): [PsbtSigner | null, string | null] {
  const { wallet } = useSession();
  const w = walletById(wallet);
  if (!w) return [null, null];
  return [w.psbt ?? null, w.psbt ? null : t("{wallet} 不能签交易，换 UniSat、Xverse 或 OKX 连接", { wallet: w.name })];
}

export function NetworkTag({ network }: { network: string | null }) {
  if (!network || network === "mainnet") return null;
  return <span className="net-tag">{t("测试网 {net}", { net: network })}</span>;
}

function TxLink({ txid, network }: { txid: string; network: string | null }) {
  const base = network ? EXPLORERS[network] : undefined;
  return base ? (
    <a className="mono break" href={base + txid} target="_blank" rel="noopener noreferrer">
      {txid} ↗
    </a>
  ) : (
    <code className="mono break">{txid}</code>
  );
}

/** The owner's side: list the district in unimap, or take a listing down. */
export function SellCard({ n, token }: { n: number; token: string }) {
  const market = useMarket();
  const { address } = useSession();
  const [signer, signerError] = useSigner();
  const [mine, setMine] = useState<MarketListing | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api<{ listings: MarketListing[] }>(`/v1/market/listings?bitmap_number=${n}`)
      .then((r) => setMine(r.listings.find((l) => l.tx_index == null && l.seller === address) ?? null))
      .catch(() => setMine(null));
  useEffect(() => {
    if (market?.open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.open, n, address]);
  if (!market?.open || mine === undefined) return null;

  const list = async () => {
    setError(null);
    const p = Math.floor(Number(price));
    if (!Number.isFinite(p) || p < 1000) return setError(t("价格至少 1,000 聪"));
    if (!signer) return setError(signerError);
    setBusy(true);
    try {
      const acc = await signer.accounts();
      const prep = await api<{ psbt: string; postage_sats: number }>("/v1/market/listings/prepare", {
        method: "POST",
        token,
        body: { bitmap_number: n, price_sats: p, pay_to: acc.payment_address, public_key: acc.receive_public_key },
      });
      const signed = await signer.sign(prep.psbt, [{ index: 0, address: address!, sighash: SINGLE_ACP }]);
      await api("/v1/market/listings", { method: "POST", token, body: { psbt: signed, bitmap_number: n } });
      setOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const takeDown = async () => {
    if (!mine || !confirm(t("在 unimap 下架？你签过的挂单在铭文转走之前仍然有效，想彻底作废就把铭文转到你自己的另一个地址。"))) return;
    await api(`/v1/market/listings/${mine.id}`, { method: "DELETE", token }).catch((e) => setError(e.message));
    await load();
  };

  return (
    <div className="sell-card">
      <div className="row between">
        <b>{t("在 unimap 出售")}</b>
        <NetworkTag network={market.network} />
      </div>
      {mine ? (
        <>
          <p className="small">
            {t("你挂了 {price}，买家在这个页面就能直接买。", { price: btc(mine.price_sats) })}
          </p>
          <div className="row end">
            <button type="button" className="ghost sm" onClick={takeDown}>
              {t("下架")}
            </button>
          </div>
        </>
      ) : !open ? (
        <>
          <p className="muted small">{t("挂在 unimap，买家看得到这条街的居民和帖子，在这里就能买。钱和铭文都不经过 unimap。")}</p>
          <div className="row end">
            <button type="button" className="sm" onClick={() => setOpen(true)}>
              {t("挂单出售")}
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="small">
            {t("价格（聪）")}
            <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 16))} placeholder="1000000" />
          </label>
          {price && <p className="muted small mono">≈ {btc(Number(price))}</p>}
          <p className="muted small">
            {t("你的钱包会签一个半成品交易：这个铭文换一笔付到你地址的钱，金额就是这个价格。只有付够钱的交易能用这个签名，unimap 改不了它。铭文所在的那点聪会随铭文一起给买家。")}
            {market.fee_bps > 0 && " " + t("unimap 向买家收 {pct}% 手续费，写在交易里，双方签名前都看得到。", { pct: market.fee_bps / 100 })}
          </p>
          {error && <p className="error small">{error}</p>}
          <div className="row end">
            <button type="button" className="ghost sm" onClick={() => setOpen(false)} disabled={busy}>
              {t("取消")}
            </button>
            <button type="button" className="primary sm" onClick={list} disabled={busy}>
              {busy ? t("等待钱包签名…") : t("签名挂单")}
            </button>
          </div>
        </>
      )}
      {error && mine && <p className="error small">{error}</p>}
    </div>
  );
}

type Step = { kind: "quote"; quote: Quote } | { kind: "dummies" } | { kind: "dummies-sent"; txid: string } | { kind: "done"; txid: string };

/** The buyer's side: quote, sign in the wallet, broadcast. */
export function BuyButton({ listingId, price, label }: { listingId: number; price: number; label?: string }) {
  const { token } = useSession();
  const [open, setOpen] = useState(false);
  if (!token) return null;
  return (
    <>
      <button type="button" className="primary sm" onClick={() => setOpen(true)}>
        {label ?? t("在 unimap 购买")}
      </button>
      {open && <BuyDialog listingId={listingId} price={price} token={token} close={() => setOpen(false)} />}
    </>
  );
}

function BuyDialog({ listingId, price, token, close }: { listingId: number; price: number; token: string; close: () => void }) {
  const market = useMarket();
  const [signer, signerError] = useSigner();
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(signerError);

  const run = async (f: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const ask = () =>
    run(async () => {
      const acc = await signer!.accounts();
      try {
        setStep({ kind: "quote", quote: await api<Quote>(`/v1/market/listings/${listingId}/quote`, { method: "POST", token, body: acc }) });
      } catch (e) {
        if (e instanceof Error && e.message.includes("need_dummies")) return setStep({ kind: "dummies" });
        throw e;
      }
    });
  const makeDummies = () =>
    run(async () => {
      const acc = await signer!.accounts();
      const d = await api<{ psbt: string; sign_inputs: number[] }>("/v1/market/dummies", { method: "POST", token, body: acc });
      const signed = await signer!.sign(d.psbt, d.sign_inputs.map((index) => ({ index, address: acc.payment_address })));
      const r = await api<{ txid: string }>("/v1/market/dummies/broadcast", { method: "POST", token, body: { psbt: signed } });
      setStep({ kind: "dummies-sent", txid: r.txid });
    });
  const buy = (q: Quote) =>
    run(async () => {
      const acc = await signer!.accounts();
      const signed = await signer!.sign(q.psbt, q.sign_inputs.map((index) => ({ index, address: acc.payment_address })));
      const r = await api<{ txid: string }>(`/v1/market/quotes/${q.quote_id}/submit`, { method: "POST", token, body: { psbt: signed } });
      setStep({ kind: "done", txid: r.txid });
    });

  return createPortal(
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="buy-title" onClick={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="dialog buy-dialog">
        <div className="row between">
          <h2 id="buy-title">{t("在 unimap 购买")}</h2>
          <NetworkTag network={market?.network ?? null} />
        </div>
        {!step && (
          <>
            <p>
              <b className="mono">{btc(price)}</b>
            </p>
            <p className="muted small">{t("unimap 用你钱包里的聪拼好这笔交易：铭文到你的地址，钱到卖家的地址。你的钱包会显示每一笔进出，确认无误再签名。unimap 不经手钱和铭文。")}</p>
          </>
        )}
        {step?.kind === "dummies" && (
          <p className="small">
            {t("第一次在 unimap 买之前，你的付款地址需要两笔各 {n} 聪的小额 UTXO，用来把铭文准确地放进你的地址。先发一笔转给自己的小交易，确认以后（大约 10 分钟）再回来买。", { n: market?.dummy_sats ?? 600 })}
          </p>
        )}
        {step?.kind === "dummies-sent" && (
          <>
            <p className="small">{t("小额 UTXO 已经发出。等它被打包确认后，再点一次购买。")}</p>
            <TxLink txid={step.txid} network={market?.network ?? null} />
          </>
        )}
        {step?.kind === "quote" && (
          <dl className="buy-sum">
            <dt>{t("价格")}</dt>
            <dd className="mono">{sats(step.quote.price_sats)}</dd>
            {step.quote.fee_sats > 0 && (
              <>
                <dt>{t("unimap 手续费")}</dt>
                <dd className="mono">{sats(step.quote.fee_sats)}</dd>
              </>
            )}
            <dt>{t("矿工费（{rate} 聪/vB）", { rate: Math.round(step.quote.fee_rate * 10) / 10 })}</dt>
            <dd className="mono">{sats(step.quote.network_fee_sats)}</dd>
            <dt>
              <b>{t("一共")}</b>
            </dt>
            <dd className="mono">
              <b>{sats(step.quote.total_sats)}</b> {t("聪")}
            </dd>
          </dl>
        )}
        {step?.kind === "done" && (
          <>
            <p>
              <b>{t("交易已发出。打包确认后，这块地就是你的了。")}</b>
            </p>
            <TxLink txid={step.txid} network={market?.network ?? null} />
          </>
        )}
        {error && <p className="error small">{error}</p>}
        <div className="row end">
          <button type="button" className="ghost" onClick={close} disabled={busy}>
            {step?.kind === "done" || step?.kind === "dummies-sent" ? t("好的") : t("取消")}
          </button>
          {signer && !step && (
            <button type="button" className="primary" onClick={ask} disabled={busy}>
              {busy ? t("正在拼交易…") : t("下一步")}
            </button>
          )}
          {signer && step?.kind === "dummies" && (
            <button type="button" className="primary" onClick={makeDummies} disabled={busy}>
              {busy ? t("等待钱包签名…") : t("准备小额 UTXO")}
            </button>
          )}
          {signer && step?.kind === "quote" && (
            <button type="button" className="primary" onClick={() => buy(step.quote)} disabled={busy}>
              {busy ? t("等待钱包签名…") : t("签名购买")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
