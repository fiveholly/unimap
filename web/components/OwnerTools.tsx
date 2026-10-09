"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { short } from "@/components/Session";
import { TileThumb } from "@/components/TileThumb";
import { api, type Application, type District, type Land } from "@/lib/api";
import { connected, reach } from "@/lib/parks";
import { COLORS, DECOS, MAX_DECOS, type DistrictStyle } from "@/lib/style";
import type { Zone } from "@/lib/zones";

type Section = "profile" | "look" | "recruit" | "park";
const SECTIONS: [Section, string][] = [
  ["profile", "资料"],
  ["look", "外观"],
  ["recruit", "招募"],
  ["park", "园区"],
];

/** Everything a district owner can change, in one panel. */
export function OwnerTools({
  n,
  district,
  land,
  zone,
  held,
  token,
  txCount,
  onDone,
  onUnpin,
}: {
  n: number;
  district: District;
  land: Land;
  zone: Zone | null;
  held: number[];
  token: string | null;
  txCount: number | null;
  onDone: () => Promise<unknown>;
  onUnpin: () => void;
}) {
  const [section, setSection] = useState<Section>("profile");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async (path: string, method: string, body?: unknown) => {
    setError(null);
    setSaved(false);
    try {
      await api(path, { method, token, body });
      await onDone();
      setSaved(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  return (
    <section className="owner-panel">
      <div className="row between">
        <h2 className="section-title">管理街区</h2>
        <nav className="seg" aria-label="管理">
          {SECTIONS.map(([k, label]) => (
            <button key={k} type="button" className={section === k ? "active" : ""} aria-pressed={section === k} onClick={() => setSection(k)}>
              {label}
            </button>
          ))}
        </nav>
      </div>
      {section === "profile" && <Profile district={district} onSave={(b) => save(`/v1/districts/${n}/profile`, "PUT", b)} onUnpin={onUnpin} />}
      {section === "look" && <Look n={n} zone={zone} level={district.level ?? district.prosperity?.level ?? 1} current={district.profile.style ?? null} onSave={(b) => save(`/v1/districts/${n}/style`, "PUT", b)} />}
      {section === "recruit" && <RecruitForm n={n} district={district} land={land} token={token} txCount={txCount} save={save} />}
      {section === "park" && <ParkForm n={n} district={district} held={held} save={save} />}
      {error && <p className="error small">{error}</p>}
      {saved && !error && <p className="muted small">已保存。</p>}
    </section>
  );
}

function Profile({ district, onSave, onUnpin }: { district: District; onSave: (b: object) => void; onUnpin: () => void }) {
  const [bio, setBio] = useState(district.profile.bio);
  const [cover, setCover] = useState(district.profile.cover || "");
  const [visitors, setVisitors] = useState(district.profile.visitor_comments_on);
  return (
    <>
      <label>
        街区简介
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={1000} name="bio" />
      </label>
      <label>
        封面图片链接
        <input value={cover} onChange={(e) => setCover(e.target.value)} placeholder="https://…" name="cover" />
      </label>
      <label className="check">
        <input type="checkbox" checked={visitors} onChange={(e) => setVisitors(e.target.checked)} name="visitors" />
        允许访客回复
      </label>
      <div className="row end">
        {district.profile.pinned_post_id && (
          <button type="button" className="ghost" onClick={onUnpin}>
            取消置顶
          </button>
        )}
        <button type="button" className="primary" onClick={() => onSave({ bio, cover, visitor_comments_on: visitors })}>
          保存
        </button>
      </div>
    </>
  );
}

function Look({ n, zone, level, current, onSave }: { n: number; zone: Zone | null; level: number; current: DistrictStyle | null; onSave: (b: DistrictStyle) => void }) {
  const [color, setColor] = useState(current?.color ?? "orange");
  const [deco, setDeco] = useState<string[]>(current?.deco ?? []);
  const look = { color, deco };
  const toggle = (d: string) => setDeco(deco.includes(d) ? deco.filter((x) => x !== d) : deco.length < MAX_DECOS ? [...deco, d] : deco);
  return (
    <div className="look">
      <div className="look-preview">
        <TileThumb zone={zone} n={n} width={150} level={level} look={look} />
        <span className="muted small">现在 {level} 级，繁荣度越高解锁越多</span>
      </div>
      <div className="grow look-options">
        <div>
          <div className="muted small">主题色（旗帜、花和雕像的颜色）</div>
          <div className="chips">
            {Object.entries(COLORS).map(([k, c]) => {
              const locked = c.level > level;
              return (
                <button key={k} type="button" className={`swatch-btn${color === k ? " active" : ""}`} disabled={locked} aria-pressed={color === k} onClick={() => setColor(k)} title={locked ? `${c.level} 级解锁` : c.name}>
                  <i style={{ background: c.hex }} />
                  {c.name}
                  {locked && <span className="dim small">{c.level} 级</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="muted small">装饰，最多选 {MAX_DECOS} 个</div>
          <div className="chips">
            {Object.entries(DECOS).map(([k, d]) => {
              const locked = d.level > level;
              const on = deco.includes(k);
              return (
                <button key={k} type="button" className={`chip${on ? " active" : ""}`} disabled={locked || (!on && deco.length >= MAX_DECOS)} aria-pressed={on} onClick={() => toggle(k)}>
                  {d.name}
                  {locked && <span className="dim small"> {d.level} 级解锁</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="row end">
          <button type="button" className="primary" onClick={() => onSave(look)}>
            保存外观
          </button>
        </div>
      </div>
    </div>
  );
}

function RecruitForm({
  n,
  district,
  land,
  token,
  txCount,
  save,
}: {
  n: number;
  district: District;
  land: Land;
  token: string | null;
  txCount: number | null;
  save: (path: string, method: string, body?: unknown) => Promise<boolean>;
}) {
  const r = district.recruit;
  const [message, setMessage] = useState(r?.message ?? "欢迎新邻居！持有这里的地块就能在街区发帖。");
  const [plots, setPlots] = useState((r?.parcels ?? []).join(", "));
  const [apps, setApps] = useState<Application[] | null>(null);
  const claimed = useMemo(() => new Set(land.parcels.map((p) => p.tx_index)), [land]);
  const free = useMemo(() => {
    const out: number[] = [];
    for (let i = 1; txCount != null && i < txCount && out.length < 8; i++) if (!claimed.has(i)) out.push(i);
    return out;
  }, [claimed, txCount]);
  const parsed = plots
    .split(/[\s,，、]+/)
    .filter(Boolean)
    .map(Number);
  const bad = parsed.some((i) => !Number.isInteger(i) || i < 0 || (txCount != null && i >= txCount) || claimed.has(i));
  useEffect(() => {
    if (!r) return setApps(null);
    api<{ applications: Application[] }>(`/v1/districts/${n}/applications`, { token })
      .then((x) => setApps(x.applications))
      .catch(() => setApps([]));
  }, [n, token, r]);
  return (
    <>
      <label>
        招募说明
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={500} name="recruit-message" />
      </label>
      <label>
        开放的地块编号（用逗号隔开，可不填）
        <input value={plots} onChange={(e) => setPlots(e.target.value)} placeholder={free.length ? `例如 ${free.slice(0, 3).join(", ")}` : ""} name="recruit-plots" />
      </label>
      {free.length > 0 && (
        <div className="chips">
          <span className="muted small">还没人认领的：</span>
          {free.map((i) => (
            <button key={i} type="button" className="chip mono" onClick={() => setPlots(parsed.includes(i) ? plots : [...parsed, i].join(", "))}>
              #{i}
            </button>
          ))}
        </div>
      )}
      {bad && <p className="error small">有的编号不存在或已经被认领。</p>}
      <div className="row end">
        {r && (
          <button type="button" className="ghost" onClick={() => confirm("结束招募？申请记录会一起清掉。") && save(`/v1/districts/${n}/recruit`, "DELETE")}>
            结束招募
          </button>
        )}
        <button type="button" className="primary" disabled={!message.trim() || bad} onClick={() => save(`/v1/districts/${n}/recruit`, "PUT", { message, parcels: parsed })}>
          {r ? "更新招募" : "发布招募"}
        </button>
      </div>
      {r && (
        <div>
          <h3 className="section-title">申请（{apps?.length ?? r.applications}）</h3>
          {apps?.length === 0 && <p className="muted small">还没有人申请。</p>}
          <ul className="applications">
            {apps?.map((a) => (
              <li key={a.address}>
                <span className="mono" title={a.address}>
                  {short(a.address)}
                </span>
                <span className="grow">{a.note || <span className="dim">没有留言</span>}</span>
                <span className="dim small">{new Date(a.created_at).toLocaleDateString("zh-CN")}</span>
              </li>
            ))}
          </ul>
          <p className="dim small">选好人后，把地块铭刻成 {n}.bitmap 的子铭文转到对方地址，链上确认后对方就是居民了。</p>
        </div>
      )}
    </>
  );
}

function ParkForm({ n, district, held, save }: { n: number; district: District; held: number[]; save: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const park = district.park;
  const near = useMemo(() => reach(n, new Set([...held, n])), [held, n]);
  const [name, setName] = useState(park?.name ?? `${n} 园区`);
  const [members, setMembers] = useState<number[]>(park?.members ?? near);
  const ok = name.trim() && members.length >= 2 && members.includes(n) && connected(members);
  const toggle = (m: number) => setMembers(members.includes(m) ? members.filter((x) => x !== m) : [...members, m].sort((a, b) => a - b));
  if (!park && near.length < 2)
    return <p className="muted">你在这附近只有这一个街区。持有边挨着边或隔着马路相对的街区后，可以把它们连成一个园区，分数合并计算、一起升级。</p>;
  return (
    <>
      <p className="muted small">园区里的街区分数合起来算，一起升级，地图上铺成一整片并显示园区名。街区卖掉后会自动退出园区。</p>
      <label>
        园区名
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} name="park-name" />
      </label>
      <div className="chips">
        {[...new Set([...near, ...(park?.members ?? [])])].sort((a, b) => a - b).map((m) => (
          <label key={m} className="check chip">
            <input type="checkbox" checked={members.includes(m)} disabled={m === n} onChange={() => toggle(m)} />
            <Link href={`/district/${m}`} className="mono">
              {m}
            </Link>
          </label>
        ))}
      </div>
      {!connected(members) && <p className="error small">园区里的街区要连成一片。</p>}
      <div className="row end">
        {park && (
          <button type="button" className="ghost" onClick={() => confirm(`解散「${park.name}」？`) && save(`/v1/parks/${park.id}`, "DELETE")}>
            解散园区
          </button>
        )}
        <button type="button" className="primary" disabled={!ok} onClick={() => save(park ? `/v1/parks/${park.id}` : "/v1/parks", park ? "PUT" : "POST", { name, members })}>
          {park ? "保存园区" : "建立园区"}
        </button>
      </div>
    </>
  );
}
