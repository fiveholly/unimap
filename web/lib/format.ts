import { locale, t } from "./i18n/index.ts";

export function timeAgo(seconds: number): string {
  const d = Math.max(0, Date.now() / 1000 - seconds);
  if (d < 60) return t("刚刚");
  if (d < 3600) return t("{n} 分钟前", { n: Math.floor(d / 60) });
  if (d < 86400) return t("{n} 小时前", { n: Math.floor(d / 3600) });
  if (d < 86400 * 30) return t("{n} 天前", { n: Math.floor(d / 86400) });
  return new Date(seconds * 1000).toLocaleDateString(locale());
}

export function btc(sats: number): string {
  return `${(sats / 1e8).toLocaleString("en-US", { maximumFractionDigits: 8 })} BTC`;
}

const EPOCHS = ["老城区", "第一纪元", "第二纪元", "第三纪元", "第四纪元", "第五纪元", "第六纪元"];

/** Halving epoch of a block: 210000 blocks each, epoch 0 being the old town. */
export function epochName(height: number): string {
  const epoch = Math.floor(height / 210000);
  return EPOCHS[epoch] ? t(EPOCHS[epoch]) : t("第 {n} 纪元", { n: epoch });
}

export function short(address: string | null | undefined): string {
  if (!address) return "—";
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}
