"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { BadgeList } from "@/components/Badge";
import { PostCard } from "@/components/PostCard";
import { useSession } from "@/components/Session";
import { ShareMenu } from "@/components/ShareMenu";
import { XHandle } from "@/components/X";
import { api, type Person, type Post } from "@/lib/api";
import { short } from "@/lib/format";
import { locale, t } from "@/lib/i18n";
import { LEVEL_NAMES, type Level } from "@/lib/prosperity";

/** Someone's page: the land an address holds, its X account and what it posted. */
export default function AddressPage() {
  const { a } = useParams<{ a: string }>();
  const address = decodeURIComponent(a);
  const { token, address: me } = useSession();
  const [person, setPerson] = useState<Person | null>(null);
  const [more, setMore] = useState<Post[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api<Person>(`/v1/people/${encodeURIComponent(address)}`, { token })
      .then((p) => {
        setPerson(p);
        setMore([]);
        setDone(p.posts.length < 20);
      })
      .catch((e) => setError(e.message));
  }, [address, token]);
  if (error) return <p className="page error">{error}</p>;
  if (!person) return <p className="page muted">{t("加载中…")}</p>;

  const posts = [...person.posts, ...more];
  const loadMore = async () => {
    const last = posts[posts.length - 1];
    const page = await api<Person>(`/v1/people/${encodeURIComponent(address)}?before_id=${last.id}`, { token });
    setMore((m) => [...m, ...page.posts]);
    if (page.posts.length < 20) setDone(true);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(person.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const who = person.x ? `@${person.x.username}` : short(person.address);
  const since = person.first_post_at ? new Date(person.first_post_at).toLocaleDateString(locale()) : null;

  return (
    <div className="page narrow person">
      <section className="me-head">
        <Avatar seed={person.address} size={56} />
        <div className="grow">
          <h1>{person.x ? person.x.name : short(person.address)}</h1>
          <div className="person-ids">
            {person.x && <XHandle username={person.x.username} />}
            <button type="button" className="link-btn mono small break" onClick={copy} title={t("复制地址")}>
              {person.address}
            </button>
            {copied && <span className="muted small">{t("已复制")}</span>}
          </div>
        </div>
        <ShareMenu
          path={`/address/${person.address}`}
          text={t("{who} 在 unimap 上的街区和帖子 #Bitmap", { who })}
          label={t("分享")}
          className="ghost sm"
        />
      </section>
      {me === person.address && (
        <p className="muted small">
          {t("这是你的主页，别人看到的就是这样。")} <Link href="/me">{t("管理我的土地")}</Link>
        </p>
      )}

      <div className="stats person-stats">
        <div>
          <b className="mono">{person.districts.length}</b>
          <span>{t("街区#count")}</span>
        </div>
        <div>
          <b className="mono">{person.parcels.length}</b>
          <span>{t("地块")}</span>
        </div>
        <div>
          <b className="mono">{person.post_count}</b>
          <span>{t("帖子")}</span>
        </div>
        <div>
          <b className="mono">{person.reply_count}</b>
          <span>{t("回复#count")}</span>
        </div>
      </div>

      {person.districts.length > 0 && (
        <section className="me-group">
          <h2 className="section-title">
            {t("街区")} <span className="mono">{person.districts.length}</span>
          </h2>
          <div className="chips">
            {person.districts.map((d) => (
              <Link key={d.bitmap_number} className="chip person-district" href={`/district/${d.bitmap_number}`}>
                <span className="mono">{d.bitmap_number}.bitmap</span>
                {d.level > 0 && <span className="muted small">{t(LEVEL_NAMES[d.level as Level])}</span>}
                {d.park && <span className="muted small">{t("园区「{name}」", { name: d.park })}</span>}
              </Link>
            ))}
          </div>
        </section>
      )}
      {person.parcels.length > 0 && (
        <section className="me-group">
          <h2 className="section-title">
            {t("地块")} <span className="mono">{person.parcels.length}</span>
          </h2>
          <div className="chips">
            {person.parcels.map((p) => (
              <Link key={`${p.bitmap_number}.${p.tx_index}`} className="chip mono" href={`/district/${p.bitmap_number}?parcel=${p.tx_index}`}>
                {p.bitmap_number}.bitmap #{p.tx_index}
              </Link>
            ))}
          </div>
        </section>
      )}
      {!!person.badges?.length && (
        <section className="me-group">
          <h2 className="section-title">
            {t("徽章")} <span className="mono">{person.badges.length}</span>
          </h2>
          <BadgeList badges={person.badges} />
        </section>
      )}

      <section className="me-group">
        <h2 className="section-title">{t("帖子和回复")}</h2>
        {since && <p className="muted small">{t("从 {date} 开始发帖", { date: since })}</p>}
        {posts.length === 0 ? (
          <p className="muted">{t("还没有发过帖子。")}</p>
        ) : (
          <div>
            {posts.map((p) => (
              <PostCard key={p.id} post={p} showDistrict />
            ))}
          </div>
        )}
        {!done && posts.length > 0 && (
          <button type="button" className="ghost" onClick={loadMore}>
            {t("更早的帖子")}
          </button>
        )}
      </section>
    </div>
  );
}
