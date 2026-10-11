// English for every t() string, one file per part of the site so they can be edited apart.
import { common } from "./common.ts";
import { district } from "./district.ts";
import { game } from "./game.ts";
import { map } from "./map.ts";
import { moderation } from "./moderation.ts";
import { social } from "./social.ts";
import { market } from "./market.ts";
import { tips } from "./tips.ts";
import { agent } from "./agent.ts";
import { shop } from "./shop.ts";
import { metrics } from "./metrics.ts";

export const EN: Record<string, string> = { ...district, ...map, ...social, ...moderation, ...tips, ...game, ...market, ...agent, ...shop, ...metrics, ...common };
