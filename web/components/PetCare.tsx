"use client";

import { useEffect, useState } from "react";

import { PetFace } from "./Pets";
import { api, type CaredPet } from "@/lib/api";
import { t } from "@/lib/i18n";
import { amountText, PET_KEYS, PETS } from "@/lib/pets";

const MOODS: Record<CaredPet["mood"], string> = { full: "吃饱了", ok: "心情不错", hungry: "饿了", starving: "饿坏了" };

/** 我的宠物: the pets the wallets hold, fed and named here (api/pets.py). */
export function PetCareSection({ token }: { token: string }) {
  const [pets, setPets] = useState<CaredPet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ pets: CaredPet[] }>("/v1/me/pets", { token })
      .then((r) => setPets(r.pets))
      .catch((e) => setError(e.message));
  }, [token]);
  const update = (p: CaredPet) => setPets((list) => list && list.map((x) => (x.asset === p.asset ? p : x)));
  return (
    <section className="me-group pet-care">
      <h2 className="section-title">
        {t("我的宠物")} {pets && <span className="count">{pets.length}</span>}
      </h2>
      {error && <p className="error small">{error}</p>}
      {pets && pets.length === 0 && (
        <p className="muted small">
          {t("钱包里有这些资产，就会有对应的宠物住进来：{list}。关联的其他钱包也算。", {
            list: PET_KEYS.map((k) => `${t(PETS[k].name)}（${PETS[k].asset}）`).join(t("、")),
          })}
        </p>
      )}
      {pets && pets.length > 0 && (
        <>
          <p className="muted small">{t("每只宠物每 6 小时可以喂一次，连续几天都来喂，亲密度涨得更快。也可以在你的街区或地块上展示它们。")}</p>
          <ul className="pet-cards">
            {pets.map((p) => (
              <PetCard key={p.asset} pet={p} token={token} onChange={update} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function PetCard({ pet, token, onChange }: { pet: CaredPet; token: string; onChange: (p: CaredPet) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hearts, setHearts] = useState(0); // bumps on each feed, to replay the hearts
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(pet.name ?? "");
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const info = PETS[pet.asset];
  const wait = pet.can_feed_at ? Date.parse(pet.can_feed_at) - Date.now() : 0;
  const prevAt = pet.level > 1 ? 30 * (pet.level - 1) ** 2 : 0;
  const progress = pet.next_level_at ? (pet.affection - prevAt) / (pet.next_level_at - prevAt) : 1;
  const feed = async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api<CaredPet>(`/v1/me/pets/${pet.asset}/feed`, { method: "POST", token }));
      setHearts((h) => h + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const setPublic = async (show: boolean) => {
    try {
      onChange(await api<CaredPet>(`/v1/me/pets/${pet.asset}`, { method: "PUT", token, body: { public: show } }));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const setFace = async (face: string) => {
    try {
      onChange(await api<CaredPet>(`/v1/me/pets/${pet.asset}`, { method: "PUT", token, body: { face } }));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      onChange(await api<CaredPet>(`/v1/me/pets/${pet.asset}`, { method: "PUT", token, body: { name } }));
      setNaming(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <li className={`pet-card mood-${pet.mood}`}>
      <div className="pet-stage">
        <PetFace asset={pet.asset} tier={pet.tier} face={pet.face} size={104} />
        {hearts > 0 && (
          <span key={hearts} className="pet-hearts" aria-hidden>
            ♥ ♥ ♥
          </span>
        )}
      </div>
      <div className="pet-body">
        {naming ? (
          <form className="row" onSubmit={saveName}>
            <input value={name} maxLength={20} autoFocus placeholder={t(info.name)} aria-label={t("宠物名字")} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="ghost sm">
              {t("保存")}
            </button>
          </form>
        ) : (
          <div className="row between">
            <b>{pet.name || t(info.name)}</b>
            <button type="button" className="pet-rename small" onClick={() => (setName(pet.name ?? ""), setNaming(true))}>
              {pet.name ? t("改名") : t("起名字")}
            </button>
          </div>
        )}
        <span className="muted small">
          {info.asset} · <span className="mono">{amountText(pet.asset, pet.amount)}</span>
        </span>
        <div className="pet-level small">
          <span>{t("等级 {n}", { n: pet.level })}</span>
          <span className="pet-bar" role="progressbar" aria-label={t("亲密度")} aria-valuenow={pet.affection} aria-valuemin={prevAt} aria-valuemax={pet.next_level_at ?? pet.affection}>
            <i style={{ width: `${Math.round(Math.min(1, progress) * 100)}%` }} />
          </span>
          <span className="mono muted">
            {pet.affection}
            {pet.next_level_at ? ` / ${pet.next_level_at}` : ""}
          </span>
        </div>
        <div className="row between small">
          <span className={`pet-mood ${pet.mood}`}>{t(MOODS[pet.mood])}</span>
          {pet.streak > 1 && <span className="muted">{t("连续 {n} 天", { n: pet.streak })}</span>}
        </div>
        {wait > 0 ? (
          <button type="button" className="ghost sm" disabled>
            {t("{h}后可以再喂", { h: hoursText(wait) })}
          </button>
        ) : (
          <button type="button" className="primary sm" disabled={busy} onClick={feed}>
            {t("喂食")}
          </button>
        )}
        <label className="pet-public small">
          <input type="checkbox" checked={pet.public} onChange={(e) => setPublic(e.target.checked)} />
          {t("在我的主页展示")}
        </label>
        {pet.items.length > 1 && (
          <div className="pet-faces" role="group" aria-label={t("换一个样子")}>
            {pet.items.map((id) => (
              <button key={id} type="button" className={id === pet.face ? "on" : ""} aria-pressed={id === pet.face} aria-label={id} onClick={() => setFace(id)}>
                <PetFace asset={pet.asset} tier={pet.tier} face={id} size={36} />
              </button>
            ))}
          </div>
        )}
        {error && <p className="error small">{error}</p>}
      </div>
    </li>
  );
}

function hoursText(ms: number) {
  const min = Math.ceil(ms / 60_000);
  return min >= 60 ? t("{n} 小时", { n: Math.ceil(min / 60) }) : t("{n} 分钟", { n: min });
}
