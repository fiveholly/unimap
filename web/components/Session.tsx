"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { setManualPrompt, walletById, type WalletId } from "@/lib/wallets";

type Stored = { address: string; token: string; wallet: WalletId };

type SessionValue = {
  address: string | null;
  token: string | null;
  ready: boolean;
  login: (wallet: WalletId) => Promise<void>;
  logout: () => Promise<void>;
  sign: (message: string) => Promise<string>;
};

const SessionContext = createContext<SessionValue | null>(null);
const KEY = "unimap.session";

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function save(s: Stored | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {}
}

type Pending =
  | { kind: "address"; resolve: (v: string) => void; reject: (e: Error) => void }
  | { kind: "signature"; address: string; message: string; resolve: (v: string) => void; reject: (e: Error) => void };

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    setStored(load());
    setReady(true);
    setManualPrompt({
      askAddress: () => new Promise((resolve, reject) => setPending({ kind: "address", resolve, reject })),
      askSignature: (address, message) =>
        new Promise((resolve, reject) => setPending({ kind: "signature", address, message, resolve, reject })),
    });
    return () => setManualPrompt(null);
  }, []);

  const login = useCallback(async (walletId: WalletId) => {
    const wallet = walletById(walletId);
    if (!wallet) throw new Error("unknown wallet");
    if (!wallet.available()) throw new Error(`${wallet.name} is not installed in this browser`);
    const address = await wallet.connect();
    const nonce = await api<{ nonce: string; message: string }>("/v1/auth/nonce", { method: "POST", body: { address } });
    const signature = await wallet.sign(address, nonce.message);
    const res = await api<{ token: string; address: string }>("/v1/auth/login", {
      method: "POST",
      body: { address, nonce: nonce.nonce, signature },
    });
    const s = { address: res.address, token: res.token, wallet: walletId };
    save(s);
    setStored(s);
  }, []);

  const logout = useCallback(async () => {
    if (stored) {
      try {
        await api("/v1/auth/logout", { method: "POST", token: stored.token });
      } catch {}
    }
    save(null);
    setStored(null);
  }, [stored]);

  const sign = useCallback(
    async (message: string) => {
      if (!stored) throw new Error("sign in first");
      const wallet = walletById(stored.wallet);
      if (!wallet) throw new Error("wallet not found, sign in again");
      return wallet.sign(stored.address, message);
    },
    [stored],
  );

  return (
    <SessionContext.Provider
      value={{ address: stored?.address ?? null, token: stored?.token ?? null, ready, login, logout, sign }}
    >
      {children}
      {pending && <ManualDialog pending={pending} close={() => setPending(null)} />}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

function ManualDialog({ pending, close }: { pending: Pending; close: () => void }) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = () => {
    if (!value.trim()) return;
    pending.resolve(value.trim());
    close();
  };
  const cancel = () => {
    pending.reject(new Error("cancelled"));
    close();
  };
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="dialog">
        {pending.kind === "address" ? (
          <>
            <h2>Your address</h2>
            <p className="muted">The address that holds your Bitmap inscriptions.</p>
            <input
              ref={input as React.RefObject<HTMLInputElement>}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="bc1p…"
              name="address"
            />
          </>
        ) : (
          <>
            <h2>Sign this message</h2>
            <p className="muted">
              Sign it with {short(pending.address)}, for example with{" "}
              <code>ord wallet sign --signer {short(pending.address)} --text &quot;…&quot;</code>, then paste the
              signature (base64).
            </p>
            <pre className="message">{pending.message}</pre>
            <button className="ghost" onClick={() => navigator.clipboard?.writeText(pending.message)}>
              Copy message
            </button>
            <textarea
              ref={input as React.RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={3}
              placeholder="Signature"
              name="signature"
            />
          </>
        )}
        <div className="row end">
          <button className="ghost" onClick={cancel}>
            Cancel
          </button>
          <button onClick={submit}>Continue</button>
        </div>
      </div>
    </div>
  );
}

export function short(address: string | null | undefined): string {
  if (!address) return "—";
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}
