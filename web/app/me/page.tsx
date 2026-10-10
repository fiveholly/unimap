"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { useSession } from "@/components/Session";
import { XIcon } from "@/components/X";
import { api, ApiError, type Me, type XAccount } from "@/lib/api";

export default function MePage() {
  const { token, ready, address } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    api<Me>("/v1/me", { token })
      .then(setMe)
      .catch((e) => setError(e.message));
  }, [token]);
  if (!ready) return null;
  if (!token) return <p className="page muted">连接钱包后可以看到你的街区和地块。</p>;
  if (error) return <p className="page error">{error}</p>;
  if (!me) return <p className="page muted">加载中…</p>;
  return (
    <div className="page narrow me">
      <section className="me-head">
        <Avatar seed={address || me.address} size={56} />
        <div>
          <h1>我的土地</h1>
          <p className="mono muted small break">{me.address}</p>
        </div>
      </section>
      <XSection token={token} />
      <Group title="街区" count={me.districts.length} empty="这个地址没有持有街区。">
        {me.districts.map((n) => (
          <Link key={n} className="chip mono" href={`/district/${n}`}>
            {n}.bitmap
          </Link>
        ))}
      </Group>
      <Group title="地块" count={me.parcels.length} empty="这个地址没有持有地块。">
        {me.parcels.map((p) => (
          <Link key={`${p.bitmap_number}.${p.tx_index}`} className="chip mono" href={`/district/${p.bitmap_number}?parcel=${p.tx_index}`}>
            {p.bitmap_number}.bitmap #{p.tx_index}
          </Link>
        ))}
      </Group>
      <Group title="关注" count={me.follows.length} empty="还没有关注街区。">
        {me.follows.map((n) => (
          <Link key={n} className="chip mono" href={`/district/${n}`}>
            {n}.bitmap
          </Link>
        ))}
      </Group>
    </div>
  );
}

function Group({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section className="me-group">
      <h2 className="section-title">
        {title} <span className="mono">{count}</span>
      </h2>
      {count === 0 ? <p className="muted">{empty}</p> : <div className="chips">{children}</div>}
    </section>
  );
}

/** 绑定 X: sign in to X so the account shows next to this address on districts and posts. */
function XSection({ token }: { token: string }) {
  const [state, setState] = useState<{ available: boolean; x: XAccount | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ available: boolean; x: XAccount | null }>("/v1/x/link", { token })
      .then(setState)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? null : e.message));
  }, [token]);
  if (!state) return error ? <p className="error small">{error}</p> : null;
  const link = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/v1/x/link/start", { method: "POST", token });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const unlink = async () => {
    if (!confirm("解除绑定后，街区和帖子上不再显示你的 X 账号。")) return;
    setBusy(true);
    try {
      await api("/v1/x/link", { method: "DELETE", token });
      setState({ ...state, x: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const x = state.x;
  return (
    <section className="me-group x-link">
      <h2 className="section-title">X 账号</h2>
      {x ? (
        <div className="x-card">
          {x.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="x-avatar" src={x.avatar_url} alt="" width={40} height={40} referrerPolicy="no-referrer" />
          ) : (
            <span className="x-avatar">
              <XIcon size={18} />
            </span>
          )}
          <div className="grow">
            <div>{x.name}</div>
            <a className="muted small" href={x.url} target="_blank" rel="noopener noreferrer">
              @{x.username}
            </a>
          </div>
          <button type="button" className="ghost sm" onClick={unlink} disabled={busy}>
            解除绑定
          </button>
        </div>
      ) : state.available ? (
        <div className="x-card">
          <p className="grow muted small">绑定后，你的街区和帖子旁会显示 X 账号，别人一眼知道是谁。我们只读取账号名和头像，不会替你发推。</p>
          <button type="button" className="primary" onClick={link} disabled={busy}>
            <XIcon /> 绑定 X
          </button>
        </div>
      ) : (
        <p className="muted small">这个站点还没有开启 X 绑定。</p>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
