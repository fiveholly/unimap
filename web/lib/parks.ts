// Parks (园区): districts held by one address that touch edge to edge or face each other
// across a street. Same rule as api/parks.py; the layout matches components/CityMap.tsx.

export const SIDE = 8;
export const PER_Q = SIDE * SIDE;
export const QUARTERS = 24;

/** The block next to n one step along u or v, across the street when n is on its quarter's
 * edge; null past the edge of the map. */
export function side(n: number, du: number, dv: number): number | null {
  const q = Math.floor(n / PER_Q), i = n % PER_Q;
  let u = (i % SIDE) + du, v = Math.floor(i / SIDE) + dv;
  if (u >= 0 && u < SIDE && v >= 0 && v < SIDE) return q * PER_Q + v * SIDE + u;
  let qr = Math.floor(q / QUARTERS), qc = q % QUARTERS;
  // Odd rows sit half a quarter to the right: +u is down-right, +v is down-left.
  if (u === SIDE) [qc, qr, u] = [qc + (qr & 1), qr + 1, 0];
  else if (u < 0) [qc, qr, u] = [qc - ((qr - 1) & 1), qr - 1, SIDE - 1];
  else if (v === SIDE) [qc, qr, v] = [qc - (1 - (qr & 1)), qr + 1, 0];
  else [qc, qr, v] = [qc + (1 - ((qr - 1) & 1)), qr - 1, SIDE - 1];
  if (qr < 0 || qc < 0 || qc >= QUARTERS) return null;
  return (qr * QUARTERS + qc) * PER_Q + v * SIDE + u;
}

export function neighbours(n: number): number[] {
  const out: number[] = [];
  for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const m = side(n, du, dv);
    if (m !== null) out.push(m);
  }
  return out;
}

/** The districts in `held` reachable from `start` edge to edge or across a street. */
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
