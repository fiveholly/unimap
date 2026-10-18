"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { CapsulePay, Envelope, LetterPaper, utcDay, utcMinute, WaitBars } from "@/components/Capsule";
import { GiftFund, NetBadge, sats } from "@/components/Gift";
import { short, useSession } from "@/components/Session";
import { api, ApiError, type Capsule } from "@/lib/api";
import { decryptLetter, decryptPhoto, fingerprintOk, halfFromHash, imageType, keyFromHash, shortHash, spanText, TAG_NAMES } from "@/lib/capsule";
import { DEMO } from "@/lib/demo";
import { roundTime, tlockDecrypt } from "@/lib/drand";
import { b64url, capsuleContent, describeTx, joinKey } from "@/lib/gift";
import { chainFor, explorerTx } from "@/lib/giftchain";
import { type GiftDraft, loadDraft, timelockLink } from "@/lib/giftseal";
import { t } from "@/lib/i18n";
import { SITE_URL } from "@/lib/share";

const POLL_MS = DEMO ? 15_000 : 60_000;
const toB64 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};

/** One capsule: the sealed envelope with its countdown in blocks, or, once its block has come, the letter. */
export default function CapsulePage() {
  const { id } = useParams<{ id: string }>();
  const { token, ready } = useSession();
  const [c, setC] = useState<Capsule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spare, setSpare] = useState<string | null>(null);
  const [linkHalf, setLinkHalf] = useState<string | null>(null); // an inscribed letter's half of the key, from #r=
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
    setLinkHalf(halfFromHash(window.location.hash));
    setDraft(loadDraft(id));
  }, [load, ready, id]);
  // Watch for the block that opens it.
  useEffect(() => {
    if (c?.status !== "sealed") return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [c?.status, load]);

  const open = useCallback(
    async (key: string, early: boolean, from?: { ciphertext: string; photo: string | null }) => {
      const ciphertext = from?.ciphertext ?? c?.ciphertext, photo = from ? from.photo : (c?.photo ?? null);
      if (!ciphertext || !c) return;
      setOpenError(null);
      try {
        const text = await decryptLetter(ciphertext, key);
        const bytes = photo ? await decryptPhoto(photo, key) : null;
        const image = bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageType(bytes) })) : null;
        setLetter({ text, early, photo: image });
        setVerified(await fingerprintOk(ciphertext, c.fingerprint, photo));
      } catch {
        setOpenError(t("这把钥匙打不开这封信。"));
      }
    },
    [c],
  );
  useEffect(() => {
    if (c?.status === "open" && c.key && !letter) open(c.key, false);
  }, [c?.status, c?.key, letter, open]);

  // 上链的信: the letter is read from its inscription (unimap's copy if the chain can't be asked), and
  // opened with unimap's half and the link's, or with the key drand gives out at the opening time.
  const openChain = useCallback(async () => {
    const ch = c?.chain;
    if (!c || !ch) return;
    let from = { ciphertext: c.ciphertext ?? "", photo: c.photo ?? null };
    try {
      if (ch.reveal_txid) {
        const ins = describeTx(await chainFor(ch.network, null, !!ch.live).txHex(ch.reveal_txid)).inscription;
        const got = capsuleContent(ins); // from the metadata, or the content of a letter inscribed before metadata
        if (got) from = { ciphertext: toB64(got.letter), photo: got.photo ? toB64(got.photo) : null };
      }
    } catch {}
    const r = linkHalf ?? draft?.letter?.half ?? null;
    let key: string | null = null;
    if (c.half && r) key = b64url.encode(joinKey(b64url.decode(c.half), b64url.decode(r)));
    else if (roundTime(ch.drand_round) <= Date.now() / 1000) {
      try {
        key = b64url.encode(await tlockDecrypt(ch.tlock, 8_000));
      } catch {}
    }
    if (!key) {
      setOpenError(t("到时间了。用带一半钥匙的链接打开，或者等 drand 公开整把钥匙（约 {time}）。", { time: new Date(roundTime(ch.drand_round) * 1000).toLocaleString() }));
      return;
    }
    await open(key, false, from);
  }, [c, linkHalf, draft, open]);
  useEffect(() => {
    if (c?.status === "open" && c.chain && !letter && !openError) openChain();
  }, [c?.status, c?.chain, letter, openError, openChain]);

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
          ) : c.chain && openError ? (
            <p className="muted">{openError}</p>
          ) : (
            <p className="muted">{t("到时间了，正在打开…")}</p>
          )}
        </div>
        <aside className="cap-side">
          <h2 className="cap-side-title">{c.mine ? t("封好了") : t("一封还没到时间的信")}</h2>
          <p className="muted small">
            {c.onchain
              ? t("这封信在浏览器里上了锁，永久保存在比特币上（区块 {h}）。谁都能看到它在，但到了打开那天才能读。", { h: c.sealed_height.toLocaleString("en-US") })
              : t("这封信在浏览器里加密，用钱包签名后存在 unimap，挂在区块 {h} 上。谁都能看到它存在，但到点之前谁也读不到内容。", { h: c.sealed_height.toLocaleString("en-US") })}
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
            {!c.chain && (
              <div>
                <span>{t("钥匙")}</span>
                <span>{c.gift ? t("一半在 unimap，一半在时间锁") : t("两份都留")}</span>
              </div>
            )}
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
            <GiftSide c={c} draft={c.mine && draft?.timelock ? draft : null} token={token} reload={() => (load(), setDraft(loadDraft(c.id)))} />
          ) : c.chain ? (
            <ChainSide c={c} draft={c.mine && draft?.letter ? draft : null} half={linkHalf ?? draft?.letter?.half ?? null} token={token} reload={() => (load(), setDraft(loadDraft(c.id)))} />
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
      {draft?.timelock ? (
        <CopyButton text={timelockLink(SITE_URL, draft.timelock)} label={t("复制时间锁链接（交给收礼人）")} primary />
      ) : (
        <p className="dim small">{c.mine ? t("时间锁存在封信的那个浏览器里。") : t("收礼人拿着时间锁，到点就能打开信、领走礼物。")}</p>
      )}
      {draft?.timelock && (
        <a className="btn" href={timelockLink(SITE_URL, draft.timelock)}>
          {t("打开时间锁")}
        </a>
      )}
    </div>
  );
}

/** 上链的信 on the envelope: where it is inscribed; for the sender who sealed it in this browser,
 * inscribing it if that isn't done; and the link with the other half of the key, for the recipient. */
function ChainSide({ c, draft, half, token, reload }: { c: Capsule; draft: GiftDraft | null; half: string | null; token: string | null; reload: () => void }) {
  const ch = c.chain!;
  const link = half ? `${SITE_URL}/capsule/${c.id}#r=${half}` : null;
  return (
    <div className="cap-spare">
      <span className="small">
        {t("永久保存在比特币上")} <NetBadge network={ch.network} live={!!ch.live} />
      </span>
      <div className="cap-kv">
        <div>
          <span>{t("在比特币上")}</span>
          {ch.reveal_txid ? (
            <a href={explorerTx(ch.network, ch.reveal_txid, !!ch.live)} target="_blank" rel="noopener">
              {t("在区块浏览器里看")} ↗
            </a>
          ) : (
            <span>{t("还没保存")}</span>
          )}
        </div>
      </div>
      {draft && !draft.done && <GiftFund draft={draft} token={token} done={reload} />}
      {link ? (
        <>
          <p className="dim small">
            {c.mine
              ? t("把这个链接发给收信人：信打开那天，Ta 用它就能读。链接只显示这一次，请存好。")
              : t("你手里的链接带着钥匙的一半，信打开时就能读。")}
          </p>
          <CopyButton text={link} label={t("复制给收信人的链接")} primary />
        </>
      ) : (
        <p className="dim small">{t("到了打开那天，谁都能从比特币上读出这封信。")}</p>
      )}
      <CopyButton text={`${SITE_URL}/capsule/${c.id}`} label={t("复制信封链接（现在只能看到信封）")} />
      <details className="cap-more">
        <summary className="small muted">{t("了解更多")}</summary>
        <p className="dim small">
          {t("钥匙分成两半：unimap 留一半，到打开那天才交出；另一半在给收信人的链接里。")}{" "}
          {t("就算 unimap 不在了，到 {time} UTC 钥匙也会由 drand 自动公开，信照样能打开。", { time: new Date(roundTime(ch.drand_round) * 1000).toISOString().slice(0, 16).replace("T", " ") })}
        </p>
      </details>
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
