"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { Composer } from "@/components/Composer";
import { EventItem } from "@/components/EventItem";
import { Mondrian } from "@/components/Mondrian";
import { PostCard, RoleBadge, type PostActions } from "@/components/PostCard";
import { short, useSession } from "@/components/Session";
import { api, ApiError, type District, type Land, type LandEvent, type Me, type Post } from "@/lib/api";
import { btc, epochName, LANDMARKS } from "@/lib/format";

export default function DistrictPage() {
  return (
    <Suspense>
      <DistrictView />
    </Suspense>
  );
}

function DistrictView() {
  const params = useParams<{ n: string }>();
  const search = useSearchParams();
  const n = Number(params.n);
  const { token, address } = useSession();

  const [land, setLand] = useState<Land | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [txValues, setTxValues] = useState<number[] | null>(null);
  const [district, setDistrict] = useState<District | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [events, setEvents] = useState<LandEvent[]>([]);
  const [neighbors, setNeighbors] = useState<Post[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [selected, setSelected] = useState<number | null>(search.get("parcel") ? Number(search.get("parcel")) : null);
  const [error, setError] = useState<string | null>(null);

  const loadDistrict = useCallback(
    () => api<District>(`/v1/districts/${n}`, { token }).then(setDistrict),
    [n, token],
  );
  const loadPosts = useCallback(
    () => api<{ posts: Post[] }>(`/v1/districts/${n}/posts`, { token }).then((r) => setPosts(r.posts)),
    [n, token],
  );

  useEffect(() => {
    if (!Number.isInteger(n) || n < 0) return setNotFound(true);
    setError(null);
    api<Land>(`/v1/land/${n}`)
      .then(setLand)
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setNotFound(true) : setError(e.message)));
    api<{ tx_values: number[] }>(`/v1/land/${n}/txs`)
      .then((r) => setTxValues(r.tx_values))
      .catch(() => setTxValues(null));
    api<{ events: LandEvent[] }>(`/v1/land/${n}/events`).then((r) => setEvents(r.events)).catch(() => {});
    api<{ posts: Post[] }>(`/v1/districts/${n}/neighbors`).then((r) => setNeighbors(r.posts)).catch(() => {});
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

  const claimedParcels = useMemo(() => new Set(land?.parcels.map((p) => p.tx_index)), [land]);

  if (notFound) return <p className="muted">Block {params.n} hasn&apos;t been mined or indexed yet.</p>;
  if (error) return <p className="error">{error}</p>;
  if (!land || !district) return <p className="muted">Loading {n}.bitmap…</p>;

  const viewer = district.viewer;
  const isOwner = viewer?.role === "owner";
  const canPost = !!viewer && !viewer.muted && viewer.role !== "visitor";
  const canReply = !!viewer && !viewer.muted && (viewer.role !== "visitor" || district.profile.visitor_comments_on);
  const asOptions = (me?.districts || []).filter((d) => d !== n);

  const owner = async (path: string, method: string, body?: unknown) => {
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
    onPin: (p) => owner(`/v1/districts/${n}/pin`, "PUT", { post_id: p.id }),
    onMute: (a) => confirm(`Mute ${short(a)} in ${n}.bitmap?`) && owner(`/v1/districts/${n}/mutes/${a}`, "PUT"),
  };
  const parcel = selected != null ? land.parcels.find((p) => p.tx_index === selected) : undefined;

  return (
    <div className="district">
      {district.profile.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="banner" src={district.profile.cover} alt="" referrerPolicy="no-referrer" />
      )}
      <section className="district-head card">
        <div className="cover">
          {txValues ? (
            <Mondrian txValues={txValues} claimed={claimedParcels} selected={selected} onSelect={setSelected} />
          ) : (
            <div className="mondrian placeholder" />
          )}
        </div>
        <div className="district-info">
          <h1>{n}.bitmap</h1>
          <div className="chips">
            <span className="chip">{epochName(n)}</span>
            {LANDMARKS[n] && <span className="chip landmark">{LANDMARKS[n]}</span>}
            {land.tx_count != null && <span className="chip">{land.tx_count.toLocaleString()} transactions</span>}
            <span className="chip">{land.parcels.length} parcels claimed</span>
          </div>
          {land.claimed ? (
            <p>
              Owner <span className="mono" title={district.owner || ""}>{short(district.owner)}</span>
              {land.district && <span className="muted small"> · inscription #{land.district.inscription_number}</span>}
            </p>
          ) : (
            <p className="muted">Nobody has claimed this block yet. Inscribe {n}.bitmap to claim it.</p>
          )}
          {district.profile.bio && <p className="bio">{district.profile.bio}</p>}
          <div className="row">
            <span className="muted small">{district.followers} followers</span>
            {viewer && <RoleBadge role={viewer.role} parcel={viewer.parcel} />}
            {viewer?.muted && <span className="badge muted-badge">Muted here</span>}
            {token && (
              <button
                className={viewer?.following ? "ghost small" : "small"}
                onClick={() => owner(`/v1/districts/${n}/follow`, viewer?.following ? "DELETE" : "PUT")}
              >
                {viewer?.following ? "Following" : "Follow"}
              </button>
            )}
          </div>
          <ParcelPanel n={n} index={selected} parcel={parcel} value={selected != null ? txValues?.[selected] : undefined} />
        </div>
      </section>

      {isOwner && (
        <OwnerPanel district={district} onSave={(body) => owner(`/v1/districts/${n}/profile`, "PUT", body)} onUnpin={() => owner(`/v1/districts/${n}/pin`, "DELETE")} />
      )}

      <div className="columns">
        <div className="col-main">
          {district.pinned_post && (
            <div className="pinned">
              <p className="muted small">Pinned</p>
              <PostCard key={`pin${district.pinned_post.id}`} post={district.pinned_post} actions={actions} onRemoved={() => loadDistrict()} />
            </div>
          )}
          {canPost && <Composer district={n} asOptions={asOptions} onPosted={(p) => setPosts([p, ...posts])} />}
          {!token && land.claimed && <p className="muted card">Sign in to follow, like and reply.</p>}
          {token && viewer?.role === "visitor" && (
            <p className="muted small">
              {district.profile.visitor_comments_on
                ? "Visitors can reply to posts. Hold a parcel here to post."
                : "The owner has turned off visitor replies."}
            </p>
          )}
          {posts.length === 0 && <p className="muted">No posts yet.</p>}
          {posts.map((p) => (
            <PostCard key={p.id} post={p} actions={actions} onRemoved={(id) => setPosts(posts.filter((x) => x.id !== id))} />
          ))}
        </div>
        <aside className="col-side">
          <section className="card">
            <h2>Land activity</h2>
            {events.length === 0 && <p className="muted small">No claims or transfers recorded yet.</p>}
            <ul className="events">
              {events.map((e) => (
                <EventItem key={e.id} event={e} />
              ))}
            </ul>
          </section>
          <section className="card">
            <h2>Neighbors</h2>
            <div className="chips">
              {[-2, -1, 1, 2].map((d) =>
                n + d >= 0 ? (
                  <Link key={d} className="chip" href={`/district/${n + d}`}>
                    {n + d}
                  </Link>
                ) : null,
              )}
            </div>
            {neighbors.length === 0 && <p className="muted small">Quiet around here.</p>}
            {neighbors.map((p) => (
              <PostCard key={p.id} post={p} showDistrict />
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}

function ParcelPanel({ n, index, parcel, value }: { n: number; index: number | null; parcel?: Land["parcels"][number]; value?: number }) {
  if (index == null) return <p className="muted small">Click a square to see that parcel.</p>;
  return (
    <div className="parcel-panel">
      <strong>
        Parcel {index}.{n}.bitmap
      </strong>
      {index === 0 && <span className="muted small"> · coinbase, the town hall</span>}
      {value != null && <span className="muted small"> · {btc(value)}</span>}
      <p className="small">
        {parcel ? (
          <>
            Claimed by <span className="mono">{short(parcel.owner?.address)}</span> · inscription #{parcel.inscription_number}
          </>
        ) : (
          <span className="muted">Unclaimed. The district owner can inscribe {index}.{n}.bitmap as a child to split it off.</span>
        )}
      </p>
    </div>
  );
}

function OwnerPanel({
  district,
  onSave,
  onUnpin,
}: {
  district: District;
  onSave: (body: { bio: string; cover: string; visitor_comments_on: boolean }) => void;
  onUnpin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [bio, setBio] = useState(district.profile.bio);
  const [cover, setCover] = useState(district.profile.cover || "");
  const [visitors, setVisitors] = useState(district.profile.visitor_comments_on);
  return (
    <section className="card owner-panel">
      <div className="row">
        <h2 className="grow">Owner tools</h2>
        {district.profile.pinned_post_id && (
          <button className="ghost small" onClick={onUnpin}>
            Unpin
          </button>
        )}
        <button className="ghost small" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Edit page"}
        </button>
      </div>
      {open && (
        <div className="stack">
          <label>
            About this district
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={1000} name="bio" />
          </label>
          <label>
            Cover image link
            <input value={cover} onChange={(e) => setCover(e.target.value)} placeholder="https://…" name="cover" />
          </label>
          <label className="row">
            <input type="checkbox" checked={visitors} onChange={(e) => setVisitors(e.target.checked)} name="visitors" />
            Visitors can reply
          </label>
          <div className="row end">
            <button
              onClick={() => {
                onSave({ bio, cover, visitor_comments_on: visitors });
                setOpen(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
