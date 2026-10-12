"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { BuyButton, useMarket } from "@/components/Market";
import { short, useSession } from "@/components/Session";
import { TileThumb } from "@/components/TileThumb";
import { api, type ParcelForSale, type Recruiting } from "@/lib/api";
import { btc } from "@/lib/format";
import { LEVEL_NAMES, type Level } from "@/lib/prosperity";
import { ZONES, zoneOf } from "@/lib/zones";
import { t } from "@/lib/i18n";

export default function RecruitPage() {
  const [rows, setRows] = useState<Recruiting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ districts: Recruiting[] }>("/v1/recruiting")
      .then((r) => setRows(r.districts))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="page narrow rank">
      <h1>{t("招募居民")}</h1>
      <p className="muted">{t("这些街区在找新邻居。进去看看说明，申请入住后，街区主人会把地块转给你。")}</p>
      {error ? (
        <p className="error">{error}</p>
      ) : !rows ? (
        <p className="muted">{t("加载中…")}</p>
      ) : rows.length === 0 ? (
        <p className="muted empty">{t("现在没有街区在招募。")}</p>
      ) : (
        <ol className="rank-list">
          {rows.map((r) => {
            const zone = zoneOf(r.zone);
            return (
              <li key={r.bitmap_number}>
                <Link href={`/district/${r.bitmap_number}`}>
                  <TileThumb zone={zone} n={r.bitmap_number} width={56} level={r.level} />
                  <span className="grow">
                    <b className="mono">{r.name}</b>
                    <span className="small">{r.message}</span>
                    <span className="muted small">
                      {zone ? t(ZONES[zone].name) : t("地段计算中")} · {t("{n} 级", { n: r.level })} {t(LEVEL_NAMES[r.level as Level])} · {short(r.owner)}
                      {r.for_sale && r.for_sale.length > 0 && ` · ${t("{n} 块地在售", { n: r.for_sale.length })}`}
                    </span>
                  </span>
                  <span className="rank-score">
                    <b className="mono">{r.parcels.length || "—"}</b>
                    <span className="muted small">{t("开放地块")}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      <ParcelsForSale />
    </div>
  );
}

/** 地块交易: parcels listed in unimap, for someone who'd rather buy their way in than wait for an owner. */
function ParcelsForSale() {
  const market = useMarket();
  const { address } = useSession();
  const [rows, setRows] = useState<ParcelForSale[] | null>(null);
  useEffect(() => {
    if (market?.open) api<{ parcels: ParcelForSale[] }>("/v1/market/parcels").then((r) => setRows(r.parcels)).catch(() => setRows([]));
  }, [market?.open]);
  if (!market?.open || !rows || rows.length === 0) return null;
  return (
    <section className="for-sale">
      <h2 className="section-title">{t("在售地块：买下就是居民")}</h2>
      <p className="muted small">{t("这些地块的持有人在 unimap 挂了单。买下后地块直接到你的地址，你就成了那条街的居民，不用等街区主人。在招募的街区排在前面。")}</p>
      <ol className="rank-list">
        {rows.map((p) => {
          const zone = zoneOf(p.zone);
          return (
            <li key={p.id} className="for-sale-row">
              <Link href={`/district/${p.bitmap_number}?tab=parcels`}>
                <TileThumb zone={zone} n={p.bitmap_number} width={44} level={p.level} />
                <span className="grow">
                  <b className="mono">
                    {p.bitmap_number}.bitmap · {t("地块 #{n}", { n: String(p.tx_index) })}
                  </b>
                  <span className="muted small">
                    {t("{n} 级", { n: p.level })} {t(LEVEL_NAMES[p.level as Level])} · {t("{n} 位居民", { n: p.residents })}
                    {p.recruiting && ` · ${t("在招募")}`}
                  </span>
                </span>
              </Link>
              <b className="mono sale-price">{btc(p.price_sats)}</b>
              {p.seller !== address && (
                <BuyButton listingId={p.id} price={p.price_sats} label={t("买下入住")} doneText={t("交易已发出。确认后这块地就是你的了，你也就成了这里的居民。")} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
