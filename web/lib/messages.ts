// The exact text a wallet signs for a post. Must match post_message in api/social.py.
export function postMessage(
  district: number,
  replyTo: number | null,
  asBitmap: number | null,
  signedAt: number,
  media: string[],
  body: string,
): string {
  const lines = [
    "unimap post",
    `district: ${district}.bitmap`,
    `reply-to: ${replyTo ?? "none"}`,
    `as: ${asBitmap != null ? `${asBitmap}.bitmap` : "none"}`,
    `time: ${signedAt}`,
    ...(media.length ? media.map((url) => `media: ${url}`) : ["media: none"]),
  ];
  return lines.join("\n") + "\n\n" + body;
}
