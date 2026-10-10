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
import { Contests } from "@/components/Contests";
import { AgentPanel } from "@/components/Agent";
import { BuyButton, SellCard } from "@/components/Market";
import { PostCard, RoleBadge, type PostActions } from "@/components/PostCard";
import { ProsperityCard } from "@/components/ProsperityCard";
import { RecruitCard } from "@/components/Recruit";
import { ShareMenu } from "@/components/ShareMenu";
import { short, useSession } from "@/components/Session";
import { TileThumb } from "@/components/TileThumb";
import { useTip } from "@/components/BlockWatch";
import { ClaimGuide, DistrictBeat } from "@/components/GameBits";
import { TipButton } from "@/components/Tip";
import { XHandle } from "@/components/X";
import { api, ApiError, type District, type Land, type LandEvent, type Me, type Post, type Sale, type Tile } from "@/lib/api";
import { btc, epochName, MARKETS, timeAgo } from "@/lib/format";
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

type Tab = "posts" | "polls" | "contests" | "agent" | "parcels" | "history";

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
  const [tipNote, setTipNote] = useState<string | null>(null);
  const [won, setWon] = useState<string | null>(null); // a badge the last check-in earned
  const { tip } = useTip();
  const [selected, setSelected] = useState<number | null>(search.get("parcel") ? Number(search.get("parcel")) : null);
  const [tab, setTab] = useState<Tab>(search.get("tab") === "contests" ? "contests" : search.get("tab") === "agent" ? "agent" : "posts");
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
  const checkIn = async () => {
    try {
      const r = await api<{ badges?: { kind: string }[] }>(`/v1/districts/${n}/checkin`, { method: "POST", token });
      if (r.badges?.some((b) => b.kind === "lucky_visit")) setWon(t("签到成功。今天这里是幸运街区，你得到一枚幸运来访徽章。"));
      await loadDistrict();
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
                    {district.owner ? <Link href={`/address/${district.owner}`}>{short(district.owner)}</Link> : short(district.owner)}
                    {land.district && ` · ${t("铭文 #{n}", { n: land.district.inscription_number })}`}
                  </div>
                  {(district.tips?.sats30 ?? 0) > 0 && (
                    <div className="muted small tip-line">
                      {t("近 30 天收到 {sats} 聪打赏，来自 {n} 人", { sats: district.tips!.sats30.toLocaleString("en-US"), n: district.tips!.tippers30 })}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>{t("还没有人认领")}</div>
                  <div className="muted small">{t("铭刻 {n}.bitmap 就能成为这里的主人。", { n })}</div>
                </>
              )}
            </div>
            {district.owner_tippable && district.owner && viewer?.address !== district.owner && (
              <TipButton target={{ bitmap_number: n }} to={`${n}.bitmap`} sats={0} token={token} className="sm" label={t("打赏主人")} onError={setTipNote} />
            )}
            {viewer && <RoleBadge role={viewer.role} parcel={viewer.parcel} />}
            {viewer?.muted && <span className="badge muted-badge">{t("你在这里被禁言了")}</span>}
          </div>
          {tipNote && <p className="muted small">{tipNote}</p>}
          {!land.claimed && <ClaimGuide n={n} fresh={tip != null && tip - n < 6} />}
          {district.game && <DistrictBeat n={n} game={district.game} token={token} onOpened={loadDistrict} />}
          {won && <p className="win-note small">{won}</p>}
          {land.district?.sale && <SaleBanner sale={land.district.sale} mine={!!viewer && viewer.address === district.owner} />}
          {isOwner && token && <SellCard n={n} token={token} />}
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
                onClick={checkIn}
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
            ["contests", t("活动")],
            ...(isOwner ? [["agent", t("助手")]] : []),
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
          {tab === "contests" && <Contests n={n} token={token} me={viewer?.address ?? null} isOwner={isOwner} />}
          {tab === "agent" && isOwner && token && <AgentPanel n={n} token={token} />}
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

/** 在售: the district is listed on a marketplace; its price and a link to the listing. */
function SaleBanner({ sale, mine }: { sale: Sale; mine: boolean }) {
  const market = MARKETS[sale.market] ?? sale.market;
  return (
    <div className="sale-banner">
      <span className="sale-tag">{t("在售")}</span>
      <b className="mono">{btc(sale.price_sats)}</b>
      <span className="muted small">
        {mine ? t("你在 {market} 挂单出售这个街区", { market }) : t("拥有者在 {market} 挂单出售", { market })}
        {sale.listed_at && ` · ${timeAgo(Date.parse(sale.listed_at) / 1000)}`}
      </span>
      <span className="grow" />
      {sale.market === "unimap" && sale.listing_id != null && !mine && <BuyButton listingId={sale.listing_id} price={sale.price_sats} />}
      {sale.url && (
        <a className="btn sm" href={sale.url} target="_blank" rel="noopener noreferrer">
          {t("去 {market} 看看", { market })} ↗
        </a>
      )}
    </div>
  );
}
