"use client";

import { Fragment, createContext, useCallback, useContext, useEffect, useState } from "react";

import { detectLang, LANG_KEY, setLang, type Lang } from "@/lib/i18n";

const LangContext = createContext<{ lang: Lang; choose: (l: Lang) => void }>({ lang: "zh", choose: () => {} });

/** Picks the language after the first render (the server renders Chinese) and re-mounts the
 * page whenever it changes, since t() reads a module variable rather than React state. */
export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, set] = useState<Lang>("zh");
  useEffect(() => {
    const l = detectLang();
    if (l !== "zh") {
      setLang(l);
      set(l);
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  }, [lang]);
  const choose = useCallback((l: Lang) => {
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {}
    setLang(l);
    set(l);
  }, []);
  return (
    <LangContext.Provider value={{ lang, choose }}>
      <Fragment key={lang}>{children}</Fragment>
    </LangContext.Provider>
  );
}

export const useLang = () => useContext(LangContext);

/** 中 / EN switch for the header. */
export function LangSwitch() {
  const { lang, choose } = useLang();
  return (
    <button
      type="button"
      className="ghost small lang-switch"
      onClick={() => choose(lang === "en" ? "zh" : "en")}
      aria-label={lang === "en" ? "切换到中文" : "Switch to English"}
      title={lang === "en" ? "切换到中文" : "Switch to English"}
    >
      {lang === "en" ? "中" : "EN"}
    </button>
  );
}
