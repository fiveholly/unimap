"use client";

import qrcode from "qrcode-generator";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { api, type Tip } from "@/lib/api";
import { t } from "@/lib/i18n";

export const TIP_AMOUNTS = [100, 500, 2100] as const;
const POLL_MS = 2500;

type Target = { post_id: number } | { bitmap_number: number } | { event_id: number; place: number };
type WebLN = { enable: () => Promise<void>; sendPayment: (invoice: string) => Promise<unknown> };

/** The lightning bolt the tip buttons share. */
export function Bolt({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  );
}

/** The invoice as a QR code any Lightning wallet can scan. */
function InvoiceQr({ invoice }: { invoice: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(invoice.toUpperCase(), "Alphanumeric"); // upper case packs a BOLT11 invoice tighter
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  }, [invoice]);
  return <div className="tip-qr" role="img" aria-label={t("付款二维码")} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** 打赏: pick an amount, get an invoice from the recipient's wallet, pay it, and wait for the wallet to confirm. */
export function TipDialog({ target, to, token, close, fixed }: { target: Target; to: string; token: string; close: (paidSats: number) => void; fixed?: number }) {
  const [amount, setAmount] = useState<number>(fixed ?? 500);
  const [custom, setCustom] = useState("");
  const [comment, setComment] = useState("");
  const [tip, setTip] = useState<Tip | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sats = custom ? Math.floor(Number(custom)) : amount;
  const paid = tip?.status === "settled";
  const done = () => close(paid ? tip!.amount_sats ?? sats : 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && done();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // While the invoice is open, ask now and then whether it was paid.
  useEffect(() => {
    if (!tip || tip.status !== "pending" || !tip.verifiable) return;
    const timer = setInterval(() => {
      api<Tip>(`/v1/tips/${tip.id}`, { token })
        .then((s) => s.status !== "pending" && setTip((old) => (old ? { ...old, status: s.status } : old)))
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [tip, token]);

  const start = async () => {
    setError(null);
    if (!Number.isFinite(sats) || sats < 1 || sats > 1_000_000) return setError(t("金额是 1 到 1,000,000 聪"));
    setBusy(true);
    try {
      const made = await api<Tip>("/v1/tips", { method: "POST", token, body: { ...target, amount_sats: sats, comment } });
      setTip(made);
      // A browser Lightning wallet (WebLN, e.g. Alby) pays in one click; otherwise the QR code does.
      const webln = (window as unknown as { webln?: WebLN }).webln;
      if (webln && made.invoice) webln.enable().then(() => webln.sendPayment(made.invoice!)).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!tip?.invoice) return;
    try {
      await navigator.clipboard.writeText(tip.invoice);
      setCopied(true);
    } catch {}
  };

  return createPortal(
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="tip-title" onClick={(e) => e.target === e.currentTarget && !busy && done()}>
      <div className="dialog tip-dialog">
        <h2 id="tip-title">
          <Bolt size={18} /> {"post_id" in target ? t("打赏这条帖子") : "event_id" in target ? t("发放活动奖金") : t("打赏街区主人")}
        </h2>
        {!tip ? (
          <>
            <p className="muted small">{t("聪会通过闪电网络直接到 {to} 的钱包，unimap 不经手。", { to })}</p>
            {fixed != null ? (
              <p className="tip-fixed">
                <span className="mono">{fixed.toLocaleString("en-US")}</span> {t("聪")}
              </p>
            ) : (
            <div className="tip-amounts" role="radiogroup" aria-label={t("金额")}>
              {TIP_AMOUNTS.map((a) => (
                <button key={a} type="button" role="radio" aria-checked={!custom && amount === a} className={!custom && amount === a ? "on" : ""} onClick={() => (setAmount(a), setCustom(""))}>
                  <span className="mono">{a.toLocaleString("en-US")}</span> {t("聪")}
                </button>
              ))}
              <input
                id="tip-custom"
                inputMode="numeric"
                placeholder={t("自定义")}
                value={custom}
                onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 7))}
                aria-label={t("自定义金额（聪）")}
              />
            </div>
            )}
            <input id="tip-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={200} placeholder={t("留一句话（可选）")} />
            {error && <p className="error small">{error}</p>}
            <div className="row end">
              <button type="button" className="ghost" onClick={done} disabled={busy}>
                {t("取消")}
              </button>
              <button type="button" className="primary" onClick={start} disabled={busy}>
                {busy ? t("正在生成发票…") : t(fixed != null ? "发 {n} 聪" : "打赏 {n} 聪", { n: Number.isFinite(sats) ? sats.toLocaleString("en-US") : "—" })}
              </button>
            </div>
          </>
        ) : paid ? (
          <div className="tip-done">
            <p>
              <b>{t("打赏成功，{n} 聪已经到账。", { n: (tip.amount_sats ?? sats).toLocaleString("en-US") })}</b>
            </p>
            <div className="row end">
              <button type="button" className="primary" onClick={done}>
                {t("好的")}
              </button>
            </div>
          </div>
        ) : tip.status === "expired" ? (
          <>
            <p className="muted">{t("这张发票已经过期了，没有扣款。可以重新打赏一次。")}</p>
            <div className="row end">
              <button type="button" onClick={() => setTip(null)}>
                {t("重新打赏")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">{t("用任意闪电钱包扫码付款，或者复制发票。")}</p>
            {tip.invoice && <InvoiceQr invoice={tip.invoice} />}
            <code className="tip-invoice small break">{tip.invoice}</code>
            <div className="row wrap">
              <a className="btn primary" href={`lightning:${tip.invoice}`}>
                {t("用钱包打开")}
              </a>
              <button type="button" onClick={copy}>
                {copied ? t("已复制") : t("复制发票")}
              </button>
              <span className="grow" />
              <button type="button" className="ghost" onClick={done}>
                {t("关闭")}
              </button>
            </div>
            <p className="muted small tip-wait" aria-live="polite">
              {tip.verifiable ? t("付款后这里会自动确认…") : t("对方的钱包不支持确认付款：钱照样会到账，但不会计入打赏榜。")}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** ⚡ under a post or by a district's owner: the sats it got so far, and a way to send more. */
export function TipButton({
  target,
  to,
  sats,
  token,
  className = "act",
  label,
  canTip = true,
  onError,
}: {
  target: Target;
  to: string;
  sats: number;
  token: string | null;
  className?: string;
  label?: string;
  canTip?: boolean; // false: the recipient has no Lightning address now; show what they got, no button
  onError?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState(sats);
  useEffect(() => setTotal(sats), [sats]);
  if (!canTip)
    return (
      <span className={`${className} tip-btn tipped`} title={t("作者还没有开通闪电收款")}>
        <Bolt />
        {total.toLocaleString("en-US")}
        <span className="sr-only">{t("聪的打赏")}</span>
      </span>
    );
  return (
    <>
      <button
        type="button"
        className={`${className} tip-btn${total > 0 ? " tipped" : ""}`}
        onClick={() => (token ? setOpen(true) : onError?.(t("连接钱包后才能打赏")))}
        title={t("用闪电网络打赏")}
      >
        <Bolt />
        {label ?? (total > 0 ? total.toLocaleString("en-US") : "")}
        <span className="sr-only">{t("聪的打赏")}</span>
      </button>
      {open && token && (
        <TipDialog
          target={target}
          to={to}
          token={token}
          close={(paid) => {
            setOpen(false);
            if (paid) setTotal((x) => x + paid);
          }}
        />
      )}
    </>
  );
}
