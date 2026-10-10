"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { useSession } from "@/components/Session";
import { Bolt } from "@/components/Tip";
import { XIcon } from "@/components/X";
import { api, ApiError, type LinkedWallet, type Me, type XAccount } from "@/lib/api";
import { LINK_WALLETS, type Wallet } from "@/lib/wallets";
import { t } from "@/lib/i18n";

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
  if (!token) return <p className="page muted">{t("连接钱包后可以看到你的街区和地块。")}</p>;
  if (error) return <p className="page error">{error}</p>;
  if (!me) return <p className="page muted">{t("加载中…")}</p>;
  return (
    <div className="page narrow me">
      <section className="me-head">
        <Avatar seed={address || me.address} size={56} />
        <div>
          <h1>{t("我的土地")}</h1>
          <p className="mono muted small break">{me.address}</p>
          <Link className="small" href={`/address/${me.address}`}>
            {t("看看别人眼中的我的主页")}
          </Link>
          {me.admin && (
            <>
              {" · "}
              <Link className="small" href="/admin">
                {t("站点管理")}
              </Link>
            </>
          )}
        </div>
      </section>
      {me.banned && <p className="notice small">{t("这个地址已被站点管理员禁止发帖。")}</p>}
      <XSection token={token} />
      <LightningSection token={token} />
      {me.wallets && <WalletsSection token={token} initial={me.wallets} />}
      <Group title={t("街区")} count={me.districts.length} empty={t("这个地址没有持有街区。")}>
        {me.districts.map((n) => (
          <Link key={n} className="chip mono" href={`/district/${n}`}>
            {n}.bitmap
          </Link>
        ))}
      </Group>
      <Group title={t("地块")} count={me.parcels.length} empty={t("这个地址没有持有地块。")}>
        {me.parcels.map((p) => (
          <Link key={`${p.bitmap_number}.${p.tx_index}`} className="chip mono" href={`/district/${p.bitmap_number}?parcel=${p.tx_index}`}>
            {p.bitmap_number}.bitmap #{p.tx_index}
          </Link>
        ))}
      </Group>
      <Group title={t("关注#following")} count={me.follows.length} empty={t("还没有关注街区。")}>
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

/** 闪电收款: the Lightning address tips to this wallet group go to. */
function LightningSection({ token }: { token: string }) {
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ lightning_address: string | null }>("/v1/me/lightning", { token })
      .then((r) => setSaved(r.lightning_address))
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setSaved(undefined) : setError(e.message)));
  }, [token]);
  if (saved === undefined) return error ? <p className="error small">{error}</p> : null;
  const run = async (fn: () => Promise<{ lightning_address: string | null }>) => {
    setBusy(true);
    setError(null);
    try {
      setSaved((await fn()).lightning_address);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => api("/v1/me/lightning", { method: "PUT", token, body: { lightning_address: value } }));
  const clear = () => confirm(t("关掉以后，别人就不能给你打赏了。")) && run(() => api("/v1/me/lightning", { method: "DELETE", token }));
  return (
    <section className="me-group lightning">
      <h2 className="section-title">{t("闪电收款")}</h2>
      {saved && !editing ? (
        <div className="x-card">
          <span className="x-avatar lightning-icon">
            <Bolt size={18} />
          </span>
          <div className="grow">
            <div className="mono break">{saved}</div>
            <span className="muted small">{t("你的帖子和街区可以收到打赏了，聪直接进这个钱包。")}</span>
          </div>
          <button type="button" className="ghost sm" onClick={() => (setValue(saved), setEditing(true))} disabled={busy}>
            {t("修改")}
          </button>
          <button type="button" className="ghost sm" onClick={clear} disabled={busy}>
            {t("关闭#off")}
          </button>
        </div>
      ) : (
        <>
          <p className="muted small">
            {t("填一个闪电地址（形如 name@wallet.com），别人就能给你的帖子和街区打赏。Wallet of Satoshi、Phoenix、Alby 等钱包都会给你一个。")}
          </p>
          <div className="row">
            <input id="lightning-address" className="grow" value={value} onChange={(e) => setValue(e.target.value)} placeholder="name@wallet.com" autoComplete="off" spellCheck={false} />
            <button type="button" className="primary" onClick={save} disabled={busy || !value.trim()}>
              {busy ? t("检查中…") : t("保存")}
            </button>
            {editing && (
              <button type="button" className="ghost" onClick={() => setEditing(false)} disabled={busy}>
                {t("取消")}
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className="error small">{error}</p>}
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
    if (!confirm(t("解除绑定后，街区和帖子上不再显示你的 X 账号。"))) return;
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
      <h2 className="section-title">{t("X 账号")}</h2>
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
            {t("解除绑定")}
          </button>
        </div>
      ) : state.available ? (
        <div className="x-card">
          <p className="grow muted small">{t("绑定后，你的街区和帖子旁会显示 X 账号，别人一眼知道是谁。我们只读取账号名和头像，不会替你发推。")}</p>
          <button type="button" className="primary" onClick={link} disabled={busy}>
            <XIcon /> {t("绑定 X")}
          </button>
        </div>
      ) : (
        <p className="muted small">{t("这个站点还没有开启 X 绑定。")}</p>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

const short = (a: string) => (a.length > 20 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a);

/** 关联钱包: prove another address is yours by signing with it, so pets count what all of them hold. */
function WalletsSection({ token, initial }: { token: string; initial: LinkedWallet[] }) {
  const [wallets, setWallets] = useState(initial);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const link = async (w: Wallet) => {
    setBusy(w.id);
    setError(null);
    try {
      const address = await w.connect();
      if (wallets.some((x) => x.address === address)) {
        throw new Error(t("{wallet} 现在选中的是已经关联的地址，请在钱包里切换到另一个账户再试。", { wallet: w.name }));
      }
      const n = await api<{ nonce: string; message: string }>("/v1/me/wallets/nonce", { method: "POST", token, body: { address } });
      const signature = await w.sign(address, n.message);
      const res = await api<{ wallets: LinkedWallet[] }>("/v1/me/wallets", { method: "POST", token, body: { address, nonce: n.nonce, signature } });
      setWallets(res.wallets);
      setPicking(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === "cancelled" ? null : msg);
    } finally {
      setBusy(null);
    }
  };
  const unlink = async (address: string) => {
    if (!confirm(t("解除关联后，这个钱包里的藏品不再算进你的街区。"))) return;
    setBusy(address);
    setError(null);
    try {
      setWallets((await api<{ wallets: LinkedWallet[] }>(`/v1/me/wallets/${address}`, { method: "DELETE", token })).wallets);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="me-group linked-wallets">
      <h2 className="section-title">
        {t("关联钱包")} <span className="mono">{wallets.length}</span>
      </h2>
      <p className="muted small">{t("土地和藏品放在不同地址？用另一个钱包签个名证明它也是你的，街区上的宠物会合计所有关联钱包的数量。发帖和管理街区仍按各自地址。")}</p>
      <ul className="wallet-list">
        {wallets.map((w) => (
          <li key={w.address}>
            <span className="mono small" title={w.address}>
              {short(w.address)}
            </span>
            {w.main && <span className="tag">{t("主地址")}</span>}
            {w.me && <span className="tag">{t("当前登录")}</span>}
            <span className="grow" />
            {!w.main && (
              <button type="button" className="ghost sm" onClick={() => unlink(w.address)} disabled={!!busy}>
                {t("解除")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {picking ? (
        <div className="link-picker">
          <p className="muted small">{t("选一个钱包，在钱包里切换到要关联的账户，再签名。签名不花钱，也不会发起交易。")}</p>
          <div className="chips">
            {LINK_WALLETS.map((w) => (
              <button key={w.id} type="button" className="chip" onClick={() => link(w)} disabled={!!busy || !w.available()}>
                {busy === w.id ? t("等待签名…") : w.id === "manual" ? t("手动粘贴签名") : w.name}
              </button>
            ))}
            <button type="button" className="link-btn small" onClick={() => setPicking(false)} disabled={!!busy}>
              {t("取消")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="ghost" onClick={() => setPicking(true)}>
          {t("关联另一个钱包")}
        </button>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
