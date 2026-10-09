"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { short } from "@/lib/format";

export { short };
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
    if (!wallet) throw new Error("不认识这个钱包");
    if (!wallet.available()) throw new Error(`这个浏览器没有安装 ${wallet.name}`);
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
      if (!stored) throw new Error("请先连接钱包");
      const wallet = walletById(stored.wallet);
      if (!wallet) throw new Error("找不到钱包，请重新连接");
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
            <h2>你的地址</h2>
            <p className="muted">持有 Bitmap 铭文的那个地址。</p>
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
            <h2>签名这条消息</h2>
            <p className="muted">
              用 {short(pending.address)} 签名，例如{" "}
              <code>ord wallet sign --signer {short(pending.address)} --text &quot;…&quot;</code>
              ，再把签名（base64）粘贴到下面。
            </p>
            <pre className="message">{pending.message}</pre>
            <button className="ghost" onClick={() => navigator.clipboard?.writeText(pending.message)}>
              复制消息
            </button>
            <textarea
              ref={input as React.RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={3}
              placeholder="签名"
              name="signature"
            />
          </>
        )}
        <div className="row end">
          <button className="ghost" onClick={cancel}>
            取消
          </button>
          <button className="primary" onClick={submit}>继续</button>
        </div>
      </div>
    </div>
  );
}

