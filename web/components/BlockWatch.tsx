"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { t } from "@/lib/i18n";

const POLL_MS = DEMO ? 15_000 : 30_000;
const TOAST_MS = 15_000;
const ALERTS_KEY = "unimap.blockAlerts";

type Watch = { tip: number | null; error: string | null; alerts: boolean; setAlerts: (on: boolean) => Promise<boolean> };
const Ctx = createContext<Watch>({ tip: null, error: null, alerts: false, setAlerts: async () => false });

/** The newest block the city has, kept fresh, and whether to tell the browser about new ones. */
export const useTip = () => useContext(Ctx);

const readAlerts = () => {
  try {
    return localStorage.getItem(ALERTS_KEY) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted";
  } catch {
    return false;
  }
};

/** 新区块提醒: watches for new blocks; each one grows a new district at the city's edge, free for
 * whoever inscribes it first. Shows a toast, and a system notification when the tab is in the background. */
export function BlockWatch({ children }: { children: React.ReactNode }) {
  const [tip, setTip] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const [alerts, setAlertsState] = useState(false);
  const last = useRef<number | null>(null);

  useEffect(() => setAlertsState(readAlerts()), []);

  useEffect(() => {
    let alive = true;
    const check = () =>
      api<{ indexed_height: { bitmap: number | null } }>("/v1/status")
        .then((s) => {
          if (!alive) return;
          const h = s.indexed_height.bitmap ?? 0;
          setError(null);
          if (last.current != null && h > last.current) {
            setFresh(h);
            if (readAlerts() && document.hidden) {
              try {
                new Notification(t("新区块 {n}", { n: h.toLocaleString("en-US") }), {
                  body: t("城市边上长出了新街区 {n}.bitmap，先铭刻的人得地。", { n: h }),
                  tag: "unimap-block",
                });
              } catch {}
            }
          }
          last.current = h;
          setTip(h);
        })
        .catch((e) => alive && last.current == null && setError(String(e.message || e)));
    check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (fresh == null) return;
    const timer = setTimeout(() => setFresh(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [fresh]);

  const setAlerts = useCallback(async (on: boolean) => {
    if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      if ((await Notification.requestPermission()) !== "granted") return false;
    }
    try {
      localStorage.setItem(ALERTS_KEY, on ? "1" : "0");
    } catch {}
    setAlertsState(on);
    return true;
  }, []);

  return (
    <Ctx.Provider value={{ tip, error, alerts, setAlerts }}>
      {children}
      {fresh != null && (
        <div className="block-toast" role="status">
          <span className="block-toast-icon" aria-hidden>
            <Pick />
          </span>
          <div className="grow">
            <b>{t("新区块 {n} 刚被挖出", { n: fresh.toLocaleString("en-US") })}</b>
            <p className="muted small">{t("城市边上长出了新街区 {n}.bitmap，先铭刻的人得地。", { n: fresh })}</p>
            <div className="row">
              <Link className="btn primary sm" href={`/district/${fresh}`} onClick={() => setFresh(null)}>
                {t("去看看")}
              </Link>
              <Link className="btn ghost sm" href="/game" onClick={() => setFresh(null)}>
                {t("这个区块抽中了什么")}
              </Link>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label={t("关闭")} onClick={() => setFresh(null)}>
            ×
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}

function Pick() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21 13 11" />
      <path d="M8 5c4-2 9-1 12 3-3-1-6-1-9 1" />
      <path d="M19 16c2-4 1-9-3-12 1 3 1 6-1 9" />
    </svg>
  );
}
