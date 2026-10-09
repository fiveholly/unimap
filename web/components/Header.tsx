"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { short, useSession } from "./Session";
import { WALLETS, type WalletId } from "@/lib/wallets";

export function Header() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <header className="header">
      <Link href="/" className="logo">
        <span className="logo-mark" aria-hidden />
        unimap
      </Link>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          const n = parseInt(q.replace(/\.bitmap$/i, ""), 10);
          if (Number.isFinite(n) && n >= 0) router.push(`/district/${n}`);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Go to block, e.g. 840000" name="q" inputMode="numeric" />
      </form>
      <WalletButton />
    </header>
  );
}

function WalletButton() {
  const { address, ready, login, logout } = useSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ready) return <div className="wallet" />;
  if (address) {
    return (
      <div className="wallet">
        <Link href="/me" className="pill">
          {short(address)}
        </Link>
        <button className="ghost small" onClick={logout}>
          Sign out
        </button>
      </div>
    );
  }
  const choose = async (id: WalletId) => {
    setBusy(true);
    setError(null);
    try {
      await login(id);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wallet">
      <button onClick={() => setOpen(!open)} disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {open && (
        <div className="menu">
          {WALLETS.map((w) => (
            <button key={w.id} className="menu-item" onClick={() => choose(w.id)} disabled={busy}>
              {w.name}
              {w.id !== "manual" && !w.available() && <span className="muted"> · not installed</span>}
            </button>
          ))}
          <p className="muted small">Signing in costs nothing; it is a message signature, not a transaction.</p>
          {error && <p className="error small">{error}</p>}
        </div>
      )}
    </div>
  );
}
