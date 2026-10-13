"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, type Promotion } from "@/lib/api";
import { t } from "@/lib/i18n";

/** 推广: districts a site admin put in a slot (api/billing.py). Always labelled; nothing shows when there are none. */
export function Promoted({ slot = "home" }: { slot?: string }) {
  const [list, setList] = useState<Promotion[] | null>(null);
  useEffect(() => {
    api<{ promotions: Promotion[] }>(`/v1/promotions?slot=${slot}`)
      .then((r) => setList(r.promotions))
      .catch(() => {});
  }, [slot]);
  if (!list?.length) return null;
  return (
    <section className="opened promoted" aria-label={t("推广")}>
      <h2 className="section-title">{t("推广")}</h2>
      <ul>
        {list.map((p) => (
          <li key={p.bitmap_number}>
            <Link href={`/district/${p.bitmap_number}`}>
              <b className="mono">{p.name}</b>
              {p.note && <span className="muted small grow">{p.note}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
