"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PetPicture } from "./Pets";
import { short } from "./Session";
import { api } from "@/lib/api";
import { btc } from "@/lib/format";
import { t } from "@/lib/i18n";
import { PETS, type Pet, type PetKey } from "@/lib/pets";

type Role = "owner" | "resident" | "visitor";

/** What you can do with the parcel you clicked on the district's map. */
export function ParcelPanel({
  n,
  i,
  value,
  holder,
  mine,
  role,
  token,
  recruit,
  following,
  onClose,
  onApply,
  onFollow,
  onTrade,
  onPetChanged,
}: {
  n: number;
  i: number;
  value: number | null;
  holder: string | null; // null: nobody has claimed it
  mine: boolean;
  role: Role | null; // null: signed out
  token: string | null;
  recruit: { applied?: boolean } | null; // the district is looking for residents
  following: boolean;
  onClose: () => void;
  onApply: () => void;
  onFollow: () => void;
  onTrade: () => void;
  onPetChanged: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = `${i}.${n}.bitmap`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {}
  };
  return (
    <section className="parcel-panel callout" aria-label={t("地块 #{n}", { n: i })}>
      <div className="row between">
        <b>{t("地块 #{n}", { n: i })}</b>
        <span className="row">
          <span className="muted small">{mine ? t("你的地块") : holder ? t("已认领") : t("未认领")}</span>
          <button type="button" className="icon-btn bare" aria-label={t("关闭")} onClick={onClose}>
            ×
          </button>
        </span>
      </div>
      <p className="muted small">
        {i === 0 ? t("区块里的第一笔交易（coinbase），街区的市政厅。") : t("区块里的第 {n} 笔交易。", { n: i })}
        {value != null && ` ${t("交易金额")} ${btc(value)}`}
      </p>
      {mine ? (
        <>
          <p className="small">{t("这是你的地块，你是这里的居民。")}</p>
          {token && <PetChooser n={n} i={i} token={token} onChanged={onPetChanged} />}
        </>
      ) : holder ? (
        <>
          <p className="small">
            {t("居民#one")} <span className="mono">{short(holder)}</span>
          </p>
          <div className="row wrap">
            <Link className="btn primary sm" href={`/address/${holder}`}>
              {t("去居民的主页")}
            </Link>
            <button type="button" className="ghost sm" onClick={onTrade}>
              {t("看在售和出价")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="small">{t("地块不能自己认领：要由街区主人把它铭刻成 {n}.bitmap 的子铭文，再转给居民。", { n })}</p>
          {role === "owner" ? (
            <div className="parcel-inscribe">
              <p className="muted small">{t("你是街区主人，可以把它分给居民。在支持父子铭文的铭刻服务（比如 UniSat、OrdinalsBot）上，以 {n}.bitmap 为父铭文铭刻下面这段文本，再转到居民的地址：", { n })}</p>
              <div className="row">
                <code className="mono grow">{text}</code>
                <button type="button" className="ghost sm" onClick={copy}>
                  {copied ? t("已复制") : t("复制")}
                </button>
              </div>
            </div>
          ) : !token ? (
            <p className="muted small">{t("连接钱包后，可以申请入住或关注这个街区。")}</p>
          ) : recruit ? (
            recruit.applied ? (
              <p className="muted small">{t("你已经申请入住，等街区主人联系你。")}</p>
            ) : (
              <div className="row wrap">
                <button type="button" className="primary sm" onClick={onApply}>
                  {t("申请入住")}
                </button>
                <span className="muted small">{t("这个街区正在招居民。")}</span>
              </div>
            )
          ) : (
            <div className="row wrap">
              <span className="muted small grow">{following ? t("主人现在没有招居民。你已经关注了这个街区，有新帖子会通知你。") : t("主人现在没有招居民。关注街区，有新帖子会通知你。")}</span>
              {!following && (
                <button type="button" className="ghost sm" onClick={onFollow}>
                  {t("关注街区")}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

type View = { chosen: PetKey | null; held: Pet[]; shown: string | null };

/** A resident picks one pet from their wallet to stand by their house on the map. */
function PetChooser({ n, i, token, onChanged }: { n: number; i: number; token: string; onChanged: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/v1/districts/${n}/parcels/${i}/showcase`;
  useEffect(() => {
    api<View>(url, { token })
      .then(setView)
      .catch((e) => setError(e.message));
  }, [url, token]);
  const pick = (asset: PetKey | null) =>
    api<View>(url, { method: "PUT", token, body: { asset } })
      .then((v) => (setView(v), onChanged()))
      .catch((e) => setError(e.message));
  if (!view) return error ? <p className="error small">{error}</p> : null;
  const held = view.held.filter((p) => p.tier > 0);
  return (
    <div className="pet-chooser">
      <b className="small">{t("在地块上放一只宠物")}</b>
      {held.length === 0 ? (
        <p className="muted small">{t("你的钱包里还没有能当宠物的资产，比如 DOG、Quantum Cats、NodeMonkes。有了以后就能放在这里。")}</p>
      ) : (
        <div className="chips">
          {held.map((p) => (
            <button key={p.asset} type="button" className={`chip pet-chip${view.chosen === p.asset ? " on" : ""}`} aria-pressed={view.chosen === p.asset} onClick={() => pick(p.asset)}>
              <PetPicture asset={p.asset} tier={p.tier} size={32} />
              {t(PETS[p.asset].name)}
            </button>
          ))}
          {view.chosen && (
            <button type="button" className="chip" onClick={() => pick(null)}>
              {t("不放")}
            </button>
          )}
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
