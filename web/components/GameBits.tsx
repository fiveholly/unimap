"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { BadgeIcon } from "./Badge";
import { useTip } from "./BlockWatch";
import { api, type DistrictGame, type Game } from "@/lib/api";
import { birthdays, CROWN_COLORS, RARITY_COLORS, RARITY_NAMES, type Rarity } from "@/lib/game";
import { t, tn } from "@/lib/i18n";

const blocks = (n: number) => n.toLocaleString("en-US");
const SHOWN = 3; // treasures listed on a district's page
const CROWN_RARITY: Rarity[] = ["legendary", "epic", "rare"]; // as api/seasons.py

/** Above the home map: today's lucky district and how long it has left. */
export function LuckyStrip({ tip }: { tip: number }) {
  const [game, setGame] = useState<Game | null>(null);
  useEffect(() => {
    api<Game>("/v1/game")
      .then(setGame)
      .catch(() => {});
  }, [tip]);
  const r = game?.round;
  if (!r || r.bitmap_number == null) return null;
  return (
    <div className="lucky-strip">
      <span className="lucky-star" aria-hidden>
        ★
      </span>
      <span>
        {tn("今日幸运街区 {n}，还剩 {left} 个区块", {
          n: (
            <Link className="mono" href={`/district/${r.bitmap_number}`}>
              {r.bitmap_number}.bitmap
            </Link>
          ),
          left: <b className="mono">{blocks(Math.max(0, r.until - tip + 1))}</b>,
        })}
      </span>
      <span className="grow" />
      <Link className="small" href="/game">
        {t("区块节拍是什么 →")}
      </Link>
    </div>
  );
}

/** On a district's page: its lucky round and the treasures on its parcels. */
export function DistrictBeat({ n, game, token, onOpened }: { n: number; game: DistrictGame; token: string | null; onOpened: () => void }) {
  const { tip } = useTip();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const age = tip != null ? (birthdays(tip).find(([, a, b]) => a <= n && n <= b)?.[0] ?? null) : null;
  if (!game.lucky && !game.treasures.length && !game.crown && age == null) return null;
  // The viewer's own treasures first; a district with many parcels can hold several at once.
  const sorted = [...game.treasures].sort((a, b) => Number(b.claimable) - Number(a.claimable) || b.height - a.height);
  const shown = sorted.slice(0, SHOWN), more = sorted.length - shown.length;
  const open = async (height: number) => {
    setBusy(height);
    setError(null);
    try {
      await api(`/v1/game/treasures/${height}/open`, { method: "POST", token });
      onOpened();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="beat-banner">
      {game.crown && (
        <div className="beat-row">
          <BadgeIcon kind="crown" rarity={CROWN_RARITY[game.crown.rank - 1]} size={30} />
          <div className="grow">
            <b style={{ color: CROWN_COLORS[game.crown.rank - 1] }}>{t("第 {s} 赛季第 {n} 名", { s: game.crown.season, n: game.crown.rank })}</b>
            <p className="muted small">{t("这个街区戴着王冠，直到这个赛季结束。")}</p>
          </div>
        </div>
      )}
      {age != null && (
        <div className="beat-row">
          <span className="beat-emoji" aria-hidden>
            🎂
          </span>
          <div className="grow">
            <b>{t("今天大约是 {n}.bitmap 的 {age} 岁生日", { n, age })}</b>
            <p className="muted small">{t("这个区块是 {age} 年前的今天前后挖出来的。来签个到，祝它生日快乐。", { age })}</p>
          </div>
        </div>
      )}
      {game.lucky && (
        <div className="beat-row lucky">
          <BadgeIcon kind="lucky" rarity="rare" size={30} />
          <div className="grow">
            <b>{t("今天的幸运街区")}</b>
            <p className="muted small">
              {t("区块 {a} 抽中了这里，直到区块 {b}。这段时间繁荣度加 30 分，来签到的人都能领一枚幸运来访徽章。", { a: blocks(game.lucky.since), b: blocks(game.lucky.until) })}
            </p>
          </div>
          {game.lucky.visited && <span className="tag">{t("已领到徽章")}</span>}
        </div>
      )}
      {shown.map((x) => (
        <div className="beat-row" key={x.height}>
          <BadgeIcon kind="treasure" rarity={x.rarity} size={30} />
          <div className="grow">
            <b>
              {tn("地块 #{i} 上有一个{rarity}宝箱", { i: x.tx_index, rarity: <span style={{ color: RARITY_COLORS[x.rarity] }}>{t(RARITY_NAMES[x.rarity])}</span> })}
            </b>
            <p className="muted small">
              {t("区块 {h} 抽中了这块地。地块主人在区块 {end} 之前可以打开它", { h: blocks(x.height), end: blocks(x.closes_at) })}
              {tip != null && `（${t("还剩 {n} 个区块", { n: blocks(Math.max(0, x.closes_at - tip + 1)) })}）`}
            </p>
          </div>
          {x.claimable && (
            <button type="button" className="primary sm" onClick={() => open(x.height)} disabled={busy != null}>
              {busy === x.height ? t("打开中…") : t("打开宝箱")}
            </button>
          )}
        </div>
      ))}
      {more > 0 && <p className="muted small">{t("这里还有 {n} 个宝箱等主人打开", { n: more })}</p>}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** An unclaimed district: how to make it yours. */
export function ClaimGuide({ n, fresh }: { n: number; fresh: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = `${n}.bitmap`;
  return (
    <div className="claim-guide">
      <b>{fresh ? t("这是刚挖出的新街区，还没有主人") : t("怎么认领这个街区")}</b>
      <ol className="small">
        <li>
          {tn("在 UniSat、OrdinalsBot 等铭刻服务上铭刻一段纯文本：{text}", {
            text: (
              <>
                <code className="mono">{text}</code>{" "}
                <button
                  type="button"
                  className="link-btn small"
                  onClick={() =>
                    navigator.clipboard.writeText(text).then(
                      () => setCopied(true),
                      () => {},
                    )
                  }
                >
                  {copied ? t("已复制") : t("复制")}
                </button>
              </>
            ),
          })}
        </li>
        <li>{t("Bitmap 的规矩是第一个铭刻这段文本的人得地。付款前刷新这一页，确认还没人抢先。")}</li>
        <li>{t("铭文上链后，几个区块内这里就会显示你是主人。")}</li>
      </ol>
    </div>
  );
}
