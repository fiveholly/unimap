"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useTip } from "@/components/BlockWatch";
import { CapsulePay, StylePicker } from "@/components/Capsule";
import { GiftFund, GiftPicker, LiveSwitch, sats as giftSats, useLiveSignet, walletPublicKey } from "@/components/Gift";
import { askLogin } from "@/components/Header";
import { PageIntro } from "@/components/PageIntro";
import { useSession } from "@/components/Session";
import { api, type BillingProducts, type Capsule, type CapsuleRules, type Payment, type UsdRate } from "@/lib/api";
import {
  BLOCK_SECONDS,
  blocksUntil,
  capsuleMessage,
  CHAIN_PHOTO_SIDE,
  CHAIN_PHOTO_TARGET,
  compressImage,
  DEFAULT_STYLE,
  encryptLetter,
  type EnvelopeStyle,
  imageType,
  kb,
  MAX_CHAIN_PHOTO_BYTES,
  MAX_LETTER,
  MAX_LINE,
  MAX_RECIPIENT,
  nextAnniversary,
  pastFreeLimit,
  spanText,
  STYLES,
  TAG_NAMES,
  TAGS,
  type Tag,
  type Tier,
  tierAllows,
  tierOptions,
  usd,
} from "@/lib/capsule";
import { DEMO } from "@/lib/demo";
import { type Face, NETWORK_NAMES, POSTAGE } from "@/lib/gift";
import { chainFor } from "@/lib/giftchain";
import { chosenSats, faceOf, type GiftChoice, type GiftDraft, letterCost, NO_GIFT, postageAddress, prepareGift, prepareLetter, saveDraft } from "@/lib/giftseal";
import { lang, t } from "@/lib/i18n";

const YEAR = 365.25 * 86400;
const dayOf = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);
const sats = (n: number) => t("{n} 聪", { n: n.toLocaleString("en-US") });
/** A cost in dollars at mainnet's price (api/prices.py), or in sats without one. */
const money = (n: number, rate: UsdRate | null | undefined) => (rate ? usd(n, rate.btc_usd) : sats(n));
const utf8Length = (s: string) => new TextEncoder().encode(s).length;
/** An amount and its unit, never split over two lines. */
const Amount = ({ children, dim }: { children: React.ReactNode; dim?: boolean }) => <span className={`cap-amt${dim ? " dim" : ""}`}>{children}</span>;

/** "2031 年 10 月 18 日" / "October 18, 2031" (UTC), with the time when it opens within a day or two. */
function dayWords(unix: number, withTime: boolean): string {
  const d = new Date(unix * 1000);
  const date =
    lang() === "en"
      ? d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
      : `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
  return withTime ? `${date} ${d.toISOString().slice(11, 16)} UTC` : date;
}

const STEPS = ["写信", "什么时候打开", "确认", "封存"] as const;
type Step = 1 | 2 | 3 | 4;

/** The letter as it is being written, kept in this browser so a reload loses nothing; gone once sealed. */
const DRAFT_KEY = "unimap.capsule.draft";
type LetterDraft = {
  step: Step;
  recipient: string;
  letter: string;
  day: string;
  clock: string;
  preset: number | "pick" | null;
  photoOn: boolean;
  styleOn: boolean;
  style: EnvelopeStyle;
  notify: boolean;
  isPublic: boolean;
  line: string;
  tag: Tag;
  gift: GiftChoice;
};
function loadLetterDraft(): Partial<LetterDraft> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<LetterDraft>) : null;
  } catch {
    return null;
  }
}
const saveLetterDraft = (d: LetterDraft) => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {}
};
const dropLetterDraft = () => {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
};

/** 时间胶囊 · 写信, one thing at a time: the letter, when it opens, a look over what it costs (and
 * what it can carry), then sealing it. The tier follows from what is picked: a wallet's first letter
 * with nothing added is the free 首封; a photo, an envelope or the notice makes it the paid one. */
export default function CapsuleWritePage() {
  const router = useRouter();
  const { tip } = useTip();
  const { address, token, sign, ready, wallet } = useSession();
  const [rules, setRules] = useState<CapsuleRules | null>(null);
  const [paidSats, setPaidSats] = useState(0);
  const [step, setStep] = useState<Step>(1);
  const [recipient, setRecipient] = useState("");
  const [letter, setLetter] = useState("");
  const [day, setDay] = useState("");
  const [clock, setClock] = useState("00:00");
  const [preset, setPreset] = useState<number | "pick" | null>(null);
  const [forDay, setForDay] = useState<string | null>(null);
  const [isPublic, setPublic] = useState(false);
  const [line, setLine] = useState("");
  const [tag, setTag] = useState<Tag>("other");
  const [style, setStyle] = useState<EnvelopeStyle>(DEFAULT_STYLE);
  const [styleOn, setStyleOn] = useState(false);
  const [notify, setNotify] = useState(false);
  const [photo, setPhoto] = useState<{ bytes: Uint8Array; url: string } | null>(null);
  const [photoOn, setPhotoOn] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [pending, setPending] = useState<{ id: string; key: string; payment: Payment | null; gift: GiftDraft | null } | null>(null); // key: the link's (#k=, or an inscribed letter's half, #r=)
  const [gift, setGift] = useState(NO_GIFT);
  const [funding, setFunding] = useState<GiftDraft | null>(null); // sealed (and paid): the inscription, or the gift's sats, still to send
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [feeRate, setFeeRate] = useState<number | null>(null); // the gift network's, sat/vB
  const [restored, setRestored] = useState(false);
  const liveSwitch = useLiveSignet(); // the demo's 真实 Signet (lib/signet.ts): the rules' gift part follows it

  // The letter from before a reload, if any.
  useEffect(() => {
    const d = loadLetterDraft();
    if (d) {
      if (d.step && d.step >= 1 && d.step <= 4) setStep(d.step);
      if (typeof d.recipient === "string") setRecipient(d.recipient);
      if (typeof d.letter === "string") setLetter(d.letter);
      if (typeof d.day === "string") setDay(d.day);
      if (typeof d.clock === "string") setClock(d.clock);
      if (d.preset !== undefined) setPreset(d.preset);
      setPhotoOn(!!d.photoOn);
      setStyleOn(!!d.styleOn);
      if (d.style && (STYLES as readonly string[]).includes(d.style)) setStyle(d.style);
      setNotify(!!d.notify);
      setPublic(!!d.isPublic);
      if (typeof d.line === "string") setLine(d.line);
      if (d.tag && (TAGS as readonly string[]).includes(d.tag)) setTag(d.tag);
      if (d.gift) setGift({ ...NO_GIFT, ...d.gift });
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (restored && !pending && !funding) saveLetterDraft({ step, recipient, letter, day, clock, preset, photoOn, styleOn, style, notify, isPublic, line, tag, gift });
  }, [restored, pending, funding, step, recipient, letter, day, clock, preset, photoOn, styleOn, style, notify, isPublic, line, tag, gift]);

  useEffect(() => {
    if (!ready) return;
    api<CapsuleRules>("/v1/capsules/rules", { token }).then(setRules, (e) => setError(e.message));
  }, [ready, token, liveSwitch]);
  useEffect(() => {
    api<BillingProducts>("/v1/billing/products").then((r) => setPaidSats(r.products.find((p) => p.product === "capsule")?.amount_sats ?? 0), () => {});
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(timer);
  }, []);
  const lead = rules?.min_lead_seconds ?? 86400;
  const blockSeconds = rules?.block_seconds ?? BLOCK_SECONDS;
  const freeDays = rules?.free_days ?? 366;
  // 上链: billing on and a gift network: every letter is inscribed (api/capsule.py onchain()).
  const onchain = !!rules?.onchain && !!rules?.gift;
  const rate = rules?.usd ?? null;
  const options = useMemo(
    () => tierOptions(!!rules?.billing && paidSats > 0, rules?.free_left ?? null, paidSats, rules?.inscribe_sats ?? 20_000, !!rules?.onchain && !!rules?.gift),
    [rules, paidSats],
  );
  const giftRules = rules?.gift ?? null;
  const giftOn = !!giftRules && gift.on;
  const live = (giftOn || onchain) && !!giftRules?.live;

  // Start a year out, or on the next anniversary of the day the birthday finder was given (?for=YYYY-MM-DD).
  useEffect(() => {
    if (!rules || !restored) return;
    const given = new URLSearchParams(window.location.search).get("for");
    const start = Math.floor(Date.now() / 1000) + rules.min_lead_seconds;
    const anniversary = given ? nextAnniversary(given, start) : null;
    if (given && anniversary) setForDay(given);
    if (day) return;
    setDay(anniversary ?? dayOf(Math.floor(Date.now() / 1000) + YEAR));
    setPreset(anniversary ? "pick" : YEAR);
  }, [rules, restored, day]);

  const openAt = useMemo(() => {
    const ms = Date.parse(`${day}T${clock || "00:00"}:00Z`);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }, [day, clock]);

  // The tier follows from what is picked (no picker): the 首封 while the wallet has it and nothing
  // added needs the paid letter; else the paid one. "open" with billing off.
  const freeOffered = options.some((o) => o.tier === "free");
  const paidOffered = options.some((o) => o.tier === "paid" && o.available);
  const farForFree = openAt != null && pastFreeLimit("free", openAt, now, freeDays, onchain);
  const wantsPaid = photoOn || styleOn || notify || (!onchain && (giftOn || farForFree));
  const chosen: Tier = !options.length ? "open" : !freeOffered || (wantsPaid && paidOffered) ? "paid" : "free";
  const allows = tierAllows(chosen, onchain);
  const serviceSats = chosen === "paid" ? paidSats : 0;
  const withPhoto = photoOn && allows.photo ? photo : null;
  const firstUsed = !!options.length && !freeOffered; // the wallet's 首封 is gone

  // 上链: the gift network's fee rate, for what the inscription costs there.
  useEffect(() => {
    if (!onchain || !giftRules) return;
    let on = true;
    chainFor(giftRules.network, giftRules.esplora, !!giftRules.live)
      .feeRate()
      .then((r) => on && setFeeRate(r), () => on && setFeeRate(null));
    return () => {
      on = false;
    };
  }, [onchain, giftRules]);

  const tooSoon = openAt != null && openAt < now + lead;
  const tooFar = openAt != null && pastFreeLimit(chosen, openAt, now, freeDays, onchain);
  const left = openAt != null ? blocksUntil(openAt, now, blockSeconds) : null;
  const giftHeight = giftRules?.tip != null && openAt != null ? giftRules.tip + blocksUntil(openAt, now, giftRules.block_seconds) : null;
  // What the inscription will show, for its cost: the shared envelope, or the SVG naming this block.
  const face = faceOf(giftRules ?? {}, giftHeight ?? giftRules?.tip ?? 0);
  const at = (seconds: number) => {
    const when = Math.floor(Date.now() / 1000) + seconds;
    setDay(dayOf(when));
    setClock(seconds < 86400 ? new Date(when * 1000).toISOString().slice(11, 16) : "00:00");
    setPreset(seconds);
  };
  // The demo lets a letter open in minutes; offer that there only. With the real signet, the next
  // block or the one after (H = tip + 1 or 2, about 10 to 20 minutes).
  const giftBlock = giftRules?.block_seconds ?? 600;
  const quick: [string, number][] = !DEMO
    ? []
    : live
      ? [
          [t("下一个块（约 10 分钟）"), Math.max(lead + 30, Math.floor(giftBlock / 2))],
          [t("两个块后（约 20 分钟）"), Math.floor(giftBlock * 1.5)],
        ]
      : lead < 3600
        ? [[t("几分钟后"), Math.max(lead, 60) + 120]]
        : [];
  const presets: [string, number][] = [...quick, [t("1 年后"), YEAR], [t("5 年后"), 5 * YEAR], [t("10 年后"), 10 * YEAR], [t("18 年后"), 18 * YEAR]];
  const soon = openAt != null && openAt - now < 2 * 86400;

  const pickPhoto = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    setPhotoBusy(true);
    try {
      // Inscribed, every byte is a network fee: a small WebP, ~20 KB, 50 KB at most.
      const bytes = onchain ? await compressImage(file, rules?.max_chain_photo_bytes ?? MAX_CHAIN_PHOTO_BYTES, CHAIN_PHOTO_SIDE, CHAIN_PHOTO_TARGET) : await compressImage(file);
      setPhoto((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { bytes, url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageType(bytes) })) };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("读不出这张照片。"));
    } finally {
      setPhotoBusy(false);
    }
  };
  const removePhoto = () =>
    setPhoto((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });

  const to = recipient.trim() || t("未来的我");
  // What each step needs before the next one; the message for the first thing missing.
  const missing = (s: Step): string | null => {
    if (s >= 1 && !letter.trim()) return t("信还是空的。");
    if (s >= 2) {
      if (openAt == null) return t("选一个打开的日子。");
      if (Math.floor(Date.now() / 1000) + lead > openAt) return lead >= 86400 ? t("打开的时间至少要在一天以后。") : t("打开的时间要再晚一点。");
      if (tooFar) return t("免费的信最多一年后打开；想等更久，要付服务费。");
    }
    if (s >= 3) {
      if (photoOn && !photo) return t("选一张照片，或者关掉「附一张照片」。");
      if (isPublic && !line.trim()) return t("写一句公开的话，或者关掉「留一句公开的话」。");
      if (wantsPaid && !paidOffered && options.length) return t("这个站点现在不收服务费，附加的选项用不了。");
    }
    return null;
  };
  const go = (s: Step) => {
    setError(null);
    if (s > step) {
      const why = missing(step);
      if (why) return setError(why);
    }
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const seal = async () => {
    setError(null);
    if (ready && !address) return askLogin(); // connect first; the price may change once the wallet is known
    const body = letter.trim(), said = isPublic ? line.trim() : "";
    const why = missing(3);
    if (why || openAt == null) return setError(why ?? t("选一个打开的日子。"));
    setBusy(true);
    try {
      const sealed = await encryptLetter(body, withPhoto?.bytes);
      // 礼物 and 上链: the gift network's tip as of now, then the keys, the address, the timelock and the split key.
      const fresh = giftOn || onchain ? (await api<CapsuleRules>("/v1/capsules/rules", { token })).gift : null;
      if (giftOn && !fresh) throw new Error(t("这个站点现在不能附礼物。"));
      if (onchain && !fresh) throw new Error(t("这个站点现在不能把信刻上链。"));
      const prepared = fresh && giftOn
        ? await prepareGift({ rules: fresh, choice: gift, walletKey: await walletPublicKey(wallet, !!fresh.live), key: sealed.key, ciphertext: sealed.ciphertext, photo: sealed.photo,
            fingerprint: sealed.fingerprint, openAt, now: Math.floor(Date.now() / 1000), recipient: to, author: address ?? "" })
        : null;
      const inscribed = fresh && onchain && !giftOn
        ? await prepareLetter({ rules: fresh, key: sealed.key, ciphertext: sealed.ciphertext, photo: sealed.photo, fingerprint: sealed.fingerprint, openAt, now: Math.floor(Date.now() / 1000), recipient: to })
        : null;
      const signedAt = Math.floor(Date.now() / 1000);
      const message = capsuleMessage(to, openAt, sealed.fingerprint, said || null, said ? tag : null, signedAt, prepared?.line ?? inscribed?.line);
      const signature = await sign(message);
      const c = await api<Capsule>("/v1/capsules", {
        method: "POST",
        token,
        body: {
          recipient: to, ciphertext: sealed.ciphertext, fingerprint: sealed.fingerprint, key: prepared?.serverHalf ?? inscribed?.serverHalf ?? sealed.key, open_at: openAt, line: said || null, tag: said ? tag : null,
          signed_at: signedAt, signature, photo: sealed.photo, style: allows.style && styleOn ? style : DEFAULT_STYLE, ...(chosen === "open" ? {} : { tier: chosen }),
          ...(prepared ? { gift: prepared.gift } : {}),
          ...(inscribed ? { chain: inscribed.chain } : {}),
        },
      });
      dropLetterDraft();
      const draft: GiftDraft | null = prepared
        ? { ...prepared.draft, capsuleId: c.id, timelock: { ...prepared.draft.timelock, c: c.id } }
        : inscribed
          ? { ...inscribed.draft, capsuleId: c.id }
          : null;
      if (draft) saveDraft(draft);
      const linkKey = inscribed ? inscribed.half : sealed.key;
      if (c.status === "pending") {
        setPending({ id: c.id, key: linkKey, payment: c.payment ?? null, gift: draft });
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
  // On a phone the next part of sealing may be below: bring it into view.
  useEffect(() => {
    if (pending || funding) document.querySelector(".cap-progress")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [pending, funding]);
  // Paid: a plain capsule goes to its page with the spare key; an inscribed one (or one with a gift) goes on to the chain.
  const paid = useCallback(() => {
    if (!pending) return;
    if (pending.gift) {
      setFunding(pending.gift);
      setPending(null);
    } else router.push(`/capsule/${pending.id}#k=${pending.key}`);
  }, [pending, router]);
  // An inscribed letter, once on the chain, goes to its page with the link's half of the key.
  const letterLink = (d: GiftDraft) => `/capsule/${d.capsuleId}${d.letter ? `#r=${d.letter.half}` : ""}`;

  // What it costs, before anything is signed.
  const letterBytes = Math.max(1, utf8Length(letter));
  const postage: "them" | "you" | null = onchain && !giftOn ? (postageAddress(recipient) ? "them" : "you") : null;
  const cost = onchain && giftRules ? costOf({ rate, feeRate, letterBytes, photoBytes: withPhoto?.bytes.length ?? 0, serviceSats, postage, face }) : null;
  const total = cost ? cost.total : serviceSats;
  const photoGuess = letterCost(letterBytes, photo?.bytes.length ?? CHAIN_PHOTO_TARGET, rate?.fee_rate ?? feeRate ?? 1, face).photoFee;
  const giftAmount = giftOn && Number.isInteger(chosenSats(gift)) ? chosenSats(gift) : null;
  // What a paid add-on adds: the service fee, unless something else makes it a paid letter already.
  const fee = money(paidSats, rate);
  const paidWithout = (k: "photo" | "style" | "notify") =>
    !freeOffered || (photoOn && k !== "photo") || (styleOn && k !== "style") || (notify && k !== "notify") || (!onchain && (giftOn || farForFree));
  const paidAdds = (k: "photo" | "style" | "notify") => (chosen === "open" ? null : paidWithout(k) ? t("已包含") : t("+{usd} 服务费", { usd: fee }));
  const photoAdds = [onchain ? t("+约 {usd}", { usd: money(photoGuess, rate) }) : null, paidAdds("photo") === t("已包含") ? null : paidAdds("photo")].filter(Boolean).join(" · ") || t("免费");

  // Where sealing is: 1 签名, 2 付服务费 (paid), 3 保存到比特币 (inscribed, or a gift).
  const marks: { key: string; label: string }[] = [
    { key: "sign", label: t("签名#step") },
    ...(chosen === "paid" ? [{ key: "pay", label: t("付服务费") }] : []),
    ...(onchain || giftOn ? [{ key: "chain", label: onchain ? t("保存到比特币") : t("锁好随信的比特币") }] : []),
  ];
  const atIndex = marks.findIndex((m) => m.key === (funding ? "chain" : pending ? "pay" : "sign"));

  const testBadge = giftRules ? (
    <span className="gift-net" title={t("测试网的币没有价值，只用来试")}>
      {t("测试网")}
    </span>
  ) : null;

  return (
    <div className="page capsule-page">
      <PageIntro page="capsule" title={t("时间胶囊")}>
        {t("写一封信，到你选的那一天才能打开。")}
      </PageIntro>
      <div className="cap-flow">
        <header className="cap-flow-head">
          <p className="eyebrow">
            {forDay ? t("给 {day} 这一天写一封信", { day: forDay }) : t("新的时间胶囊")} {testBadge}
          </p>
          <h1 className="cap-title">{t("给将来的自己，或你爱的人，\n封存一份礼物")}</h1>
        </header>
        <ol className="cap-steps" aria-label={t("步骤")}>
          {STEPS.map((name, i) => {
            const n = (i + 1) as Step;
            const state = n === step ? "now" : n < step ? "done" : "";
            const canGo = n < step && !pending && !funding && !busy;
            return (
              <li key={name} className={state} aria-current={n === step ? "step" : undefined}>
                <button type="button" onClick={() => go(n)} disabled={!canGo}>
                  <i>{n < step ? "✓" : n}</i>
                  <span>{t(name)}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {step === 1 && (
          <section className="cap-step" aria-label={t("写信")}>
            <label className="cap-field">
              <span>{t("写给谁")}</span>
              <input value={recipient} onChange={(e) => setRecipient(e.target.value.replace(/\n/g, ""))} maxLength={MAX_RECIPIENT} placeholder={t("18 岁的小满")} name="recipient" />
              <span className="dim small">{onchain || allows.told ? t("写名字就行。写对方的比特币地址的话，信会直接送到 Ta 那里。") : t("写名字就行，不写就是写给未来的自己。")}</span>
            </label>
            <label className="cap-field">
              <span>{t("信")}</span>
              <textarea className="cap-letter" value={letter} onChange={(e) => setLetter(e.target.value)} maxLength={MAX_LETTER} rows={9} placeholder={t("小满：今天你出生了……")} name="letter" />
              <span className="dim small cap-chars">
                <span className="mono">{letter.length.toLocaleString("en-US")}</span> / <span className="mono">{MAX_LETTER.toLocaleString("en-US")}</span>
              </span>
            </label>
          </section>
        )}

        {step === 2 && (
          <section className="cap-step" aria-label={t("什么时候打开")}>
            <div className="cap-field">
              <span>{t("什么时候打开")}</span>
              <div className="cap-chips">
                {presets.map(([label, s]) => (
                  <button key={label} type="button" className={`cap-chip${preset === s ? " on" : ""}`} onClick={() => at(s)} aria-pressed={preset === s}>
                    {label}
                  </button>
                ))}
                <button type="button" className={`cap-chip${preset === "pick" ? " on" : ""}`} onClick={() => setPreset("pick")} aria-pressed={preset === "pick"}>
                  {t("选一个日子")}
                </button>
              </div>
              {preset === "pick" && (
                <div className={`cap-when-inputs${DEMO || lead < 86400 ? "" : " one"}`}>
                  <input type="date" value={day} onChange={(e) => setDay(e.target.value)} name="open-day" aria-label={t("日期")} />
                  {(DEMO || lead < 86400) && <input type="time" value={clock} onChange={(e) => setClock(e.target.value)} name="open-time" aria-label={t("时间 (UTC)")} />}
                </div>
              )}
            </div>
            {openAt != null && (
              <div className={`cap-when${tooSoon || tooFar ? " bad" : ""}`}>
                <b>{t("{date}打开", { date: dayWords(openAt, soon) })}</b>
                {tooSoon ? (
                  <span className="small">{lead >= 86400 ? t("打开的时间至少要在一天以后。") : t("打开的时间要再晚一点。")}</span>
                ) : (
                  left != null && <span className="dim small">{spanText(left, blockSeconds)}</span>
                )}
                {!tooSoon && !onchain && farForFree && paidOffered && <span className="dim small">{t("超过一年才打开的信要付服务费（{usd}）。", { usd: fee })}</span>}
                {tip != null && left != null && !tooSoon && <span className="dim small cap-when-block">{t("约在第 {h} 个比特币区块", { h: (tip + left).toLocaleString("en-US") })}</span>}
              </div>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="cap-step" aria-label={t("确认")}>
            <div className="cap-summary">
              <div className="cap-summary-row">
                <span>{t("写给")}</span>
                <b>{to}</b>
              </div>
              <div className="cap-summary-row">
                <span>{t("打开")}</span>
                <b>{openAt != null ? dayWords(openAt, soon) : "—"}</b>
              </div>
              {giftAmount != null && (
                <div className="cap-summary-row">
                  <span>{t("随信的比特币")}</span>
                  <b>
                    <Amount>{giftSats(giftAmount)}</Amount>
                  </b>
                </div>
              )}
              {serviceSats > 0 && (
                <div className="cap-summary-row">
                  <span>{t("服务费")}</span>
                  <b>
                    <Amount>{money(serviceSats, rate)}</Amount>
                  </b>
                </div>
              )}
              <div className="cap-summary-total">
                <span>{cost ? t("一共约") : t("一共")}</span>
                <b>
                  <Amount>{total > 0 ? money(total, rate) : t("免费")}</Amount>
                </b>
              </div>
              <div className="cap-summary-notes">
                {cost && <span className="dim small">{t("包含网络费")}</span>}
                {chosen === "free" && <span className="cap-free">{t("第一封免服务费")}</span>}
                {firstUsed && onchain && <span className="dim small">{t("这个钱包的第一封已经寄过了。")}</span>}
              </div>
              {cost && giftRules && (
                <details className="cap-more">
                  <summary className="small muted">{t("费用明细")}</summary>
                  <CostDetails cost={cost} rate={rate} feeRate={feeRate} serviceSats={serviceSats} postage={postage} giftSats={giftAmount} letterBytes={letterBytes} photoBytes={withPhoto?.bytes.length ?? 0} face={face} network={giftRules.network} />
                </details>
              )}
            </div>

            <div className="cap-addons" role="group" aria-label={t("可选")}>
              <span className="cap-addons-title">{t("可选")}</span>
              {options.length === 0 || paidOffered || chosen === "open" ? (
                <>
                  <Addon
                    name={t("附一张照片")}
                    adds={photoAdds}
                    on={photoOn}
                    set={(v) => (setPhotoOn(v), v ? null : removePhoto())}
                  >
                    <PhotoPick photo={photo} busy={photoBusy} onchain={onchain} extra={photo && onchain ? money(letterCost(letterBytes, photo.bytes.length, rate?.fee_rate ?? feeRate ?? 1, face).photoFee, rate) : null} pick={pickPhoto} remove={removePhoto} />
                  </Addon>
                  <Addon name={t("选信封样式")} adds={paidAdds("style") ?? t("免费")} on={styleOn} set={setStyleOn}>
                    <StylePicker value={style} onChange={setStyle} locked={false} />
                  </Addon>
                  {options.length > 0 && (
                    <Addon name={t("打开时提醒我和收信人")} adds={paidAdds("notify") ?? t("免费")} on={notify} set={setNotify}>
                      <span className="dim small">{t("信打开那天，unimap 会提醒你；收信人写的是比特币地址的话，也会提醒 Ta。")}</span>
                    </Addon>
                  )}
                </>
              ) : (
                <p className="dim small">{t("照片、信封样式和打开提醒现在还用不了。")}</p>
              )}
              {giftRules && (
                <Addon name={t("随信附送比特币")} adds={giftAmount != null ? giftSats(giftAmount) : t("自己定金额")} on={gift.on} set={(v) => setGift({ ...gift, on: v })}>
                  <GiftPicker rules={giftRules} value={gift} onChange={setGift} height={giftHeight} blockSeconds={giftRules.block_seconds} live={liveSwitch} />
                </Addon>
              )}
              <Addon name={t("留一句公开的话")} adds={t("免费")} on={isPublic} set={setPublic}>
                <input value={line} onChange={(e) => setLine(e.target.value.replace(/\n/g, ""))} maxLength={MAX_LINE} placeholder={t("女儿出生。给她封了一封信，2044 年打开。")} name="line" aria-label={t("公开的一句话")} />
                <div className="cap-chips" role="radiogroup" aria-label={t("类型")}>
                  {TAGS.map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={tag === k} className={`cap-chip${tag === k ? " on" : ""}`} onClick={() => setTag(k)}>
                      {t(TAG_NAMES[k])}
                    </button>
                  ))}
                </div>
                <span className="dim small">{t("同一个区块封信的人（同块人）能看到这句话和你的钱包缩写；信的内容永远不会出现在那里。")}</span>
              </Addon>
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="cap-step" aria-label={t("封存")}>
            <p className="cap-seal-line">
              {t("给 {name}", { name: to })} · {openAt != null ? t("{date}打开", { date: dayWords(openAt, soon) }) : ""} ·{" "}
              <Amount>{total > 0 ? (cost ? t("一共约 {usd}", { usd: money(total, rate) }) : t("一共 {usd}", { usd: money(total, rate) })) : t("免费")}</Amount>
            </p>
            <ol className="cap-progress" aria-label={t("封存的步骤")}>
              {marks.map((m, i) => (
                <li key={m.key} className={i < atIndex ? "done" : i === atIndex && (busy || pending || funding) ? "now" : ""}>
                  <i>{i < atIndex ? "✓" : i + 1}</i>
                  {m.label}
                </li>
              ))}
            </ol>
            {funding ? (
              <>
                <GiftFund
                  draft={funding}
                  token={token}
                  done={(d) => (d.letter ? router.push(letterLink(d)) : undefined)}
                  note={cost && <span className="dim small">{t("网络费约 {usd}", { usd: money(cost.main.fee + cost.post, rate) })}</span>}
                />
                <Link className="btn" href={letterLink(funding)}>
                  {t("看看封好的信封")}
                </Link>
              </>
            ) : pending ? (
              <CapsulePay capsuleId={pending.id} first={pending.payment} token={token} done={paid} step />
            ) : (
              <>
                <button type="button" className="primary lg cap-seal-btn" onClick={seal} disabled={busy || !rules || photoBusy}>
                  {busy ? t("请在钱包里签名…") : t("封存这封信")}
                </button>
                <span className="dim small">{ready && !address ? t("会先请你连接钱包。签名不花钱。") : t("钱包会请你签名，签名不花钱。")}</span>
              </>
            )}
          </section>
        )}

        {error && <p className="error small">{error}</p>}
        {!pending && !funding && (
          <nav className="cap-nav" aria-label={t("步骤")}>
            {step > 1 ? (
              <button type="button" className="ghost" onClick={() => go((step - 1) as Step)} disabled={busy}>
                {t("上一步")}
              </button>
            ) : (
              <span />
            )}
            {step < 4 && (
              <button type="button" className="primary" onClick={() => go((step + 1) as Step)}>
                {step === 3 ? t("下一步：封存") : t("下一步")}
              </button>
            )}
          </nav>
        )}

        <details className="cap-more cap-howto">
          <summary className="small muted">{t("了解更多")}</summary>
          <ul className="small dim">
            <li>{t("信在你的浏览器里上锁，unimap 读不到。")}</li>
            <li>{onchain ? t("上了锁的信永久保存在比特币上：谁都能看到它在，但到了打开那天才能读。") : t("上了锁的信存在 unimap，用你的钱包签名，挂在今天的比特币区块上。")}</li>
            <li>{onchain ? t("unimap 替你保管一部分钥匙，到那天才交出；另一部分在封好后给你的链接里，把链接发给收信人。") : t("unimap 保管钥匙，到那天才交出；封好后的链接里也有一把备用钥匙，把链接发给收信人。")}</li>
            {onchain && <li>{t("就算 unimap 不在了，到了那天钥匙也会自动公开，信照样能打开。")}</li>}
            {giftRules && <li>{t("随信附送的比特币锁在比特币网络上，到那天之前谁都动不了，包括 unimap。")}</li>}
            {giftRules && <li>{t("现在用的是测试网：测试币没有价值，只用来试。")}</li>}
          </ul>
        </details>
        {DEMO && giftRules && (
          <details className="cap-more cap-test">
            <summary className="small muted">{t("测试设置")}</summary>
            <LiveSwitch live={liveSwitch} letter={!giftOn} />
          </details>
        )}
      </div>
      {token && <MyCapsules token={token} tip={tip} />}
    </div>
  );
}

/** One optional thing on the review step: a switch with its name on one line and what it adds
 * (wrapping below on a narrow screen, never squeezing the name), and its settings once on. */
function Addon({ name, adds, on, set, children }: { name: string; adds: string; on: boolean; set: (on: boolean) => void; children?: React.ReactNode }) {
  return (
    <div className={`cap-addon${on ? " on" : ""}`}>
      <label className="cap-addon-head">
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
        <span className="cap-addon-name">{name}</span>
        <span className="cap-addon-adds">{adds}</span>
      </label>
      {on && children && <div className="cap-addon-body">{children}</div>}
    </div>
  );
}

/** The photo, once 附一张照片 is on: pick one, shrunk in the browser (inscribed: ~20 KB, 50 KB at most),
 * then its size and what it adds, and a way to take it off. */
function PhotoPick(p: { photo: { bytes: Uint8Array; url: string } | null; busy: boolean; onchain: boolean; extra: string | null; pick: (f: File | undefined) => void; remove: () => void }) {
  if (p.photo)
    return (
      <div className="cap-photo-pick">
        <img src={p.photo.url} alt={t("随信附上的照片")} />
        <div>
          <span className="small">{p.extra ? t("压缩后 {size} · 多付约 {usd}", { size: kb(p.photo.bytes.length), usd: p.extra }) : t("压缩后 {size}", { size: kb(p.photo.bytes.length) })}</span>
          <button type="button" className="link-btn small" onClick={p.remove}>
            {t("去掉照片")}
          </button>
        </div>
      </div>
    );
  return (
    <label className="cap-photo-drop">
      <input type="file" accept="image/*" name="photo" onChange={(e) => p.pick(e.target.files?.[0])} disabled={p.busy} />
      <span>{p.busy ? t("正在压缩…") : t("选一张照片")}</span>
      <span className="dim small">{p.onchain ? t("会压成一张小图（最大 50 KB），越小越便宜。") : t("会压到 300 KB 以内，和信一起上锁。")}</span>
    </label>
  );
}

type Cost = { mainRate: number; main: ReturnType<typeof letterCost>; post: number; total: number };
/** 上链: what sealing costs. The network fee is vbytes × fee rate (lib/gift.ts inscriptionVbytes: the
 * letter and photo sit in the witness, a quarter each byte), in dollars at mainnet's price and fee
 * rate (api/prices.py): on a test network, what the same letter would cost on mainnet. */
function costOf(p: { rate: UsdRate | null; feeRate: number | null; letterBytes: number; photoBytes: number; serviceSats: number; postage: "them" | "you" | null; face: Face }): Cost {
  const mainRate = p.rate?.fee_rate ?? p.feeRate ?? 1;
  const main = letterCost(p.letterBytes, p.photoBytes, mainRate, p.face);
  const post = p.postage ? POSTAGE : 0;
  return { mainRate, main, post, total: main.fee + p.serviceSats + post };
}

/** 费用明细, folded away on the review step: each part in dollars with its sats, and how it was worked out. */
function CostDetails(p: {
  cost: Cost;
  rate: UsdRate | null;
  feeRate: number | null;
  serviceSats: number;
  postage: "them" | "you" | null; // the small amount that rides with the letter; null: it rides a gift
  giftSats: number | null;
  letterBytes: number;
  photoBytes: number;
  face: Face;
  network: keyof typeof NETWORK_NAMES;
}) {
  const { main, mainRate, post, total } = p.cost;
  const test = p.feeRate != null ? letterCost(p.letterBytes, p.photoBytes, p.feeRate, p.face) : null;
  const m = (n: number) => money(n, p.rate);
  const both = (n: number) => (
    <>
      <Amount>{m(n)}</Amount>
      {p.rate && <Amount dim>{sats(n)}</Amount>}
    </>
  );
  return (
    <div className="cap-kv cap-cost" aria-label={t("费用明细")}>
      <div>
        <span>{t("网络费（估）")}</span>
        <span>{both(main.fee)}</span>
      </div>
      <p className="dim small mono">{t("{v} vB × {r} sat/vB", { v: main.vbytes.toLocaleString("en-US"), r: mainRate })}</p>
      {p.photoBytes > 0 && (
        <div>
          <span>{t("其中照片")}</span>
          <span>
            <Amount>{t("+{usd}", { usd: m(main.photoFee) })}</Amount>
          </span>
        </div>
      )}
      <div>
        <span>{t("服务费")}</span>
        <span>{p.serviceSats > 0 ? both(p.serviceSats) : t("第一封免服务费")}</span>
      </div>
      {p.postage && (
        <div>
          <span>{p.postage === "them" ? t("随信寄给 Ta 的一小笔") : t("随信寄出、回到你这里的一小笔")}</span>
          <span>{both(post)}</span>
        </div>
      )}
      {p.giftSats != null && (
        <div>
          <span>{t("随信的比特币")}</span>
          <span>
            <Amount>{giftSats(p.giftSats)}</Amount>
          </span>
        </div>
      )}
      <div className="cap-cost-total">
        <span>{t("合计")}</span>
        <b>{both(total)}</b>
      </div>
      <p className="dim small">
        {p.rate ? t("按主网价估算：1 BTC ≈ {price}。", { price: usd(1e8, p.rate.btc_usd).replace(/\.00$/, "") }) : t("现在拿不到比特币的美元价，先按聪显示。")}{" "}
        {test && t("在 {net} 上实际付的网络费约 {n}（测试币，没有价值）。", { net: NETWORK_NAMES[p.network], n: sats(test.fee) })}
      </p>
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
