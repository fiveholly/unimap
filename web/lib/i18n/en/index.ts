// English for every t() string, one file per part of the site so they can be edited apart.
import { common } from "./common.ts";
import { district } from "./district.ts";
import { game } from "./game.ts";
import { map } from "./map.ts";
import { moderation } from "./moderation.ts";
import { social } from "./social.ts";
import { market } from "./market.ts";
import { tips } from "./tips.ts";

export const EN: Record<string, string> = { ...district, ...map, ...social, ...moderation, ...tips, ...game, ...market, ...common };
