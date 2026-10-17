"use client";

import { useEffect, useState } from "react";

import { useSession } from "@/components/Session";
import { InvoiceQr } from "@/components/Tip";
import { api, type BillingProducts, type Payment } from "@/lib/api";
import { btcAmount, parseTxid, payMethods, type PayMethod } from "@/lib/billing";
import { barsDone, DEFAULT_STYLE, shortHash, STYLE_NAMES, STYLES, type EnvelopeStyle } from "@/lib/capsule";
import { DEMO } from "@/lib/demo";
import { t } from "@/lib/i18n";
import { walletById } from "@/lib/wallets";

const POLL_MS = 2500;

/** 火漆: the wax seal on a sealed capsule, reading 封 and the block it was sealed on. */
export function WaxSeal({ height, size = 92 }: { height: number; size?: number }) {
  return (
    <svg className="cap-wax" width={size} height={size} viewBox="0 0 92 92" aria-hidden>
      <circle cx="46" cy="46" r="42" className="cap-wax-body" />
      <circle cx="46" cy="46" r="34" fill="none" className="cap-wax-ring" strokeWidth="1.4" />
      <text x="46" y="42" textAnchor="middle" className="cap-wax-char">
        封
      </text>
      <text x="46" y="60" textAnchor="middle" className="cap-wax-num">
        {height}
      </text>
    </svg>
  );
}

/** The sealed envelope: paper, its folds, the wax seal, who it is for and when it opens. */
export function Envelope({ height, recipient, opens, style = DEFAULT_STYLE }: { height: number; recipient: string; opens: string; style?: EnvelopeStyle }) {
  return (
    <div className="cap-envelope" data-style={style} role="img" aria-label={t("封好的信封")}>
      <WaxSeal height={height} />
      <span className="cap-env-to">{t("给 {name}", { name: recipient })}</span>
      <span className="cap-env-open">
        {t("打开于")}
        <br />
        {t("{date} 之后的第一块", { date: opens })}
      </span>
    </div>
  );
}

/** 信封样式: a small envelope for each style; only the default one unless the tier allows them all. */
export function StylePicker({ value, onChange, locked }: { value: EnvelopeStyle; onChange: (s: EnvelopeStyle) => void; locked: boolean }) {
  return (
    <div className="cap-styles" role="radiogroup" aria-label={t("信封样式")}>
      {STYLES.map((s) => {
        const off = locked && s !== DEFAULT_STYLE;
        return (
          <button key={s} type="button" role="radio" aria-checked={value === s} disabled={off} className={`cap-style${value === s ? " on" : ""}`} onClick={() => onChange(s)}>
            <span className="cap-mini" data-style={s} aria-hidden>
              <i />
            </span>
            <span className="small">{t(STYLE_NAMES[s])}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The wait as a row of bars, the share already behind filled amber. */
export function WaitBars({ sealed, tip, left }: { sealed: number; tip: number; left: number }) {
  const n = 18, done = barsDone(sealed, tip, left, n);
  return (
    <div className="cap-bars" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < done ? "d" : ""} />
      ))}
    </div>
  );
}

/** The letter on paper, with the photo if one came with it, and a line of facts under it. */
export function LetterPaper({ text, meta, photo, style = DEFAULT_STYLE }: { text: string; meta: React.ReactNode[]; photo?: string | null; style?: EnvelopeStyle }) {
  return (
    <article className="cap-paper" data-style={style}>
      {photo && <img className="cap-photo" src={photo} alt={t("随信附上的照片")} />}
      <p>{text}</p>
      <div className="cap-paper-meta">
        {meta.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>
    </article>
  );
}

/** 封存的付款, checked every few seconds until it lands; then done(). On-chain first: 用钱包支付
 * asks the connected wallet to send exactly the amount to unimap's address and posts the txid; a
 * wallet that can't (the manual one), or a send that fails, gets the address, the amount and a box
 * to paste the txid. 用闪电网络付款 swaps in a Lightning invoice when the server has one. A new
 * payment when one expires. The demo settles at once. */
export function CapsulePay({ capsuleId, first, token, done }: { capsuleId: string; first: Payment | null; token: string | null; done: () => void }) {
  const { wallet } = useSession();
  // On the demo site the fee is only ever simulated: a real wallet signed in there (for 真实 Signet) never pays it.
  const sender = DEMO && wallet !== "demo" ? undefined : walletById(wallet);
  const [pay, setPay] = useState<Payment | null>(first);
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [manual, setManual] = useState(false);
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState<"invoice" | "address" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const fresh = async (method?: PayMethod) => {
    setError(null);
    setBusy(true);
    try {
      setPay(await api<Payment>("/v1/billing/pay", { method: "POST", token, body: { product: "capsule", ref: capsuleId, ...(method ? { method } : {}) } }));
      setManual(false);
      setCopied(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!first) fresh();
    api<BillingProducts>("/v1/billing/products").then((r) => {
      setMethods(payMethods(r.methods));
      setPrice(r.products.find((p) => p.product === "capsule")?.amount_sats ?? null);
    }, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onchain = pay?.method === "onchain";
  // A browser Lightning wallet (WebLN) pays an invoice in one click; otherwise the QR code does.
  useEffect(() => {
    const webln = (window as unknown as { webln?: { enable: () => Promise<void>; sendPayment: (i: string) => Promise<unknown> } }).webln;
    if (webln && pay?.invoice && pay.status === "pending") webln.enable().then(() => webln.sendPayment(pay.invoice!)).catch(() => {});
  }, [pay?.invoice, pay?.status]);
  useEffect(() => {
    if (!pay || pay.status !== "pending") return;
    const timer = setInterval(() => {
      api<Payment>(`/v1/billing/payments/${pay.id}`, { token })
        .then((s) => (s.status !== pay.status || (s.txid ?? null) !== (pay.txid ?? null)) && setPay((old) => (old && old.id === s.id ? { ...old, ...s } : old)))
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pay, token]);
  useEffect(() => {
    if (pay?.status === "settled") done();
  }, [pay?.status, done]);

  const claim = async (txid: string) => {
    if (!pay) return;
    const s = await api<Payment>(`/v1/billing/payments/${pay.id}/tx`, { method: "POST", token, body: { txid } });
    setPay((old) => (old && old.id === s.id ? { ...old, ...s } : old));
  };
  const sendFromWallet = async () => {
    if (!pay?.address || !sender?.pay) return;
    setError(null);
    setSending(true);
    try {
      let txid: string;
      try {
        txid = await sender.pay(pay.address, pay.amount_sats);
      } catch (e) {
        setError(t("钱包没有发出这笔付款：{why}", { why: message(e) }));
        setManual(true);
        return;
      }
      try {
        await claim(txid);
      } catch (e) {
        setError(message(e));
        setPasted(txid);
        setManual(true);
      }
    } finally {
      setSending(false);
    }
  };
  const submitPasted = async () => {
    const txid = parseTxid(pasted);
    if (!txid) return setError(t("这不像交易 ID：应该是 64 位十六进制。"));
    setError(null);
    setBusy(true);
    try {
      await claim(txid);
      setPasted("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const simulate = async () => {
    if (!pay) return;
    const s = await api<Payment>(`/v1/billing/payments/${pay.id}/demo-settle`, { method: "POST", token });
    setPay((old) => (old ? { ...old, status: s.status } : old));
  };
  const copy = async (what: "invoice" | "address") => {
    const text = what === "invoice" ? pay?.invoice : pay?.address;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {}
  };
  const sats = pay ? pay.amount_sats.toLocaleString("en-US") : "";
  const pasteBox = (
    <label className="cap-pay-paste">
      <span className="small">{t("付好后把交易 ID 贴在这里")}</span>
      <span className="row">
        <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="txid" spellCheck={false} autoComplete="off" name="txid" />
        <button type="button" onClick={submitPasted} disabled={busy || !pasted.trim()}>
          {t("提交")}
        </button>
      </span>
    </label>
  );
  const demoPay = DEMO && (
    <button type="button" className="cap-demo-pay" onClick={simulate}>
      {t("演示：模拟付款")}
    </button>
  );
  const footer = (
    <>
      <p className="muted small" aria-live="polite">
        {t("付款后这里会自动确认…")}
      </p>
      <p className="dim small">{t("一小时内没付款，这封信会被删掉，不扣钱。")}</p>
    </>
  );

  return (
    <div className="cap-pay">
      <h2 className="cap-side-title">{t("付款后封存")}</h2>
      {pay && (
        <p className="cap-pay-sum">
          <span className="mono">{sats}</span> {t("聪")}
        </p>
      )}
      {onchain && pay?.status === "pending" && price != null && pay.amount_sats > price && (
        <p className="dim small">{t("{price} 聪，加上这笔付款独有的 {n} 聪尾数，用来认出你的转账。请正好付这个数。", { price: price.toLocaleString("en-US"), n: pay.amount_sats - price })}</p>
      )}
      {pay?.status === "settled" ? (
        <p className="muted small">{t("付好了，正在封存…")}</p>
      ) : pay?.status === "expired" ? (
        <>
          <p className="muted small">{onchain ? t("这笔付款等得太久，已经过期了。") : t("这张发票已经过期了，没有扣款。")}</p>
          <button type="button" onClick={() => fresh(pay.method)} disabled={busy}>
            {onchain ? t("重新付款") : t("重新开一张发票")}
          </button>
        </>
      ) : onchain && pay?.address ? (
        <>
          {pay.txid ? (
            <>
              <p className="muted small">{t("收到交易 {txid}，等它出现在 unimap 的比特币节点上，看到就封存，不用等出块。", { txid: shortHash(pay.txid) })}</p>
              {manual ? (
                pasteBox
              ) : (
                <button type="button" className="link-btn small" onClick={() => setManual(true)}>
                  {t("交易 ID 不对？换一个")}
                </button>
              )}
              {demoPay}
              {footer}
            </>
          ) : (
            <>
              <p className="muted small">{t("信已经加密交给 unimap，付款到账的那一刻封存，挂在当时最新的区块上。")}</p>
              {sender?.pay && (
                <button type="button" className="primary" onClick={sendFromWallet} disabled={sending || busy}>
                  {sending ? t("请在钱包里确认…") : t("用钱包支付")}
                </button>
              )}
              <p className="dim small">{t("钱包会在这笔钱之外另收一点网络手续费，按现在的低费率大约两三百聪。")}</p>
              {manual || !sender?.pay ? (
                <div className="cap-pay-manual">
                  <span className="small">{t("从任意比特币钱包转账，正好 {n} 聪（{btc} BTC）到：", { n: sats, btc: btcAmount(pay.amount_sats) })}</span>
                  <code className="cap-pay-addr small break">{pay.address}</code>
                  <button type="button" onClick={() => copy("address")}>
                    {copied === "address" ? t("已复制") : t("复制地址")}
                  </button>
                  {pasteBox}
                </div>
              ) : (
                <button type="button" className="link-btn small" onClick={() => setManual(true)}>
                  {t("用别的钱包转账")}
                </button>
              )}
              {methods.includes("lightning") && (
                <button type="button" onClick={() => fresh("lightning")} disabled={busy || sending}>
                  {t("用闪电网络付款")}
                </button>
              )}
              {demoPay}
              {footer}
            </>
          )}
        </>
      ) : pay?.invoice ? (
        <>
          <p className="muted small">{t("信已经加密交给 unimap，付款到账的那一刻封存，挂在当时最新的区块上。用任意闪电钱包扫码，或者复制发票。")}</p>
          <InvoiceQr invoice={pay.invoice} />
          <code className="tip-invoice small break">{pay.invoice}</code>
          <div className="row wrap">
            <a className="btn primary" href={`lightning:${pay.invoice}`}>
              {t("用钱包打开")}
            </a>
            <button type="button" onClick={() => copy("invoice")}>
              {copied === "invoice" ? t("已复制") : t("复制发票")}
            </button>
          </div>
          {demoPay}
          {methods.includes("onchain") && (
            <button type="button" className="link-btn small" onClick={() => fresh("onchain")} disabled={busy}>
              {t("改用比特币钱包支付")}
            </button>
          )}
          {footer}
        </>
      ) : (
        <p className="muted small">{busy ? t("正在准备付款…") : ""}</p>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** YYYY-MM-DD of an ISO time, in UTC. */
export const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);
/** YYYY-MM-DD HH:MM of an ISO time, in UTC. */
export const utcMinute = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ");
