// 新手任务 (api/newcomer.py): three first steps and the 新居民 badge. Signed out, the browser keeps
// what it can see (the birthday lookup) in localStorage; signed in, the server is the record and
// steps 2 and 3 come from its data. These helpers are pure so they can be tested.

export const STEPS = ["birthday", "checkin", "capsule"] as const;
export type Step = (typeof STEPS)[number];
export type Progress = Record<Step, boolean>;

export const NONE: Progress = { birthday: false, checkin: false, capsule: false };

/** What the browser keeps: the step it saw done, and how the card was left. */
export type Local = { birthday: boolean; block: number | null; collapsed: boolean; dismissed: boolean };
export const LOCAL_KEY = "unimap.newcomer";
const EMPTY_LOCAL: Local = { birthday: false, block: null, collapsed: false, dismissed: false };

/** Read the browser's copy from a localStorage-like store; anything broken or missing reads as nothing done. */
export function readLocal(store: Pick<Storage, "getItem"> | null | undefined): Local {
  try {
    const raw = store?.getItem(LOCAL_KEY);
    if (!raw) return { ...EMPTY_LOCAL };
    const v = JSON.parse(raw) as Partial<Local>;
    return {
      birthday: v.birthday === true,
      block: typeof v.block === "number" && Number.isInteger(v.block) && v.block >= 0 ? v.block : null,
      collapsed: v.collapsed === true,
      dismissed: v.dismissed === true,
    };
  } catch {
    return { ...EMPTY_LOCAL };
  }
}

export function writeLocal(store: Pick<Storage, "setItem"> | null | undefined, v: Local) {
  try {
    store?.setItem(LOCAL_KEY, JSON.stringify(v));
  } catch {}
}

/** A step done anywhere is done: the browser's copy and the server's, merged. */
export function merge(local: Partial<Progress> | null | undefined, server: Partial<Progress> | null | undefined): Progress {
  const out = { ...NONE };
  for (const s of STEPS) out[s] = !!(local?.[s] || server?.[s]);
  return out;
}

/** Whether signing in should tell the server about a step only the browser saw. */
export const needsReport = (local: Local, server: Progress | null) => local.birthday && !!server && !server.birthday;

export const doneCount = (p: Progress) => STEPS.filter((s) => p[s]).length;
export const complete = (p: Progress) => doneCount(p) === STEPS.length;
/** The first step not yet done, or null when all are. */
export const nextStep = (p: Progress): Step | null => STEPS.find((s) => !p[s]) ?? null;
