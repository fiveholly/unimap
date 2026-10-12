import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { EN } from "./i18n/en/index.ts";
import { setLang, t } from "./i18n/index.ts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" || f === "i18n" ? [] : files(p);
    return /\.tsx?$/.test(f) && !f.includes(".test.") ? [p] : [];
  });
}

test("every t() and tn() string has English", () => {
  const missing = new Set<string>();
  const root = new URL("..", import.meta.url).pathname;
  for (const f of ["app", "components", "lib"].flatMap((d) => files(join(root, d)))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bt[n]?\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      const zh = JSON.parse(`"${m[1]}"`);
      if (!(zh in EN)) missing.add(`${f.slice(root.length)}: ${zh}`);
    }
  }
  assert.deepEqual([...missing], []);
});

test("English keeps the placeholders", () => {
  for (const [zh, en] of Object.entries(EN)) {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(vars(en), vars(zh), zh);
  }
});

test("t() fills placeholders and falls back to Chinese", () => {
  setLang("en");
  assert.equal(t("没有这句话 {n}", { n: 2 }), "没有这句话 2");
  setLang("zh");
});

test("only a #word glued to the end is a context, not shown in Chinese", () => {
  setLang("zh");
  assert.equal(t("举报#tab"), "举报");
  assert.equal(t("地块 #{n}", { n: 7 }), "地块 #7");
  assert.equal(t("unimap 繁荣榜：比特币城市里最热闹的街区。#Bitmap #unimap"), "unimap 繁荣榜：比特币城市里最热闹的街区。#Bitmap #unimap");
  setLang("en");
  assert.equal(t("地块 #{n}", { n: 7 }), "Parcel #7");
  setLang("zh");
});
