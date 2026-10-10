// Prosperity: how lively a district is, which decides how built-up it looks on the map.
//
// The zone (mountain, residential, CBD, ...) comes from the chain and never changes. Prosperity
// grows with what people do there and falls back when they stop, because everything but
// residents and followers counts only the last 30 days. api/prosperity.py computes the same
// score on the server; keep the two in step.

export type ProsperityParts = {
  residents: number; // claimed parcels
  posts30: number; // top-level posts, last 30 days
  replies30: number; // replies, last 30 days
  followers: number;
  checkins30: number; // visitor check-ins, last 30 days
  neighbors30: number; // posts in the 5 districts on each side, last 30 days
  tippers30: number; // people who tipped sats here, last 30 days
};

export type Prosperity = { score: number; level: Level; parts: ProsperityParts; next: number | null };
export type Level = 1 | 2 | 3 | 4 | 5;

export const WEIGHTS: Record<keyof ProsperityParts, number> = {
  residents: 3,
  posts30: 4,
  replies30: 1.5,
  followers: 0.5,
  checkins30: 1,
  neighbors30: 0.3,
  tippers30: 2,
};
export const PART_NAMES: Record<keyof ProsperityParts, string> = {
  residents: "居民",
  posts30: "近 30 天帖子",
  replies30: "近 30 天回复",
  followers: "关注",
  checkins30: "近 30 天签到",
  neighbors30: "邻居的热闹",
  tippers30: "近 30 天打赏的人",
};

/** Score needed for each level; level 1 is where every district starts. */
export const THRESHOLDS = [0, 25, 80, 200, 450] as const;
export const LEVEL_NAMES: Record<Level, string> = { 1: "荒地", 2: "村落", 3: "小镇", 4: "城区", 5: "繁华" };

export function prosperity(parts: ProsperityParts): Prosperity {
  const score = Math.round((Object.keys(WEIGHTS) as (keyof ProsperityParts)[]).reduce((s, k) => s + parts[k] * WEIGHTS[k], 0));
  let level = 1;
  while (level < 5 && score >= THRESHOLDS[level]) level++;
  return { score, level: level as Level, parts, next: level < 5 ? THRESHOLDS[level] : null };
}

/** How each zone looks as it grows, for the district page. */
export const GROWTH: Record<string, [string, string, string, string, string]> = {
  residential: ["一片草地", "几间小屋", "成排的住宅", "公寓楼", "高层住宅区"],
  villa: ["空着的草坪", "带花园的小屋", "别墅", "带泳池的大宅", "庄园"],
  commercial: ["几个摊位", "街边小店", "商业街", "商场", "购物中心和写字楼"],
  cbd: ["工地", "几栋写字楼", "办公区", "高楼群", "摩天楼天际线"],
  data: ["一个机柜棚", "机房", "数据中心", "大型数据中心", "超算园区"],
  mountain: ["荒山", "山间小屋", "山村", "缆车和山村", "山地度假区"],
  landmark: ["纪念碑", "纪念碑", "纪念广场", "纪念广场", "城市地标"],
};
