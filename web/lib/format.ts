export function timeAgo(seconds: number): string {
  const d = Math.max(0, Date.now() / 1000 - seconds);
  if (d < 60) return "刚刚";
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} 天前`;
  return new Date(seconds * 1000).toLocaleDateString("zh-CN");
}

export function btc(sats: number): string {
  return `${(sats / 1e8).toLocaleString("en-US", { maximumFractionDigits: 8 })} BTC`;
}

const EPOCHS = ["老城区", "第一纪元", "第二纪元", "第三纪元", "第四纪元", "第五纪元", "第六纪元"];

/** Halving epoch of a block: 210000 blocks each, epoch 0 being the old town. */
export function epochName(height: number): string {
  const epoch = Math.floor(height / 210000);
  return EPOCHS[epoch] ?? `第 ${epoch} 纪元`;
}
