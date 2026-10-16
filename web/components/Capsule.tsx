"use client";

import { barsDone } from "@/lib/capsule";
import { t } from "@/lib/i18n";

/** 火漆: the red wax seal on a sealed capsule, reading 封 and the block it was sealed on. */
export function WaxSeal({ height, size = 92 }: { height: number; size?: number }) {
  return (
    <svg className="cap-wax" width={size} height={size} viewBox="0 0 92 92" aria-hidden>
      <circle cx="46" cy="46" r="42" className="cap-wax-body" />
      <circle cx="46" cy="46" r="34" fill="none" className="cap-wax-ring" strokeWidth="1.4" />
      <text x="46" y="42" textAnchor="middle" className="cap-wax-char">
        封
      </text>
      <text x="46" y="60" textAnchor="middle" className="cap-wax-num">
        {height}
      </text>
    </svg>
  );
}

/** The sealed envelope: paper, its folds, the wax seal, who it is for and when it opens. */
export function Envelope({ height, recipient, opens }: { height: number; recipient: string; opens: string }) {
  return (
    <div className="cap-envelope" role="img" aria-label={t("封好的信封")}>
      <WaxSeal height={height} />
      <span className="cap-env-to">{t("给 {name}", { name: recipient })}</span>
      <span className="cap-env-open">
        {t("打开于")}
        <br />
        {t("{date} 之后的第一块", { date: opens })}
      </span>
    </div>
  );
}

/** The wait as a row of bars, the share already behind filled amber. */
export function WaitBars({ sealed, tip, left }: { sealed: number; tip: number; left: number }) {
  const n = 18, done = barsDone(sealed, tip, left, n);
  return (
    <div className="cap-bars" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < done ? "d" : ""} />
      ))}
    </div>
  );
}

/** The letter on paper, with a line of facts under it. */
export function LetterPaper({ text, meta }: { text: string; meta: React.ReactNode[] }) {
  return (
    <article className="cap-paper">
      <p>{text}</p>
      <div className="cap-paper-meta">
        {meta.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>
    </article>
  );
}

/** YYYY-MM-DD of an ISO time, in UTC. */
export const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);
/** YYYY-MM-DD HH:MM of an ISO time, in UTC. */
export const utcMinute = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ");
