"use client";

import { useEffect, useRef, useState } from "react";

import { XIcon } from "./X";
import { xIntent } from "@/lib/share";

const ShareIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
    <path d="m16 6-4-4-4 4" />
    <path d="M12 2v13" />
  </svg>
);


/** A 分享 button with 分享到 X, 复制链接 and, where the device has one, the system share sheet.
 * `path` is the page to share; its card image comes from that page's opengraph-image. */
export function ShareMenu({
  path,
  text,
  label = "分享",
  className = "ghost lg",
  align = "right",
}: {
  path: string;
  text: string;
  label?: string;
  className?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [native, setNative] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setNative(typeof navigator !== "undefined" && "share" in navigator), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const url = () => new URL(path, window.location.origin).toString();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
    setOpen(false);
  };
  return (
    <div className={`share-menu ${align}`} ref={ref}>
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ShareIcon />
        {copied ? "链接已复制" : label || <span className="sr-only">分享</span>}
      </button>
      {open && (
        <div className="menu" role="menu">
          <a
            role="menuitem"
            className="btn menu-item"
            href={xIntent(text, url())}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            <XIcon />
            分享到 X
          </a>
          <button type="button" role="menuitem" className="menu-item" onClick={copy}>
            复制链接
          </button>
          {native && (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                navigator.share({ text, url: url() }).catch(() => {});
              }}
            >
              更多方式…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
