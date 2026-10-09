// Pets on the map: what an owner chose to show of their wallet's holdings (api/holdings.py).
// Tiers start at the same amounts as there; keep the keys and tiers in step.

export type PetKey = "dog" | "cat";
export type Pet = { asset: PetKey; tier: number; amount: string };

export const PETS: Record<PetKey, { name: string; asset: string; kind: string; unit: string; tiers: [number, number, number]; looks: [string, string, string] }> = {
  dog: { name: "狗狗", asset: "DOG•GO•TO•THE•MOON", kind: "Rune", unit: "DOG", tiers: [1, 1_000_000, 100_000_000], looks: ["一只小狗", "一只大狗", "狗狗和狗窝"] },
  cat: { name: "猫咪", asset: "Quantum Cats", kind: "铭文系列", unit: "只", tiers: [1, 3, 10], looks: ["一只猫", "两只猫", "一群猫"] },
};
export const PET_KEYS = Object.keys(PETS) as PetKey[];

/** "dog:2" from a map tile, as [key, tier]; anything unknown is dropped. */
export function parsePets(tags: string[] | null | undefined): [PetKey, number][] {
  return (tags ?? []).flatMap((t) => {
    const [k, n] = t.split(":");
    return k in PETS && +n >= 1 ? [[k as PetKey, Math.min(3, +n)] as [PetKey, number]] : [];
  });
}

export const petsKey = (tags: string[] | null | undefined) => (tags ?? []).join(",");

export function amountText(key: PetKey, amount: string): string {
  const n = Number(amount);
  const s = n >= 1e8 ? `${(n / 1e8).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 亿` : n >= 1e4 ? `${(n / 1e4).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 万` : n.toLocaleString("zh-CN");
  return key === "cat" ? `${s} 只` : `${s} ${PETS[key].unit}`;
}

/** What the next tier needs, or null at the top. */
export function nextTier(key: PetKey, tier: number): number | null {
  return tier < 3 ? PETS[key].tiers[tier] : null;
}
