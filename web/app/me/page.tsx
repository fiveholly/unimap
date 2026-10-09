"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { useSession } from "@/components/Session";
import { api, type Me } from "@/lib/api";

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
