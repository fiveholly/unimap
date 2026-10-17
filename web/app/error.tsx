"use client";

import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { reloadIfStale } from "@/lib/stale";

/** A page that failed in the browser: reloads once for a stale build, otherwise says what broke. */
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    setReloading(reloadIfStale(error));
    console.error(error);
  }, [error]);
  return (
    <div className="page narrow page-error">
      <h1>{reloading ? t("网站刚更新过，正在刷新…") : t("这个页面出错了")}</h1>
      {!reloading && (
        <>
          <p className="dim">{t("刷新一下通常就好。还不行的话，把下面这行发给我们。")}</p>
          <p className="mono small error">{error.message || error.name}</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              {t("刷新")}
            </button>
            <button type="button" onClick={() => retry()}>
              {t("再试一次")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
