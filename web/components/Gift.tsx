"use client";

// 礼物 on the capsule pages (lib/gift.ts, lib/giftseal.ts): picking a gift on the write page,
// locking its sats once 封存 is paid, and the 时间锁 card the recipient keeps. GiftFund also
// inscribes a letter without a gift (上链的信), the same commit and reveal with postage for output 0.

import { hex } from "@scure/base";
import qrcode from "qrcode-generator";
import { useMemo, useState, useSyncExternalStore } from "react";

import { useSession } from "@/components/Session";
import { api, type CapsuleGift, type GiftRules } from "@/lib/api";
import { shortHash, spanText } from "@/lib/capsule";
import { DEMO, DEMO_GIFT_SENDER_KEY, DEMO_TEST_ADDRESS, demoChain } from "@/lib/demo";
import { buildReveal, commitPsbt, commitTaproot, finishCommit, GIFT_TIERS, isTestAddress, NETWORK_NAMES, revealFee, type GiftNetwork, type Outpoint, type Timelock } from "@/lib/gift";
import { chainFor, explorerAddress, explorerTx } from "@/lib/giftchain";
import { chosenSats, envelopeOf, type GiftChoice, type GiftDraft, saveDraft, timelockLink } from "@/lib/giftseal";
import { t } from "@/lib/i18n";
import { SITE_URL } from "@/lib/share";
import { liveSignet, onLiveSignet, setLiveSignet } from "@/lib/signet";
import { signetSigner, switchToSignet, WrongNetwork, type SignetWalletId } from "@/lib/signetwallets";
import { walletById } from "@/lib/wallets";

export const sats = (n: number) => t("{n} 聪", { n: n.toLocaleString("en-US") });
const tierName = (n: number) => (n % 10_000 === 0 ? t("{n} 万聪", { n: n / 10_000 }) : sats(n));

/** 测试网: a gift is never on mainnet, and says so wherever it shows. live: the demo's 真实 Signet. */
export function NetBadge({ network, live }: { network: GiftNetwork; live?: boolean }) {
  return live ? (
    <span className="gift-net live" title={LIVE_LINE()}>
      {t("测试网 · Signet · 真实交易")}
    </span>
  ) : (
    <span className="gift-net" title={t("测试网的币没有价值，只用来试")}>
      {t("测试网 · {net}", { net: NETWORK_NAMES[network] })}
    </span>
  );
}

const LIVE_LINE = () => t("测试网 · Signet，真实交易，测试币没有价值");
/** The line a 真实 Signet gift carries wherever it shows (lib/signet.ts). */
export function LiveNote({ children }: { children?: React.ReactNode }) {
  return (
    <div className="gift-live-note small" role="note">
      <b>{LIVE_LINE()}</b>
      {children}
    </div>
  );
}

/** The demo's 真实 Signet switch, as this browser has it (lib/signet.ts). */
export function useLiveSignet(): boolean {
  return useSyncExternalStore(onLiveSignet, liveSignet, () => false);
}

/** The demo site's switch between its pretend chain and the real signet, on the gift step (and, for
 * an inscribed letter, by its cost). */
export function LiveSwitch({ live, letter = false }: { live: boolean; letter?: boolean }) {
  return (
    <div className={`gift-live${live ? " on" : ""}`}>
      <label className="check">
        <input type="checkbox" checked={live} onChange={(e) => setLiveSignet(e.target.checked)} name="gift-live" />
        <b>{t("真实 Signet")}</b>
        <span className="dim small">{t("（演示站）")}</span>
      </label>
      {live ? (
        <LiveNote>
          <span className="dim">
            {letter
              ? t("信用你自己的钱包真实地刻在比特币 Signet 测试网上：先把 UniSat 切到 Signet，准备一点测试币。演示站没有服务器，unimap 那一半钥匙存在这个浏览器里；服务费照旧只是模拟。")
              : t("礼物用你自己的钱包在比特币 Signet 测试网上真实交易：先把 UniSat 切到 Signet，准备一点测试币。区块约 10 分钟一个，到点后真的能领走。演示站没有服务器，unimap 那一半钥匙存在这个浏览器里；封存的费用照旧只是模拟。")}
          </span>
        </LiveNote>
      ) : (
        <span className="dim small">
          {letter ? t("关着时信只刻在演示站模拟的链上。打开后，用你的钱包在 Signet 上发真实的测试网交易。") : t("关着时礼物只在演示站里模拟，不碰任何链。打开后，用你的钱包在 Signet 上发真实的测试网交易。")}
        </span>
      )}
    </div>
  );
}

/** The sender's wallet public key for the refund leaf, when the wallet gives one (the demo wallet's is
 * made up; with 真实 Signet, the real wallet's, which also checks it is on signet). */
export async function walletPublicKey(walletId: Parameters<typeof walletById>[0], live = false): Promise<string | null> {
  if (DEMO && live) {
    const signer = signetSigner(walletId);
    if (!signer) return null;
    const acc = await signer.accounts(); // a wallet on the wrong network says so here, before anything is sealed
    return acc.receive_public_key ?? acc.payment_public_key ?? null;
  }
  if (DEMO) return DEMO_GIFT_SENDER_KEY;
  try {
    const acc = await walletById(walletId)?.psbt?.accounts();
    return acc?.receive_public_key ?? acc?.payment_public_key ?? null;
  } catch {
    return null;
  }
}

/** 附上一份礼物: on or off, the amount (a tier or at least 50,000), the refund, and whose key it locks to. */
export function GiftPicker({ rules, value, onChange, height, blockSeconds, live = false }: { rules: GiftRules; value: GiftChoice; onChange: (c: GiftChoice) => void; height: number | null; blockSeconds: number; live?: boolean }) {
  const set = (p: Partial<GiftChoice>) => onChange({ ...value, ...p });
  const n = chosenSats(value);
  const low = value.custom.trim() !== "" && !(Number.isInteger(n) && n >= rules.min_sats);
  const high = Number.isInteger(n) && n > rules.max_sats;
  return (
    <div className="cap-field gift-pick">
      <span>{t("礼物")}</span>
      <label className="check">
        <input type="checkbox" checked={value.on} onChange={(e) => set({ on: e.target.checked })} name="gift" />
        {t("随信附上一份比特币礼物")} <NetBadge network={rules.network} live={!!rules.live} />
      </label>
      {value.on && (
        <>
          {DEMO && <LiveSwitch live={live} />}
          {live && rules.tip == null && <span className="error small">{t("连不上 Signet 的区块浏览器（mempool.space），看不到最新区块。稍后再试，或者先关掉真实 Signet。")}</span>}
          <div className="cap-chips" role="radiogroup" aria-label={t("礼物金额")}>
            {GIFT_TIERS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={!value.custom.trim() && value.sats === s} className={`cap-chip${!value.custom.trim() && value.sats === s ? " on" : ""}`} onClick={() => set({ sats: s, custom: "" })}>
                {tierName(s)}
              </button>
            ))}
          </div>
          <input value={value.custom} onChange={(e) => set({ custom: e.target.value.replace(/[^\d,]/g, "") })} inputMode="numeric" placeholder={t("自定义金额（至少 {n} 聪）", { n: rules.min_sats.toLocaleString("en-US") })} name="gift-custom" aria-label={t("自定义金额")} />
          {(low || high) && <span className="error small">{low ? t("礼物至少 {n} 聪。", { n: rules.min_sats.toLocaleString("en-US") }) : t("测试网上的礼物最多 {n} 聪。", { n: rules.max_sats.toLocaleString("en-US") })}</span>}
          <p className="dim small gift-note">
            {height != null
              ? t("比特币自己把这笔钱锁到区块 {h}（{span}），之前谁都动不了，包括 unimap。收礼人到时用时间锁领走；unimap 不碰这笔钱，也拿不到钥匙。", { h: height.toLocaleString("en-US"), span: spanText(Math.max(1, height - (rules.tip ?? height)), blockSeconds) })
              : t("比特币自己把这笔钱锁到打开那一块，之前谁都动不了，包括 unimap。")}
          </p>
          <label className="check">
            <input type="checkbox" checked={value.refund} onChange={(e) => set({ refund: e.target.checked })} name="gift-refund" />
            {t("约 5 年后还没人领，就退回给我")}
          </label>
          <label className="cap-field gift-key">
            <span>{t("收礼人的钱包公钥（可选）")}</span>
            <input value={value.recipientKey} onChange={(e) => set({ recipientKey: e.target.value.trim() })} placeholder={t("不填就生成一把礼物钥匙")} spellCheck={false} autoComplete="off" name="gift-recipient-key" />
            <span className="dim small">{t("不填的话，浏览器会生成一把「礼物钥匙」，放进时间锁交给对方：拿着时间锁的人到时就能领。")}</span>
          </label>
          {value.refund && (
            <details className="gift-more">
              <summary className="small muted">{t("退回用的公钥")}</summary>
              <input value={value.senderKey} onChange={(e) => set({ senderKey: e.target.value.trim() })} placeholder={t("默认用钱包的公钥")} spellCheck={false} autoComplete="off" name="gift-sender-key" />
            </details>
          )}
          <p className="dim small">{t("只收「封存」的费用，礼物本身不收一分钱；另付比特币网络的手续费。")}</p>
        </>
      )}
    </div>
  );
}

/** The 时间锁's QR code: the whole link, so a phone camera opens the card. */
export function TimelockQr({ text, label }: { text: string; label: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "L");
    qr.addData(text, "Byte");
    qr.make();
    return qr.createSvgTag({ cellSize: 3, margin: 3, scalable: true });
  }, [text]);
  return <div className="gift-qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** The printable 时间锁: QR, the facts, and the same thing as text for when the QR won't scan. */
export function TimelockCard({ timelock, address, packed }: { timelock: Timelock; address: string; packed: string }) {
  const link = timelockLink(SITE_URL, timelock);
  return (
    <section className="gift-card" aria-label={t("时间锁")}>
      <header>
        <b className="serif">{t("时间锁")}</b>
        <NetBadge network={timelock.net} live={!!timelock.live} />
      </header>
      <div className="gift-card-body">
        <TimelockQr text={link} label={t("时间锁二维码")} />
        <dl className="gift-card-facts">
          <div>
            <dt>{t("给")}</dt>
            <dd>{timelock.to}</dd>
          </div>
          <div>
            <dt>{t("礼物")}</dt>
            <dd className="mono">{sats(timelock.a)}</dd>
          </div>
          <div>
            <dt>{t("锁到区块")}</dt>
            <dd className="mono">{timelock.h.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>{t("地址")}</dt>
            <dd className="mono break">{address}</dd>
          </div>
          {timelock.t && (
            <div>
              <dt>{t("铭文")}</dt>
              <dd className="mono break">{shortHash(timelock.t)}i0</dd>
            </div>
          )}
        </dl>
      </div>
      {timelock.live && <p className="small gift-card-warn">{LIVE_LINE()}</p>}
      <p className="small gift-card-warn">{t("谁拿着这张时间锁，谁就能在到点后领走礼物、打开信。像现金一样收好，别拍照发到群里。")}</p>
      <div className="gift-card-text">
        <span className="small dim">{t("文字备份（二维码扫不出来时，把这段贴进时间锁页面）")}</span>
        <code className="mono break">{packed}</code>
      </div>
    </section>
  );
}

type Step = "idle" | "wallet" | "commit" | "reveal" | "report" | "done";

/** 锁进礼物: after 封存 is paid, the sats go in. First the 时间锁 is saved (it holds the 礼物钥匙
 * and the recipient's half of the backup key), then the wallet funds the commit, the reveal is
 * signed here with its one-time key, both are broadcast, and the txids go to unimap. Each step is
 * kept in the draft, so a failure can be retried from where it stopped. A letter without a gift
 * (draft.letter) goes the same way without the 时间锁: its reveal sends the postage to the
 * recipient's address, or to the wallet's own, and its link carries the other half of the key. */
export function GiftFund({ draft: first, token, done, note }: { draft: GiftDraft; token: string | null; done: (d: GiftDraft) => void; note?: React.ReactNode }) {
  const { wallet } = useSession();
  const [draft, setDraft] = useState(first);
  const [saved, setSaved] = useState(false);
  const [step, setStep] = useState<Step>(first.done ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [wrongNet, setWrongNet] = useState<SignetWalletId | null>(null);
  const [copied, setCopied] = useState(false);
  const keep = (d: GiftDraft) => (saveDraft(d), setDraft(d), d);
  const letter = draft.letter ?? null; // an inscribed letter, no gift: no 时间锁
  const link = draft.timelock ? timelockLink(SITE_URL, draft.timelock) : "";
  const live = letter ? !!letter.live : !!draft.timelock?.live; // the demo's 真实 Signet: a real wallet, the real signet
  const liveSigner = live ? signetSigner(wallet) : null;

  const fund = async () => {
    setError(null);
    setWrongNet(null);
    const chain = chainFor(draft.network, draft.esplora, live);
    try {
      const secret = hex.decode(draft.revealSecret), envelope = envelopeOf(draft);
      let d = draft;
      const signerOf = () => {
        if (live && !liveSigner) throw new Error(t("没找到能用的钱包：真实 Signet 要装 UniSat（或 Xverse、OKX 钱包）并切到 Signet。"));
        const signer = live ? liveSigner : walletById(wallet)?.psbt;
        if (!signer) throw new Error(t("这个钱包不能签交易。换 UniSat、Xverse 或 OKX 钱包试试。"));
        return signer;
      };
      const testAccounts = async () => {
        const acc = await signerOf()!.accounts();
        if (!isTestAddress(acc.payment_address)) throw new Error(t("钱包现在不在测试网上：先在钱包里切到 {net}，再试一次。", { net: NETWORK_NAMES[draft.network] }));
        return acc;
      };
      if (!d.address) {
        // A letter to a label, not an address: its postage comes back to the wallet that pays.
        setStep("wallet");
        d = keep({ ...d, address: DEMO && !live ? DEMO_TEST_ADDRESS : (await testAccounts()).payment_address });
      }
      if (!d.commit) {
        const feeRate = await chain.feeRate();
        const amount = d.sats + revealFee(secret, envelope, d.address, d.sats, feeRate);
        const commitAddress = commitTaproot(secret, envelope).address!;
        let commit: Outpoint;
        setStep("wallet");
        if (DEMO && !live) commit = demoChain.fund(commitAddress, amount);
        else {
          const signer = signerOf()!;
          const acc = await testAccounts();
          // Coins of 1,000 sats or less are left alone: on a wallet that holds inscriptions they are likely ones.
          const coins = (await chain.utxos(acc.payment_address)).filter((u) => !live || u.value > 1_000).map((u) => ({ ...u, address: acc.payment_address, publicKey: acc.payment_public_key }));
          const short = (have: number, need = amount) =>
            live
              ? t("钱包在 Signet 上的币不够：要 {need}，只有 {have}。先从 Signet 水龙头（比如 signetfaucet.com）领一点测试币，等到账后再试。", { need: sats(need), have: sats(have) })
              : t("钱包在 {net} 上没有币。先从水龙头领一点测试币。", { net: NETWORK_NAMES[draft.network] });
          if (!coins.length) throw new Error(short(0));
          let p: ReturnType<typeof commitPsbt>;
          try {
            p = commitPsbt({ utxos: coins, commitAddress, amount, change: acc.payment_address, feeRate });
          } catch (e) {
            const m = e instanceof Error ? e.message.match(/^not enough coins: (\d+) < (\d+)/) : null;
            if (m) throw new Error(short(+m[1], +m[2]));
            throw e;
          }
          const signed = finishCommit(await signer.sign(p.psbt, p.inputs.map((_, i) => ({ index: i, address: acc.payment_address }))));
          setStep("commit");
          await broadcast(chain, signed.hex, live);
          commit = { txid: signed.txid, vout: 0, value: amount };
        }
        d = keep({ ...d, commit, ...(d.timelock ? { timelock: { ...d.timelock, ct: commit.txid } } : {}) });
      }
      if (!d.reveal) {
        setStep("reveal");
        const reveal = buildReveal({ secret, envelope, commit: d.commit!, giftAddress: d.address, giftSats: d.sats });
        await broadcast(chain, reveal.hex, live);
        d = keep({ ...d, reveal: reveal.txid, ...(d.timelock ? { timelock: { ...d.timelock, t: reveal.txid } } : {}) });
      }
      setStep("report");
      await api<CapsuleGift>(`/v1/capsules/${d.capsuleId}/${letter ? "chain" : "gift"}/txs`, { method: "POST", token, body: { commit_txid: d.commit!.txid, reveal_txid: d.reveal } });
      d = keep({ ...d, done: true });
      setStep("done");
      done(d);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof WrongNetwork && e.canSwitch && liveSigner) setWrongNet(liveSigner.id);
      setError(msg === "cancelled" ? null : msg);
      setStep("idle");
    }
  };
  const switchNet = async () => {
    if (!wrongNet) return;
    try {
      await switchToSignet(wrongNet);
      setWrongNet(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {}
  };
  const busy = step !== "idle" && step !== "done";
  const said: Record<Step, string> = {
    idle: "",
    wallet: t("请在钱包里确认…"),
    commit: t("正在广播第一笔交易（commit）…"),
    reveal: letter ? t("正在把信刻成铭文（reveal）…") : t("正在刻上铭文，把礼物锁进去（reveal）…"),
    report: t("告诉 unimap 交易号…"),
    done: "",
  };

  if (letter)
    return (
      <div className="gift-fund">
        <h2 className="cap-side-title">{step === "done" ? t("信刻上链了") : t("把信刻上链")}</h2>
        <NetBadge network={draft.network} live={live} />
        {live && <LiveNote />}
        <p className="muted small">
          {draft.address
            ? t("钱包付一笔交易（刻铭文的网络费，加随信的 {n}），浏览器再签第二笔，把信的密文刻成铭文，连同 {n} 送到 {to}。", { n: sats(draft.sats), to: shortHash(draft.address) })
            : t("钱包付一笔交易（刻铭文的网络费，加随信的 {n}），浏览器再签第二笔，把信的密文刻成铭文；那 {n} 回到你自己的地址。", { n: sats(draft.sats) })}
        </p>
        {step !== "done" && !draft.commit && note}
        {step === "done" ? (
          draft.reveal && (
            <a className="mono small" href={explorerTx(draft.network, draft.reveal, live)} target="_blank" rel="noopener">
              {t("在区块浏览器里看")} {shortHash(draft.reveal)}i0
            </a>
          )
        ) : (
          <button type="button" className="primary" onClick={fund} disabled={busy}>
            {busy ? said[step] : draft.commit ? t("继续刻上链") : live ? (liveSigner ? t("用 {wallet} 在 Signet 上刻上链", { wallet: liveSigner.name }) : t("用钱包在 Signet 上刻上链")) : DEMO ? t("用演示钱包刻上链") : t("用钱包刻上链")}
          </button>
        )}
        {live && !draft.commit && step !== "done" && <span className="dim small">{t("会发两笔真实的 Signet 交易：钱包签第一笔，浏览器签第二笔，都广播到 mempool.space。")}</span>}
        {error && <p className="error small">{error}</p>}
        {wrongNet && (
          <button type="button" onClick={switchNet}>
            {t("让 UniSat 切到 Signet")}
          </button>
        )}
      </div>
    );

  return (
    <div className="gift-fund">
      <h2 className="cap-side-title">{step === "done" ? t("礼物锁好了") : t("把礼物锁进去")}</h2>
      <NetBadge network={draft.network} live={live} />
      {live && <LiveNote />}
      <p className="muted small">
        {t("{n} 会锁在 {addr}，到区块 {h} 才能动。", { n: sats(draft.sats), addr: shortHash(draft.address), h: (draft.timelock?.h ?? 0).toLocaleString("en-US") })}
      </p>
      <ol className="gift-steps">
        <li className={saved || draft.commit ? "done" : ""}>
          <b>{t("先存好时间锁")}</b>
          <span className="dim small">{t("里面有领礼物的钥匙和一半的备用钥匙，unimap 不会再给第二次。打开、打印，或者把链接发给收礼人。")}</span>
          <div className="row wrap">
            <a className="btn" href={link} target="_blank" rel="noopener">
              {t("打开时间锁（可打印）")}
            </a>
            <button type="button" onClick={copy}>
              {copied ? t("已复制") : t("复制时间锁链接")}
            </button>
          </div>
          {!draft.commit && (
            <label className="check">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} name="timelock-saved" />
              {t("我已经存好时间锁了")}
            </label>
          )}
        </li>
        <li className={step === "done" ? "done" : ""}>
          <b>{t("用钱包锁进 {n}", { n: sats(draft.sats) })}</b>
          <span className="dim small">{t("钱包付一笔交易（礼物加上刻铭文的手续费），浏览器再签第二笔，把信的密文刻成铭文，和礼物放进同一个输出。")}</span>
          {step === "done" ? (
            <span className="small">
              {draft.reveal && (
                <a className="mono" href={explorerTx(draft.network, draft.reveal, live)} target="_blank" rel="noopener">
                  {t("在区块浏览器里看")} {shortHash(draft.reveal)}
                </a>
              )}
            </span>
          ) : (
            <button type="button" className="primary" onClick={fund} disabled={busy || (!saved && !draft.commit)}>
              {busy ? said[step] : draft.commit ? t("继续锁礼物") : live ? (liveSigner ? t("用 {wallet} 在 Signet 上锁进去", { wallet: liveSigner.name }) : t("用钱包在 Signet 上锁进去")) : DEMO ? t("用演示钱包锁进去") : t("用钱包锁进去")}
            </button>
          )}
          {live && !draft.commit && step !== "done" && <span className="dim small">{t("会发两笔真实的 Signet 交易：钱包签第一笔，浏览器签第二笔，都广播到 mempool.space。")}</span>}
        </li>
      </ol>
      {error && <p className="error small">{error}</p>}
      {wrongNet && (
        <button type="button" onClick={switchNet}>
          {t("让 UniSat 切到 Signet")}
        </button>
      )}
      {step === "done" && (
        <a className="btn primary" href={link}>
          {t("看看时间锁")}
        </a>
      )}
      <a className="small muted" href={explorerAddress(draft.network, draft.address, live)} target="_blank" rel="noopener">
        {t("礼物地址")} <span className="mono">{shortHash(draft.address)}</span>
      </a>
    </div>
  );
}

/** Broadcast, saying plainly that it was the network that refused (the node's reason after it). */
async function broadcast(chain: ReturnType<typeof chainFor>, raw: string, live: boolean): Promise<string> {
  try {
    return await chain.broadcast(raw);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(live ? t("Signet 没有收下这笔交易：{why}", { why }) : why);
  }
}
