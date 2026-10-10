"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { heightOnDay } from "@/lib/blocktime";

const KEY = "unimap.welcome.closed";

/** 初来乍到: what unimap is and three ways in, on the home page until the visitor closes it.
 * Closed, it leaves a small link to open it again. */
export function Welcome({ tip }: { tip: number }) {
  const [open, setOpen] = useState<boolean | null>(null); // null until localStorage is read
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(KEY) !== "1");
    } catch {
      setOpen(true);
    }
  }, []);
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      if (next) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, "1");
    } catch {}
  };
  if (open == null) return null;
  if (!open)
    return (
      <button type="button" className="link-btn small welcome-reopen" onClick={() => toggle(true)}>
        第一次来？看看怎么玩
      </button>
    );
  return (
    <section className="welcome" aria-label="新手指南">
      <div className="welcome-head">
        <h2>初来乍到</h2>
        <button type="button" className="icon-btn bare" aria-label="关闭新手指南" onClick={() => toggle(false)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <ol className="welcome-steps">
        <li>
          <b>逛一逛</b>
          <p className="muted small">
            地图上每一格是比特币的一个区块，楼的样子由区块里的交易决定。拖动、缩放，点一个街区进去看看。可以从
            <Link href="/district/0">创世区块</Link>、<Link href="/district/840000">第四次减半</Link>或者
            <Link href="/rank">繁荣榜</Link>开始。
          </p>
          <Birthday tip={tip} />
        </li>
        <li>
          <b>住下来</b>
          <p className="muted small">
            持有某个区块的 Bitmap 铭文，你就是那个街区的主人；持有街区里的一个地块（一笔交易），你就是那里的居民。Bitmap 可以在支持铭文的市场上买，还没人认领的号码也可以自己铭刻。想先当居民的话，
            <Link href="/recruit">看看哪些街区在招人</Link>。
          </p>
        </li>
        <li>
          <b>热闹起来</b>
          <p className="muted small">
            连接钱包后可以关注、签到、发帖和回复，帖子都由你的钱包签名。街区越热闹，繁荣度越高，楼越高；相邻的街区可以连成园区，钱包里的 DOG 和猫也能住进来。
          </p>
        </li>
      </ol>
    </section>
  );
}

/** 找到你生日那天的区块. */
function Birthday({ tip }: { tip: number }) {
  const router = useRouter();
  const [day, setDay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const h = heightOnDay(day, tip);
    if (h == null) return setError(day && day < "2009-01-03" ? "比特币诞生于 2009 年 1 月 3 日，换一个那之后的日子试试。" : "这一天还没有区块。");
    setError(null);
    router.push(`/?b=${h}`);
  };
  return (
    <form className="birthday" onSubmit={go}>
      <label className="small">
        找到你生日（或任何一天）的区块
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} name="birthday" required />
      </label>
      <button type="submit" className="ghost sm">
        去看看
      </button>
      {error && <p className="error small">{error}</p>}
    </form>
  );
}
