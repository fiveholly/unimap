"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { CityMap } from "@/components/CityMap";
import { EventItem } from "@/components/EventItem";
import { PostCard } from "@/components/PostCard";
import { useSession } from "@/components/Session";
import { Welcome } from "@/components/Welcome";
import { api, type FeedItem } from "@/lib/api";
import { epochName } from "@/lib/format";

export default function Home() {
  return (
    <Suspense>
      <HomeView />
    </Suspense>
  );
}

function HomeView() {
  const { token } = useSession();
  const search = useSearchParams();
  const [tip, setTip] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ indexed_height: { bitmap: number | null } }>("/v1/status")
      .then((s) => setTip(s.indexed_height.bitmap ?? 0))
      .catch((e) => setError(String(e.message || e)));
  }, []);
  const b = Number(search.get("b"));
  const focus = tip == null ? 0 : Number.isInteger(b) && b >= 0 && b <= tip && search.get("b") ? b : tip;

  return (
    <div className="page">
      <section className="home-head">
        <div>
          <h1>比特币的每一个区块，都是城市里的一个街区</h1>
          <p className="muted">
            持有 Bitmap 街区就能经营它的社区，持有地块就是这里的居民，其他人可以来逛、关注和回复。
          </p>
        </div>
        {tip != null && (
          <div className="mono muted small nowrap">
            {epochName(tip)} · 最新区块 {tip.toLocaleString("en-US")}
          </div>
        )}
      </section>
      {tip != null && <Welcome tip={tip} />}
      {error && <p className="error">连不上 unimap 服务：{error}</p>}
      {tip == null && !error && <div className="city-skeleton" aria-label="地图加载中" />}
      {tip != null && <CityMap tip={tip} focus={focus} />}
      <section className="home-feed">
        <h2 className="section-title">我的动态</h2>
        {token ? <Feed token={token} /> : <p className="muted">连接钱包并关注街区后，这里会出现它们的帖子和地块变动。</p>}
      </section>
    </div>
  );
}

function Feed({ token }: { token: string }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: FeedItem[] }>("/v1/feed", { token })
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, [token]);
  if (error) return <p className="error small">{error}</p>;
  if (!items) return <p className="muted">加载中…</p>;
  if (items.length === 0) return <p className="muted">关注一个街区，动态就会出现在这里。</p>;
  return (
    <div className="feed">
      {items.map((i) =>
        i.type === "event" ? (
          <ul className="events" key={`e${i.event.id}`}>
            <EventItem event={i.event} showDistrict />
          </ul>
        ) : (
          <PostCard key={`p${i.post.id}`} post={i.post} showDistrict />
        ),
      )}
    </div>
  );
}
