// Parks (园区): connected districts in one quarter of the map held by one address. Same rule
// as api/parks.py; the quarter size matches components/CityMap.tsx.

export const SIDE = 8;
export const PER_Q = SIDE * SIDE;

export function neighbours(n: number): number[] {
  const q = Math.floor(n / PER_Q), i = n % PER_Q, u = i % SIDE, v = Math.floor(i / SIDE);
  const out: number[] = [];
  for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
    if (u + du >= 0 && u + du < SIDE && v + dv >= 0 && v + dv < SIDE) out.push(q * PER_Q + (v + dv) * SIDE + u + du);
  return out;
}

/** The districts in `held` reachable from `start` edge to edge. */
export function reach(start: number, held: Set<number>): number[] {
  const seen = new Set<number>();
  const todo = [start];
  while (todo.length) {
    const n = todo.pop()!;
    if (seen.has(n) || !held.has(n)) continue;
    seen.add(n);
    todo.push(...neighbours(n));
  }
  return [...seen].sort((a, b) => a - b);
}

export const connected = (members: number[]) => members.length > 0 && reach(members[0], new Set(members)).length === new Set(members).size;
