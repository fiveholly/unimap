// English for every t() string, one file per part of the site so they can be edited apart.
import { common } from "./common.ts";
import { district } from "./district.ts";
import { map } from "./map.ts";
import { social } from "./social.ts";

export const EN: Record<string, string> = { ...district, ...map, ...social, ...common };
