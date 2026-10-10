import Link from "next/link";

import type { Badge } from "@/lib/api";
import { BADGE_NAMES, RARITY_COLORS, RARITY_NAMES, type BadgeKind, type Rarity } from "@/lib/game";
import { t } from "@/lib/i18n";

const LUCKY_GOLD = "#F2B544";

/** A badge's medal: a chest for a treasure, a star for a lucky round, a flag for a visit, ringed in its rarity's colour. */
export function BadgeIcon({ kind, rarity, size = 32 }: { kind: BadgeKind; rarity: Rarity; size?: number }) {
  const c = kind === "lucky" ? LUCKY_GOLD : RARITY_COLORS[rarity];
  return (
    <svg className="badge-icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="14.5" fill="#1d1b17" stroke={c} strokeWidth="2" />
      {rarity === "legendary" && <circle cx="16" cy="16" r="11.5" fill="none" stroke={c} strokeWidth="0.8" strokeDasharray="2 2" />}
      <g fill="none" stroke={c} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round">
        {kind === "treasure" ? (
          <>
            <path d="M9 14.5h14v8H9z" />
            <path d="M9 14.5c0-3 2.5-4.5 7-4.5s7 1.5 7 4.5" />
            <path d="M15 14.5v3h2v-3" />
          </>
        ) : kind === "lucky" ? (
          <path d="m16 8.5 2.3 4.8 5.2.7-3.8 3.6.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z" />
        ) : (
          <>
            <path d="M11 23V9" />
            <path d="M11 9.5h10l-2.5 3.5 2.5 3.5H11" />
          </>
        )}
      </g>
    </svg>
  );
}

/** 徽章: what someone won in 区块节拍, newest first. */
export function BadgeList({ badges }: { badges: Badge[] }) {
  return (
    <ul className="badge-list">
      {badges.map((b) => (
        <li key={`${b.kind}:${b.height}`} title={`${t(BADGE_NAMES[b.kind])} · ${t(RARITY_NAMES[b.rarity])}`}>
          <BadgeIcon kind={b.kind} rarity={b.rarity} size={36} />
          <span className="small">
            <b style={{ color: RARITY_COLORS[b.rarity] }}>{t(RARITY_NAMES[b.rarity])}</b> {t(BADGE_NAMES[b.kind])}
            <Link className="mono muted block" href={`/district/${b.bitmap_number}`}>
              {b.bitmap_number}.bitmap{b.tx_index != null ? ` #${b.tx_index}` : ""}
            </Link>
            <span className="mono dim block">{t("区块 {n}", { n: b.height.toLocaleString("en-US") })}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
