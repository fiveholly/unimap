"use client";

import { DEMO, resetDemo } from "@/lib/demo";
import { t } from "@/lib/i18n";

/** A strip under the header in demo mode, so nobody mistakes the made-up city for the real one. */
export function DemoBanner() {
  if (!DEMO) return null;
  return (
    <div className="demo-banner">
      <span>{t("演示模式：地图、街区和帖子都是模拟数据。点“连接钱包”选“演示钱包”即可体验发帖和管理。")}</span>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          resetDemo();
          try {
            localStorage.removeItem("unimap.session");
          } catch {}
          location.reload();
        }}
      >
        {t("重置演示数据")}
      </button>
    </div>
  );
}
