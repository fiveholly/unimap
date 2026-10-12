// Two languages: Chinese, which the source is written in, and English.
//
// Write UI text in Chinese wrapped in t(): t("关注") or t("{n} 个街区", { n }). The English is
// looked up by that exact Chinese text in lib/i18n/en/*.ts; anything missing falls back to the
// Chinese (lib/i18n.test.ts fails on a t() literal without an English entry). For text with
// elements inside, tn() fills placeholders with React nodes: tn("属于园区 {name}", { name: <b>…</b> }).
//
// The language lives in a module variable so plain functions in lib/ can translate too.
// LangProvider sets it and re-mounts the page when it changes, so everything re-renders.

import { Fragment, createElement, type ReactNode } from "react";

import { EN } from "./en/index.ts";

export type Lang = "zh" | "en";
export const LANG_KEY = "unimap.lang";

let current: Lang = "zh";
export const lang = () => current;
export function setLang(l: Lang) {
  current = l;
}

/** The language a visitor gets before they pick one: Chinese for a Chinese browser, else English. */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {}
  const nav = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return nav.some((l) => l?.toLowerCase().startsWith("zh")) ? "zh" : "en";
}

type Vars = Record<string, string | number>;

// A key may end in "#context" when the same Chinese needs different English, e.g. t("居民#one")
// for a single resident's badge; the Chinese shown is the part before the "#". Only a lowercase
// word glued to the end counts, so "地块 #{n}" and "#Bitmap #unimap" are shown as written.
const CONTEXT = /(?<=\S)#[a-z]+$/;
function lookup(zh: string): string {
  const text = zh.replace(CONTEXT, "");
  return current === "en" ? EN[zh] ?? text : text;
}

export function t(zh: string, vars?: Vars): string {
  const s = lookup(zh);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** t() with React nodes in the placeholders. */
export function tn(zh: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = lookup(zh).split(/\{(\w+)\}/g);
  return parts.map((p, i) => createElement(Fragment, { key: i }, i % 2 ? (vars[p] ?? `{${p}}`) : p));
}

/** Locale for toLocaleString and friends. */
export const locale = () => (current === "en" ? "en-US" : "zh-CN");
