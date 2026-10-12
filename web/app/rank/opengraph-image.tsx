import { api, type Ranking } from "@/lib/api";
import { C, Frame, render, siteName } from "@/lib/og";
import { LEVEL_NAMES, type Level } from "@/lib/prosperity";
import { SITE_URL } from "@/lib/share";
import { ZONES, zoneOf } from "@/lib/zones";

export { contentType, size } from "@/lib/og";
export const alt = "unimap 繁荣榜";
export const revalidate = 600;

export default async function Image() {
  const rows = (await api<{ rankings: Ranking[] }>("/v1/rankings").catch(() => null))?.rankings.slice(0, 5) ?? [];
  return render(
    <Frame site={siteName(SITE_URL)}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 20, marginTop: 12 }}>
        <span style={{ fontSize: 64, fontWeight: 700 }}>繁荣榜</span>
        <span style={{ fontSize: 26, color: C.fg3 }}>比特币城市里最热闹的街区</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 24 }}>
        {rows.map((r, i) => {
          const zone = zoneOf(r.zone);
          return (
            <div key={r.bitmap_number} style={{ display: "flex", alignItems: "center", gap: 24, height: 64, borderTop: i ? `1px solid ${C.line}` : "none" }}>
              <span style={{ width: 44, fontFamily: "Geist Mono", fontWeight: 700, fontSize: 34, color: i < 3 ? C.accent : C.fg3 }}>{i + 1}</span>
              <div style={{ width: 18, height: 18, borderRadius: 4, background: zone ? ZONES[zone].color : C.claimed }} />
              <span style={{ width: 330, fontFamily: "Geist Mono", fontWeight: 700, fontSize: 34 }}>{r.name}</span>
              <span style={{ width: 200, fontSize: 26, color: C.fg2 }}>{zone ? ZONES[zone].name : ""}</span>
              <span style={{ width: 200, fontSize: 26, color: C.fg2 }}>
                {r.level} 级 · {LEVEL_NAMES[r.level as Level]}
              </span>
              <span style={{ fontFamily: "Geist Mono", fontWeight: 700, fontSize: 30, marginLeft: "auto" }}>{r.score}</span>
            </div>
          );
        })}
      </div>
    </Frame>,
  );
}
