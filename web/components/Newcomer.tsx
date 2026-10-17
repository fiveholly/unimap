"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { BadgeIcon } from "./Badge";
import { useSession } from "./Session";
import { api, type Newcomer, type Tour } from "@/lib/api";
import { t } from "@/lib/i18n";
import { complete, doneCount, merge, needsReport, nextStep, readLocal, STEPS, writeLocal, type Local, type Progress, type Step } from "@/lib/newcomer";

const EVENT = "unimap:newcomer";
const store = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/** Step 1 done: called by the birthday lookup. Kept in the browser, and sent on once signed in. */
export function markBirthday(block: number) {
  const s = store();
  const local = readLocal(s);
  writeLocal(s, { ...local, birthday: true, block: local.block ?? block });
  window.dispatchEvent(new Event(EVENT));
}

function saveLocal(change: Partial<Local>) {
  const s = store();
  writeLocal(s, { ...readLocal(s), ...change });
  window.dispatchEvent(new Event(EVENT));
}

/** The task as this visitor stands: the browser's copy merged with the server's once signed in. */
export function useNewcomer() {
  const { token, ready } = useSession();
  const [local, setLocal] = useState<Local | null>(null);
  const [server, setServer] = useState<Newcomer | null>(null);
  useEffect(() => {
    const read = () => setLocal(readLocal(store()));
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  useEffect(() => {
    if (!ready || !token) return setServer(null);
    let live = true;
    api<Newcomer>("/v1/me/newcomer", { token })
      .then((r) => live && setServer(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ready, token]);
  // Signing in, or finding the birthday while signed in: tell the server what only the browser saw.
  useEffect(() => {
    if (!token || !local || !server || !needsReport(local, server.steps)) return;
    let live = true;
    api<Newcomer>("/v1/me/newcomer/birthday", { method: "POST", token, body: { block: local.block } })
      .then((r) => live && setServer(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [token, local, server]);
  const progress: Progress = merge(local ? { birthday: local.birthday } : null, server?.steps);
  return { ready: ready && local != null, local, progress, badge: server?.badge ?? null, signedIn: !!token };
}

/** Where on the site each step is done. */
function stepHref(step: Step, tour: Tour | null) {
  if (step === "birthday") return "/#birthday";
  if (step === "capsule") return "/capsule";
  const next = tour?.stops.find((s) => !s.visited) ?? tour?.stops[0];
  return next ? `/district/${next.bitmap_number}` : "/rank";
}

const STEP_TEXT: Record<Step, string> = { birthday: "找到你生日那天的区块", checkin: "去一个街区签到", capsule: "封存你的第一封信" };
const NEXT_TEXT: Record<Step, string> = { birthday: "找你的生日区块", checkin: "去签到", capsule: "封一封信" };

/** On the home page the birthday step's link goes to the picker on the same page (Welcome.tsx opens it). */
export const BIRTHDAY_EVENT = "unimap:birthday";
export function focusBirthday(e?: React.MouseEvent) {
  if (!document.getElementById("birthday")) return; // elsewhere: follow the link to /#birthday
  e?.preventDefault();
  window.dispatchEvent(new Event(BIRTHDAY_EVENT));
}

/** 新手任务: on a wide screen a card floating at the bottom right of the home page, folding
 * to a dot; on a phone a bar above the tab bar that opens the card. Gone once done and closed. */
export function NewcomerTask({ tour, card = true }: { tour: Tour | null; card?: boolean }) {
  const { ready, local, progress, badge, signedIn } = useNewcomer();
  const [sheet, setSheet] = useState(false); // the phone's card, opened from the bar
  const toggle = useCallback(() => setSheet((s) => !s), []);
  useEffect(() => {
    if (!sheet) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [sheet]);
  // The card floats over the page; once the first screen is scrolled past it folds to the dot, so
  // it doesn't sit on the content further down. A tap on the dot opens it there anyway.
  const [below, setBelow] = useState(false);
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    if (!card) return;
    const onScroll = () => {
      const b = window.scrollY > window.innerHeight * 0.5;
      setBelow(b);
      if (!b) setPeek(false);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [card]);
  if (!ready || !local || local.dismissed) return null;
  const folded = local.collapsed || (below && !peek);
  const n = doneCount(progress), all = complete(progress), next = nextStep(progress);
  const label = t("新手任务 {k}/{n}", { k: n, n: STEPS.length });

  const body = (
    <>
      <div className="quest-head">
        <b>{all ? t("新手任务完成") : t("新手任务")}</b>
        <span className="mono quest-count">
          {n}/{STEPS.length}
        </span>
      </div>
      <div className="quest-meter" role="progressbar" aria-label={t("新手任务")} aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={n}>
        <i style={{ width: `${(n / STEPS.length) * 100}%` }} />
      </div>
      <ol className="quest-steps">
        {STEPS.map((s) => (
          <li key={s} className={progress[s] ? "done" : s === next ? "next" : ""}>
            <span className="quest-check" aria-hidden>
              {progress[s] ? "✓" : ""}
            </span>
            {progress[s] ? (
              <span>
                {t(STEP_TEXT[s])}
                <span className="sr-only">{t("（已完成）")}</span>
              </span>
            ) : (
              <Link href={stepHref(s, tour)} onClick={s === "birthday" ? focusBirthday : undefined}>
                {t(STEP_TEXT[s])}
                {s === "checkin" && !signedIn && <span className="dim">{t("（连接钱包）")}</span>}
              </Link>
            )}
          </li>
        ))}
      </ol>
      {all ? (
        <div className="quest-reward won">
          <BadgeIcon kind="newcomer" rarity="common" size={30} />
          <span className="grow">
            {badge ? t("你得到了「新居民」徽章") : t("三步都做完了，连接钱包领「新居民」徽章")}
            {badge && (
              <>
                {" "}
                <Link href="/game#badges">{t("看徽章")}</Link>
              </>
            )}
          </span>
        </div>
      ) : (
        <div className="quest-reward">
          <span className="quest-star" aria-hidden>
            ★
          </span>
          <span className="grow">
            {next && (
              <>
                {t("下一步：")}
                <Link href={stepHref(next, tour)} onClick={next === "birthday" ? focusBirthday : undefined}>
                  {t(NEXT_TEXT[next])} →
                </Link>
                <br />
              </>
            )}
            <span className="dim">{t("三步做完得到「新居民」徽章")}</span>
          </span>
        </div>
      )}
    </>
  );

  const actions = (
    <div className="quest-actions">
      {all && badge ? (
        <button type="button" className="link-btn small" onClick={() => saveLocal({ dismissed: true })}>
          {t("关闭，不再显示")}
        </button>
      ) : (
        card && (
          <button type="button" className="link-btn small quest-fold" onClick={() => saveLocal({ collapsed: true })}>
            {t("收起")}
          </button>
        )
      )}
    </div>
  );

  return (
    <>
      {card &&
        (folded ? (
          <button type="button" className="quest-dot" onClick={() => (local.collapsed ? saveLocal({ collapsed: false }) : setPeek(true))} aria-label={t("打开新手任务（{k}/{n}）", { k: n, n: STEPS.length })}>
            <span className="mono">{n}/{STEPS.length}</span>
          </button>
        ) : (
          <section className="quest" aria-label={t("新手任务")}>
            {body}
            {actions}
          </section>
        ))}
      <div className={`quest-bar-wrap${sheet ? " open" : ""}`}>
        {sheet && (
          <section className="quest quest-sheet" id="quest-sheet" aria-label={t("新手任务")}>
            {body}
            {all && badge && actions}
          </section>
        )}
        <div className="quest-bar">
          <button type="button" className="quest-bar-open" onClick={toggle} aria-expanded={sheet} aria-controls="quest-sheet">
            <span className="quest-star" aria-hidden>
              ★
            </span>
            {all ? t("新手任务完成") : label}
          </button>
          {next ? (
            <Link className="quest-bar-next" href={stepHref(next, tour)} onClick={next === "birthday" ? focusBirthday : undefined}>
              {t("下一步：{step}", { step: t(NEXT_TEXT[next]) })} →
            </Link>
          ) : (
            badge && (
              <button type="button" className="icon-btn bare" aria-label={t("关闭，不再显示")} onClick={() => saveLocal({ dismissed: true })}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            )
          )}
        </div>
      </div>
    </>
  );
}
