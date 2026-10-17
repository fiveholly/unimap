/** After the site is redeployed, a tab opened before it asks for script files that no longer
 * exist. Reloading the page once picks up the new ones. */
const STALE = /ChunkLoadError|Loading chunk|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed/i;
const KEY = "unimap.staleReload";

export const isStaleBuild = (error: unknown) => STALE.test(`${(error as Error)?.name ?? ""} ${(error as Error)?.message ?? error}`);

/** Reloads the page for a stale build, at most once a minute so a real failure can't loop. */
export function reloadIfStale(error: unknown): boolean {
  if (typeof window === "undefined" || !isStaleBuild(error)) return false;
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
