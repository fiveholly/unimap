import Link from "next/link";

import type { Badge, WornBadge } from "@/lib/api";
import { BADGE_NAMES, RARITY_COLORS, RARITY_NAMES, type BadgeKind, type Rarity } from "@/lib/game";
import { t } from "@/lib/i18n";

const LUCKY_GOLD = "#F2B544";

/** A badge's medal: a chest for a treasure, a star for a lucky round, a flag for a visit, a crown for a season's podium, a pin for a day's tour, an awning for opening a district, ringed in its rarity's colour. */
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
        ) : kind === "crown" ? (
          <path d="M8.5 21.5h15l1.5-10-5 4-4-7-4 7-5-4z" />
        ) : kind === "tour" ? (
          <>
            <path d="M16 24s-6-6.2-6-10.5a6 6 0 0 1 12 0C22 17.8 16 24 16 24z" />
            <circle cx="16" cy="13.5" r="2" />
          </>
        ) : kind === "opening" ? (
          <>
            <path d="M9 13.5 10.5 9h11l1.5 4.5z" />
            <path d="M10 13.5V23h12v-9.5" />
            <path d="M14 23v-5h4v5" />
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

/** The badge someone wears, beside their name. */
export function WornBadgeMark({ badge, size = 18 }: { badge: WornBadge; size?: number }) {
  const name = `${t(RARITY_NAMES[badge.rarity])} ${t(BADGE_NAMES[badge.kind])}`;
  return (
    <span className="worn-badge" title={name} aria-label={name}>
      <BadgeIcon kind={badge.kind} rarity={badge.rarity} size={size} />
    </span>
  );
}

/** 徽章: what someone won in 区块节拍, newest first. With onWear, each can be worn beside your name. */
export function BadgeList({ badges, onWear }: { badges: Badge[]; onWear?: (id: number | null) => void }) {
  return (
    <ul className="badge-list">
      {badges.map((b) => (
        <li key={`${b.kind}:${b.height}`} className={b.worn ? "worn" : ""} title={`${t(BADGE_NAMES[b.kind])} · ${t(RARITY_NAMES[b.rarity])}`}>
          <BadgeIcon kind={b.kind} rarity={b.rarity} size={36} />
          <span className="small">
            <b style={{ color: RARITY_COLORS[b.rarity] }}>{t(RARITY_NAMES[b.rarity])}</b> {t(BADGE_NAMES[b.kind])}
            <Link className="mono muted block" href={`/district/${b.bitmap_number}`}>
              {b.bitmap_number}.bitmap{b.tx_index != null ? ` #${b.tx_index}` : ""}
            </Link>
            <span className="mono dim block">
              {b.kind === "tour" || b.kind === "opening" ? new Date(b.kind === "tour" ? b.height * 86_400_000 : b.created_at).toISOString().slice(0, 10) : t("区块 {n}", { n: b.height.toLocaleString("en-US") })}
            </span>
            {onWear && b.id != null && (
              <button type="button" className="link-btn small" aria-pressed={!!b.worn} onClick={() => onWear(b.worn ? null : b.id!)}>
                {b.worn ? t("取下") : t("佩戴")}
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
