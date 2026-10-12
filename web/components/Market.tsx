"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useSession } from "./Session";
import { api, type MarketInfo, type MarketListing, type MarketOffer, type OfferQuote, type ParcelListed, type ParkMove, type ParkSale, type Quote } from "@/lib/api";
import { btc, short } from "@/lib/format";
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

/** The holder's side: list the district (or one of its parcels) in unimap, or take a listing down. */
export function SellCard({ n, token, txIndex = null }: { n: number; token: string; txIndex?: number | null }) {
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
      .then((r) => setMine(r.listings.find((l) => l.tx_index === txIndex && l.park_id == null && l.seller === address) ?? null))
      .catch(() => setMine(null));
  useEffect(() => {
    if (market?.open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.open, n, txIndex, address]);
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
        body: { bitmap_number: n, tx_index: txIndex, price_sats: p, pay_to: acc.payment_address, public_key: acc.receive_public_key },
      });
      const signed = await signer.sign(prep.psbt, [{ index: 0, address: address!, sighash: SINGLE_ACP }]);
      await api("/v1/market/listings", { method: "POST", token, body: { psbt: signed, bitmap_number: n, tx_index: txIndex } });
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
        <b>{txIndex == null ? t("在 unimap 出售") : t("出售地块 #{n}", { n: String(txIndex) })}</b>
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
          <p className="muted small">
            {txIndex == null
              ? t("挂在 unimap，买家看得到这条街的居民和帖子，在这里就能买。钱和铭文都不经过 unimap。")
              : t("挂在 unimap，想搬进这条街的人在招募页和这里都看得到，买下就成了这里的居民。钱和铭文都不经过 unimap。")}
          </p>
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

type Sums = Omit<Quote, "quote_id" | "expires_in">;
type Step = { kind: "quote"; sums: Sums; sign: () => Promise<void> } | { kind: "dummies" } | { kind: "dummies-sent"; txid: string } | { kind: "done"; txid: string | null };

/** The buyer's side: quote, sign in the wallet, broadcast. */
export function BuyButton({ listingId, price, label, doneText }: { listingId: number; price: number; label?: string; doneText?: string }) {
  const { token } = useSession();
  const [open, setOpen] = useState(false);
  if (!token) return null;
  return (
    <>
      <button type="button" className="primary sm" onClick={() => setOpen(true)}>
        {label ?? t("在 unimap 购买")}
      </button>
      {open && (
        <PurchaseDialog
          title={t("在 unimap 购买")}
          token={token}
          close={() => setOpen(false)}
          intro={
            <>
              <p>
                <b className="mono">{btc(price)}</b>
              </p>
              <p className="muted small">{t("unimap 用你钱包里的聪拼好这笔交易：铭文到你的地址，钱到卖家的地址。你的钱包会显示每一笔进出，确认无误再签名。unimap 不经手钱和铭文。")}</p>
            </>
          }
          ask={async (acc, signer) => {
            const q = await api<Quote>(`/v1/market/listings/${listingId}/quote`, { method: "POST", token, body: acc });
            return {
              sums: q,
              sign: async () => {
                const signed = await signer.sign(q.psbt, q.sign_inputs.map((index) => ({ index, address: acc.payment_address })));
                return (await api<{ txid: string }>(`/v1/market/quotes/${q.quote_id}/submit`, { method: "POST", token, body: { psbt: signed } })).txid;
              },
            };
          }}
          signLabel={t("签名购买")}
          doneText={doneText ?? t("交易已发出。打包确认后，这块地就是你的了。")}
        />
      )}
    </>
  );
}

type Accounts = Awaited<ReturnType<PsbtSigner["accounts"]>>;
type Ask = (acc: Accounts, signer: PsbtSigner) => Promise<{ sums: Sums; sign: () => Promise<string | null> }>;

/** Buying a listing or making an offer: the wallet's coins put together by unimap, two dummies first if needed, signed in the wallet. */
function PurchaseDialog({ title, token, close, intro, ask, signLabel, doneText, ready = true }: {
  title: string; token: string; close: () => void; intro: React.ReactNode; ask: Ask; signLabel: string; doneText: string; ready?: boolean;
}) {
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
  const next = () =>
    run(async () => {
      const acc = await signer!.accounts();
      try {
        const q = await ask(acc, signer!);
        setStep({ kind: "quote", sums: q.sums, sign: async () => setStep({ kind: "done", txid: await q.sign() }) });
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

  return createPortal(
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="buy-title" onClick={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="dialog buy-dialog">
        <div className="row between">
          <h2 id="buy-title">{title}</h2>
          <NetworkTag network={market?.network ?? null} />
        </div>
        {!step && intro}
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
            <dd className="mono">{sats(step.sums.price_sats)}</dd>
            {step.sums.fee_sats > 0 && (
              <>
                <dt>{t("unimap 手续费")}</dt>
                <dd className="mono">{sats(step.sums.fee_sats)}</dd>
              </>
            )}
            <dt>{t("矿工费（{rate} 聪/vB）", { rate: Math.round(step.sums.fee_rate * 10) / 10 })}</dt>
            <dd className="mono">{sats(step.sums.network_fee_sats)}</dd>
            <dt>
              <b>{t("一共")}</b>
            </dt>
            <dd className="mono">
              <b>{sats(step.sums.total_sats)}</b> {t("聪")}
            </dd>
          </dl>
        )}
        {step?.kind === "done" && (
          <>
            <p>
              <b>{doneText}</b>
            </p>
            {step.txid && <TxLink txid={step.txid} network={market?.network ?? null} />}
          </>
        )}
        {error && <p className="error small">{error}</p>}
        <div className="row end">
          <button type="button" className="ghost" onClick={close} disabled={busy}>
            {step?.kind === "done" || step?.kind === "dummies-sent" ? t("好的") : t("取消")}
          </button>
          {signer && !step && (
            <button type="button" className="primary" onClick={next} disabled={busy || !ready}>
              {busy ? t("正在拼交易…") : t("下一步")}
            </button>
          )}
          {signer && step?.kind === "dummies" && (
            <button type="button" className="primary" onClick={makeDummies} disabled={busy}>
              {busy ? t("等待钱包签名…") : t("准备小额 UTXO")}
            </button>
          )}
          {signer && step?.kind === "quote" && (
            <button type="button" className="primary" onClick={() => run(step.sign)} disabled={busy}>
              {busy ? t("等待钱包签名…") : signLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const OFFER_DAYS = [1, 3, 7, 30];

/** 出价 for someone else's district or parcel, listed here or not. */
export function OfferButton({ n, txIndex = null, label }: { n: number; txIndex?: number | null; label?: string }) {
  const { token } = useSession();
  const market = useMarket();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [days, setDays] = useState(7);
  if (!token || !market?.open) return null;
  const p = Math.floor(Number(price));
  const valid = Number.isFinite(p) && p >= 1000;
  const what = txIndex == null ? `${n}.bitmap` : t("{n}.bitmap 的地块 #{i}", { n, i: txIndex });
  return (
    <>
      <button type="button" className="ghost sm" onClick={() => setOpen(true)}>
        {label ?? t("出价")}
      </button>
      {open && (
        <PurchaseDialog
          title={t("给 {what} 出价", { what })}
          token={token}
          ready={valid}
          close={() => setOpen(false)}
          intro={
            <>
              <label className="small">
                {t("你出的价（聪）")}
                <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 16))} placeholder="1000000" autoFocus />
              </label>
              {price && <p className="muted small mono">≈ {btc(p)}</p>}
              <label className="small">
                {t("有效期")}
                <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {OFFER_DAYS.map((d) => (
                    <option key={d} value={d}>
                      {t("{n} 天", { n: d })}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted small">
                {t("你的钱包会签好整笔买卖，只差持有人那一个签名：钱付到持有人现在的地址，铭文到你的地址。持有人点接受就成交，钱在那之前一直在你的钱包里。")}
              </p>
              <p className="muted small">
                {t("在 unimap 撤回后，unimap 不再把它交给持有人。想万无一失，就把这笔出价用到的币花掉，比如转给自己。")}
              </p>
            </>
          }
          ask={async (acc, signer) => {
            const q = await api<OfferQuote>("/v1/market/offers/prepare", { method: "POST", token, body: { ...acc, bitmap_number: n, tx_index: txIndex, price_sats: p } });
            return {
              sums: q,
              sign: async () => {
                const signed = await signer.sign(q.psbt, q.sign_inputs.map((index) => ({ index, address: acc.payment_address })));
                await api(`/v1/market/offers/${q.offer_id}/sign`, { method: "POST", token, body: { psbt: signed, days } });
                return null;
              },
            };
          }}
          signLabel={t("签名出价")}
          doneText={t("出价已发给持有人。对方接受后交易会直接发出，你会收到通知。")}
        />
      )}
    </>
  );
}

/** Offers on a district and its parcels: the holder accepts or turns them down, a buyer withdraws their own. */
export function OffersCard({ n, me, token, owner }: { n: number; me: string | null; token: string | null; owner: string | null }) {
  const market = useMarket();
  const [signer, signerError] = useSigner();
  const [list, setList] = useState<MarketOffer[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<{ id: number; txid: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => api<{ offers: MarketOffer[] }>(`/v1/market/offers?bitmap_number=${n}`).then((r) => setList(r.offers)).catch(() => setList([])),
    [n],
  );
  useEffect(() => {
    if (market?.open) load();
  }, [market?.open, load]);
  if (!market?.open || !list || (list.length === 0 && !done)) return null;
  const act = async (o: MarketOffer, f: () => Promise<void>) => {
    setError(null);
    setBusy(o.id);
    try {
      await f();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const accept = (o: MarketOffer) =>
    act(o, async () => {
      if (!signer) throw new Error(signerError ?? "");
      if (!confirm(t("接受 {price} 的出价？签名后交易会立刻发出，铭文会转给买家。", { price: btc(o.price_sats) }))) return;
      const acc = await signer.accounts();
      const prep = await api<{ psbt: string; sign_inputs: number[] }>(`/v1/market/offers/${o.id}/accept/prepare`, {
        method: "POST",
        token,
        body: { public_key: acc.receive_public_key },
      });
      const signed = await signer.sign(prep.psbt, prep.sign_inputs.map((index) => ({ index, address: o.seller })));
      const r = await api<{ txid: string }>(`/v1/market/offers/${o.id}/accept`, { method: "POST", token, body: { psbt: signed } });
      setDone({ id: o.id, txid: r.txid });
    });
  const drop = (o: MarketOffer) => act(o, async () => void (await api(`/v1/market/offers/${o.id}`, { method: "DELETE", token })));
  return (
    <section className="sell-card offers-card" aria-label={t("出价")}>
      <div className="row between">
        <b>{list.some((o) => o.seller === me) ? t("收到的出价") : t("出价")}</b>
        <NetworkTag network={market.network} />
      </div>
      {done && (
        <p className="small">
          {t("成交了，交易已发出。")} <TxLink txid={done.txid} network={market.network} />
        </p>
      )}
      <ul className="offers">
        {list.map((o) => {
          const holder = !!me && me === o.seller && me === owner;
          const mine = !!me && me === o.buyer;
          return (
            <li key={o.id}>
              <b className="mono">{btc(o.price_sats)}</b>
              <span className="small muted grow">
                {o.tx_index != null && `${t("地块 #{n}", { n: String(o.tx_index) })} · `}
                {mine
                  ? t("你的出价，{date} 前有效", { date: new Date(o.expires_at).toLocaleDateString() })
                  : t("{who} 出价，{date} 前有效", { who: short(o.buyer), date: new Date(o.expires_at).toLocaleDateString() })}
              </span>
              {holder && (
                <>
                  <button type="button" className="ghost sm" disabled={busy != null} onClick={() => drop(o)}>
                    {t("拒绝")}
                  </button>
                  <button type="button" className="primary sm" disabled={busy != null} onClick={() => accept(o)}>
                    {busy === o.id ? t("等待钱包签名…") : t("接受")}
                  </button>
                </>
              )}
              {mine && (
                <button type="button" className="ghost sm" disabled={busy != null} onClick={() => drop(o)}>
                  {t("撤回")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

/** 园区打包卖: the whole park in one sale. Its owner first puts the districts into one output with a
 * transaction to themselves, then lists that output like a district; whoever buys it gets the park. */
export function ParkSaleCard({ parkId, owner }: { parkId: number; owner: string }) {
  const market = useMarket();
  const { address, token } = useSession();
  const [signer, signerError] = useSigner();
  const [sale, setSale] = useState<ParkSale | null>(null);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [sent, setSent] = useState<{ kind: "pack" | "unpack"; txid: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<ParkSale>(`/v1/market/parks/${parkId}`).then(setSale).catch(() => setSale(null)), [parkId]);
  useEffect(() => {
    if (market?.open) load();
  }, [market?.open, load]);
  if (!market?.open || !sale) return null;
  const listing = sale.listing;
  const count = listing?.members?.length ?? sale.members.length;

  if (!token || address !== owner)
    return listing ? (
      <div className="sale-banner">
        <span className="sale-tag">{t("整体在售")}</span>
        <b className="mono">{btc(listing.price_sats)}</b>
        <span className="muted small">{t("{n} 个街区一起卖，一笔交易全部到手，园区跟着换主人", { n: count })}</span>
        <span className="grow" />
        <BuyButton listingId={listing.id} price={listing.price_sats} label={t("整体买下")} doneText={t("交易已发出。打包确认后，整个园区就是你的了。")} />
      </div>
    ) : null;

  const run = async (f: () => Promise<void>) => {
    setError(null);
    if (!signer) return setError(signerError);
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  // Packing or splitting only moves the owner's own outputs to the owner's own address; the paying address covers the miners.
  const move = (kind: "pack" | "unpack") =>
    run(async () => {
      const acc = await signer!.accounts();
      const m = await api<ParkMove>(`/v1/market/parks/${parkId}/${kind}`, {
        method: "POST",
        token,
        body: { payment_address: acc.payment_address, payment_public_key: acc.payment_public_key, public_key: acc.receive_public_key },
      });
      const signed = await signer!.sign(m.psbt, m.sign_inputs.map((index) => ({ index, address: m.own_inputs.includes(index) ? address! : acc.payment_address })));
      const r = await api<{ txid: string }>(`/v1/market/moves/${m.move_id}/submit`, { method: "POST", token, body: { psbt: signed } });
      setSent({ kind, txid: r.txid });
      await load();
    });
  const list = () =>
    run(async () => {
      const p = Math.floor(Number(price));
      if (!Number.isFinite(p) || p < 1000) throw new Error(t("价格至少 1,000 聪"));
      const acc = await signer!.accounts();
      const prep = await api<{ psbt: string }>(`/v1/market/parks/${parkId}/listing/prepare`, {
        method: "POST",
        token,
        body: { price_sats: p, pay_to: acc.payment_address, public_key: acc.receive_public_key },
      });
      const signed = await signer!.sign(prep.psbt, [{ index: 0, address: address!, sighash: SINGLE_ACP }]);
      await api(`/v1/market/parks/${parkId}/listing`, { method: "POST", token, body: { psbt: signed } });
      setOpen(false);
      await load();
    });
  const takeDown = async () => {
    if (!listing || !confirm(t("在 unimap 下架？你签过的挂单在铭文转走之前仍然有效，想彻底作废就把园区拆开，或者把铭文转到你自己的另一个地址。"))) return;
    await api(`/v1/market/listings/${listing.id}`, { method: "DELETE", token }).catch((e) => setError(e.message));
    await load();
  };

  return (
    <div className="sell-card">
      <div className="row between">
        <b>{t("整个园区一起卖")}</b>
        <NetworkTag network={market.network} />
      </div>
      {sent ? (
        // Until it confirms, ord still sees the old outputs, so there is nothing more to do here yet.
        <>
          <p className="small">
            {sent.kind === "pack"
              ? t("打包交易已发出。确认后（大约 10 分钟）就能整体挂单。")
              : t("拆开的交易已发出。确认后每个街区又各在一个输出里，可以单独卖了。")}
          </p>
          <TxLink txid={sent.txid} network={market.network} />
        </>
      ) : listing ? (
        <>
          <p className="small">{t("你把 {n} 个街区一起挂了 {price}。买家一笔交易全部买走，园区跟着换主人。", { n: count, price: btc(listing.price_sats) })}</p>
          <div className="row end">
            <button type="button" className="ghost sm" onClick={takeDown}>
              {t("下架")}
            </button>
          </div>
        </>
      ) : !sale.packed ? (
        <>
          <p className="muted small">
            {t("一笔交易卖掉整个园区，园区跟着换主人。先把 {n} 个街区放进同一个输出：这是一笔转给你自己的交易，铭文不离开你的地址，只花一点矿工费。", { n: count })}
          </p>
          <div className="row end">
            <button type="button" className="sm" onClick={() => move("pack")} disabled={busy}>
              {busy ? t("等待钱包签名…") : t("打包")}
            </button>
          </div>
        </>
      ) : !open ? (
        <>
          <p className="muted small">{t("{n} 个街区已经在同一个输出里，可以整体挂单了。想单独卖其中一个，就先拆开。", { n: count })}</p>
          <div className="row end">
            <button type="button" className="ghost sm" onClick={() => move("unpack")} disabled={busy}>
              {t("拆开")}
            </button>
            <button type="button" className="sm" onClick={() => setOpen(true)} disabled={busy}>
              {t("整体挂单")}
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="small">
            {t("整个园区的价格（聪）")}
            <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 16))} placeholder="5000000" />
          </label>
          {price && <p className="muted small mono">≈ {btc(Number(price))}</p>}
          <p className="muted small">
            {t("和单个街区挂单一样，你的钱包签一个半成品交易：装着 {n} 个街区的这个输出，换一笔付到你地址的钱。只有付够钱的交易能用这个签名。", { n: count })}
          </p>
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
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** 地块交易: a district's parcels listed in unimap, each a way to move in by buying it. */
export function ParcelsOnSale({ items, intro, onPick }: { items: ParcelListed[]; intro: string; onPick: (i: number) => void }) {
  const { address } = useSession();
  const rows = items.filter((l) => l.seller !== address);
  if (rows.length === 0) return null;
  return (
    <div className="recruit-sale">
      <span className="small">{intro}</span>
      {rows.slice(0, 5).map((l) => (
        <div key={l.listing_id} className="row between small">
          <button type="button" className="link-btn mono" onClick={() => onPick(l.tx_index)}>
            {t("地块 #{n}", { n: l.tx_index })}
          </button>
          <span className="row">
            <b className="mono sale-price">{btc(l.price_sats)}</b>
            <BuyButton listingId={l.listing_id} price={l.price_sats} label={t("买下入住")} doneText={t("交易已发出。确认后这块地就是你的了，你也就成了这里的居民。")} />
          </span>
        </div>
      ))}
    </div>
  );
}
