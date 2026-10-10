"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { Composer } from "@/components/Composer";
import { EventItem } from "@/components/EventItem";
import { Mondrian } from "@/components/Mondrian";
import { OwnerTools } from "@/components/OwnerTools";
import { PetsCard } from "@/components/Pets";
import { Polls } from "@/components/Polls";
import { PostCard, RoleBadge, type PostActions } from "@/components/PostCard";
import { ProsperityCard } from "@/components/ProsperityCard";
import { RecruitCard } from "@/components/Recruit";
import { ShareMenu } from "@/components/ShareMenu";
import { short, useSession } from "@/components/Session";
import { TileThumb } from "@/components/TileThumb";
import { XHandle } from "@/components/X";
import { api, ApiError, type District, type Land, type LandEvent, type Me, type Post, type Tile } from "@/lib/api";
import { btc, epochName } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { districtText, parkText } from "@/lib/share";
import { LANDMARKS, ZONES, zoneOf } from "@/lib/zones";

export default function DistrictPage() {
  return (
    <Suspense>
      <DistrictView />
    </Suspense>
  );
}

type Tab = "posts" | "polls" | "parcels" | "history";

function DistrictView() {
  const params = useParams<{ n: string }>();
  const search = useSearchParams();
  const n = Number(params.n);
  const { token } = useSession();

  const [land, setLand] = useState<Land | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [txValues, setTxValues] = useState<number[] | null>(null);
  const [district, setDistrict] = useState<District | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [events, setEvents] = useState<LandEvent[]>([]);
  const [nearby, setNearby] = useState<Post[]>([]);
  const [around, setAround] = useState<Tile[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [selected, setSelected] = useState<number | null>(search.get("parcel") ? Number(search.get("parcel")) : null);
  const [tab, setTab] = useState<Tab>("posts");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep only the latest answer: a request sent before sign-in can come back after the one
  // sent with the token, and must not overwrite it.
  const districtSeq = useRef(0);
  const postsSeq = useRef(0);
  const loadDistrict = useCallback(() => {
    const id = ++districtSeq.current;
    return api<District>(`/v1/districts/${n}`, { token }).then((d) => id === districtSeq.current && setDistrict(d));
  }, [n, token]);
  const loadPosts = useCallback(() => {
    const id = ++postsSeq.current;
    return api<{ posts: Post[] }>(`/v1/districts/${n}/posts`, { token }).then((r) => id === postsSeq.current && setPosts(r.posts));
  }, [n, token]);

  useEffect(() => {
    if (!Number.isInteger(n) || n < 0) return setNotFound(true);
    setError(null);
    setLand(null);
    setTxValues(null);
    api<Land>(`/v1/land/${n}`)
      .then(setLand)
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setNotFound(true) : setError(e.message)));
    api<{ tx_values: number[] }>(`/v1/land/${n}/txs`)
      .then((r) => setTxValues(r.tx_values))
      .catch(() => setTxValues(null));
    api<{ events: LandEvent[] }>(`/v1/land/${n}/events`).then((r) => setEvents(r.events)).catch(() => {});
    api<{ posts: Post[] }>(`/v1/districts/${n}/neighbors`).then((r) => setNearby(r.posts)).catch(() => {});
    api<{ tiles: Tile[] }>(`/v1/land?start=${Math.max(0, n - 3)}&end=${n + 3}`).then((r) => setAround(r.tiles)).catch(() => {});
  }, [n]);

  useEffect(() => {
    if (notFound) return;
    loadDistrict().catch((e) => setError(e.message));
    loadPosts().catch((e) => setError(e.message));
  }, [loadDistrict, loadPosts, notFound]);

  useEffect(() => {
    if (!token) return setMe(null);
    api<Me>("/v1/me", { token }).then(setMe).catch(() => setMe(null));
  }, [token]);

  const claimed = useMemo(() => new Set(land?.parcels.map((p) => p.tx_index)), [land]);
  const own = useMemo(() => new Set(me?.parcels.filter((p) => p.bitmap_number === n).map((p) => p.tx_index)), [me, n]);

  if (notFound) return <p className="page muted">{t("区块 {n} 还没挖出来，或者还没被索引。", { n: params.n })}</p>;
  if (error) return <p className="page error">{error}</p>;
  if (!land || !district) return <DistrictSkeleton n={n} />;

  const viewer = district.viewer;
  const isOwner = viewer?.role === "owner";
  const canPost = !!viewer && !viewer.muted && viewer.role !== "visitor";
  const canReply = !!viewer && !viewer.muted && (viewer.role !== "visitor" || district.profile.visitor_comments_on);
  const asOptions = (me?.districts || []).filter((d) => d !== n);
  const zone = zoneOf(land.zone);
  const txCount = land.tx_count ?? txValues?.length ?? null;

  const act = async (path: string, method: string, body?: unknown) => {
    try {
      await api(path, { method, token, body });
      await Promise.all([loadDistrict(), loadPosts()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const actions: PostActions = {
    canReply,
    isOwner,
    asOptions,
    onPin: (p) => act(`/v1/districts/${n}/pin`, "PUT", { post_id: p.id }),
    onMute: (a) => confirm(t("在 {n}.bitmap 禁言 {who}？", { n, who: short(a) })) && act(`/v1/districts/${n}/mutes/${a}`, "PUT"),
  };
  const parcelOwner = (i: number) => land.parcels.find((p) => p.tx_index === i)?.owner?.address;

  return (
    <div className="page district">
      {district.profile.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="banner" src={district.profile.cover} alt="" referrerPolicy="no-referrer" />
      )}
      <section className="d-hero">
        <div className="d-info">
          <div className="crumbs">
            <span>{epochName(n)}</span>
            <span aria-hidden>·</span>
            <span>{t("区块 {n}", { n: n.toLocaleString("en-US") })}</span>
            {zone && (
              <>
                <span aria-hidden>·</span>
                <span className="zone-tag">
                  <i className="swatch" style={{ background: ZONES[zone].color }} />
                  {t(ZONES[zone].name)}
                  {LANDMARKS[n] && ` · ${t(LANDMARKS[n])}`}
                </span>
              </>
            )}
          </div>
          <div className="d-title-row">
            <h1 className="d-title mono">
              {n}
              <span className="dim">.bitmap</span>
            </h1>
            <div className="row tight">
              {n > 0 ? (
                <Link className="icon-btn" href={`/district/${n - 1}`} aria-label={t("上一个街区")}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </Link>
              ) : null}
              <Link className="icon-btn" href={`/district/${n + 1}`} aria-label={t("下一个街区")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </Link>
            </div>
          </div>
          <p className="lede">{district.profile.bio || (zone ? t(ZONES[zone].story) : "")}</p>
          <div className="stats">
            <div>
              <b className="mono">{txCount?.toLocaleString("en-US") ?? "—"}</b>
              <span>{t("地块")}</span>
            </div>
            <div>
              <b className="mono">{land.parcels.length.toLocaleString("en-US")}</b>
              <span>{t("已认领")}</span>
            </div>
            <div>
              <b className="mono">{district.followers.toLocaleString("en-US")}</b>
              <span>{t("关注")}</span>
            </div>
            <div>
              <b className="mono">{district.post_count.toLocaleString("en-US")}</b>
              <span>{t("帖子")}</span>
            </div>
          </div>
          <div className="owner-row">
            <Avatar seed={n} size={40} />
            <div className="grow">
              {land.claimed ? (
                <>
                  <div className="owner-name">
                    {t("拥有者")}
                    {district.owner_x && <XHandle username={district.owner_x.username} />}
                  </div>
                  <div className="mono muted small" title={district.owner || ""}>
                    {short(district.owner)}
                    {land.district && ` · ${t("铭文 #{n}", { n: land.district.inscription_number })}`}
                  </div>
                </>
              ) : (
                <>
                  <div>{t("还没有人认领")}</div>
                  <div className="muted small">{t("铭刻 {n}.bitmap 就能成为这里的主人。", { n })}</div>
                </>
              )}
            </div>
            {viewer && <RoleBadge role={viewer.role} parcel={viewer.parcel} />}
            {viewer?.muted && <span className="badge muted-badge">{t("你在这里被禁言了")}</span>}
          </div>
          {district.park && (
            <div className="park-banner">
              <span>{tn("属于园区 {name}", { name: <b>{district.park.name}</b> })}</span>
              <span className="muted small">
                {t("{n} 个街区 · 合计 {score} 分 · {level} 级", { n: district.park.members.length, score: district.park.score, level: district.park.level })}
              </span>
              <span className="chips">
                {district.park.members
                  .filter((m) => m !== n)
                  .map((m) => (
                    <Link key={m} href={`/district/${m}`} className="chip mono">
                      {m}
                    </Link>
                  ))}
              </span>
              <ShareMenu
                path={`/district/${n}`}
                text={parkText(district.park.name, district.park.members.length, district.park.level, viewer?.address === district.park.owner)}
                label={t("晒园区")}
                className="ghost sm"
              />
            </div>
          )}
          {district.prosperity && <ProsperityCard p={district.prosperity} zone={zone} n={n} park={district.park ?? null} look={district.profile.style ?? null} />}
          <div className="row">
            {token ? (
              <button
                type="button"
                className={viewer?.following ? "ghost lg" : "primary lg"}
                onClick={() => act(`/v1/districts/${n}/follow`, viewer?.following ? "DELETE" : "PUT")}
                aria-pressed={!!viewer?.following}
              >
                {viewer?.following ? t("已关注") : t("关注街区")}
              </button>
            ) : (
              <span className="muted small">{t("连接钱包后可以关注和回复。")}</span>
            )}
            {token && district.checked_in_today !== undefined && (
              <button
                type="button"
                className="ghost lg"
                disabled={district.checked_in_today}
                onClick={() => act(`/v1/districts/${n}/checkin`, "POST")}
              >
                {district.checked_in_today ? t("今天已签到") : t("签到")}
              </button>
            )}
            <ShareMenu path={`/district/${n}`} text={districtText(district, isOwner)} />
            {isOwner && (
              <button type="button" className="ghost lg" onClick={() => setEditing(!editing)} aria-expanded={editing}>
                {t("管理街区")}
              </button>
            )}
          </div>
        </div>

        <div className="d-art">
          {txValues ? (
            <Mondrian
              txValues={txValues}
              claimed={claimed}
              own={own}
              selected={selected}
              onSelect={setSelected}
              card={(i) => (
                <>
                  <div className="row between">
                    <b>{t("地块 #{n}", { n: i })}</b>
                    <span className="muted small">{claimed.has(i) ? t("已认领") : t("未认领")}</span>
                  </div>
                  {i === 0 && <div className="muted small">{t("coinbase，街区的市政厅")}</div>}
                  <div className="row between small">
                    <span className="muted">{t("交易金额")}</span>
                    <span className="mono">{btc(txValues[i])}</span>
                  </div>
                  {claimed.has(i) && (
                    <div className="row between small">
                      <span className="muted">{t("居民#one")}</span>
                      <span className="mono">{short(parcelOwner(i))}</span>
                    </div>
                  )}
                </>
              )}
            />
          ) : (
            <div className="mondrian-wrap placeholder" />
          )}
          <div className="legend">
            <span>
              <i className="swatch free" />
              {t("未认领")}
            </span>
            <span>
              <i className="swatch claimed" />
              {t("已认领")}
            </span>
            {own.size > 0 && (
              <span>
                <i className="swatch own" />
                {t("你的地块")}
              </span>
            )}
            <span className="grow" />
            <span>{t("方块大小 = 交易金额")}</span>
          </div>
        </div>
      </section>

      {isOwner && editing && (
        <OwnerTools
          n={n}
          district={district}
          land={land}
          zone={zone}
          held={me?.districts ?? []}
          token={token}
          txCount={txCount}
          onDone={loadDistrict}
          onUnpin={() => act(`/v1/districts/${n}/pin`, "DELETE")}
        />
      )}

      {around.length > 1 && (
        <section className="neighbors" aria-label={t("相邻街区")}>
          {around.map((t) => (
            <Link key={t.bitmap_number} href={`/district/${t.bitmap_number}`} className={`neighbor${t.bitmap_number === n ? " current" : ""}`} aria-current={t.bitmap_number === n ? "page" : undefined}>
              <TileThumb zone={zoneOf(t.zone)} n={t.bitmap_number} width={88} />
              <span className="mono small">{t.bitmap_number.toLocaleString("en-US")}</span>
            </Link>
          ))}
        </section>
      )}

      <nav className="tabs" aria-label={t("街区内容")}>
        {(
          [
            ["posts", t("动态")],
            ["polls", t("投票")],
            ["parcels", t("地块")],
            ["history", t("历史")],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? "active" : ""} aria-pressed={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>

      <div className="d-body">
        <div className="d-main">
          {tab === "posts" && (
            <>
              {canPost && (
                <Composer
                  district={n}
                  asOptions={asOptions}
                  speakingAs={isOwner ? t("街区主人身份") : viewer?.parcel != null ? t("地块 #{n} ", { n: viewer.parcel }) : undefined}
                  onPosted={(p) => setPosts([p, ...posts])}
                />
              )}
              {token && viewer?.role === "visitor" && (
                <p className="muted small hint">
                  {district.profile.visitor_comments_on ? t("访客可以回复帖子。持有这里的地块后就能发帖。") : t("街区主人关闭了访客回复。")}
                </p>
              )}
              {district.pinned_post && (
                <PostCard key={`pin${district.pinned_post.id}`} post={district.pinned_post} actions={actions} pinned onRemoved={() => loadDistrict()} />
              )}
              {posts.filter((p) => p.id !== district.pinned_post?.id).map((p) => (
                <PostCard key={p.id} post={p} actions={actions} onRemoved={(id) => setPosts(posts.filter((x) => x.id !== id))} />
              ))}
              {posts.length === 0 && !district.pinned_post && <p className="muted empty">{t("还没有帖子。")}</p>}
            </>
          )}
          {tab === "polls" && <Polls n={n} token={token} canVote={!!viewer && viewer.role !== "visitor"} isOwner={isOwner} />}
          {tab === "parcels" && <ParcelList land={land} txValues={txValues} own={own} onPick={(i) => setSelected(i)} />}
          {tab === "history" && (
            <ul className="events">
              {events.length === 0 && <li className="muted">{t("还没有认领或转手记录。")}</li>}
              {events.map((e) => (
                <EventItem key={e.id} event={e} />
              ))}
            </ul>
          )}
        </div>

        <aside className="d-side">
          {district.recruit && (
            <RecruitCard
              n={n}
              recruit={district.recruit}
              token={token}
              canApply={!!viewer && viewer.role === "visitor"}
              onPick={setSelected}
              onChanged={() => loadDistrict()}
            />
          )}
          <PetsCard pets={district.pets ?? []} />
          <section>
            <h2 className="section-title">{t("最近变动")}</h2>
            <ul className="events">
              {events.length === 0 && <li className="muted small">{t("还没有认领或转手记录。")}</li>}
              {events.slice(0, 4).map((e) => (
                <EventItem key={e.id} event={e} />
              ))}
            </ul>
            {events.length > 4 && (
              <button type="button" className="link-btn small" onClick={() => setTab("history")}>
                {t("查看全部历史")}
              </button>
            )}
          </section>
          {!district.recruit && land.claimed && txCount != null && txCount > land.parcels.length && (
            <section className="callout">
              <b>{t("认领这里的地块")}</b>
              <p className="muted small">
                {t("还有 {n} 个地块没人认领。街区主人可以把地块铭刻成子铭文分给居民，居民可以在这里发帖。", { n: (txCount - land.parcels.length).toLocaleString("en-US") })}
              </p>
            </section>
          )}
          {nearby.length > 0 && (
            <section>
              <h2 className="section-title">{t("附近在聊")}</h2>
              {nearby.map((p) => (
                <PostCard key={p.id} post={p} showDistrict />
              ))}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function ParcelList({ land, txValues, own, onPick }: { land: Land; txValues: number[] | null; own: Set<number>; onPick: (i: number) => void }) {
  if (land.parcels.length === 0) return <p className="muted empty">{t("还没有地块被认领。")}</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t("地块")}</th>
            <th>{t("居民")}</th>
            <th className="num">{t("交易金额")}</th>
            <th className="num">{t("铭文")}</th>
          </tr>
        </thead>
        <tbody>
          {land.parcels.map((p) => (
            <tr key={p.tx_index}>
              <td>
                <button type="button" className="link-btn" onClick={() => onPick(p.tx_index)}>
                  #{p.tx_index}
                </button>
                {own.has(p.tx_index) && <span className="badge resident">{t("你的")}</span>}
              </td>
              <td className="mono">{short(p.owner?.address)}</td>
              <td className="num mono">{txValues ? btc(txValues[p.tx_index]) : "—"}</td>
              <td className="num mono">#{p.inscription_number}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DistrictSkeleton({ n }: { n: number }) {
  return (
    <div className="page district" aria-busy="true">
      <section className="d-hero">
        <div className="d-info">
          <h1 className="d-title mono">
            {n}
            <span className="dim">.bitmap</span>
          </h1>
          <div className="skeleton line" />
          <div className="skeleton line short" />
        </div>
        <div className="d-art">
          <div className="mondrian-wrap placeholder" />
        </div>
      </section>
    </div>
  );
}
