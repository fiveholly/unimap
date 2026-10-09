import { api, type District, type Land } from "@/lib/api";
import { epochName, short } from "@/lib/format";
import { C, Chip, Frame, mondrianUri, render, siteName } from "@/lib/og";
import { LEVEL_NAMES, type Level } from "@/lib/prosperity";
import { SITE_URL } from "@/lib/share";
import { LANDMARKS, ZONES, zoneOf } from "@/lib/zones";

export { contentType, size } from "@/lib/og";
export const alt = "unimap 街区卡片";
export const revalidate = 600;

export default async function Image({ params }: { params: Promise<{ n: string }> }) {
  const n = Number((await params).n);
  const [land, district, txs] = await Promise.all([
    api<Land>(`/v1/land/${n}`).catch(() => null),
    api<District>(`/v1/districts/${n}`).catch(() => null),
    api<{ tx_values: number[] }>(`/v1/land/${n}/txs`).catch(() => null),
  ]);
  const zone = zoneOf(land?.zone);
  const level = (district?.level ?? district?.prosperity?.level ?? null) as Level | null;
  const claimed = new Set((land?.parcels ?? []).map((p) => p.tx_index));
  const owner = district?.owner ?? land?.district?.owner?.address ?? null;
  const site = siteName(SITE_URL);
  const stats: [string, string][] = [
    ["地块", (land?.tx_count ?? txs?.tx_values.length ?? 0).toLocaleString("en-US")],
    ["已认领", claimed.size.toLocaleString("en-US")],
    ["关注", String(district?.followers ?? 0)],
    ["帖子", String(district?.post_count ?? 0)],
  ];
  return render(
    <Frame
      site={site}
      side={
        txs ? (
          <div style={{ display: "flex", padding: 20, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mondrianUri(txs.tx_values, claimed, zone ? ZONES[zone].color : C.claimed)} width={420} height={420} alt="" />
          </div>
        ) : undefined
      }
    >
      <div style={{ display: "flex", gap: 12, fontSize: 24, color: C.fg3 }}>
        <span>{epochName(n)}</span>
        <span>·</span>
        <span>区块 {n.toLocaleString("en-US")}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", marginTop: 8 }}>
        <span style={{ fontFamily: "Geist Mono", fontWeight: 700, fontSize: n >= 1e6 ? 76 : 88, letterSpacing: -2 }}>{n}</span>
        <span style={{ fontFamily: "Geist Mono", fontWeight: 700, fontSize: 48, color: C.fg3 }}>.bitmap</span>
      </div>
      {LANDMARKS[n] && <span style={{ fontSize: 34, fontWeight: 700, color: C.accent }}>{LANDMARKS[n]}</span>}
      <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
        {zone && <Chip color={ZONES[zone].color}>{ZONES[zone].name}</Chip>}
        {level && (
          <Chip color={C.accent}>
            {level} 级 · {LEVEL_NAMES[level]}
            {district?.prosperity ? ` · 繁荣度 ${district.prosperity.score}` : ""}
          </Chip>
        )}
        {district?.park && <Chip color={C.park}>园区「{district.park.name}」</Chip>}
      </div>
      <div style={{ display: "flex", gap: 40, marginTop: 28 }}>
        {stats.map(([k, v]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: "Geist Mono", fontWeight: 700, fontSize: 40 }}>{v}</span>
            <span style={{ fontSize: 22, color: C.fg3 }}>{k}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: 20, fontSize: 24, color: C.fg2 }}>
        {district?.recruit ? `正在招居民：${district.recruit.message.slice(0, 28)}` : owner ? `主人 ${short(owner)}` : "还没有人认领"}
      </div>
    </Frame>,
  );
}
