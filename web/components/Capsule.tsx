"use client";

import { useEffect, useState } from "react";

import { InvoiceQr } from "@/components/Tip";
import { api, type Payment } from "@/lib/api";
import { barsDone, DEFAULT_STYLE, STYLE_NAMES, STYLES, type EnvelopeStyle } from "@/lib/capsule";
import { DEMO } from "@/lib/demo";
import { t } from "@/lib/i18n";

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

/** 封存的付款: the invoice for a paid capsule, checked every few seconds until the wallet says it
 * was paid; then done(). A new invoice when one expires. The demo can settle it at once. */
export function CapsulePay({ capsuleId, first, token, done }: { capsuleId: string; first: Payment | null; token: string | null; done: () => void }) {
  const [pay, setPay] = useState<Payment | null>(first);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fresh = async () => {
    setError(null);
    setBusy(true);
    try {
      setPay(await api<Payment>("/v1/billing/pay", { method: "POST", token, body: { product: "capsule", ref: capsuleId } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!first) fresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A browser Lightning wallet (WebLN) pays in one click; otherwise the QR code does.
  useEffect(() => {
    const webln = (window as unknown as { webln?: { enable: () => Promise<void>; sendPayment: (i: string) => Promise<unknown> } }).webln;
    if (webln && pay?.invoice && pay.status === "pending") webln.enable().then(() => webln.sendPayment(pay.invoice!)).catch(() => {});
  }, [pay?.invoice, pay?.status]);
  useEffect(() => {
    if (!pay || pay.status !== "pending") return;
    const timer = setInterval(() => {
      api<Payment>(`/v1/billing/payments/${pay.id}`, { token })
        .then((s) => s.status !== "pending" && setPay((old) => (old ? { ...old, status: s.status } : old)))
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pay, token]);
  useEffect(() => {
    if (pay?.status === "settled") done();
  }, [pay?.status, done]);

  const simulate = async () => {
    if (!pay) return;
    const s = await api<Payment>(`/v1/billing/payments/${pay.id}/demo-settle`, { method: "POST", token });
    setPay((old) => (old ? { ...old, status: s.status } : old));
  };
  const copy = async () => {
    if (!pay?.invoice) return;
    try {
      await navigator.clipboard.writeText(pay.invoice);
      setCopied(true);
    } catch {}
  };

  return (
    <div className="cap-pay">
      <h2 className="cap-side-title">{t("付款后封存")}</h2>
      {pay && (
        <p className="cap-pay-sum">
          <span className="mono">{pay.amount_sats.toLocaleString("en-US")}</span> {t("聪")}
        </p>
      )}
      {pay?.status === "settled" ? (
        <p className="muted small">{t("付好了，正在封存…")}</p>
      ) : pay?.status === "expired" ? (
        <>
          <p className="muted small">{t("这张发票已经过期了，没有扣款。")}</p>
          <button type="button" onClick={fresh} disabled={busy}>
            {t("重新开一张发票")}
          </button>
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
            <button type="button" onClick={copy}>
              {copied ? t("已复制") : t("复制发票")}
            </button>
          </div>
          {DEMO && (
            <button type="button" className="cap-demo-pay" onClick={simulate}>
              {t("演示：模拟付款")}
            </button>
          )}
          <p className="muted small" aria-live="polite">
            {t("付款后这里会自动确认…")}
          </p>
          <p className="dim small">{t("一小时内没付款，这封信会被删掉，不扣钱。")}</p>
        </>
      ) : (
        <p className="muted small">{busy ? t("正在生成发票…") : ""}</p>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** YYYY-MM-DD of an ISO time, in UTC. */
export const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);
/** YYYY-MM-DD HH:MM of an ISO time, in UTC. */
export const utcMinute = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ");
