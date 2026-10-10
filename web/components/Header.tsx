"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Avatar } from "./Avatar";
import { Bell } from "./Notifications";
import { short, useSession } from "./Session";
import { WALLETS, type WalletId } from "@/lib/wallets";

export function Header() {
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);

  // "/" jumps to the search box from anywhere except a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "/" || el.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="logo">
          <span className="logo-mark" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
          unimap
        </Link>
        <nav className="nav">
          <Link href="/" className={path === "/" ? "active" : ""}>
            地图
          </Link>
          <Link href="/rank" className={path === "/rank" ? "active" : ""}>
            繁荣榜
          </Link>
          <Link href="/recruit" className={path === "/recruit" ? "active" : ""}>
            招募
          </Link>
          <Link href="/me" className={path === "/me" ? "active" : ""}>
            我的
          </Link>
        </nav>
        <span className="grow" />
        <form
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(q.replace(/\.bitmap$/i, ""), 10);
            if (Number.isFinite(n) && n >= 0) {
              router.push(`/district/${n}`);
              setQ("");
              search.current?.blur();
            }
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索街区号"
            aria-label="搜索街区号"
            name="q"
            inputMode="numeric"
          />
          <kbd>/</kbd>
        </form>
        <WalletButton />
      </div>
    </header>
  );
}

function WalletButton() {
  const { address, ready, logout } = useSession();
  const [open, setOpen] = useState(false);
  if (!ready) return <div className="wallet" />;
  if (address) {
    return (
      <div className="wallet">
        <Bell />
        <Link href="/me" className="me-link" title={address}>
          <Avatar seed={address} size={22} />
          <span className="mono">{short(address)}</span>
        </Link>
        <button type="button" className="ghost small" onClick={logout}>
          退出
        </button>
      </div>
    );
  }
  return (
    <div className="wallet">
      <button type="button" className="ghost" onClick={() => setOpen(true)}>
        连接钱包
      </button>
      {open && <LoginDialog close={() => setOpen(false)} />}
    </div>
  );
}

function LoginDialog({ close }: { close: () => void }) {
  const { login } = useSession();
  const [busy, setBusy] = useState<WalletId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, close]);

  const choose = async (id: WalletId) => {
    setBusy(id);
    setError(null);
    try {
      await login(id);
      close();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === "cancelled" ? null : msg);
    } finally {
      setBusy(null);
    }
  };

  const browserWallets = WALLETS.filter((w) => w.id !== "manual");
  // Into <body>: the header's backdrop-filter would otherwise make it the box a fixed
  // overlay is placed in, and on phones the dialog ends up above the screen.
  return createPortal(
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="login-title" onClick={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="dialog">
        <h2 id="login-title">连接钱包</h2>
        <p className="muted">
          先连接钱包，再签一条消息证明地址是你的。签名不花钱，也不会发起交易。
        </p>
        <div className="wallet-grid">
          {browserWallets.map((w) => {
            const installed = w.available();
            return (
              <button key={w.id} type="button" className="wallet-tile" onClick={() => choose(w.id)} disabled={!!busy || !installed}>
                <span className="wallet-name">{w.name}</span>
                <span className="muted small">{busy === w.id ? "等待钱包签名…" : installed ? "已安装" : "未安装"}</span>
              </button>
            );
          })}
        </div>
        {error && <p className="error small">{error}</p>}
        <button type="button" className="link-btn small" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          {advanced ? "收起高级选项" : "高级：手动粘贴签名"}
        </button>
        {advanced && (
          <p className="muted small">
            适合用 ord 命令行或其他钱包签名：输入地址，复制要签的消息，签好后把签名粘贴回来。{" "}
            <button type="button" className="link-btn" onClick={() => choose("manual")} disabled={!!busy}>
              开始
            </button>
          </p>
        )}
        <div className="row end">
          <button type="button" className="ghost" onClick={close} disabled={!!busy}>
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
