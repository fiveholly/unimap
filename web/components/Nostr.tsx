"use client";

import { noteUrl } from "@/lib/nostr";
import { t } from "@/lib/i18n";

/** Nostr's mark: a plain purple dot with an N, since the protocol has no one logo. */
export const NostrIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="11" fill="#8e44ec" />
    <path d="M8 17V7l8 10V7" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Under a post that its author also published on Nostr: opens the note. */
export function NostrNoteLink({ id }: { id: string }) {
  return (
    <a className="act nostr-link" href={noteUrl(id)} target="_blank" rel="noopener noreferrer" title={t("作者把这条帖子也发到了 Nostr，点击查看")}>
      <NostrIcon />
      <span className="sr-only">{t("在 Nostr 上查看")}</span>
    </a>
  );
}
