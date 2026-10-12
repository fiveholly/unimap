"use client";

import { useMemo, useState } from "react";

import { PetPicture } from "./Pets";
import { t } from "@/lib/i18n";
import { layout } from "@/lib/mondrian";
import { parsePets } from "@/lib/pets";

export type ParcelInfo = (index: number) => React.ReactNode;

/** The block's Mondrian picture; square i is transaction i, i.e. parcel i. */
export function Mondrian({
  txValues,
  claimed,
  own,
  selected,
  onSelect,
  card,
  pets,
}: {
  txValues: number[];
  claimed?: Set<number>;
  own?: Set<number>;
  selected?: number | null;
  onSelect?: (txIndex: number) => void;
  /** Contents of the floating card for the hovered (or selected) parcel. */
  card?: ParcelInfo;
  /** {tx_index: "dog:2"}: the pet each resident shows on their parcel. */
  pets?: Record<string, string>;
}) {
  const { squares, width, height } = useMemo(() => layout(txValues), [txValues]);
  const [hover, setHover] = useState<number | null>(null);
  const extent = Math.max(width, height);
  const pad = Math.min(0.25, extent / 400 + 0.08);
  const dx = (extent - width) / 2; // centre narrow layouts, like other Bitmap renderers
  const shown = hover ?? selected ?? null;
  // Squares big enough to read get a picture: grass on free land, a house on a claimed parcel,
  // the town hall on the coinbase. A resident's pet takes the place of their house.
  const minGlyph = extent / 36;
  const q = shown != null ? squares[shown] : null;
  let cardStyle: React.CSSProperties | undefined;
  if (q) {
    const right = (dx + q.x + q.r) / extent, left = (dx + q.x) / extent, top = q.y / extent;
    cardStyle = right < 0.6 ? { left: `calc(${right * 100}% + 10px)`, top: `${top * 100}%` } : { right: `calc(${(1 - left) * 100}% + 10px)`, top: `${top * 100}%` };
  }
  return (
    <div className="mondrian-wrap" onMouseLeave={() => setHover(null)}>
      <svg className="mondrian" viewBox={`0 0 ${extent} ${extent}`} role="img" aria-label={t("{n} 笔交易的 Mondrian 地块图", { n: txValues.length })}>
        {squares.map((sq, i) => (
          <rect
            key={i}
            x={dx + sq.x + pad / 2}
            y={sq.y + pad / 2}
            width={sq.r - pad}
            height={sq.r - pad}
            className={`tx${claimed?.has(i) ? " claimed" : ""}${own?.has(i) ? " own" : ""}${shown === i ? " shown" : ""}${i === 0 ? " coinbase" : ""}`}
            onMouseEnter={() => setHover(i)}
            onClick={onSelect ? () => onSelect(i) : undefined}
          />
        ))}
        {squares.map((sq, i) =>
          sq.r - pad < minGlyph || pets?.[i] ? null : (
            <Glyph key={`g${i}`} x={dx + sq.x + pad / 2} y={sq.y + pad / 2} r={sq.r - pad} kind={i === 0 ? "hall" : own?.has(i) ? "own" : claimed?.has(i) ? "house" : "grass"} />
          ),
        )}
      </svg>
      {pets &&
        Object.entries(pets).map(([k, tag]) => {
          const sq = squares[Number(k)];
          const pet = parsePets([tag])[0];
          if (!sq || !pet) return null;
          // A pet stands on its parcel, a little bigger than a small parcel so it can be seen.
          const size = Math.max((sq.r - pad) * 0.8, extent / 26);
          const cx = dx + sq.x + sq.r / 2, cy = sq.y + sq.r / 2;
          return (
            <div
              key={`p${k}`}
              className="parcel-pet"
              style={{ left: `${((cx - size / 2) / extent) * 100}%`, top: `${((cy - size / 2) / extent) * 100}%`, width: `${(size / extent) * 100}%` }}
            >
              <PetPicture asset={pet[0]} tier={pet[1]} size={48} />
            </div>
          );
        })}
      {q && card && shown != null && (
        <div className="parcel-card" style={cardStyle}>
          {card(shown)}
        </div>
      )}
    </div>
  );
}

/** A small picture inside a square r wide at (x, y); it lets clicks through to the square. */
function Glyph({ x, y, r, kind }: { x: number; y: number; r: number; kind: "grass" | "house" | "own" | "hall" }) {
  const k = r * 0.42;
  const tr = `translate(${x + (r - k) / 2} ${y + (r - k) / 2}) scale(${k})`;
  if (kind === "grass")
    return (
      <g className="glyph grass" transform={tr}>
        <path d="M0.22 0.86 L0.12 0.42 M0.36 0.86 L0.36 0.3 M0.5 0.86 L0.6 0.38 M0.66 0.86 L0.82 0.52 M0.8 0.86 L0.92 0.7" strokeWidth={0.07} />
      </g>
    );
  if (kind === "hall")
    return (
      <g className="glyph hall" transform={tr}>
        <path d="M0.05 0.32 L0.5 0.06 L0.95 0.32 Z M0.08 0.9 H0.92 V0.98 H0.08 Z M0.16 0.38 H0.28 V0.86 H0.16 Z M0.44 0.38 H0.56 V0.86 H0.44 Z M0.72 0.38 H0.84 V0.86 H0.72 Z" />
      </g>
    );
  return (
    <g className={`glyph house${kind === "own" ? " own" : ""}`} transform={tr}>
      <path d="M0.08 0.5 L0.5 0.12 L0.92 0.5 Z M0.2 0.5 H0.8 V0.92 H0.58 V0.68 H0.42 V0.92 H0.2 Z" />
    </g>
  );
}
