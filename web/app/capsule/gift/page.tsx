"use client";

import { hex } from "@scure/base";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LetterPaper } from "@/components/Capsule";
import { LiveNote, NetBadge, sats, TimelockCard } from "@/components/Gift";
import { short, useSession } from "@/components/Session";
import { api, ApiError, type Capsule, type CapsuleGift } from "@/lib/api";
import { decryptLetter, decryptPhoto, shortHash, spanText } from "@/lib/capsule";
import { DEMO } from "@/lib/demo";
import { roundTime, tlockDecrypt } from "@/lib/drand";
import { b64url, buildSweep, decodeContent, describeTx, finishSweep, isTestAddress, joinKey, packTimelock, REFUND_BLOCKS, sweepPsbt, timelockAddress, timelockFromHash, timelockKeys, unpackTimelock, type GiftContent, type Timelock } from "@/lib/gift";
import { chainFor, explorerAddress, explorerTx, type ChainUtxo } from "@/lib/giftchain";
import { t } from "@/lib/i18n";
import { drandProblem } from "@/lib/signet";
import { signetSigner } from "@/lib/signetwallets";
import { walletById } from "@/lib/wallets";

// The demo's pretend chain mines every 75 seconds; a real one (a 真实 Signet gift included) every 600.
const pollMs = (live: boolean) => (DEMO && !live ? 10_000 : live ? 30_000 : 60_000);
const blockSeconds = (live: boolean) => (DEMO && !live ? 75 : 600);
const clock = (unix: number) => new Date(unix * 1000).toLocaleString();
const toB64 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** 时间锁: the card a gift's recipient keeps, read from the link's #fragment (or pasted). Before H:
 * a countdown, the locked amount (checkable on an explorer) and who sealed it, never the letter.
 * From H: the letter, opened by drand's timelock or by the two halves of the backup key, and a
 * one-click sweep of the sats to an address the recipient gives. It reads the chain directly, so it
 * keeps working for the sats even if unimap's server doesn't answer. */
export default function TimelockPage() {
  const [x, setX] = useState<Timelock | null>(null);
  const [pasted, setPasted] = useState("");
  const [bad, setBad] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setX(timelockFromHash(window.location.hash));
    setReady(true);
  }, []);
  if (!ready) return <p className="page muted">{t("加载中…")}</p>;
  if (!x)
    return (
      <div className="page capsule-page gift-page">
        <h1 className="cap-title">{t("时间锁")}</h1>
        <p className="muted">{t("扫时间锁上的二维码会直接打开这里。二维码扫不出来的话，把卡片上的文字备份贴进来。")}</p>
        <label className="cap-field">
          <span>{t("时间锁的文字备份")}</span>
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} spellCheck={false} name="timelock" className="mono" />
        </label>
        <button
          type="button"
          className="primary"
          onClick={() => {
            const got = unpackTimelock(pasted.replace(/\s+/g, ""));
            setBad(!got);
            if (got) {
              window.history.replaceState(null, "", `#g=${packTimelock(got)}`);
              setX(got);
            }
          }}
        >
          {t("打开时间锁")}
        </button>
        {bad && <p className="error small">{t("这段文字不是一张完整的时间锁。")}</p>}
      </div>
    );
  return <Timelocked x={x} />;
}

function Timelocked({ x }: { x: Timelock }) {
  const { token, wallet } = useSession();
  const address = useMemo(() => timelockAddress(x), [x]);
  const packed = useMemo(() => packTimelock(x), [x]);
  const live = !!x.live; // sealed on the demo site's 真实 Signet: the real signet, here too
  const chain = useMemo(() => chainFor(x.net, null, live), [x.net, live]);
  const [found, setFound] = useState<string | null>(null); // the reveal, found on the chain when the card has none
  const [looked, setLooked] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [tip, setTip] = useState<number | null>(null);
  const [utxos, setUtxos] = useState<ChainUtxo[] | null>(null);
  const [chainDown, setChainDown] = useState(false);
  const [capsule, setCapsule] = useState<Capsule | null>(null);
  const [rec, setRec] = useState<CapsuleGift | null>(null);
  const [letter, setLetter] = useState<{ text: string; photo: string | null; how: "drand" | "backup" } | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [showCard, setShowCard] = useState(false);

  const look = useCallback(async () => {
    try {
      setTip(await chain.tip());
      setUtxos(await chain.utxos(address));
      setChainDown(false);
      // A card saved before the sats went in has no reveal txid: the chain knows it (the address's first funding).
      if (!x.t && chain.fundingTx) {
        const id = await chain.fundingTx(address);
        if (id) setFound(id);
      }
    } catch {
      setChainDown(true);
    }
    // unimap's side: who it's for and from, the txids if the card has none. Optional.
    api<Capsule>(`/v1/capsules/${x.c}`, { token }).then(setCapsule, () => {});
    api<CapsuleGift>(`/v1/capsules/${x.c}/gift`).then(
      (g) => {
        setRec(g);
        setTip((old) => old ?? g.tip);
      },
      () => {},
    ).finally(() => setLooked(true));
  }, [chain, address, x.c, x.t, token]);
  useEffect(() => {
    look();
    const timer = setInterval(look, pollMs(live));
    return () => clearInterval(timer);
  }, [look, live]);

  const reveal = x.t ?? rec?.reveal_txid ?? found ?? null;
  // A 真实 Signet card opened anywhere but the browser that sealed it: the demo has no server, so
  // unimap's half of the backup key isn't here, and only drand can open the letter.
  const away = DEMO && live && looked && !rec;
  const at = tip != null && tip >= x.h;
  const onChain = utxos?.reduce((n, u) => n + u.value, 0) ?? null;

  /** The letter's content: the inscription from the chain, else the copy unimap keeps. */
  const content = useCallback(async (): Promise<GiftContent> => {
    const id = reveal ?? (await chain.fundingTx?.(address).catch(() => null)) ?? null;
    if (id) {
      try {
        const ins = describeTx(await chain.txHex(id)).inscription;
        const c = ins ? decodeContent(ins.body) : null;
        if (c) return c;
      } catch {}
    }
    const c = capsule ?? (await api<Capsule>(`/v1/capsules/${x.c}`, { token }));
    const g = rec ?? (await api<CapsuleGift>(`/v1/capsules/${x.c}/gift`));
    if (!c.ciphertext) throw new Error(t("找不到信的密文。"));
    return { net: x.net, h: x.h, round: g.drand_round, tlock: g.tlock, fingerprint: c.fingerprint, letter: fromB64(c.ciphertext), photo: c.photo ? fromB64(c.photo) : null };
  }, [reveal, chain, address, capsule, rec, x, token]);

  const open = useCallback(async () => {
    setOpening(true);
    setOpenError(null);
    try {
      const c = await content();
      let key: Uint8Array | null = null, how: "drand" | "backup" = "drand", drandWhy = "", early: number | null = null;
      const due = roundTime(c.round);
      if (due <= Date.now() / 1000) {
        try {
          key = await tlockDecrypt(c.tlock, 8_000);
        } catch (e) {
          const p = drandProblem(c.round, due, Date.now() / 1000, e);
          if (p.kind === "early") early = p.at;
          else drandWhy = t("连不上 drand（{why}）", { why: p.why });
        }
      } else early = due;
      if (early != null) drandWhy = t("drand 要到 {time} 才公开钥匙", { time: clock(early) });
      if (!key) {
        // drand isn't out yet (H came early), can't be reached, or is gone: the backup key's two halves.
        try {
          const { half } = await api<{ half: string }>(`/v1/capsules/${x.c}/gift/backup`);
          key = joinKey(b64url.decode(half), b64url.decode(x.b));
          how = "backup";
        } catch (e) {
          const why =
            DEMO && live && e instanceof ApiError && e.status === 404
              ? t("这台设备上没有 unimap 那一半（演示站没有服务器，它只存在封信的那个浏览器里）")
              : e instanceof Error
                ? e.message
                : String(e);
          setRetryAt(early != null ? early + 5 : null);
          throw new Error(t("{drand}；备用钥匙也拿不到：{why}", { drand: drandWhy, why }));
        }
      }
      const k = b64url.encode(key);
      const text = await decryptLetter(toB64(c.letter), k);
      const photo = c.photo ? URL.createObjectURL(new Blob([(await decryptPhoto(toB64(c.photo), k)) as BlobPart], { type: "image/jpeg" })) : null;
      setLetter({ text, photo, how });
    } catch (e) {
      setOpenError(t("现在还打不开信：{why}", { why: e instanceof Error ? e.message : String(e) }));
    } finally {
      setOpening(false);
    }
  }, [content, x, live]);
  useEffect(() => {
    if (at && !letter && !opening && !openError) open();
  }, [at, letter, opening, openError, open]);
  useEffect(() => setOpenError(null), [tip]); // a new block: try again
  useEffect(() => {
    // drand's round was still to come: try again when it is out.
    if (retryAt == null) return;
    const timer = setTimeout(() => (setRetryAt(null), setOpenError(null)), Math.max(1_000, retryAt * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt]);

  const left = tip != null ? Math.max(0, x.h - tip) : null;
  const from = capsule?.author ?? x.s;

  return (
    <div className="page capsule-page gift-page">
      <div className="cap-sealed">
        <div className="cap-sealed-main gift-main">
          <span className="eyebrow">
            {t("时间锁")} · <NetBadge network={x.net} live={live} />
          </span>
          {live && (
            <LiveNote>
              <span className="dim">
                {away
                  ? t("这台设备不是封信的那一台：演示站没有服务器，unimap 那一半钥匙只存在封信的浏览器里，所以这里只能等 drand 公开钥匙来打开信（大约 {time}）。领礼物不受影响。", { time: clock(roundTime(x.d)) })
                  : t("区块高度和金额都直接读 Signet 链上（mempool.space）。到点后先用 drand 打开信，不行再用两半备用钥匙；在别的设备上打开时只有 drand 这条路。", {})}
              </span>
            </LiveNote>
          )}
          {letter ? (
            <>
              <h1 className="cap-title">{t("区块 {h} 到了，信和礼物都打开了", { h: x.h.toLocaleString("en-US") })}</h1>
              <LetterPaper
                text={letter.text}
                photo={letter.photo}
                style={capsule?.style}
                meta={[t("给 {name}", { name: x.to }), t("锁到区块 {h}", { h: x.h.toLocaleString("en-US") }), letter.how === "drand" ? t("用 drand 公开的钥匙打开") : t("用两半备用钥匙打开")]}
              />
            </>
          ) : (
            <>
              <h1 className="cap-title">{t("给 {name} 的一封信和一份礼物", { name: x.to })}</h1>
              {at ? (
                <p className="muted">{opening ? t("区块到了，正在打开信…") : openError}</p>
              ) : (
                <>
                  <div className="cap-count">
                    <span className="dim small">{t("还要再出")}</span>
                    <b className="mono">{left != null ? left.toLocaleString("en-US") : "…"}</b>
                    <span className="dim small">{left != null ? t("个块 · {span}", { span: spanText(Math.max(1, left), blockSeconds(live)) }) : t("正在看测试网的最新区块…")}</span>
                  </div>
                  <p className="dim small">{t("区块 {h} 出来之前，谁都打不开这封信，也动不了这份礼物。到时这里会自动打开。", { h: x.h.toLocaleString("en-US") })}</p>
                </>
              )}
              {at && openError && (
                <button type="button" onClick={() => (setOpenError(null), open())}>
                  {t("再试一次")}
                </button>
              )}
            </>
          )}
          {chainDown && <p className="error small">{t("连不上测试网的区块浏览器，过一会儿再看。")}</p>}
        </div>
        <aside className="cap-side">
          <h2 className="cap-side-title">{t("礼物")}</h2>
          <div className="cap-kv">
            <div>
              <span>{t("金额")}</span>
              <span className="mono">{sats(x.a)}</span>
            </div>
            <div>
              <span>{t("链上现在")}</span>
              <a className="mono" href={explorerAddress(x.net, address, live)} target="_blank" rel="noopener">
                {onChain == null ? "…" : onChain > 0 ? sats(onChain) : t("已领走或还没到账")} ↗
              </a>
            </div>
            <div>
              <span>{t("锁到区块")}</span>
              <span className="mono">{x.h.toLocaleString("en-US")}</span>
            </div>
            <div>
              <span>{t("测试网最新")}</span>
              <span className="mono">{tip?.toLocaleString("en-US") ?? "…"}</span>
            </div>
            <div>
              <span>{t("寄信人")}</span>
              <span className="mono">{short(from)}</span>
            </div>
            <div>
              <span>{t("退回")}</span>
              <span>{x.r ? t("区块 {h} 后寄信人可取回", { h: (x.h + REFUND_BLOCKS).toLocaleString("en-US") }) : t("没有退回")}</span>
            </div>
            {reveal && (
              <div>
                <span>{t("铭文")}</span>
                <a className="mono" href={explorerTx(x.net, reveal, live)} target="_blank" rel="noopener">
                  {shortHash(reveal)}i0 ↗
                </a>
              </div>
            )}
          </div>
          <p className="dim small">{t("金额可以在区块浏览器里核对：这个地址的钱只能按上面的规则花，unimap 没有钥匙。")}</p>
          {at && <Sweep x={x} utxos={utxos ?? []} wallet={wallet} onSwept={look} />}
          <button type="button" onClick={() => setShowCard((v) => !v)}>
            {showCard ? t("收起时间锁卡片") : t("显示时间锁卡片（可打印）")}
          </button>
          <NoUnimap x={x} address={address} />
          <Link className="small muted" href="/capsule">
            {t("也写一封时间胶囊")}
          </Link>
        </aside>
      </div>
      {showCard && (
        <div className="gift-card-wrap">
          <TimelockCard timelock={x} address={address} packed={packed} />
          <button type="button" className="primary" onClick={() => window.print()}>
            {t("打印时间锁")}
          </button>
        </div>
      )}
    </div>
  );
}

/** 领取: every sat at the gift address (less the fee) to an address the recipient gives, signed
 * here with the 礼物钥匙, or by the recipient's wallet when the gift is locked to its key. */
function Sweep({ x, utxos, wallet, onSwept }: { x: Timelock; utxos: ChainUtxo[]; wallet: Parameters<typeof walletById>[0]; onSwept: () => void }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const live = !!x.live;
  const chain = useMemo(() => chainFor(x.net, null, live), [x.net, live]);
  const sweep = async () => {
    setError(null);
    if (!isTestAddress(to)) return setError(t("这不像测试网地址（应该是 tb1 开头）。"));
    setBusy(true);
    try {
      const feeRate = await chain.feeRate();
      const keys = timelockKeys(x);
      const txids: string[] = [];
      for (const u of utxos) {
        let raw: string;
        if (x.gk) raw = buildSweep({ keys, utxo: u, secret: hex.decode(x.gk), to, feeRate }).hex;
        else {
          const signer = DEMO && live ? signetSigner(wallet) : walletById(wallet)?.psbt;
          if (!signer) throw new Error(t("这份礼物锁在收礼人的钱包公钥上：请连接那个钱包再领。"));
          const acc = await signer.accounts();
          raw = finishSweep(await signer.sign(sweepPsbt({ keys, utxo: u, to, feeRate }), [{ index: 0, address: acc.receive_address }])).hex;
        }
        try {
          txids.push(await chain.broadcast(raw));
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          throw new Error(live ? t("Signet 没有收下这笔交易：{why}", { why }) : why);
        }
      }
      setDone(txids);
      onSwept();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (done.length)
    return (
      <div className="gift-sweep">
        <b>{t("礼物已经发出")}</b>
        {done.map((id) => (
          <a key={id} className="mono small" href={explorerTx(x.net, id, live)} target="_blank" rel="noopener">
            {shortHash(id)} ↗
          </a>
        ))}
      </div>
    );
  return (
    <div className="gift-sweep cap-field">
      <span>{t("领取礼物")}</span>
      {utxos.length === 0 ? (
        <p className="dim small">{t("这个地址上现在没有币：可能已经领走了，或者还在路上。")}</p>
      ) : (
        <>
          <input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder={t("你的测试网地址 tb1…")} spellCheck={false} autoComplete="off" name="sweep-to" />
          <button type="button" className="primary" onClick={sweep} disabled={busy || !to}>
            {busy ? t("正在发出…") : t("一键领到这个地址")}
          </button>
          {!x.gk && <p className="dim small">{t("这份礼物锁在收礼人的钱包公钥上，要那个钱包来签。")}</p>}
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** 不靠 unimap: what spending the gift takes, written out, so it can be done with any Bitcoin tool. */
function NoUnimap({ x, address }: { x: Timelock; address: string }) {
  return (
    <details className="gift-more">
      <summary className="small muted">{t("不靠 unimap 怎么领")}</summary>
      <div className="small dim gift-howto">
        <p>{t("礼物是一个 Taproot 输出，内部公钥是 BIP-341 的 NUMS 点（没人有私钥），只能走脚本路径：")}</p>
        <code className="mono break">{`${x.h} OP_CHECKLOCKTIMEVERIFY OP_DROP ${x.rk} OP_CHECKSIG`}</code>
        <p>{t("到区块 {h} 之后，用礼物钥匙签一笔 nLockTime = {h}、nSequence = 0xfffffffe 的交易，见证是 [签名, 上面的脚本, 控制块]。", { h: x.h })}</p>
        {x.gk && (
          <p>
            {t("礼物钥匙（私钥，十六进制）：")} <code className="mono break">{x.gk}</code>
          </p>
        )}
        <p>{t("仓库里的 web/scripts/claim-gift.mjs 用这张时间锁的文字备份做同样的事，也能用 drand 解开信。")}</p>
        <p className="mono break">{address}</p>
      </div>
    </details>
  );
}
