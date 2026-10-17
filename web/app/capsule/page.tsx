"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useTip } from "@/components/BlockWatch";
import { CapsulePay, StylePicker, utcMinute } from "@/components/Capsule";
import { GiftFund, GiftPicker, sats as giftSats, walletPublicKey } from "@/components/Gift";
import { PageIntro } from "@/components/PageIntro";
import { useSession } from "@/components/Session";
import { api, type BillingProducts, type Capsule, type CapsuleRules, type Payment } from "@/lib/api";
import {
  BLOCK_SECONDS,
  blocksUntil,
  capsuleMessage,
  compressImage,
  DEFAULT_STYLE,
  defaultTier,
  encryptLetter,
  type EnvelopeStyle,
  kb,
  MAX_LETTER,
  MAX_LINE,
  MAX_RECIPIENT,
  nextAnniversary,
  pastFreeLimit,
  spanText,
  TAG_NAMES,
  TAGS,
  type Tag,
  type Tier,
  tierAllows,
  tierOptions,
  type TierOption,
} from "@/lib/capsule";
import { chosenSats, type GiftDraft, NO_GIFT, prepareGift, saveDraft } from "@/lib/giftseal";
import { t } from "@/lib/i18n";

const YEAR = 365.25 * 86400;
const dayOf = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);
const sats = (n: number) => t("{n} 聪", { n: n.toLocaleString("en-US") });

/** 时间胶囊 · 写信: a letter that opens at the first block past a day you pick. */
export default function CapsuleWritePage() {
  const router = useRouter();
  const { tip } = useTip();
  const { address, token, sign, ready, wallet } = useSession();
  const [rules, setRules] = useState<CapsuleRules | null>(null);
  const [paidSats, setPaidSats] = useState(0);
  const [tier, setTier] = useState<Tier | null>(null);
  const [recipient, setRecipient] = useState("");
  const [letter, setLetter] = useState("");
  const [day, setDay] = useState("");
  const [clock, setClock] = useState("00:00");
  const [forDay, setForDay] = useState<string | null>(null);
  const [isPublic, setPublic] = useState(false);
  const [line, setLine] = useState("");
  const [tag, setTag] = useState<Tag>("other");
  const [style, setStyle] = useState<EnvelopeStyle>(DEFAULT_STYLE);
  const [photo, setPhoto] = useState<{ bytes: Uint8Array; url: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [pending, setPending] = useState<{ id: string; key: string; payment: Payment | null; gift: GiftDraft | null } | null>(null);
  const [gift, setGift] = useState(NO_GIFT);
  const [funding, setFunding] = useState<GiftDraft | null>(null); // 礼物: sealed (and paid), the sats still to lock
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!ready) return;
    api<CapsuleRules>("/v1/capsules/rules", { token }).then(setRules, (e) => setError(e.message));
  }, [ready, token]);
  useEffect(() => {
    api<BillingProducts>("/v1/billing/products").then((r) => setPaidSats(r.products.find((p) => p.product === "capsule")?.amount_sats ?? 0), () => {});
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(timer);
  }, []);
  const lead = rules?.min_lead_seconds ?? 86400;
  const blockSeconds = rules?.block_seconds ?? BLOCK_SECONDS;
  const freeDays = rules?.free_days ?? 366;
  const options = useMemo(
    () => tierOptions(!!rules?.billing && paidSats > 0, rules?.free_left ?? null, paidSats, rules?.inscribe_sats ?? 20_000),
    [rules, paidSats],
  );
  // Start on the free one while the wallet has it; again whenever what is offered changes.
  useEffect(() => {
    if (rules) setTier((old) => (old && old !== "open" && options.some((o) => o.tier === old) ? old : defaultTier(options)));
  }, [rules, options]);
  const chosen: Tier = tier ?? "open";
  const allows = tierAllows(chosen);
  const giftRules = rules?.gift ?? null;
  const giftOn = !!giftRules && gift.on;
  // A gift comes with 封存: picking one moves off the free tier.
  useEffect(() => {
    if (giftOn && chosen === "free" && options.some((o) => o.tier === "paid" && o.available)) setTier("paid");
  }, [giftOn, chosen, options]);

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
  const tooFar = openAt != null && pastFreeLimit(chosen, openAt, now, freeDays);
  const left = openAt != null ? blocksUntil(openAt, now, blockSeconds) : null;
  const giftHeight = giftRules?.tip != null && openAt != null ? giftRules.tip + blocksUntil(openAt, now, giftRules.block_seconds) : null;
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

  const pickPhoto = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    setPhotoBusy(true);
    try {
      const bytes = await compressImage(file);
      setPhoto((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { bytes, url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" })) };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("读不出这张照片。"));
    } finally {
      setPhotoBusy(false);
    }
  };

  const seal = async () => {
    setError(null);
    const to = recipient.trim(), body = letter.trim(), said = isPublic ? line.trim() : "";
    if (!to) return setError(t("写上这封信给谁。"));
    if (!body) return setError(t("信还是空的。"));
    if (openAt == null) return setError(t("选一个打开的日子。"));
    if (Math.floor(Date.now() / 1000) + lead > openAt) return setError(lead >= 86400 ? t("打开的时间至少要在一天以后。") : t("打开的时间要再晚一点。"));
    if (pastFreeLimit(chosen, openAt, Math.floor(Date.now() / 1000), freeDays)) return setError(t("免费体验最多一年后打开；想等更久，选「封存」。"));
    if (isPublic && !said) return setError(t("写一句公开的话，或者不公开。"));
    if (giftOn && chosen === "free") return setError(t("礼物属于「封存」：选「封存」再附礼物。"));
    setBusy(true);
    try {
      const sealed = await encryptLetter(body, allows.photo ? photo?.bytes : null);
      // 礼物: the gift network's tip as of now, then the keys, the address, the timelock and the split key.
      const fresh = giftOn ? (await api<CapsuleRules>("/v1/capsules/rules", { token })).gift : null;
      if (giftOn && !fresh) throw new Error(t("这个站点现在不能附礼物。"));
      const prepared = fresh
        ? await prepareGift({ rules: fresh, choice: gift, walletKey: await walletPublicKey(wallet), key: sealed.key, ciphertext: sealed.ciphertext, photo: sealed.photo,
            fingerprint: sealed.fingerprint, openAt, now: Math.floor(Date.now() / 1000), recipient: to, author: address ?? "" })
        : null;
      const signedAt = Math.floor(Date.now() / 1000);
      const message = capsuleMessage(to, openAt, sealed.fingerprint, said || null, said ? tag : null, signedAt, prepared?.line);
      const signature = await sign(message);
      const c = await api<Capsule>("/v1/capsules", {
        method: "POST",
        token,
        body: {
          recipient: to, ciphertext: sealed.ciphertext, fingerprint: sealed.fingerprint, key: prepared ? prepared.serverHalf : sealed.key, open_at: openAt, line: said || null, tag: said ? tag : null,
          signed_at: signedAt, signature, photo: sealed.photo, style: allows.style ? style : DEFAULT_STYLE, ...(chosen === "open" ? {} : { tier: chosen }),
          ...(prepared ? { gift: prepared.gift } : {}),
        },
      });
      const draft: GiftDraft | null = prepared ? { ...prepared.draft, capsuleId: c.id, timelock: { ...prepared.draft.timelock, c: c.id } } : null;
      if (draft) saveDraft(draft);
      if (c.status === "pending") {
        setPending({ id: c.id, key: sealed.key, payment: c.payment ?? null, gift: draft });
        setBusy(false);
        return;
      }
      if (draft) {
        setFunding(draft);
        setBusy(false);
        return;
      }
      router.push(`/capsule/${c.id}#k=${sealed.key}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === "cancelled" ? null : msg);
      setBusy(false);
    }
  };
  // On a phone the invoice is below the whole letter: bring it into view.
  useEffect(() => {
    if (pending || funding) document.querySelector(".cap-side")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [pending, funding]);
  // Paid: a plain capsule goes to its page with the spare key; one with a gift goes on to lock the sats.
  const paid = useCallback(() => {
    if (!pending) return;
    if (pending.gift) {
      setFunding(pending.gift);
      setPending(null);
    } else router.push(`/capsule/${pending.id}#k=${pending.key}`);
  }, [pending, router]);

  return (
    <div className="page capsule-page">
      <PageIntro page="capsule" title={t("时间胶囊")}>
        {t("写一封信，锁在今天的区块里，到你选的那一天才能打开。在浏览器里加密，unimap 看不到内容；封存要用钱包签名。")}
      </PageIntro>
      <div className="cap-two">
        <div className="cap-main">
          <p className="eyebrow">{forDay ? t("给 {day} 这一天写一封信", { day: forDay }) : t("新的时间胶囊")}</p>
          <h1 className="cap-title">{t("写一封未来才能打开的信")}</h1>
          <label className="cap-field">
            <span>{t("写给谁")}</span>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value.replace(/\n/g, ""))} maxLength={MAX_RECIPIENT} placeholder={t("18 岁的小满")} name="recipient" />
            {allows.told && <span className="dim small">{t("写对方的比特币地址的话，打开那天 unimap 也会通知 Ta。")}</span>}
          </label>
          <label className="cap-field">
            <span>{t("信")}</span>
            <textarea className="cap-letter" value={letter} onChange={(e) => setLetter(e.target.value)} maxLength={MAX_LETTER} rows={9} placeholder={t("小满：今天你出生了……")} name="letter" />
            <span className="dim small cap-chars">
              <span className="mono">{letter.length.toLocaleString("en-US")}</span> / <span className="mono">{MAX_LETTER.toLocaleString("en-US")}</span> {t("字 · 在你的浏览器里加密，unimap 看不到")}
            </span>
          </label>
          <div className="cap-field">
            <span>{t("照片")}</span>
            {allows.photo ? (
              photo ? (
                <div className="cap-photo-pick">
                  <img src={photo.url} alt={t("随信附上的照片")} />
                  <div>
                    <span className="dim small">
                      {t("压缩后 {size}，和信用同一把钥匙加密", { size: kb(photo.bytes.length) })}
                    </span>
                    <button type="button" className="link-btn small" onClick={() => setPhoto(null)}>
                      {t("去掉照片")}
                    </button>
                  </div>
                </div>
              ) : (
                <label className="cap-photo-drop">
                  <input type="file" accept="image/*" name="photo" onChange={(e) => pickPhoto(e.target.files?.[0])} disabled={photoBusy} />
                  <span>{photoBusy ? t("正在压缩…") : t("附一张照片（可选）")}</span>
                  <span className="dim small">{t("在浏览器里压到 300 KB 以内，再和信一起加密。")}</span>
                </label>
              )
            ) : (
              <span className="dim small">{t("附照片、换信封样式和打开时的通知属于「封存」。")}</span>
            )}
          </div>
          <div className="cap-field">
            <span>{t("信封样式")}</span>
            <StylePicker value={allows.style ? style : DEFAULT_STYLE} onChange={setStyle} locked={!allows.style} />
          </div>
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
          {funding ? (
            <>
              <GiftFund draft={funding} token={token} done={() => {}} />
              <Link className="btn" href={`/capsule/${funding.capsuleId}`}>
                {t("看看封好的信封")}
              </Link>
            </>
          ) : pending ? (
            <>
              <CapsulePay capsuleId={pending.id} first={pending.payment} token={token} done={paid} />
              <button type="button" className="ghost" onClick={() => setPending(null)}>
                {t("返回修改")}
              </button>
            </>
          ) : (
            <>
              {options.length > 0 && <TierPicker options={options} value={chosen} onChange={setTier} />}
              {giftRules && <GiftPicker rules={giftRules} value={gift} onChange={setGift} height={giftHeight} blockSeconds={giftRules.block_seconds} />}
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
                <div className={`cap-when${tooSoon || tooFar ? " bad" : ""}`}>
                  <span className="dim small">{t("时间晚于 {when} UTC 的第一个块出来时打开", { when: utcMinute(new Date(openAt * 1000).toISOString()) })}</span>
                  {tip != null && left != null && <b className="mono">≈ {(tip + left).toLocaleString("en-US")}</b>}
                  {left != null && (
                    <span className="dim small">
                      {tooSoon
                        ? lead >= 86400
                          ? t("打开的时间至少要在一天以后。")
                          : t("打开的时间要再晚一点。")
                        : tooFar
                          ? t("免费体验最多一年后打开；想等更久，选「封存」。")
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
                  <span>{giftOn ? t("一半在 unimap，一半在时间锁") : t("两份都留")}</span>
                </div>
                <p className="dim small">{giftOn ? t("区块 {h} 到了，unimap 才交出它那一半；时间锁里是另一半。drand 到点也会公开整把钥匙。", { h: (giftHeight ?? 0).toLocaleString("en-US") }) : t("unimap 到点公开，收信人手里也有一把备用钥匙：封好后的链接里带着它，只显示这一次。")}</p>
                <div>
                  <span>{t("存在哪")}</span>
                  <span>{t("钱包签名，存在 unimap")}</span>
                </div>
                <div>
                  <span>{t("费用")}</span>
                  <span className="mono">{chosen === "paid" ? sats(paidSats) : chosen === "free" ? t("免费体验") : t("免费")}</span>
                </div>
                {giftOn && (
                  <div>
                    <span>{t("礼物")}</span>
                    <span className="mono">{Number.isInteger(chosenSats(gift)) ? giftSats(chosenSats(gift)) : "—"}</span>
                  </div>
                )}
                {giftOn && <p className="dim small">{t("礼物锁在比特币上，不交给 unimap。打开的钥匙一半在 unimap、一半在时间锁里，到点后 drand 也会公开它。")}</p>}
              </div>
              {ready && !address ? (
                <p className="muted small">{t("先在右上角连接钱包，再用它签名封存。签名不花钱，也不会发起交易。")}</p>
              ) : (
                <button type="button" className="primary lg cap-seal-btn" onClick={seal} disabled={busy || !rules || photoBusy}>
                  {busy ? t("等待钱包签名…") : chosen === "paid" ? t("签名，付 {n} 封存", { n: sats(paidSats) }) : t("封存这封信")}
                </button>
              )}
              {error && <p className="error small">{error}</p>}
              {options.length === 0 && <p className="dim small">{t("上链铭刻还没开放；现在的信只用钱包签名存在 unimap。")}</p>}
            </>
          )}
        </aside>
      </div>
      {token && <MyCapsules token={token} tip={tip} />}
    </div>
  );
}

/** 免费体验 / 封存 / 刻上链: what each costs and carries; 刻上链 is shown but can't be picked yet. */
function TierPicker({ options, value, onChange }: { options: TierOption[]; value: Tier; onChange: (t: Tier) => void }) {
  const about: Record<TierOption["tier"], [string, string]> = {
    free: [t("免费体验"), t("每个钱包一封 · 只有文字 · 一年内打开")],
    paid: [t("封存"), t("最长 100 年 · 附一张照片 · 选信封和火漆 · 打开时通知你和收信人")],
    inscribe: [t("刻上链"), t("把密文刻进一笔比特币交易，不靠 unimap 也永远能核对和取回。")],
  };
  return (
    <div className="cap-field">
      <span>{t("怎么封存")}</span>
      <div className="cap-tiers" role="radiogroup" aria-label={t("怎么封存")}>
        {options.map((o) => {
          const [name, line] = about[o.tier];
          const on = o.tier === value;
          return (
            <button key={o.tier} type="button" role="radio" aria-checked={on} disabled={!o.available} className={`cap-tier${on ? " on" : ""}`} onClick={() => o.tier !== "inscribe" && onChange(o.tier)}>
              <span className="cap-tier-head">
                <b>{name}</b>
                <span className="mono">
                  {o.tier === "free" ? t("免费") : o.tier === "inscribe" ? t("{n} 聪 + 网络费", { n: o.sats.toLocaleString("en-US") }) : sats(o.sats)}
                </span>
              </span>
              <span className="dim small">{line}</span>
              {o.tier === "inscribe" && <span className="cap-soon">{t("即将开放")}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MyCapsules({ token, tip }: { token: string; tip: number | null }) {
  const [list, setList] = useState<Capsule[] | null>(null);
  useEffect(() => {
    api<{ capsules: Capsule[] }>("/v1/capsules/mine", { token }).then((r) => setList(r.capsules), () => setList([]));
  }, [token]);
  // From the wallet menu's 我的时间胶囊 (/capsule#mine): bring the list into view once it is here.
  useEffect(() => {
    if (list != null && window.location.hash === "#mine") document.getElementById("mine")?.scrollIntoView({ block: "start" });
  }, [list]);
  return (
    <section className="cap-mine" id="mine">
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
