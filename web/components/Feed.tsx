"use client";

import { useEffect, useState } from "react";

import { EventItem } from "./EventItem";
import { PostCard } from "./PostCard";
import { api, type FeedItem } from "@/lib/api";
import { t } from "@/lib/i18n";

/** Posts and parcel changes from the districts you follow. */
export function Feed({ token }: { token: string }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: FeedItem[] }>("/v1/feed", { token })
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, [token]);
  if (error) return <p className="error small">{error}</p>;
  if (!items) return <p className="muted">{t("加载中…")}</p>;
  if (items.length === 0) return <p className="muted">{t("关注一个街区，动态就会出现在这里。")}</p>;
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
