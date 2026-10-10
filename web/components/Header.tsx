"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Avatar } from "./Avatar";
import { LangSwitch } from "./Lang";
import { Bell } from "./Notifications";
import { Search } from "./Search";
import { short, useSession } from "./Session";
import { WALLETS, type WalletId } from "@/lib/wallets";
import { t } from "@/lib/i18n";

export function Header() {
  const path = usePathname();

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
            {t("地图")}
          </Link>
          <Link href="/rank" className={path === "/rank" ? "active" : ""}>
            {t("繁荣榜")}
          </Link>
          <Link href="/recruit" className={path === "/recruit" ? "active" : ""}>
            {t("招募")}
          </Link>
          <Link href="/me" className={path === "/me" ? "active" : ""}>
            {t("我的")}
          </Link>
        </nav>
        <span className="grow" />
        <Search />
        <LangSwitch />
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
          {t("退出")}
        </button>
      </div>
    );
  }
  return (
    <div className="wallet">
      <button type="button" className="ghost" onClick={() => setOpen(true)}>
        {t("连接钱包")}
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
        <h2 id="login-title">{t("连接钱包")}</h2>
        <p className="muted">
          {t("先连接钱包，再签一条消息证明地址是你的。签名不花钱，也不会发起交易。")}
        </p>
        <div className="wallet-grid">
          {browserWallets.map((w) => {
            const installed = w.available();
            return (
              <button key={w.id} type="button" className="wallet-tile" onClick={() => choose(w.id)} disabled={!!busy || !installed}>
                <span className="wallet-name">{w.name}</span>
                <span className="muted small">{busy === w.id ? t("等待钱包签名…") : installed ? t("已安装") : t("未安装")}</span>
              </button>
            );
          })}
        </div>
        {error && <p className="error small">{error}</p>}
        <button type="button" className="link-btn small" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          {advanced ? t("收起高级选项") : t("高级：手动粘贴签名")}
        </button>
        {advanced && (
          <p className="muted small">
            {t("适合用 ord 命令行或其他钱包签名：输入地址，复制要签的消息，签好后把签名粘贴回来。")}{" "}
            <button type="button" className="link-btn" onClick={() => choose("manual")} disabled={!!busy}>
              {t("开始")}
            </button>
          </p>
        )}
        <div className="row end">
          <button type="button" className="ghost" onClick={close} disabled={!!busy}>
            {t("取消")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <span className="mono">unimap</span>
      <span>{t("比特币上的 Bitmap 城市")}</span>
    </footer>
  );
}
