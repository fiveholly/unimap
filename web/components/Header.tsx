"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Avatar } from "./Avatar";
import { LangSwitch } from "./Lang";
import { Bell } from "./Notifications";
import { Search } from "./Search";
import { short, useSession } from "./Session";
import { api } from "@/lib/api";
import { WALLETS, type WalletId } from "@/lib/wallets";
import { t } from "@/lib/i18n";

export function Header() {
  const path = usePathname();
  // Clear over the page at the top; the page's colour once something scrolls under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className={`header${scrolled ? " scrolled" : ""}`}>
      <div className="header-inner">
        <Link href="/" className="logo">
          unimap<em aria-hidden>.</em>
        </Link>
        {/* On a phone the links become a tab bar along the bottom, each with a line icon. */}
        <nav className="nav">
          {(
            [
              ["/", t("地图"), "M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Zm0 0v13.5m6-11V20"],
              ["/capsule", t("时间胶囊"), "M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7"],
              ["/rank", t("繁荣榜"), "M5 20v-8m7 8V5m7 15v-5M3 20h18"],
              ["/game", t("区块节拍"), "M3 12h4l2.5-6 5 12 2.5-6h4"],
              ["/recruit", t("招募"), "M14.5 20v-1a4.5 4.5 0 0 0-9 0v1M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm9-3v6m3-3h-6"],
              ["/me", t("我的"), "M5 20v-.5a7 7 0 0 1 14 0v.5M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],
            ] as const
          ).map(([href, label, d]) => {
            // 时间胶囊 stays lit on its letters and 同块人 pages. The tab bar has room for five, so 招募
            // is left to wider screens; 我的 is only in the tab bar, as wider screens reach it from the wallet menu.
            const on = path === href || (href === "/capsule" && path.startsWith("/capsule/"));
            const only = href === "/recruit" ? " wide-only" : href === "/me" ? " phone-only" : "";
            return (
            <Link key={href} href={href} className={`${on ? "active" : ""}${only}`} aria-current={on ? "page" : undefined}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={d} />
              </svg>
              <span>{label}</span>
            </Link>
            );
          })}
        </nav>
        <span className="grow" />
        <Search />
        <LangSwitch />
        <WalletButton />
      </div>
    </header>
  );
}

const LOGIN_EVENT = "unimap:login";
/** Open the 连接钱包 dialog from anywhere on the page (the header's button holds it). */
export function askLogin() {
  window.dispatchEvent(new Event(LOGIN_EVENT));
}

function WalletButton() {
  const { address, ready } = useSession();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(LOGIN_EVENT, on);
    return () => window.removeEventListener(LOGIN_EVENT, on);
  }, []);
  if (!ready) return <div className="wallet" />;
  if (address) {
    return (
      <div className="wallet">
        <Bell />
        <WalletMenu address={address} />
      </div>
    );
  }
  return (
    <div className="wallet">
      <button type="button" className="cta-pill" onClick={() => setOpen(true)}>
        {t("连接钱包")}
      </button>
      {open && <LoginDialog close={() => setOpen(false)} />}
    </div>
  );
}

/** The avatar and address open a menu: your pages, copy the address, and disconnect. Arrow keys
 * move through it; Escape, Tab or a click elsewhere closes it. */
function WalletMenu({ address }: { address: string }) {
  const { token, logout } = useSession();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [unread, setUnread] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = useCallback((focus = false) => {
    setOpen(false);
    if (focus) button.current?.focus();
  }, []);

  // Unread private messages, for the 私信 item: on each page change, as the bell does.
  useEffect(() => {
    if (!token) return;
    let live = true;
    api<{ unread: number }>("/v1/dms/unread", { token })
      .then((r) => live && setUnread(r.unread))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [token, path]);
  useEffect(() => close(), [path, close]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close(box.current?.contains(document.activeElement) ?? false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, close]);

  const openWith = (which: "first" | "last") => {
    setOpen(true);
    requestAnimationFrame(() => {
      const list = items();
      (which === "first" ? list[0] : list[list.length - 1])?.focus();
    });
  };
  const onButtonKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openWith("first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openWith("last");
    }
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (j: number) => {
      e.preventDefault();
      list[(j + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") close();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  const go = (href: string) => {
    close();
    router.push(href);
  };

  return (
    <div className="wallet-menu" ref={box}>
      <button
        ref={button}
        type="button"
        className={`me-link${open ? " open" : ""}`}
        title={address}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="wallet-menu"
        aria-label={t("钱包菜单：{address}", { address: short(address) })}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onButtonKey}
      >
        <Avatar seed={address} size={22} />
        <span className="mono">{short(address)}</span>
        <svg className="chev" width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m1 1 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="menu" id="wallet-menu" role="menu" aria-label={t("钱包菜单")} ref={menu} onKeyDown={onMenuKey}>
          <div className="menu-who" role="presentation">
            <Avatar seed={address} size={28} />
            <span className="mono small break">{short(address)}</span>
          </div>
          <MenuLink href="/me" go={go} d="M5 20v-.5a7 7 0 0 1 14 0v.5M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z">
            {t("我的主页")}
          </MenuLink>
          <MenuLink href="/capsule#mine" go={go} d="M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7">
            {t("我的时间胶囊")}
          </MenuLink>
          <MenuLink href="/messages" go={go} d="M4 5.5h16v10H9l-5 4v-14Z">
            {t("私信")}
            {unread > 0 && (
              <span className="menu-count" aria-label={t("{n} 条未读", { n: unread })}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </MenuLink>
          <hr role="separator" />
          <button type="button" role="menuitem" tabIndex={-1} onClick={copy}>
            <MenuIcon d="M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4" />
            <span className="grow">{copied ? t("已复制") : t("复制地址")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              close();
              logout();
            }}
          >
            <MenuIcon d="M14 4.5h5.5v15H14M10 8l-4 4 4 4M6 12h10" />
            <span className="grow">{t("断开钱包")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function MenuIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function MenuLink({ href, go, d, children }: { href: string; go: (href: string) => void; d: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      role="menuitem"
      tabIndex={-1}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        go(href);
      }}
    >
      <MenuIcon d={d} />
      <span className="grow">{children}</span>
    </Link>
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
      <span className="serif">unimap</span>
      <span>{t("比特币上的 Bitmap 城市")}</span>
    </footer>
  );
}
