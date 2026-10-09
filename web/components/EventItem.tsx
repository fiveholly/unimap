import Link from "next/link";

import { short } from "./Session";
import type { LandEvent } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export function EventItem({ event: e, showDistrict = false }: { event: LandEvent; showDistrict?: boolean }) {
  const what = e.tx_index == null ? `${e.bitmap_number}.bitmap` : `地块 #${e.tx_index}`;
  const where = showDistrict && e.tx_index != null ? `${e.bitmap_number}.bitmap 的` : "";
  const text =
    e.kind === "transfer"
      ? `${where}${what} 从 ${short(e.from_address)} 转给了 ${short(e.to_address)}`
      : `${where}${what} 被 ${short(e.to_address)} 认领`;
  return (
    <li className="event">
      <span className={`dot ${e.kind}`} aria-hidden />
      <span className="grow">{showDistrict ? <Link href={`/district/${e.bitmap_number}`}>{text}</Link> : text}</span>
      <span className="muted small nowrap" title={`区块 ${e.block_height}`}>
        {timeAgo(e.block_time)}
      </span>
    </li>
  );
}
