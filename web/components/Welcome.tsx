"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BIRTHDAY_EVENT, markBirthday } from "./Newcomer";
import { useSession } from "./Session";
import { Term } from "./Term";
import { api, type CapsuleRules, type Tour } from "@/lib/api";
import { heightOnDay } from "@/lib/blocktime";
import { locale, t, tn } from "@/lib/i18n";

/** 现在就能做 · 不用钱包: three things a first-time visitor can do at once, under the home page's
 * title: find the block of their birthday (the picker is in the card), write to the future, and
 * walk today's tour. Then the link to 30 秒看懂 unimap, which opens the three steps in place. */
export function StartHere({ tip, tour }: { tip: number; tour: Tour | null }) {
  const { token, ready } = useSession();
  const [rules, setRules] = useState<CapsuleRules | null>(null);
  const [explain, setExplain] = useState(false);
  useEffect(() => {
    if (!ready) return;
    api<CapsuleRules>("/v1/capsules/rules", { token })
      .then(setRules)
      .catch(() => setRules(null));
  }, [ready, token]);
  // 第一封免费 only when it is: billing off (all free), or the wallet hasn't used its free one.
  const free = rules != null && (!rules.billing || rules.free_left !== false);
  const stops = tour?.stops ?? [];
  const next = stops.find((s) => !s.visited);
  const tourDone = stops.length > 0 && !next;

  return (
    <div className="start">
      <p className="start-label">{t("现在就能做 · 不用钱包")}</p>
      <ul className="start-cards">
        <li>
          <Birthday tip={tip} />
        </li>
        <li>
          <Link className="start-card" href="/capsule">
            <Icon d="M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7" />
            <span className="start-text">
              <b>{t("给未来写一封信")}</b>
              <small className="on-wide">{t("时间胶囊：锁在区块里，到那一天才能打开")}</small>
              <small className="on-narrow">{free ? t("第一封免费") : t("时间胶囊")}</small>
            </span>
            {free && <span className="start-tag on-wide">{t("第一封免费")}</span>}
            <Arrow narrow={free} />
          </Link>
        </li>
        <li>
          <Link className="start-card" href={next ? `/district/${next.bitmap_number}` : "/game"}>
            <Icon d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Zm0 0v13.5m6-11V20" />
            <span className="start-text">
              <b>{tourDone ? t("今天的 3 个街区都逛过了") : t("今天去这 3 个街区逛逛")}</b>
              <small>
                {stops.length
                  ? tn("今日巡城：{stops}", { stops: <span className="mono">{stops.map((s) => s.bitmap_number).join(" · ")}</span> })
                  : t("每天三个街区，都去签到就得到巡城徽章")}
              </small>
            </span>
            <Arrow />
          </Link>
        </li>
      </ul>
      <p className="start-why">
        {t("第一次来？")}
        <button type="button" className="link-btn" aria-expanded={explain} aria-controls="explain" onClick={() => setExplain(!explain)}>
          {t("30 秒看懂 unimap")}
        </button>
      </p>
      {explain && <Explainer close={() => setExplain(false)} />}
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <span className="start-ic" aria-hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  );
}

/** narrow: only on a phone, where the card's tag gives way to it. */
const Arrow = ({ narrow = false }: { narrow?: boolean }) => (
  <span className={`start-go${narrow ? " on-narrow" : ""}`} aria-hidden>
    →
  </span>
);

/** 30 秒看懂 unimap: what the city is, in three steps, opened from the link under the cards. */
function Explainer({ close }: { close: () => void }) {
  return (
    <section className="explain" id="explain" aria-label={t("30 秒看懂 unimap")}>
      <div className="explain-head">
        <h2>{t("30 秒看懂 unimap")}</h2>
        <button type="button" className="icon-btn bare" aria-label={t("收起")} onClick={close}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <ol className="explain-steps">
        <li>
          <b>{t("逛一逛")}</b>
          <p>
            {tn("地图上每一格是比特币的一个区块，楼的样子由区块里的交易决定。每次减半是一个{epoch}，一块大陆。点一个街区进去看看，可以从{genesis}、{halving}或者{rank}开始。", {
              epoch: <Term k="epoch">{t("纪元#term")}</Term>,
              genesis: <Link href="/district/0">{t("创世区块")}</Link>,
              halving: <Link href="/district/840000">{t("第四次减半")}</Link>,
              rank: <Link href="/rank">{t("繁荣榜")}</Link>,
            })}
          </p>
        </li>
        <li>
          <b>{t("住下来")}</b>
          <p>
            {tn("持有某个区块的 Bitmap 铭文，你就是那个街区的主人；持有街区里的一个{parcel}（一笔交易），你就是那里的居民。想先当居民的话，{recruit}。", {
              parcel: <Term k="parcel">{t("地块#term")}</Term>,
              recruit: <Link href="/recruit">{t("看看哪些街区在招人")}</Link>,
            })}
          </p>
        </li>
        <li>
          <b>{t("热闹起来")}</b>
          <p>
            {tn("连接钱包后可以关注、签到、发帖和回复，都用钱包签名，不花钱。街区越热闹，{prosperity}越高，楼越高；每出一个新区块，城里还会抽一次{beat}。", {
              prosperity: <Term k="prosperity">{t("繁荣度#term")}</Term>,
              beat: <Term k="beat">{t("幸运街区#term")}</Term>,
            })}
          </p>
        </li>
      </ol>
    </section>
  );
}

function useWide() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const q = window.matchMedia("(min-width: 641px)");
    const on = () => setWide(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return wide;
}

/** 找到你生日那天的区块, as the first card. Year, month and day are separate selects rather than a
 * date input, because the browser draws a date input in its own language, not the site's. On a
 * phone the card is one line until tapped, and the picker opens under it. */
function Birthday({ tip }: { tip: number }) {
  const router = useRouter();
  const [y, setY] = useState("");
  const [m, setM] = useState("");
  const [d, setD] = useState("");
  const [open, setOpen] = useState(false);
  const wide = useWide(); // wider than a phone the picker is always shown
  const [error, setError] = useState<string | null>(null);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2009 + 1 }, (_, i) => thisYear - i);
  const monthName = (i: number) => new Date(2000, i, 1).toLocaleString(locale(), { month: "short" });
  const daysIn = y && m ? new Date(Number(y), Number(m), 0).getDate() : 31;
  useEffect(() => {
    if (Number(d) > daysIn) setD("");
  }, [d, daysIn]);
  // Sent here by a link (/#birthday, or the task card's first step): open the picker and focus it.
  useEffect(() => {
    const show = () => {
      setOpen(true);
      requestAnimationFrame(() => {
        const year = document.getElementById("birthday-year");
        year?.scrollIntoView({ block: "center", behavior: "smooth" });
        year?.focus({ preventScroll: true });
      });
    };
    if (window.location.hash === "#birthday") show();
    window.addEventListener(BIRTHDAY_EVENT, show);
    return () => window.removeEventListener(BIRTHDAY_EVENT, show);
  }, []);
  const pad = (n: string) => n.padStart(2, "0");
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const day = `${y}-${pad(m)}-${pad(d)}`;
    const h = heightOnDay(day, tip);
    if (h == null) return setError(day < "2009-01-03" ? t("比特币诞生于 2009 年 1 月 3 日，换一个那之后的日子试试。") : t("这一天还没有区块。"));
    setError(null);
    markBirthday(h);
    router.push(`/?b=${h}`);
  };
  return (
    <form className={`start-card main birthday${open ? " open" : ""}`} id="birthday" onSubmit={go}>
      <button
        type="button"
        className="start-row"
        aria-expanded={wide || open}
        aria-controls="birthday-fields"
        onClick={() => (wide ? document.getElementById("birthday-year")?.focus() : setOpen(!open))}
      >
        <Icon d="M4 9.5h16V20H4zM4 13h16M8 3.5v4m8-4v4M5.5 6h13" />
        <span className="start-text">
          <b>{t("找到你生日那天的区块")}</b>
          <small className="on-wide">{t("看看那天比特币出了第几个块，那个街区现在什么样")}</small>
          <small className="on-narrow">{t("不用钱包，10 秒")}</small>
        </span>
        <span className="start-tag on-wide">{t("10 秒")}</span>
        <span className="start-go on-narrow" aria-hidden>
          {open ? "↓" : "→"}
        </span>
      </button>
      <fieldset id="birthday-fields">
        <legend className="sr-only">{t("找到你生日（或任何一天）的区块")}</legend>
        <div className="birthday-fields">
          <select value={y} onChange={(e) => setY(e.target.value)} name="year" id="birthday-year" aria-label={t("年")} required>
            <option value="">{t("年")}</option>
            {years.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <select value={m} onChange={(e) => setM(e.target.value)} name="month" aria-label={t("月")} required>
            <option value="">{t("月")}</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>
                {monthName(i)}
              </option>
            ))}
          </select>
          <select value={d} onChange={(e) => setD(e.target.value)} name="day" aria-label={t("日")} required>
            <option value="">{t("日")}</option>
            {Array.from({ length: daysIn }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
          <button type="submit" className="primary sm">
            {t("去看看")}
          </button>
        </div>
        {y && m && d && (
          <Link className="small birthday-letter" href={`/capsule?for=${y}-${pad(m)}-${pad(d)}`}>
            {t("给这一天写一封信")}
          </Link>
        )}
        {error && <p className="error small">{error}</p>}
      </fieldset>
    </form>
  );
}
