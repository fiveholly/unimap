import Link from "next/link";

import { short } from "./Session";
import type { LandEvent } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export function EventItem({ event: e, showDistrict = false }: { event: LandEvent; showDistrict?: boolean }) {
  const what = e.tx_index == null ? `${e.bitmap_number}.bitmap` : `parcel ${e.tx_index}.${e.bitmap_number}.bitmap`;
  const text =
    e.kind === "transfer"
      ? `${what} moved from ${short(e.from_address)} to ${short(e.to_address)}`
      : `${what} claimed by ${short(e.to_address)}`;
  return (
    <li className="event">
      <span className={`dot ${e.kind}`} aria-hidden />
      <span className="grow">
        {showDistrict ? <Link href={`/district/${e.bitmap_number}`}>{text}</Link> : text}
      </span>
      <span className="muted small" title={`block ${e.block_height}`}>
        {timeAgo(e.block_time)}
      </span>
    </li>
  );
}
