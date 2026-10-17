"use client";

import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";

const key = (page: string) => `unimap.intro.${page}`;

/** One line at the top of a page the first time it is opened: what the page is and what you can
 * do here. Closing it, or coming back, and it is gone for good (remembered per page). */
export function PageIntro({ page, title, children }: { page: string; title: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(key(page))) return;
      localStorage.setItem(key(page), "seen"); // seen once is enough; it stays for this visit
    } catch {}
    setShow(true);
  }, [page]);
  if (!show) return null;
  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(key(page), "closed");
    } catch {}
  };
  return (
    <aside className="page-intro" aria-label={t("这一页是什么")}>
      <p>
        <b>{t("{name}：", { name: title })}</b>
        {children}
      </p>
      <button type="button" className="icon-btn bare" aria-label={t("知道了，不再显示")} onClick={close}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </aside>
  );
}
