import { rng } from "@/lib/iso";

const TONES = ["#7D6C50", "#57534B", "#A8A397", "#3A3833"];

/** A small Mondrian-like mark for a district or address, so authors are recognisable at a glance. */
export function Avatar({ seed, size = 36 }: { seed: string | number; size?: number }) {
  let h = 0;
  for (const ch of String(seed)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  const r = rng(h);
  // A 4x4 grid filled greedily with 1x1 and 2x2 squares.
  const used: boolean[] = Array(16).fill(false);
  const squares: { x: number; y: number; s: number; fill: string }[] = [];
  for (let i = 0; i < 16; i++) {
    if (used[i]) continue;
    const x = i % 4, y = Math.floor(i / 4);
    const big = x < 3 && y < 3 && !used[i + 1] && !used[i + 4] && !used[i + 5] && r() < 0.35;
    const s = big ? 2 : 1;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) used[i + dx + dy * 4] = true;
    squares.push({ x, y, s, fill: squares.length === 0 ? "#F7931A" : TONES[Math.floor(r() * TONES.length)] });
  }
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 4 4" aria-hidden>
      {squares.map((q, i) => (
        <rect key={i} x={q.x + 0.06} y={q.y + 0.06} width={q.s - 0.12} height={q.s - 0.12} fill={q.fill} />
      ))}
    </svg>
  );
}
