"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { BadgeIcon, BadgeList } from "@/components/Badge";
import { useTip } from "@/components/BlockWatch";
import { short, useSession } from "@/components/Session";
import { api, type Draw, type Game, type Season } from "@/lib/api";
import { birthdays, CLAIM_BLOCKS, CROWN_COLORS, nextHalving, pick, RARITIES, RARITY_COLORS, RARITY_NAMES, RARITY_ODDS, rarityOf, ROUND, SEASON } from "@/lib/game";
import { HALVING } from "@/lib/terrain";
import { t, tn } from "@/lib/i18n";

const blocks = (n: number) => n.toLocaleString("en-US");
const explorer = (hash: string) => `https://mempool.space/block/${hash}`;

/** 区块节拍: what the latest blocks drew, today's lucky district, and the rules to check it all. */
export default function GamePage() {
  const { token, ready } = useSession();
  const { tip, alerts, setAlerts } = useTip();
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    api<Game>("/v1/game", { token })
      .then(setGame)
      .catch((e) => setError(e.message));
  }, [token, ready, tip]);
  const r = game?.round;

  return (
    <div className="page narrow game">
      <h1>{t("区块节拍")}</h1>
      <p className="muted">
        {t("比特币大约每 10 分钟出一个区块。每出一个新区块，城市里就抽一次奖，结果由区块哈希决定，谁也没法提前知道或者操控。公式写在这一页最下面，任何人都能用区块浏览器自己验算。参与永远免费。")}
      </p>
      <div className="game-now">
        <div>
          <span className="muted small">{t("最新区块")}</span>
          <b className="mono">{tip != null ? blocks(tip) : "—"}</b>
        </div>
        <label className="row small alerts-toggle">
          <input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} />
          {t("有新区块时，在浏览器里提醒我")}
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {!game && !error && <p className="muted">{t("加载中…")}</p>}

      {r && r.bitmap_number != null && (
        <section className="game-card lucky">
          <h2 className="section-title">{t("今日幸运街区")}</h2>
          <div className="row">
            <BadgeIcon kind="lucky" rarity="rare" size={44} />
            <div className="grow">
              <Link className="mono lucky-name" href={`/district/${r.bitmap_number}`}>
                {r.bitmap_number}.bitmap
              </Link>
              <p className="muted small">
                {t("区块 {a} 抽中，幸运到区块 {b}", { a: blocks(r.since), b: blocks(r.until) })}
                {r.owner && ` · ${t("主人 {who}", { who: short(r.owner) })}`}
              </p>
            </div>
            <Link className="btn primary sm" href={`/district/${r.bitmap_number}`}>
              {t("去签到")}
            </Link>
          </div>
          {tip != null && (
            <div className="round-bar" aria-label={t("还剩 {n} 个区块", { n: blocks(r.until - tip + 1) })}>
              <i style={{ width: `${Math.min(100, ((tip - r.since + 1) / ROUND) * 100)}%` }} />
            </div>
          )}
          <p className="small">{t("幸运街区的繁荣度加 30 分，在地图上发光，主人得到一枚幸运街区徽章；这段时间来签到的任何人，都能领一枚幸运来访徽章。")}</p>
          <Check hash={r.block_hash} salt="lucky" candidates={r.candidates} index={r.index} what={t("从 {n} 个已认领的街区里抽", { n: blocks(r.candidates) })} />
        </section>
      )}

      <SeasonCard tip={tip} />
      {tip != null && <Calendar tip={tip} />}

      {game && game.draws.length > 0 && (
        <section className="game-card">
          <h2 className="section-title">{t("最近的宝箱")}</h2>
          <p className="muted small">
            {t("每个区块都会在一块已认领的地块上放一个宝箱。地块主人在 {n} 个区块内打开它，就能得到一枚徽章。", { n: CLAIM_BLOCKS })}
          </p>
          <ul className="draw-list">
            {game.draws.map((d) => (
              <DrawRow key={d.height} d={d} />
            ))}
          </ul>
        </section>
      )}

      {game?.badges && (
        <section className="game-card">
          <h2 className="section-title">
            {t("我的徽章")} <span className="mono">{game.badges.length}</span>
          </h2>
          {game.badges.length ? <BadgeList badges={game.badges} /> : <p className="muted small">{t("还没有徽章。去今日幸运街区签到，就能领到第一枚。")}</p>}
        </section>
      )}

      <section className="game-card rules">
        <h2 className="section-title">{t("规则")}</h2>
        <ul className="small">
          <li>{t("宝箱：每个区块从它之前铭刻的所有地块里抽一块。宝箱的稀有度看区块哈希末尾有几个 0。")}</li>
          <li>{t("幸运街区：每 {n} 个区块（大约一天）从之前铭刻的所有街区里抽一个。", { n: ROUND })}</li>
          <li>{t("不持有土地的人也有路：去幸运街区签到，免费领幸运来访徽章。")}</li>
        </ul>
        <table className="odds small">
          <thead>
            <tr>
              <th>{t("稀有度")}</th>
              <th>{t("区块哈希末尾")}</th>
              <th>{t("机会")}</th>
            </tr>
          </thead>
          <tbody>
            {RARITIES.map((x, i) => (
              <tr key={x}>
                <td style={{ color: RARITY_COLORS[x] }}>{t(RARITY_NAMES[x])}</td>
                <td className="mono">{i === 0 ? t("不是 0") : i === 3 ? t("3 个或更多 0") : t("正好 {n} 个 0", { n: i })}</td>
                <td className="mono">{RARITY_ODDS[x]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>{t("怎么验算")}</h3>
        <p className="small">
          {tn("把区块哈希（十六进制，和区块浏览器上一样）后面加上 {lucky} 或 {treasure}，算它的 SHA-256，把结果当成一个大数，除以候选的数量取余数，就是抽中的序号（从 0 开始）。街区按编号从小到大排，地块先按街区编号、再按交易序号排。", {
            lucky: <code className="mono">:lucky</code>,
            treasure: <code className="mono">:treasure</code>,
          })}
        </p>
        <p className="muted small">
          {t("矿工理论上能丢掉自己挖到的区块来换结果，但这要放弃 3 BTC 以上的出块奖励，比任何奖品都值钱。")}
        </p>
        <Verifier />
        <p className="muted small">{t("接下来：王冠和稀有徽章会铭刻成真正的铭文，挂在 unimap 的父铭文下面，可以收藏和交易。")}</p>
      </section>
    </div>
  );
}

const days = (blocksLeft: number) => Math.max(0, Math.round((blocksLeft * 10) / 60 / 24));

/** 难度调整赛季: this season's standings, the last season's crowns and the prize pool. */
function SeasonCard({ tip }: { tip: number | null }) {
  const [season, setSeason] = useState<Season | null>(null);
  useEffect(() => {
    api<Season>("/v1/season")
      .then(setSeason)
      .catch(() => {});
  }, [tip]);
  if (!season || season.number == null) return null;
  const left = season.until - season.tip + 1;
  const w = season.weights;
  return (
    <section className="game-card season">
      <h2 className="section-title">{t("第 {n} 赛季", { n: season.number })}</h2>
      <p className="muted small">
        {t("区块 {a} 到 {b}，还剩 {n} 个区块（大约 {d} 天）。比特币每 {s} 个区块调整一次挖矿难度，赛季就跟着它走。", {
          a: blocks(season.since),
          b: blocks(season.until),
          n: blocks(left),
          d: days(left),
          s: SEASON,
        })}
      </p>
      <div className="round-bar">
        <i style={{ width: `${Math.min(100, ((season.tip - season.since + 1) / SEASON) * 100)}%` }} />
      </div>
      {season.pool_sats > 0 && (
        <p className="pool small">
          {tn("本赛季奖池 {sats} 聪，赛季结束后由项目方用闪电发给前三名的主人：{split}", {
            sats: <b className="mono">{blocks(season.pool_sats)}</b>,
            split: <span className="mono">{season.pool_split.map(blocks).join(" / ")}</span>,
          })}
        </p>
      )}
      {season.standings.length ? (
        <ol className="season-list">
          {season.standings.map((r, i) => (
            <li key={r.bitmap_number}>
              <span className={`rank-no mono${i < 3 ? " top" : ""}`}>{i + 1}</span>
              <Link className="mono grow" href={`/district/${r.bitmap_number}`}>
                {r.bitmap_number}.bitmap
              </Link>
              <span className="muted small">{short(r.owner)}</span>
              <b className="mono">{r.score}</b>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">{t("这个赛季刚开始，还没有街区得分。")}</p>
      )}
      <p className="muted small">
        {t("得分：赛季里的帖子 × {p}，回复 × {r}，签到 × {c}，打赏的人 × {x}。前三名的街区戴王冠到下个赛季结束，主人得到一枚王冠徽章。", {
          p: w.posts,
          r: w.replies,
          c: w.checkins,
          x: w.tippers,
        })}
      </p>
      {season.last && season.last.winners.length > 0 && (
        <div className="last-winners">
          <span className="small muted">{t("第 {n} 赛季的王冠", { n: season.last.number })}</span>
          {season.last.winners.map((r, i) => (
            <Link key={r.bitmap_number} className="chip mono" href={`/district/${r.bitmap_number}`} style={{ borderColor: CROWN_COLORS[i] }}>
              <span style={{ color: CROWN_COLORS[i] }}>♛</span> {r.bitmap_number}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/** Today's birthdays and the next halving. */
function Calendar({ tip }: { tip: number }) {
  const next = nextHalving(tip), left = next - tip;
  const since = tip % HALVING; // blocks since the last halving
  const cakes = birthdays(tip);
  return (
    <section className="game-card">
      <h2 className="section-title">{t("城市日历")}</h2>
      {since < ROUND && (
        <p className="festival">{t("全城节日：第 {n} 次减半刚刚过去，区块 {h} 开出了新的纪元。", { n: Math.floor(tip / HALVING), h: blocks(tip - since) })}</p>
      )}
      <p className="small">
        {tn("下一次减半在区块 {h}，还有 {n} 个区块，大约 {d} 天。那一天是全城节日。", {
          h: <b className="mono">{blocks(next)}</b>,
          n: <b className="mono">{blocks(left)}</b>,
          d: days(left),
        })}
      </p>
      <p className="small">{t("今天过生日的街区（大约，按挖出的日期）：")}</p>
      <div className="chips">
        {cakes.map(([age, a, b]) => (
          <Link key={age} className="chip small" href={`/?b=${a}`} title={`${blocks(a)} – ${blocks(b)}`}>
            🎂 {t("{n} 岁", { n: age })} <span className="mono muted">{blocks(a)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function DrawRow({ d }: { d: Draw }) {
  return (
    <li>
      <BadgeIcon kind="treasure" rarity={d.rarity} size={28} />
      <div className="grow">
        <div>
          <a className="mono" href={explorer(d.block_hash)} target="_blank" rel="noopener noreferrer">
            {t("区块 {n}", { n: blocks(d.height) })}
          </a>{" "}
          <span style={{ color: RARITY_COLORS[d.rarity] }}>{t(RARITY_NAMES[d.rarity])}</span>
        </div>
        {d.bitmap_number != null ? (
          <Link className="mono muted small" href={`/district/${d.bitmap_number}?parcel=${d.tx_index}`}>
            {d.bitmap_number}.bitmap #{d.tx_index}
          </Link>
        ) : (
          <span className="muted small">{t("这时还没有已认领的地块")}</span>
        )}
      </div>
      <span className="small draw-state">{d.opened_by ? t("{who} 已打开", { who: short(d.opened_by) }) : d.open ? t("等主人打开") : d.bitmap_number != null ? t("已过期") : ""}</span>
      <Check hash={d.block_hash} salt="treasure" candidates={d.candidates} index={d.index} compact />
    </li>
  );
}

/** Redo a draw in the browser and show it matches. */
function Check({ hash, salt, candidates, index, what, compact }: { hash: string; salt: "lucky" | "treasure"; candidates: number; index: number | null; what?: string; compact?: boolean }) {
  const [shown, setShown] = useState(false);
  if (!shown)
    return (
      <button type="button" className="link-btn small" onClick={() => setShown(true)}>
        {t("验算")}
      </button>
    );
  const mine = pick(hash, salt, candidates);
  const ok = mine === index;
  return (
    <div className={`check small${compact ? " compact" : ""}`}>
      {what && <div className="muted">{what}</div>}
      <code className="mono break">
        sha256("{hash}:{salt}") mod {candidates} = {mine ?? "—"}
      </code>
      <span className={ok ? "ok" : "error"}>{ok ? t("✓ 和服务器的结果一致（序号 {n}）", { n: index ?? "—" }) : t("✗ 和服务器给的序号 {n} 不一致", { n: index ?? "—" })}</span>
    </div>
  );
}

/** Any block, any count: the draw formula as a little calculator. */
function Verifier() {
  const [hash, setHash] = useState("");
  const [count, setCount] = useState("");
  const [salt, setSalt] = useState<"lucky" | "treasure">("treasure");
  const h = hash.trim().toLowerCase();
  const n = Number(count);
  const valid = /^[0-9a-f]{64}$/.test(h) && Number.isInteger(n) && n > 0;
  return (
    <div className="verifier">
      <input value={hash} onChange={(e) => setHash(e.target.value)} placeholder={t("区块哈希（64 位十六进制）")} spellCheck={false} aria-label={t("区块哈希")} />
      <div className="row">
        <select value={salt} onChange={(e) => setSalt(e.target.value as "lucky" | "treasure")} aria-label={t("抽什么")}>
          <option value="treasure">{t("宝箱")}</option>
          <option value="lucky">{t("幸运街区")}</option>
        </select>
        <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} placeholder={t("候选数量")} aria-label={t("候选数量")} />
      </div>
      {valid && (
        <p className="small">
          {tn("抽中第 {i} 个，稀有度 {r}", {
            i: <b className="mono">{pick(h, salt, n)}</b>,
            r: <b style={{ color: RARITY_COLORS[rarityOf(h)] }}>{t(RARITY_NAMES[rarityOf(h)])}</b>,
          })}
        </p>
      )}
    </div>
  );
}
