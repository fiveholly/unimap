// A district's look on the map: a colour and up to MAX_DECOS decorations, each unlocked at a
// prosperity level. Mirrors api/style.py; keep the keys and levels in step.

export type DistrictStyle = { color: string; deco: string[] };

export const COLORS: Record<string, { name: string; hex: string; level: number }> = {
  orange: { name: "橙", hex: "#F7931A", level: 1 },
  red: { name: "红", hex: "#D9483B", level: 1 },
  blue: { name: "蓝", hex: "#3E7FD9", level: 1 },
  green: { name: "绿", hex: "#3FA35B", level: 1 },
  purple: { name: "紫", hex: "#8E5BD0", level: 3 },
  gold: { name: "金", hex: "#E8B04A", level: 5 },
};
export const DECOS: Record<string, { name: string; level: number }> = {
  flag: { name: "旗帜", level: 1 },
  flowers: { name: "花坛", level: 2 },
  lamps: { name: "路灯", level: 3 },
  fountain: { name: "喷泉", level: 4 },
  statue: { name: "雕像", level: 5 },
};
export const MAX_DECOS = 3;

export const styleKey = (s: DistrictStyle | null | undefined) => (s ? `${s.color}/${s.deco.join(",")}` : "");

/** What of a saved style shows at this level (decorations above it stay hidden), as the API does. */
export function visibleStyle(style: DistrictStyle | null | undefined, level: number): DistrictStyle | null {
  if (!style) return null;
  return {
    color: (COLORS[style.color]?.level ?? 99) <= level ? style.color : "orange",
    deco: style.deco.filter((d) => (DECOS[d]?.level ?? 99) <= level),
  };
}
