// English for 区块节拍 (the block-beat game): the game page, new-block alerts, treasures, badges.
export const game: Record<string, string> = {
  "区块节拍": "Block Beat",
  "区块节拍是什么 →": "What's Block Beat →",
  "比特币大约每 10 分钟出一个区块。每出一个新区块，城市里就抽一次奖，结果由区块哈希决定，谁也没法提前知道或者操控。公式写在这一页最下面，任何人都能用区块浏览器自己验算。参与永远免费。":
    "Bitcoin mines a block about every 10 minutes. Each new block holds a draw in the city, decided by the block hash, which nobody can know or steer in advance. The formula is at the bottom of this page, so anyone can check it with a block explorer. Taking part is always free.",
  "有新区块时，在浏览器里提醒我": "Tell me in the browser when a new block arrives",

  // Lucky district
  "今日幸运街区": "Today's lucky district",
  "今天的幸运街区": "Today's lucky district",
  "幸运街区": "Lucky district",
  "今日幸运街区 {n}，还剩 {left} 个区块": "Today's lucky district is {n}, with {left} blocks to go",
  "区块 {a} 抽中，幸运到区块 {b}": "Drawn by block {a}, lucky until block {b}",
  "区块 {a} 抽中了这里，直到区块 {b}。这段时间繁荣度加 30 分，来签到的人都能领一枚幸运来访徽章。":
    "Block {a} drew this district, and it's lucky until block {b}. Until then it gets 30 extra prosperity points, and everyone who checks in gets a Lucky visit badge.",
  "主人 {who}": "Owner {who}",
  "去签到": "Check in",
  "还剩 {n} 个区块": "{n} blocks left",
  "幸运街区的繁荣度加 30 分，在地图上发光，主人得到一枚幸运街区徽章；这段时间来签到的任何人，都能领一枚幸运来访徽章。":
    "The lucky district gets 30 extra prosperity points and glows on the map, and its owner gets a Lucky district badge. Anyone who checks in there during its turn gets a Lucky visit badge.",
  "从 {n} 个已认领的街区里抽": "Drawn from {n} claimed districts",
  "已领到徽章": "Badge collected",
  "签到成功。今天这里是幸运街区，你得到一枚幸运来访徽章。": "Checked in. This is today's lucky district, so you got a Lucky visit badge.",

  // Treasures
  "宝箱": "Treasure",
  "最近的宝箱": "Latest treasures",
  "每个区块都会在一块已认领的地块上放一个宝箱。地块主人在 {n} 个区块内打开它，就能得到一枚徽章。":
    "Every block puts a treasure on a claimed parcel. If the parcel's owner opens it within {n} blocks, they get a badge.",
  "地块 #{i} 上有一个{rarity}宝箱": "There's a treasure on parcel #{i}: {rarity}",
  "区块 {h} 抽中了这块地。地块主人在区块 {end} 之前可以打开它": "Block {h} drew this parcel. Its owner can open it until block {end}",
  "打开宝箱": "Open treasure",
  "这里还有 {n} 个宝箱等主人打开": "{n} more treasures here are waiting for their owners",
  "打开中…": "Opening…",
  "这时还没有已认领的地块": "No parcels were claimed yet",
  "{who} 已打开": "Opened by {who}",
  "等主人打开": "Waiting for the owner",
  "已过期": "Expired",
  "区块 {h} 把一个{rarity}宝箱放在了你在 {place} 的地块 #{i}，{n} 个区块内去打开它":
    "Block {h} put a treasure ({rarity}) on your parcel #{i} in {place}. Open it within {n} blocks",
  "区块 {h} 抽中你的街区 {place} 做今日幸运街区，你得到一枚徽章": "Block {h} made your district {place} today's lucky district, and you got a badge",

  // Badges and rarities
  "徽章": "Badges",
  "我的徽章": "My badges",
  "还没有徽章。去今日幸运街区签到，就能领到第一枚。": "No badges yet. Check in at today's lucky district to get your first.",
  "宝箱徽章": "Treasure",
  "幸运来访": "Lucky visit",
  "普通": "Common",
  "稀有": "Rare",
  "史诗": "Epic",
  "传说": "Legendary",

  // Rules and checking
  "规则": "Rules",
  "宝箱：每个区块从它之前铭刻的所有地块里抽一块。宝箱的稀有度看区块哈希末尾有几个 0。":
    "Treasures: every block draws one of all the parcels inscribed before it. The treasure's rarity depends on how many zeros the block hash ends with.",
  "幸运街区：每 {n} 个区块（大约一天）从之前铭刻的所有街区里抽一个。": "Lucky district: every {n} blocks (about a day), one of all the districts inscribed before is drawn.",
  "不持有土地的人也有路：去幸运街区签到，免费领幸运来访徽章。": "No land? You can still win: check in at the lucky district for a free Lucky visit badge.",
  "稀有度": "Rarity",
  "区块哈希末尾": "Block hash ends with",
  "机会": "Odds",
  "不是 0": "not 0",
  "正好 {n} 个 0": "exactly {n} zeros",
  "3 个或更多 0": "3 or more zeros",
  "怎么验算": "How to check",
  "把区块哈希（十六进制，和区块浏览器上一样）后面加上 {lucky} 或 {treasure}，算它的 SHA-256，把结果当成一个大数，除以候选的数量取余数，就是抽中的序号（从 0 开始）。街区按编号从小到大排，地块先按街区编号、再按交易序号排。":
    "Take the block hash (hex, as block explorers show it), append {lucky} or {treasure}, and compute its SHA-256. Read the result as one big number and take the remainder after dividing by the number of candidates: that is the index drawn, counting from 0. Districts are in number order; parcels are by district number, then transaction index.",
  "矿工理论上能丢掉自己挖到的区块来换结果，但这要放弃 3 BTC 以上的出块奖励，比任何奖品都值钱。":
    "In theory a miner could throw away a block they found to change the result, but that means giving up a block reward of over 3 BTC, worth more than any prize.",
  "接下来：按难度调整周期（2016 个区块）分赛季，赛季前几名的街区戴王冠，王冠和稀有徽章会铭刻成真正的铭文。":
    "Coming next: seasons that follow the difficulty adjustment (2016 blocks). Each season's top districts wear a crown, and crowns and rare badges will be inscribed as real inscriptions.",
  "验算": "Check",
  "✓ 和服务器的结果一致（序号 {n}）": "✓ Matches the server (index {n})",
  "✗ 和服务器给的序号 {n} 不一致": "✗ Doesn't match the server's index {n}",
  "区块哈希（64 位十六进制）": "Block hash (64 hex digits)",
  "区块哈希": "Block hash",
  "抽什么": "Draw",
  "候选数量": "Number of candidates",
  "抽中第 {i} 个，稀有度 {r}": "Draws index {i}, rarity {r}",

  // New blocks and claiming
  "新区块 {n}": "New block {n}",
  "新区块 {n} 刚被挖出": "Block {n} was just mined",
  "城市边上长出了新街区 {n}.bitmap，先铭刻的人得地。": "A new district, {n}.bitmap, has appeared at the edge of the city. Whoever inscribes it first owns it.",
  "这个区块抽中了什么": "What this block drew",
  "这是刚挖出的新街区，还没有主人": "This district was just mined and has no owner yet",
  "怎么认领这个街区": "How to claim this district",
  "在 UniSat、OrdinalsBot 等铭刻服务上铭刻一段纯文本：{text}": "Inscribe this plain text with an inscription service such as UniSat or OrdinalsBot: {text}",
  "复制": "Copy",
  "Bitmap 的规矩是第一个铭刻这段文本的人得地。付款前刷新这一页，确认还没人抢先。":
    "Under Bitmap's rules, the first inscription of this text gets the land. Refresh this page before you pay to make sure nobody got there first.",
  "铭文上链后，几个区块内这里就会显示你是主人。": "Once the inscription is confirmed, this page shows you as the owner within a few blocks.",
};
