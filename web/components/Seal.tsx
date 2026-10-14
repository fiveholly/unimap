import { useId } from "react";

import { sealLayout } from "@/lib/seal";

/** 印章: the district's red seal, stamped beside its title. A claimed district's seal is inked solid
 * with the numerals cut out (白文); an unclaimed one is only the outline and numerals (朱文), faint,
 * as if nobody has pressed it yet. Decorative: the title beside it already says the number. */
export function Seal({ n, size = 64, inked = true }: { n: number; size?: number; inked?: boolean }) {
  const s = sealLayout(n);
  const id = `seal${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      className={`seal${inked ? "" : " uninked"}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ transform: `rotate(${s.rotate}deg)` }}
      aria-hidden
    >
      <defs>
        {/* Rough the edges a little and let the ink take unevenly. */}
        <filter id={`${id}f`} x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed={s.noise} result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed={s.noise + 1} result="blot" />
          <feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.6 1.25" result="ink" />
          <feComposite in="rough" in2="ink" operator="in" />
        </filter>
        <mask id={`${id}m`}>
          <rect width="100" height="100" fill="#fff" />
          {inked && (
            <>
              <rect x="7" y="7" width="86" height="86" fill="none" stroke="#000" strokeWidth={1.6} />
              {s.glyphs.map((g, i) => (
                <text key={i} transform={`translate(${g.x} ${g.y}) scale(1 ${g.stretch})`} fontSize={g.size} className="seal-glyph" fill="#000" stroke="#000" strokeWidth={1.8} strokeLinejoin="round">
                  {g.ch}
                </text>
              ))}
              {s.specks.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={p.r} fill="#000" />
              ))}
            </>
          )}
        </mask>
      </defs>
      <g filter={`url(#${id}f)`}>
        {inked ? (
          <path d={s.outline} className="seal-ink" mask={`url(#${id}m)`} />
        ) : (
          <>
            <path d={s.outline} className="seal-line" />
            {s.glyphs.map((g, i) => (
              <text key={i} transform={`translate(${g.x} ${g.y}) scale(1 ${g.stretch})`} fontSize={g.size} className="seal-glyph seal-ink">
                {g.ch}
              </text>
            ))}
          </>
        )}
      </g>
    </svg>
  );
}
