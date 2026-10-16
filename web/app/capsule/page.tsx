"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useTip } from "@/components/BlockWatch";
import { utcMinute } from "@/components/Capsule";
import { useSession } from "@/components/Session";
import { api, type Capsule, type CapsuleRules } from "@/lib/api";
import { BLOCK_SECONDS, blocksUntil, capsuleMessage, encryptLetter, MAX_LETTER, MAX_LINE, MAX_RECIPIENT, nextAnniversary, spanText, TAG_NAMES, TAGS, type Tag } from "@/lib/capsule";
import { t } from "@/lib/i18n";

const YEAR = 365.25 * 86400;
const dayOf = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

/** 时间胶囊 · 写信: a letter that opens at the first block past a day you pick. */
export default function CapsuleWritePage() {
  const router = useRouter();
  const { tip } = useTip();
  const { address, token, sign, ready } = useSession();
  const [rules, setRules] = useState<CapsuleRules | null>(null);
  const [recipient, setRecipient] = useState("");
  const [letter, setLetter] = useState("");
  const [day, setDay] = useState("");
  const [clock, setClock] = useState("00:00");
  const [forDay, setForDay] = useState<string | null>(null);
  const [isPublic, setPublic] = useState(false);
  const [line, setLine] = useState("");
  const [tag, setTag] = useState<Tag>("other");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    api<CapsuleRules>("/v1/capsules/rules").then(setRules, (e) => setError(e.message));
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(timer);
  }, []);
  const lead = rules?.min_lead_seconds ?? 86400;
  const blockSeconds = rules?.block_seconds ?? BLOCK_SECONDS;

  // Start a year out, or on the next anniversary of the day the birthday finder was given (?for=YYYY-MM-DD).
  useEffect(() => {
    if (!rules || day) return;
    const start = Math.floor(Date.now() / 1000) + rules.min_lead_seconds;
    const given = new URLSearchParams(window.location.search).get("for");
    const anniversary = given ? nextAnniversary(given, start) : null;
    if (given && anniversary) setForDay(given);
    setDay(anniversary ?? dayOf(Math.floor(Date.now() / 1000) + YEAR));
  }, [rules, day]);

  const openAt = useMemo(() => {
    const ms = Date.parse(`${day}T${clock || "00:00"}:00Z`);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }, [day, clock]);
  const tooSoon = openAt != null && openAt < now + lead;
  const left = openAt != null ? blocksUntil(openAt, now, blockSeconds) : null;
  const at = (seconds: number) => {
    const when = Math.floor(Date.now() / 1000) + seconds;
    setDay(dayOf(when));
    setClock(seconds < 86400 ? new Date(when * 1000).toISOString().slice(11, 16) : "00:00");
  };
  // A demo or test server lets a capsule open in minutes; offer that too.
  const presets: [string, number][] = [
    ...(lead < 3600 ? ([[t("几分钟后"), Math.max(lead, 60) + 120]] as [string, number][]) : []),
    [t("一年后"), YEAR],
    [t("十年后"), 10 * YEAR],
    [t("18 年后"), 18 * YEAR],
  ];

  const seal = async () => {
    setError(null);
    const to = recipient.trim(), body = letter.trim(), said = isPublic ? line.trim() : "";
    if (!to) return setError(t("写上这封信给谁。"));
    if (!body) return setError(t("信还是空的。"));
    if (openAt == null) return setError(t("选一个打开的日子。"));
    if (Math.floor(Date.now() / 1000) + lead > openAt) return setError(lead >= 86400 ? t("打开的时间至少要在一天以后。") : t("打开的时间要再晚一点。"));
    if (isPublic && !said) return setError(t("写一句公开的话，或者不公开。"));
    setBusy(true);
    try {
      const sealed = await encryptLetter(body);
      const signedAt = Math.floor(Date.now() / 1000);
      const message = capsuleMessage(to, openAt, sealed.fingerprint, said || null, said ? tag : null, signedAt);
      const signature = await sign(message);
      const c = await api<Capsule>("/v1/capsules", {
        method: "POST",
        token,
        body: { recipient: to, ciphertext: sealed.ciphertext, fingerprint: sealed.fingerprint, key: sealed.key, open_at: openAt, line: said || null, tag: said ? tag : null, signed_at: signedAt, signature },
      });
      router.push(`/capsule/${c.id}#k=${sealed.key}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === "cancelled" ? null : msg);
      setBusy(false);
    }
  };

  return (
    <div className="page capsule-page">
      <div className="cap-two">
        <div className="cap-main">
          <p className="eyebrow">{forDay ? t("给 {day} 这一天写一封信", { day: forDay }) : t("新的时间胶囊")}</p>
          <h1 className="cap-title">{t("写一封未来才能打开的信")}</h1>
          <label className="cap-field">
            <span>{t("写给谁")}</span>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value.replace(/\n/g, ""))} maxLength={MAX_RECIPIENT} placeholder={t("18 岁的小满")} name="recipient" />
          </label>
          <label className="cap-field">
            <span>{t("信")}</span>
            <textarea className="cap-letter" value={letter} onChange={(e) => setLetter(e.target.value)} maxLength={MAX_LETTER} rows={9} placeholder={t("小满：今天你出生了……")} name="letter" />
            <span className="dim small cap-chars">
              <span className="mono">{letter.length.toLocaleString("en-US")}</span> / <span className="mono">{MAX_LETTER.toLocaleString("en-US")}</span> {t("字 · 在你的浏览器里加密，unimap 看不到")}
            </span>
          </label>
          <div className="cap-field">
            <label className="check">
              <input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} name="public" />
              {t("在同块人里留一句公开的话")}
            </label>
            <span className="dim small">{t("默认不公开。公开的只有这一句话、类型和钱包缩写，信的内容永远不会出现在那里。")}</span>
            {isPublic && (
              <>
                <input value={line} onChange={(e) => setLine(e.target.value.replace(/\n/g, ""))} maxLength={MAX_LINE} placeholder={t("女儿出生。给她封了一封信，2044 年打开。")} name="line" />
                <div className="cap-chips" role="radiogroup" aria-label={t("类型")}>
                  {TAGS.map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={tag === k} className={`cap-chip${tag === k ? " on" : ""}`} onClick={() => setTag(k)}>
                      {t(TAG_NAMES[k])}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <aside className="cap-side">
          <div className="cap-field">
            <span>{t("什么时候能打开")}</span>
            <div className="cap-chips">
              {presets.map(([label, s]) => (
                <button key={label} type="button" className="cap-chip" onClick={() => at(s)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="cap-when-inputs">
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} name="open-day" aria-label={t("日期 (UTC)")} />
              <input type="time" value={clock} onChange={(e) => setClock(e.target.value)} name="open-time" aria-label={t("时间 (UTC)")} />
            </div>
          </div>
          {openAt != null && (
            <div className={`cap-when${tooSoon ? " bad" : ""}`}>
              <span className="dim small">{t("时间晚于 {when} UTC 的第一个块出来时打开", { when: utcMinute(new Date(openAt * 1000).toISOString()) })}</span>
              {tip != null && left != null && <b className="mono">≈ {(tip + left).toLocaleString("en-US")}</b>}
              {left != null && (
                <span className="dim small">
                  {tooSoon
                    ? lead >= 86400
                      ? t("打开的时间至少要在一天以后。")
                      : t("打开的时间要再晚一点。")
                    : blockSeconds % 60 === 0
                      ? t("按每块 {m} 分钟估算，还有约 {n} 块，{span}。", { m: blockSeconds / 60, n: left.toLocaleString("en-US"), span: spanText(left, blockSeconds) })
                      : t("按演示站每块 {s} 秒估算，还有约 {n} 块，{span}。", { s: blockSeconds, n: left.toLocaleString("en-US"), span: spanText(left, blockSeconds) })}
                </span>
              )}
            </div>
          )}
          <div className="cap-kv">
            <div>
              <span>{t("钥匙")}</span>
              <span>{t("两份都留")}</span>
            </div>
            <p className="dim small">{t("unimap 到点公开，收信人手里也有一把备用钥匙：封好后的链接里带着它，只显示这一次。")}</p>
            <div>
              <span>{t("存在哪")}</span>
              <span>{t("钱包签名，存在 unimap")}</span>
            </div>
            <div>
              <span>{t("费用")}</span>
              <span className="mono">{t("免费")}</span>
            </div>
          </div>
          {ready && !address ? (
            <p className="muted small">{t("先在右上角连接钱包，再用它签名封存。签名不花钱，也不会发起交易。")}</p>
          ) : (
            <button type="button" className="primary lg cap-seal-btn" onClick={seal} disabled={busy || !rules}>
              {busy ? t("等待钱包签名…") : t("封存这封信")}
            </button>
          )}
          {error && <p className="error small">{error}</p>}
          <p className="dim small">{t("上链铭刻还没开放；现在的信只用钱包签名存在 unimap。")}</p>
        </aside>
      </div>
      {token && <MyCapsules token={token} tip={tip} />}
    </div>
  );
}

function MyCapsules({ token, tip }: { token: string; tip: number | null }) {
  const [list, setList] = useState<Capsule[] | null>(null);
  useEffect(() => {
    api<{ capsules: Capsule[] }>("/v1/capsules/mine", { token }).then((r) => setList(r.capsules), () => setList([]));
  }, [token]);
  return (
    <section className="cap-mine">
      <h2 className="section-title">
        {t("我封存的信")} <span className="mono">{list?.length ?? ""}</span>
      </h2>
      {list == null ? (
        <p className="muted">{t("加载中…")}</p>
      ) : list.length === 0 ? (
        <p className="muted">
          {t("还没有封存过信。")}
          {tip != null && (
            <>
              {" "}
              <Link href={`/capsule/block/${tip}`}>{t("看看现在这一块的同块人")}</Link>
            </>
          )}
        </p>
      ) : (
        <ul className="cap-mine-list">
          {list.map((c) => (
            <li key={c.id}>
              <Link href={`/capsule/${c.id}`} className="grow">
                <span className="serif">{t("给 {name}", { name: c.recipient })}</span>
                <span className="dim small">
                  {c.status === "open"
                    ? t("已在区块 {h} 打开", { h: (c.open_height ?? 0).toLocaleString("en-US") })
                    : t("封存在区块 {h} · 还有约 {n} 块", { h: c.sealed_height.toLocaleString("en-US"), n: (c.blocks_left ?? 0).toLocaleString("en-US") })}
                </span>
              </Link>
              <Link href={`/capsule/block/${c.sealed_height}`} className="small muted">
                {t("同块人")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
