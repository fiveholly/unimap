import { C, Frame, render, siteName } from "@/lib/og";
import { SITE_URL } from "@/lib/share";
import { ZONE_ORDER, ZONES } from "@/lib/zones";

export { contentType, size } from "@/lib/og";
export const alt = "unimap：比特币上的 Bitmap 城市";

// A quarter of the city as a mosaic of zone colours, the same every time.
function Mosaic() {
  const cells = [];
  let x = 7;
  for (let i = 0; i < 64; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const r = x / 0x7fffffff;
    const zone = r < 0.03 ? "landmark" : r < 0.1 ? "cbd" : r < 0.24 ? "commercial" : r < 0.38 ? "data" : r < 0.5 ? "villa" : r < 0.9 ? "residential" : "mountain";
    cells.push(<div key={i} style={{ width: 50, height: 50, borderRadius: 6, background: ZONES[zone].color, opacity: 0.35 + (x % 7) / 10 }} />);
  }
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 6, width: 442 }}>{cells}</div>;
}

export default async function Image() {
  return render(
    <Frame site={siteName(SITE_URL)} side={<Mosaic />}>
      <span style={{ fontSize: 54, fontWeight: 700, lineHeight: 1.3 }}>比特币的每一个区块，</span>
      <span style={{ fontSize: 54, fontWeight: 700, lineHeight: 1.3 }}>都是城市里的一个街区</span>
      <span style={{ fontSize: 28, color: C.fg2, marginTop: 24, lineHeight: 1.5 }}>
        持有 Bitmap 街区就能经营它的社区，持有地块就是这里的居民。逛逛、关注、回复，看看你出生那天的区块。
      </span>
      <div style={{ display: "flex", gap: 16, marginTop: 32, flexWrap: "wrap" }}>
        {ZONE_ORDER.map((z) => (
          <div key={z} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 22, color: C.fg3 }}>
            <div style={{ width: 14, height: 14, borderRadius: 3, background: ZONES[z].color }} />
            {ZONES[z].name}
          </div>
        ))}
      </div>
    </Frame>,
  );
}
