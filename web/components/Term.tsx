"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { shiftInto, TERMS, type TermKey } from "@/lib/terms";

/** A word a newcomer may not know, with a dotted underline. Hovering or focusing it (or a tap on a
 * phone) shows one line of explanation; Escape, a second tap or a tap elsewhere hides it. */
export function Term({ k, children }: { k: TermKey; children: React.ReactNode }) {
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [pinned, setPinned] = useState(false); // opened by a tap or click, not just hovered
  const [hover, setHover] = useState(false);
  const [shift, setShift] = useState(0);
  const open = pinned || hover;
  const term = TERMS[k];

  useEffect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setPinned(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPinned(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [pinned]);

  // Keep the popup on screen: measure it where CSS puts it, then move it sideways if it runs off.
  useLayoutEffect(() => {
    if (!open || !tip.current) return setShift(0);
    tip.current.style.setProperty("--shift", "0px");
    const r = tip.current.getBoundingClientRect();
    setShift(shiftInto(r.left, r.right, document.documentElement.clientWidth));
  }, [open]);

  return (
    <span
      ref={box}
      className="term-box"
      // Hover is for a mouse; a tap pins it open instead (onClick), so a second tap can close it.
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setPinned(false);
          setHover(false);
        }
      }}
    >
      <button
        type="button"
        className="term"
        aria-describedby={id}
        onClick={() => setPinned((p) => !p)}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setHover(true)}
        onBlur={() => setHover(false)}
      >
        {children}
      </button>
      <span ref={tip} id={id} role="tooltip" className="term-tip" hidden={!open} style={{ "--shift": `${shift}px` } as React.CSSProperties}>
        <b>{t(term.name)}</b>
        {t(term.text)}
      </span>
    </span>
  );
}
