"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar } from "./Avatar";
import { BadgeIcon } from "./Badge";
import { useSession } from "./Session";
import { api, type Notification } from "@/lib/api";
import { short, timeAgo } from "@/lib/format";
import { CLAIM_BLOCKS, RARITY_COLORS, RARITY_NAMES, SEASON } from "@/lib/game";
import { t, tn } from "@/lib/i18n";

// The notifications page tells the bell when it has marked things read.
const READ_EVENT = "unimap:notifications-read";
export const announceRead = () => window.dispatchEvent(new Event(READ_EVENT));

/** The bell in the header, with the unread count. Checks every minute and on each page change. */
export function Bell() {
  const { token } = useSession();
  const path = usePathname();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!token) return setUnread(0);
    let live = true;
    const check = () =>
      api<{ unread: number }>("/v1/notifications/unread", { token })
        .then((r) => live && setUnread(r.unread))
        .catch(() => {});
    check();
    const timer = setInterval(() => document.visibilityState === "visible" && check(), 60_000);
    window.addEventListener(READ_EVENT, check);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener(READ_EVENT, check);
    };
  }, [token, path]);
  return (
    <Link href="/notifications" className={`bell${path === "/notifications" ? " active" : ""}`} aria-label={unread ? t("通知，{n} 条未读", { n: unread }) : t("通知")}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
      </svg>
      {unread > 0 && <span className="bell-count">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}

/** Likes on one post and follows of one district fold into one line. */
type Item = { key: string; first: Notification; actors: string[]; read: boolean };
function group(list: Notification[]): Item[] {
  const out: Item[] = [];
  const at = new Map<string, Item>();
  for (const n of list) {
    const fold = n.kind === "like" ? `like:${n.post_id}` : n.kind === "follow" ? `follow:${n.bitmap_number}` : null;
    const item = fold ? at.get(fold) : undefined;
    if (item) {
      if (!item.actors.includes(n.actor)) item.actors.push(n.actor);
      item.read &&= n.read;
      continue;
    }
    const fresh = { key: `${n.id}`, first: n, actors: [n.actor], read: n.read };
    out.push(fresh);
    if (fold) at.set(fold, fresh);
  }
  return out;
}

function sentence(item: Item): [React.ReactNode, string] {
  const n = item.first;
  const who = (
    <b className="mono">
      {short(item.actors[0])}
      {item.actors.length > 1 && <span className="muted">{t(" 等 {n} 人", { n: item.actors.length })}</span>}
    </b>
  );
  const place = <span className="mono">{n.bitmap_number}.bitmap</span>;
  const post = n.post_id != null ? `/post/${n.post_id}` : `/district/${n.bitmap_number}`;
  switch (n.kind) {
    case "reply":
      return [tn("{who} 回复了你在 {place} 的帖子", { who, place }), post];
    case "like":
      return [tn("{who} 赞了你在 {place} 的帖子", { who, place }), post];
    case "post":
      return [tn("{who} 在你的街区 {place} 发了帖子", { who, place }), post];
    case "follow":
      return [tn("{who} 关注了你的街区 {place}", { who, place }), `/district/${n.bitmap_number}`];
    case "apply":
      return [tn("{who} 申请入住你的街区 {place}，去「管理街区 → 招募」看看", { who, place }), `/district/${n.bitmap_number}`];
    case "tip": {
      const sats = <b className="mono tip-amount">{(n.amount_sats ?? 0).toLocaleString("en-US")}</b>;
      return n.post_id != null
        ? [tn("{who} 打赏了你在 {place} 的帖子 {sats} 聪", { who, place, sats }), post]
        : [tn("{who} 打赏了你的街区 {place} {sats} 聪", { who, place, sats }), `/district/${n.bitmap_number}`];
    }
    case "treasure": {
      const rarity = n.rarity ?? "common";
      const box = <b style={{ color: RARITY_COLORS[rarity] }}>{t(RARITY_NAMES[rarity])}</b>;
      return [
        tn("区块 {h} 把一个{rarity}宝箱放在了你在 {place} 的地块 #{i}，{n} 个区块内去打开它", {
          h: <span className="mono">{(n.block_height ?? 0).toLocaleString("en-US")}</span>,
          rarity: box,
          place,
          i: n.tx_index ?? 0,
          n: CLAIM_BLOCKS,
        }),
        `/district/${n.bitmap_number}`,
      ];
    }
    case "crown":
      return [
        tn("你的街区 {place} 在第 {n} 赛季进了前三，戴上了王冠", { place, n: Math.floor((n.block_height ?? 0) / SEASON) }),
        `/district/${n.bitmap_number}`,
      ];
    case "lucky":
      return [
        tn("区块 {h} 抽中你的街区 {place} 做今日幸运街区，你得到一枚徽章", { h: <span className="mono">{(n.block_height ?? 0).toLocaleString("en-US")}</span>, place }),
        `/district/${n.bitmap_number}`,
      ];
  }
}

/** The page heading, here so it re-renders in the chosen language (the page itself is a server component). */
export function NotificationsTitle() {
  return <h1>{t("通知")}</h1>;
}

export function NotificationList() {
  const { token, ready } = useSession();
  const [list, setList] = useState<Notification[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = (before?: number) =>
    api<{ notifications: Notification[] }>(`/v1/notifications${before ? `?before=${before}` : ""}`, { token })
      .then((r) => {
        setList((old) => (before ? [...(old ?? []), ...r.notifications] : r.notifications));
        setMore(r.notifications.length >= 30);
        // Seen once listed: mark read up to the newest, and let the bell know.
        const newest = r.notifications[0]?.id;
        if (!before && newest && r.notifications.some((x) => !x.read))
          api("/v1/notifications/read", { method: "POST", body: { up_to: newest }, token }).then(announceRead, () => {});
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  if (!ready) return null;
  if (!token) return <p className="muted">{t("连接钱包后可以看到你的通知。")}</p>;
  if (error) return <p className="error">{error}</p>;
  if (!list) return <p className="muted">{t("加载中…")}</p>;
  if (!list.length) return <p className="muted">{t("还没有通知。有人回复、点赞、打赏你的帖子，关注你的街区或者申请入住，或者区块给你送来宝箱时，会在这里告诉你。")}</p>;
  return (
    <>
      <ul className="notifications">
        {group(list).map((item) => {
          const [text, href] = sentence(item);
          return (
            <li key={item.key} className={item.read ? "" : "unread"}>
              <Link href={href}>
                {item.first.kind === "treasure" || item.first.kind === "lucky" || item.first.kind === "crown" ? (
                  <BadgeIcon kind={item.first.kind} rarity={item.first.kind === "treasure" ? (item.first.rarity ?? "common") : item.first.kind === "crown" ? "legendary" : "rare"} />
                ) : (
                  <Avatar seed={item.first.actor} size={32} />
                )}
                <span className="grow">
                  <span>{text}</span>
                  {item.first.kind === "tip" && item.first.comment ? (
                    <span className="snippet small">“{item.first.comment}”</span>
                  ) : (
                    item.first.snippet && <span className="snippet muted small">{item.first.snippet}</span>
                  )}
                </span>
                <span className="dim small">{timeAgo(new Date(item.first.created_at).getTime() / 1000)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {more && (
        <button type="button" className="ghost" onClick={() => load(list[list.length - 1].id)}>
          {t("更早的通知")}
        </button>
      )}
    </>
  );
}
