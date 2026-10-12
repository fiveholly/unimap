import Link from "next/link";

import { short } from "./Session";
import type { LandEvent } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { t } from "@/lib/i18n";

export function EventItem({ event: e, showDistrict = false }: { event: LandEvent; showDistrict?: boolean }) {
  const what =
    e.tx_index == null
      ? `${e.bitmap_number}.bitmap`
      : showDistrict
        ? t("{n}.bitmap 的地块 #{i}", { n: e.bitmap_number, i: e.tx_index })
        : t("地块 #{n}", { n: e.tx_index });
  const text =
    e.kind === "transfer"
      ? t("{what} 从 {from} 转给了 {to}", { what, from: short(e.from_address), to: short(e.to_address) })
      : t("{what} 被 {to} 认领", { what, to: short(e.to_address) });
  return (
    <li className="event">
      <span className={`dot ${e.kind}`} aria-hidden />
      <span className="grow">{showDistrict ? <Link href={`/district/${e.bitmap_number}`}>{text}</Link> : text}</span>
      <span className="muted small nowrap" title={t("区块 {n}", { n: e.block_height })}>
        {timeAgo(e.block_time)}
      </span>
    </li>
  );
}
