// The words a newcomer meets first, each with one line of explanation (components/Term.tsx).
// The Chinese is the key for t(); English is in lib/i18n/en/onboarding.ts.

export const TERMS = {
  bitmap: { name: "街区 / Bitmap", text: "比特币的每个区块都是一个街区；持有那个区块的 Bitmap 铭文，你就是街区主人。" },
  parcel: { name: "地块 / 居民", text: "区块里的每笔交易是一个地块；持有地块，你就是那个街区的居民。" },
  epoch: { name: "纪元", text: "每次比特币减半是一个纪元，地图上一块大陆。" },
  prosperity: { name: "繁荣度", text: "签到、发帖、居民越多，街区越繁荣，地图上的楼越高。" },
  beat: { name: "区块节拍 / 巡城", text: "每出一个新块抽一次幸运街区；每天给三个街区，都去签到就得到巡城徽章。" },
} as const;
export type TermKey = keyof typeof TERMS;

/** How far to move a popup sideways so [left, right] stays inside [margin, viewport - margin]. */
export function shiftInto(left: number, right: number, viewport: number, margin = 12): number {
  if (right - left > viewport - 2 * margin) return margin - left; // wider than the room: pin to the left edge
  if (right > viewport - margin) return viewport - margin - right;
  if (left < margin) return margin - left;
  return 0;
}
