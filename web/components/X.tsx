"use client";

import { useEffect, useRef, useState } from "react";


/** X's logo, for 分享到 X and linked accounts. */
export const XIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.9L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" />
  </svg>
);

/** @username linking to the X profile. The address proved it through X's sign-in. */
export function XHandle({ username, className = "" }: { username: string; className?: string }) {
  return (
    <a
      className={`x-handle ${className}`}
      href={`https://x.com/${username}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`已绑定 X 账号 @${username}`}
      onClick={(e) => e.stopPropagation()}
    >
      <XIcon size={11} />
      <span>@{username}</span>
    </a>
  );
}

type Twttr = { widgets: { createTweet: (id: string, el: HTMLElement, opts: object) => Promise<HTMLElement | undefined> } };
let widgets: Promise<Twttr> | null = null;

// X's own embed script, loaded the first time a post with a tweet link shows.
function loadWidgets(): Promise<Twttr> {
  widgets ??= new Promise((resolve, reject) => {
    const w = window as unknown as { twttr?: Twttr & { ready?: (f: (t: Twttr) => void) => void } };
    const el = document.createElement("script");
    el.src = "https://platform.twitter.com/widgets.js";
    el.async = true;
    el.onload = () => (w.twttr?.ready ? w.twttr.ready(resolve) : reject(new Error("no twttr")));
    el.onerror = () => {
      widgets = null;
      reject(new Error("widgets.js didn't load"));
    };
    document.head.appendChild(el);
  });
  return widgets;
}

/** A tweet linked in a post: X's embed once it loads, a plain link card until then (or if X is
 * blocked). */
export function TweetEmbed({ user, id }: { user: string; id: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let live = true;
    const el = box.current;
    loadWidgets()
      .then((t) => el && t.widgets.createTweet(id, el, { theme: "dark", dnt: true, conversation: "none", align: "left" }))
      .then((made) => live && made && setShown(true))
      .catch(() => {});
    return () => {
      live = false;
      if (el) el.innerHTML = "";
    };
  }, [id]);
  return (
    <div className="tweet">
      <div ref={box} />
      {!shown && (
        <a className="tweet-link" href={`https://x.com/${user}/status/${id}`} target="_blank" rel="noopener noreferrer">
          <XIcon size={16} />
          <span>
            <b>@{user}</b> 在 X 上的推文
          </span>
          <span className="muted small">打开 ↗</span>
        </a>
      )}
    </div>
  );
}
