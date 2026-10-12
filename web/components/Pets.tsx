"use client";

import { useEffect, useRef, useState } from "react";

import { drawShapes, petShapes, shapesBounds } from "@/lib/iso";
import { useSession } from "./Session";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { amountText, inscriptionImage, PET_LOGOS, PETS, type Pet, type PetKey } from "@/lib/pets";

/** The pets of one asset and tier, drawn as on the map. */
function PetDrawing({ asset, tier, size = 64 }: { asset: PetKey; tier: number; size?: number }) {
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

/** A pet as its official logo (PET_LOGOS), else drawn as on the map. */
export function PetPicture({ asset, tier, size = 64 }: { asset: PetKey; tier: number; size?: number }) {
  const logo = PET_LOGOS[asset];
  const [failed, setFailed] = useState<string | null>(null);
  if (!logo || failed === logo) return <PetDrawing asset={asset} tier={tier} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="pet-face" src={logo} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(logo)} />
  );
}

/** A collection pet as the owner's own inscription, else its logo (also when the picture won't
 * load, or isn't an image). */
export function PetFace({ asset, tier, face, size }: { asset: PetKey; tier: number; face?: string | null; size: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!face || failed === face) return <PetPicture asset={asset} tier={tier} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="pet-face" src={inscriptionImage(face)} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(face)} />
  );
}

// English looks are lower case for use mid-sentence; a heading wants a capital.
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 摸一摸 (api/pets.py): pat someone else's pet once a day; it gets a little affection and its
 * owner hears about it. */
export function PatButton({ owner, pet }: { owner: string; pet: Pet }) {
  const { token, address } = useSession();
  const [state, setState] = useState({ pats: pet.pats ?? 0, patted: !!pet.patted });
  const [hearts, setHearts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!token || address === owner) return state.pats ? <span className="dim small">{t("今天被摸了 {n} 次", { n: state.pats })}</span> : null;
  const pat = async () => {
    setError(null);
    try {
      const r = await api<Pet>(`/v1/people/${encodeURIComponent(owner)}/pets/${pet.asset}/pat`, { method: "POST", token });
      setState({ pats: r.pats ?? state.pats + 1, patted: true });
      setHearts(true);
      setTimeout(() => setHearts(false), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <span className="pet-pat small">
      <button type="button" className="ghost sm" disabled={state.patted} onClick={pat}>
        {state.patted ? t("今天摸过了") : t("摸一摸")}
      </button>
      {state.pats > 0 && <span className="dim">{t("今天被摸了 {n} 次", { n: state.pats })}</span>}
      {hearts && (
        <span className="pet-pat-heart" aria-hidden>
          ♥
        </span>
      )}
      {error && <span className="error">{error}</span>}
    </span>
  );
}

/** 藏品: what the owner shows of their wallet, on the district page. */
export function PetsCard({ pets, owner }: { pets: Pet[]; owner?: string | null }) {
  if (!pets.length) return null;
  return (
    <section className="callout pets-card" aria-label={t("藏品")}>
      <h3 className="section-title">{t("藏品")}</h3>
      <ul>
        {pets.map((p) => (
          <li key={p.asset}>
            <PetFace asset={p.asset} tier={p.tier} face={p.face} size={64} />
            <span className="grow">
              <b>{capitalize(t(PETS[p.asset].looks[p.tier - 1]))}</b>
              <span className="muted small">
                {PETS[p.asset].asset}
              </span>
              <span className="mono small">{amountText(p.asset, p.amount)}</span>
              {owner && <PatButton owner={owner} pet={p} />}
            </span>
          </li>
        ))}
      </ul>
      <p className="dim small">{t("主人选择展示的钱包资产，数量来自链上，几个小时更新一次。")}</p>
    </section>
  );
}
