"use client";

import { useMemo } from "react";

import { layout } from "@/lib/mondrian";

/** The block's Mondrian picture; square i is transaction i, i.e. parcel i. */
export function Mondrian({
  txValues,
  claimed,
  selected,
  onSelect,
  size = 360,
}: {
  txValues: number[];
  claimed?: Set<number>;
  selected?: number | null;
  onSelect?: (txIndex: number) => void;
  size?: number;
}) {
  const { squares, width, height } = useMemo(() => layout(txValues), [txValues]);
  const extent = Math.max(width, height);
  const pad = 0.25;
  const dx = (extent - width) / 2; // center narrow layouts, like other Bitmap renderers
  return (
    <svg
      className="mondrian"
      viewBox={`0 0 ${extent} ${extent}`}
      width={size}
      height={size}
      role="img"
      aria-label={`Mondrian layout of ${txValues.length} transactions`}
    >
      {squares.map((q, i) => (
        <rect
          key={i}
          x={dx + q.x + pad / 2}
          y={q.y + pad / 2}
          width={q.r - pad}
          height={q.r - pad}
          className={`tx${claimed?.has(i) ? " claimed" : ""}${selected === i ? " selected" : ""}${i === 0 ? " coinbase" : ""}`}
          onClick={onSelect ? () => onSelect(i) : undefined}
        >
          <title>{i === 0 ? "Parcel 0 (coinbase)" : `Parcel ${i}`}</title>
        </rect>
      ))}
    </svg>
  );
}
