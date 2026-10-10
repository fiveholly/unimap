"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { XIcon } from "./X";
import { api, type SearchResults } from "@/lib/api";
import { short } from "@/lib/format";

type Item = { key: string; href: string; external?: boolean; title: React.ReactNode; detail: string };

function items(r: SearchResults): Item[] {
  return [
    ...r.districts.map((n) => ({ key: `d${n}`, href: `/district/${n}`, title: <span className="mono">{n}.bitmap</span>, detail: "街区" })),
    ...r.parks.map((p) => ({ key: `p${p.id}`, href: `/?b=${p.first}`, title: `园区「${p.name}」`, detail: `${p.members} 个街区 · 在地图上看` })),
    ...r.people.map((p) => ({
      key: `a${p.address}`,
      href: p.count ? `/district/${p.districts[0]}` : p.x!.url,
      external: !p.count,
      title: (
        <>
          {p.x && (
            <span className="x-handle">
              <XIcon size={11} />
              <span>@{p.x.username}</span>
            </span>
          )}
          <span className="mono">{short(p.address)}</span>
        </>
      ),
      detail: p.count ? `${p.count} 个街区：${p.districts.slice(0, 3).join("、")}${p.count > 3 ? "…" : ""}` : "还没有街区",
    })),
  ];
}

/** The header's search box: a district number, a park's name, an address or an X handle. */
export function Search() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; items: Item[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);

  // "/" jumps to the search box from anywhere except a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "/" || el.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    let live = true;
    const t = setTimeout(() => {
      api<SearchResults>(`/v1/search?q=${encodeURIComponent(term)}`)
        .then((r) => {
          if (!live) return;
          setFound({ q: term, items: items(r) });
          setActive(-1);
        })
        .catch(() => live && setFound({ q: term, items: [] }));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const go = (item: Item) => {
    setQ("");
    setFound(null);
    setOpen(false);
    input.current?.blur();
    if (item.external) window.open(item.href, "_blank", "noopener,noreferrer");
    else router.push(item.href);
  };
  const term = q.trim();
  const list = found && found.q === term ? found.items : null;
  const shown = open && !!term;

  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const n = parseInt(term.replace(/\.bitmap$/i, ""), 10);
        if (list?.[Math.max(active, 0)]) go(list[Math.max(active, 0)]);
        else if (/^\d+(\.bitmap)?$/i.test(term) && n >= 0) go({ key: "", href: `/district/${n}`, title: "", detail: "" });
      }}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            input.current?.blur();
          } else if (list?.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : list.length - 1) + (a < 0 && e.key === "ArrowUp" ? 1 : 0)) % list.length);
          }
        }}
        placeholder="搜索街区、园区、地址或 @X"
        aria-label="搜索街区号、园区名、地址或 X 账号"
        role="combobox"
        aria-expanded={shown}
        aria-controls="search-results"
        aria-autocomplete="list"
        name="q"
        autoComplete="off"
      />
      <kbd>/</kbd>
      {shown && (
        <div className="search-results" id="search-results" role="listbox">
          {list == null ? (
            <p className="muted small">搜索中…</p>
          ) : list.length === 0 ? (
            <p className="muted small">没有找到。可以搜区块号、园区名、钱包地址开头（至少 6 位）或 X 账号。</p>
          ) : (
            list.map((item, i) => (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item)}
              >
                <span className="search-title">{item.title}</span>
                <span className="muted small">{item.detail}</span>
              </button>
            ))
          )}
        </div>
      )}
    </form>
  );
}
