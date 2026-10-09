// Zones come from the API (parcel_index/zones.py decides them); this file only names and colours them.

export type Zone = "landmark" | "cbd" | "commercial" | "data" | "villa" | "residential" | "mountain";

export const ZONE_ORDER: Zone[] = ["landmark", "cbd", "commercial", "data", "villa", "residential", "mountain"];

export const ZONES: Record<Zone, { name: string; color: string; basis: string; story: string }> = {
  landmark: {
    name: "地标",
    color: "#E8B04A",
    basis: "比特币历史上的重要区块",
    story: "比特币历史上的重要区块。地标在首页常驻推荐，帖子曝光更高。",
  },
  cbd: {
    name: "CBD",
    color: "#A7B8C6",
    basis: "本减半周期手续费前 1%",
    story: "手续费排在本减半周期最前面，高楼林立，是城市的商务核心。",
  },
  commercial: {
    name: "商业区",
    color: "#C2553D",
    basis: "本减半周期手续费前 1% 到 10%",
    story: "交易活跃的商业街，适合开店和办活动。",
  },
  data: {
    name: "数据区",
    color: "#7FD1E8",
    basis: "四成以上的交易带有铭文",
    story: "铭文集中的区块，像城市的数据中心。",
  },
  villa: {
    name: "别墅区",
    color: "#6DAA52",
    basis: "交易少，但每笔金额大",
    story: "交易很少但金额很大，地块宽敞，独栋别墅带泳池。",
  },
  residential: {
    name: "住宅区",
    color: "#E6DCC8",
    basis: "其余区块",
    story: "普通区块，安静的住宅街区。",
  },
  mountain: {
    name: "山地",
    color: "#867D6D",
    basis: "只有矿工的 coinbase 一笔交易",
    story: "整个区块只有矿工的一笔交易，是还没开发的山地。",
  },
};

// Keep in sync with LANDMARKS in parcel_index/zones.py.
export const LANDMARKS: Record<number, string> = {
  0: "创世块",
  57043: "披萨块",
  210000: "第一次减半",
  420000: "第二次减半",
  481824: "SegWit 激活",
  630000: "第三次减半",
  709632: "Taproot 激活",
  767430: "第一个铭文",
  840000: "第四次减半",
};

export function zoneOf(z: string | null | undefined): Zone | null {
  return z && z in ZONES ? (z as Zone) : null;
}
