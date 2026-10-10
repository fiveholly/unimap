"use client";

import { useMemo, useState } from "react";

import { t } from "@/lib/i18n";
import { layout } from "@/lib/mondrian";

export type ParcelInfo = (index: number) => React.ReactNode;

/** The block's Mondrian picture; square i is transaction i, i.e. parcel i. */
export function Mondrian({
  txValues,
  claimed,
  own,
  selected,
  onSelect,
  card,
}: {
  txValues: number[];
  claimed?: Set<number>;
  own?: Set<number>;
  selected?: number | null;
  onSelect?: (txIndex: number) => void;
  /** Contents of the floating card for the hovered (or selected) parcel. */
  card?: ParcelInfo;
}) {
  const { squares, width, height } = useMemo(() => layout(txValues), [txValues]);
  const [hover, setHover] = useState<number | null>(null);
  const extent = Math.max(width, height);
  const pad = Math.min(0.25, extent / 400 + 0.08);
  const dx = (extent - width) / 2; // centre narrow layouts, like other Bitmap renderers
  const shown = hover ?? selected ?? null;
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
      </svg>
      {q && card && shown != null && (
        <div className="parcel-card" style={cardStyle}>
          {card(shown)}
        </div>
      )}
    </div>
  );
}
