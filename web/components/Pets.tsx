"use client";

import { useEffect, useRef } from "react";

import { drawShapes, petShapes, shapesBounds } from "@/lib/iso";
import { t } from "@/lib/i18n";
import { amountText, PETS, type Pet, type PetKey } from "@/lib/pets";

/** The pets of one asset and tier, drawn as on the map. */
export function PetPicture({ asset, tier, size = 64 }: { asset: PetKey; tier: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = cv.height = Math.round(size * dpr);
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const shapes = petShapes(asset, Math.max(1, tier));
    const [x0, y0, x1, y1] = shapesBounds(shapes);
    const k = (cv.width * 0.86) / Math.max(x1 - x0, y1 - y0);
    ctx.setTransform(k, 0, 0, k, cv.width / 2 - ((x0 + x1) / 2) * k, cv.height / 2 - ((y0 + y1) / 2) * k);
    drawShapes(ctx, shapes);
  }, [asset, tier, size]);
  return <canvas ref={ref} className="pet-picture" style={{ width: size, height: size }} aria-hidden />;
}

// English looks are lower case for use mid-sentence; a heading wants a capital.
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 藏品: what the owner shows of their wallet, on the district page. */
export function PetsCard({ pets }: { pets: Pet[] }) {
  if (!pets.length) return null;
  return (
    <section className="callout pets-card" aria-label={t("藏品")}>
      <h3 className="section-title">{t("藏品")}</h3>
      <ul>
        {pets.map((p) => (
          <li key={p.asset}>
            <PetPicture asset={p.asset} tier={p.tier} />
            <span className="grow">
              <b>{capitalize(t(PETS[p.asset].looks[p.tier - 1]))}</b>
              <span className="muted small">
                {PETS[p.asset].asset}
              </span>
              <span className="mono small">{amountText(p.asset, p.amount)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="dim small">{t("主人选择展示的钱包资产，数量来自链上，几个小时更新一次。")}</p>
    </section>
  );
}
