// Pets on the map: what an owner chose to show of their wallet's holdings (api/holdings.py).
// Tiers start at the same amounts as there; keep the keys and tiers in step.

import { lang } from "./i18n/index.ts";

export type PetKey = "dog" | "cat" | "puppet" | "monkey" | "frog" | "runestone";
export type Pet = { asset: PetKey; tier: number; amount: string };

export const PETS: Record<PetKey, { name: string; asset: string; kind: string; unit: string; tiers: [number, number, number]; looks: [string, string, string] }> = {
  dog: { name: "狗狗", asset: "DOG•GO•TO•THE•MOON", kind: "Rune", unit: "DOG", tiers: [1, 1_000_000, 100_000_000], looks: ["一只小狗", "一只大狗", "狗狗和狗窝"] },
  cat: { name: "猫咪", asset: "Quantum Cats", kind: "铭文系列", unit: "只", tiers: [1, 3, 10], looks: ["一只猫", "两只猫", "一群猫"] },
  puppet: { name: "木偶", asset: "Bitcoin Puppets", kind: "铭文系列", unit: "个", tiers: [1, 3, 10], looks: ["一个提线木偶", "两个木偶", "木偶戏台"] },
  monkey: { name: "猴子", asset: "NodeMonkes", kind: "铭文系列", unit: "只", tiers: [1, 3, 10], looks: ["一只猴子", "两只猴子", "猴子和椰子树"] },
  frog: { name: "青蛙", asset: "Bitcoin Frogs", kind: "铭文系列", unit: "只", tiers: [1, 5, 20], looks: ["一只青蛙", "青蛙和池塘", "一池青蛙"] },
  runestone: { name: "符文石", asset: "Runestone", kind: "铭文", unit: "块", tiers: [1, 3, 10], looks: ["一块符文石", "一块大符文石", "一圈符文石"] },
};
/** Pets one district can show at once (api/holdings.py MAX_SHOWN). */
export const MAX_SHOWN = 3;
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
  const pet = PETS[key];
  // English has no 万/亿 and no counter words: compact numbers, and the collection's own name as the unit.
  if (lang() === "en") return `${n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })} ${pet.kind === "Rune" ? pet.unit : pet.asset}`;
  const s = n >= 1e8 ? `${(n / 1e8).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 亿` : n >= 1e4 ? `${(n / 1e4).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 万` : n.toLocaleString("zh-CN");
  return `${s} ${pet.unit}`;
}

/** What the next tier needs, or null at the top. */
export function nextTier(key: PetKey, tier: number): number | null {
  return tier < 3 ? PETS[key].tiers[tier] : null;
}
