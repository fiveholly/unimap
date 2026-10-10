// Tweet links in a post body, shown as X's embed under the post (components/X.tsx).

const TWEET = /https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,20})/g;
export const MAX_TWEETS = 2;

/** Tweets linked in a post body, each once, at most MAX_TWEETS. */
export function tweetsIn(body: string | null): { user: string; id: string }[] {
  const out = new Map<string, { user: string; id: string }>();
  for (const m of (body ?? "").matchAll(TWEET)) if (out.size < MAX_TWEETS && !out.has(m[2])) out.set(m[2], { user: m[1], id: m[2] });
  return [...out.values()];
}
