"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { CapsulePay, Envelope, LetterPaper, utcDay, utcMinute, WaitBars } from "@/components/Capsule";
import { GiftFund, NetBadge, sats } from "@/components/Gift";
import { short, useSession } from "@/components/Session";
import { api, ApiError, type Capsule } from "@/lib/api";
import { decryptLetter, decryptPhoto, fingerprintOk, keyFromHash, shortHash, spanText, TAG_NAMES } from "@/lib/capsule";
import { DEMO } from "@/lib/demo";
import { type GiftDraft, loadDraft, timelockLink } from "@/lib/giftseal";
import { t } from "@/lib/i18n";
import { SITE_URL } from "@/lib/share";

const POLL_MS = DEMO ? 15_000 : 60_000;

/** One capsule: the sealed envelope with its countdown in blocks, or, once its block has come, the letter. */
export default function CapsulePage() {
  const { id } = useParams<{ id: string }>();
  const { token, ready } = useSession();
  const [c, setC] = useState<Capsule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spare, setSpare] = useState<string | null>(null);
  const [letter, setLetter] = useState<{ text: string; early: boolean; photo: string | null } | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GiftDraft | null>(null); // 礼物: this browser sealed it, and keeps its 时间锁

  const load = useCallback(
    () =>
      api<Capsule>(`/v1/capsules/${id}`, { token })
        .then(setC)
        .catch((e) => setError(e instanceof ApiError && e.status === 404 ? t("没有这封信，链接可能不完整。") : e.message)),
    [id, token],
  );
  // Wait for the session, so a reply without it can't land after the one with it.
  useEffect(() => {
    if (!ready) return;
    load();
    setSpare(keyFromHash(window.location.hash));
    setDraft(loadDraft(id));
  }, [load, ready, id]);
  // Watch for the block that opens it.
  useEffect(() => {
    if (c?.status !== "sealed") return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [c?.status, load]);

  const open = useCallback(
    async (key: string, early: boolean) => {
      if (!c?.ciphertext) return;
      setOpenError(null);
      try {
        const text = await decryptLetter(c.ciphertext, key);
        const image = c.photo ? URL.createObjectURL(new Blob([(await decryptPhoto(c.photo, key)) as BlobPart], { type: "image/jpeg" })) : null;
        setLetter({ text, early, photo: image });
        setVerified(await fingerprintOk(c.ciphertext, c.fingerprint, c.photo));
      } catch {
        setOpenError(t("这把钥匙打不开这封信。"));
      }
    },
    [c?.ciphertext, c?.fingerprint, c?.photo],
  );
  useEffect(() => {
    if (c?.status === "open" && c.key && !letter) open(c.key, false);
  }, [c?.status, c?.key, letter, open]);

  if (error) return <p className="page error">{error}</p>;
  if (!c) return <p className="page muted">{t("加载中…")}</p>;

  const openAt = new Date(c.open_at);
  const opens = openAt.getUTCHours() || openAt.getUTCMinutes() ? `${utcMinute(c.open_at)} UTC` : utcDay(c.open_at);
  const tip = c.tip ?? c.sealed_height;

  if (letter) {
    const waited = (c.open_height ?? tip) - c.sealed_height;
    return (
      <div className="page cap-openday">
        <div className="cap-openday-head">
          <span className="eyebrow">
            {letter.early ? t("还没到打开的时候 · 用备用钥匙提前打开") : t("区块 {h} 出块了", { h: (c.open_height ?? 0).toLocaleString("en-US") })}
          </span>
          <h1 className="cap-title">{letter.early ? t("这封信已经封了 {n} 个块", { n: waited.toLocaleString("en-US") }) : t("这封信等了 {n} 个块", { n: waited.toLocaleString("en-US") })}</h1>
          <span className="dim small">{t("从封存到今天，比特币一次也没停过。")}</span>
        </div>
        <LetterPaper
          text={letter.text}
          photo={letter.photo}
          style={c.style}
          meta={[
            t("封存于区块 {h}", { h: c.sealed_height.toLocaleString("en-US") }),
            c.open_height != null ? t("打开于区块 {h}", { h: c.open_height.toLocaleString("en-US") }) : t("打开于 {date} 之后的第一块", { date: opens }),
            `${t("指纹")} ${shortHash(c.fingerprint)} ${verified === false ? "✗" : verified ? "✓" : ""}`,
          ]}
        />
        {verified === false && <p className="error small">{t("密文和封存时签名的指纹对不上。")}</p>}
        <div className="row cap-openday-actions">
          <Link className="btn primary" href="/capsule">
            {t("回一封，封给未来的自己")}
          </Link>
          <Link className="btn" href={`/capsule/block/${c.sealed_height}`}>
            {t("看看同块的人")}
          </Link>
          {letter.early && (
            <button type="button" className="ghost" onClick={() => setLetter(null)}>
              {t("合上信")}
            </button>
          )}
        </div>
      </div>
    );
  }

  // 封存 not paid yet: only its author gets here, with a fresh invoice.
  if (c.status === "pending")
    return (
      <div className="page capsule-page">
        <div className="cap-sealed">
          <div className="cap-sealed-main">
            <Envelope height={c.sealed_height} recipient={c.recipient} opens={opens} style={c.style} />
            <p className="muted cap-count">{t("这封信还在等付款，付好才算封存。")}</p>
          </div>
          <aside className="cap-side">
            <CapsulePay capsuleId={c.id} first={null} token={token} done={load} />
          </aside>
        </div>
      </div>
    );

  const left = c.blocks_left ?? 1;
  return (
    <div className="page capsule-page">
      <div className="cap-sealed">
        <div className="cap-sealed-main">
          <Envelope height={c.sealed_height} recipient={c.recipient} opens={opens} style={c.style} />
          {c.status === "sealed" ? (
            <>
              <div className="cap-count">
                <span className="dim small">{t("还要再出")}</span>
                <b className="mono">{left.toLocaleString("en-US")}</b>
                <span className="dim small">{t("个块 · {span}", { span: spanText(left, DEMO ? 75 : 600) })}</span>
              </div>
              <WaitBars sealed={c.sealed_height} tip={tip} left={left} />
            </>
          ) : c.gift ? (
            <p className="muted">{t("到时间了。这封信带着礼物，要用收礼人手里的时间锁打开。")}</p>
          ) : (
            <p className="muted">{t("到时间了，正在打开…")}</p>
          )}
        </div>
        <aside className="cap-side">
          <h2 className="cap-side-title">{c.mine ? t("封好了") : t("一封还没到时间的信")}</h2>
          <p className="muted small">
            {t("这封信在浏览器里加密，用钱包签名后存在 unimap，挂在区块 {h} 上。谁都能看到它存在，但到点之前谁也读不到内容。", { h: c.sealed_height.toLocaleString("en-US") })}
          </p>
          <div className="cap-kv">
            <div>
              <span>{t("封存在")}</span>
              <span className="mono">{t("区块 {n}", { n: c.sealed_height.toLocaleString("en-US") })}</span>
            </div>
            <div>
              <span>{t("打开于")}</span>
              <span className="mono">{t("{date} 后第一块", { date: opens })}</span>
            </div>
            <div>
              <span>{t("钥匙")}</span>
              <span>{c.gift ? t("一半在 unimap，一半在时间锁") : t("两份都留")}</span>
            </div>
            {c.has_photo && (
              <div>
                <span>{t("照片")}</span>
                <span>{t("一张，和信一起打开")}</span>
              </div>
            )}
            <div>
              <span>{t("寄信人")}</span>
              <Link className="mono" href={`/address/${c.author}`}>
                {c.mine ? t("你") : short(c.author)}
              </Link>
            </div>
            {c.line && (
              <div>
                <span>{t("公开的一句话")}</span>
                <span className="cap-kv-line">
                  {c.tag && <span className="cap-tag">{t(TAG_NAMES[c.tag])}</span>} {c.line}
                </span>
              </div>
            )}
          </div>
          <p className="cap-hash">
            {t("密文指纹 sha256: {hash} · 任何人都能核对，内容从封存起没被改过", { hash: shortHash(c.fingerprint) })}
          </p>
          {c.gift ? (
            <GiftSide c={c} draft={c.mine ? draft : null} token={token} reload={() => (load(), setDraft(loadDraft(c.id)))} />
          ) : spare ? (
            <SpareKey id={c.id} spare={spare} mine={c.mine} open={() => open(spare, true)} />
          ) : (
            <CopyButton text={`${SITE_URL}/capsule/${c.id}`} label={t("复制信封链接（现在只能看到信封）")} />
          )}
          {openError && <p className="error small">{openError}</p>}
          <Link className="btn" href={`/capsule/block/${c.sealed_height}`}>
            {t("看看同块的人")}
          </Link>
          {c.mine && c.line && <RemoveLine id={c.id} token={token} done={load} />}
        </aside>
      </div>
    </div>
  );
}

/** 礼物 on the envelope: the amount and its block; for the sender who sealed it in this browser,
 * locking the sats if that isn't done, and the 时间锁 to hand over. */
function GiftSide({ c, draft, token, reload }: { c: Capsule; draft: GiftDraft | null; token: string | null; reload: () => void }) {
  const g = c.gift!;
  return (
    <div className="cap-spare">
      <span className="small">
        {t("随信的礼物")} <NetBadge network={g.network} live={!!g.live} />
      </span>
      <div className="cap-kv">
        <div>
          <span>{t("金额")}</span>
          <span className="mono">{sats(g.sats)}</span>
        </div>
        <div>
          <span>{t("锁到区块")}</span>
          <span className="mono">{g.height.toLocaleString("en-US")}</span>
        </div>
        <div>
          <span>{t("状态")}</span>
          <span>{g.funded ? t("已锁在链上") : t("还没锁进去")}</span>
        </div>
      </div>
      {draft && !draft.done && <GiftFund draft={draft} token={token} done={reload} />}
      {draft ? (
        <CopyButton text={timelockLink(SITE_URL, draft.timelock)} label={t("复制时间锁链接（交给收礼人）")} primary />
      ) : (
        <p className="dim small">{c.mine ? t("时间锁存在封信的那个浏览器里。") : t("收礼人拿着时间锁，到点就能打开信、领走礼物。")}</p>
      )}
      {draft && (
        <a className="btn" href={timelockLink(SITE_URL, draft.timelock)}>
          {t("打开时间锁")}
        </a>
      )}
    </div>
  );
}

/** The spare key, from the link's #fragment: shown with the link that carries it, and it can open the letter now. */
function SpareKey({ id, spare, mine, open }: { id: string; spare: string; mine: boolean; open: () => void }) {
  const link = `${SITE_URL}/capsule/${id}#k=${spare}`;
  return (
    <div className="cap-spare">
      <span className="small">{t("备用钥匙")}</span>
      <code className="cap-hash">{spare}</code>
      <p className="dim small">
        {mine
          ? t("这把钥匙只在这一次显示，unimap 不会再给你。把下面的链接发给收信人：拿着它随时能打开；不给钥匙的话，对方到点也能读。")
          : t("你手里的链接带着备用钥匙，现在就能打开。")}
      </p>
      <CopyButton text={link} label={t("复制给收信人的链接（带备用钥匙）")} primary />
      <CopyButton text={`${SITE_URL}/capsule/${id}`} label={t("复制信封链接（现在只能看到信封）")} />
      <button type="button" className="link-btn small" onClick={open}>
        {t("用备用钥匙现在打开")}
      </button>
    </div>
  );
}

function CopyButton({ text, label, primary }: { text: string; label: string; primary?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={primary ? "primary" : ""}
      onClick={() =>
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? t("已复制") : label}
    </button>
  );
}

function RemoveLine({ id, token, done }: { id: string; token: string | null; done: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="link-btn small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await api(`/v1/capsules/${id}/line`, { method: "DELETE", token }).catch(() => {});
        done();
      }}
    >
      {t("从同块人里撤下这句话")}
    </button>
  );
}
