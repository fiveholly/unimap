// English for the map strings; keys are the exact Chinese passed to t() / tn().
export const map: Record<string, string> = {
  // Home page (app/page.tsx)
  "比特币的每一个区块，都是城市里的一个街区": "Every Bitcoin block is a district in the city",
  "持有 Bitmap 街区就能经营它的社区，持有地块就是这里的居民，其他人可以来逛、关注和回复。":
    "Hold a Bitmap district and you run its community. Hold a parcel and you're a resident. Anyone can drop by, follow and reply.",
  "最新区块 {n}": "Latest block {n}",
  "连不上 unimap 服务：{error}": "Can't reach the unimap service: {error}",
  "地图加载中": "Loading map",
  "我的动态": "My feed",
  "连接钱包并关注街区后，这里会出现它们的帖子和地块变动。":
    "Connect a wallet and follow some districts to see their posts and parcel changes here.",
  "加载中…": "Loading…",
  "关注一个街区，动态就会出现在这里。": "Follow a district and its updates will show up here.",

  // Welcome guide (components/Welcome.tsx)
  "第一次来？看看怎么玩": "New here? See how it works",
  "新手指南": "Getting started",
  "初来乍到": "New here",
  "关闭新手指南": "Close the guide",
  "逛一逛": "Look around",
  "地图上每一格是比特币的一个区块，楼的样子由区块里的交易决定。拖动、缩放，点一个街区进去看看。可以从{genesis}、{halving}或者{rank}开始。":
    "Each square on the map is a Bitcoin block, and its buildings come from the block's transactions. Drag, zoom and click a district to step inside. Try {genesis}, {halving} or {rank} to start.",
  "创世区块": "the genesis block",
  "第四次减半": "Fourth halving",
  "住下来": "Move in",
  "持有某个区块的 Bitmap 铭文，你就是那个街区的主人；持有街区里的一个地块（一笔交易），你就是那里的居民。Bitmap 可以在支持铭文的市场上买，还没人认领的号码也可以自己铭刻。想先当居民的话，{recruit}。":
    "Hold a block's Bitmap inscription and you're the owner of that district. Hold one of its parcels (a transaction) and you're a resident. You can buy a Bitmap on any market that supports inscriptions, or inscribe an unclaimed number yourself. To start as a resident, {recruit}.",
  "看看哪些街区在招人": "see which districts are recruiting",
  "热闹起来": "Liven it up",
  "连接钱包后可以关注、签到、发帖和回复，帖子都由你的钱包签名。街区越热闹，繁荣度越高，楼越高；相邻的街区可以连成园区，钱包里的 DOG 和猫也能住进来。":
    "Connect a wallet to follow, check in, post and reply; every post is signed by your wallet. The livelier a district, the higher its prosperity and the taller its buildings. Neighbouring districts can join into a park, and the DOG and cats in your wallet can move in too.",
  "比特币诞生于 2009 年 1 月 3 日，换一个那之后的日子试试。":
    "Bitcoin began on January 3, 2009. Try a day after that.",
  "这一天还没有区块。": "There's no block for that day yet.",
  "找到你生日（或任何一天）的区块": "Find the block from your birthday (or any day)",
  "去看看": "Go",

  // City map (components/CityMap.tsx)
  "城市地图，当前选中 {n}.bitmap。方向键移动，回车进入街区，加减号缩放。":
    "City map, {n}.bitmap selected. Arrow keys move, Enter opens the district, plus and minus zoom.",
  "显示层级": "Detail level",
  "城区": "City",
  "街区": "District",
  "地块": "Parcels",
  "放大": "Zoom in",
  "缩小": "Zoom out",
  "最新区块": "Latest block",
  "今天": "today",
  "地图数据加载失败：{error}": "Couldn't load the map: {error}",
  "地段计算中": "Zone pending",
  "加载中": "Loading",
  "已认领": "Claimed",
  "帖子": "Posts",
  "拥有者": "Owner",
  "未认领": "Unclaimed",
  "划分依据": "Zoned by",
  "进入街区": "Enter district",
  "每一片约 64 个区块，楼的种类按其中各地段的多少来摆。每次减半隔出一片大陆，海峡上有桥。点击放大":
    "Each patch is about 64 blocks, with buildings in the mix of their zones. Every halving starts a new continent, with bridges over the strait. Click to zoom in",
  "每一块地是区块里的一笔交易；立起来的是已认领的地块":
    "Each plot is one transaction in the block; the raised ones are claimed parcels",
  "拖动平移，滚轮或双指缩放，点击街区查看；放大到最近可看到地块":
    "Drag to pan, scroll or pinch to zoom, click a district to view it; zoom all the way in to see parcels",
  "第 {n} 纪元": "Epoch {n}",

  // Mondrian (components/Mondrian.tsx)
  "{n} 笔交易的 Mondrian 地块图": "Mondrian parcel map of {n} transactions",

  // Zones (lib/zones.ts): names, basis and story
  "地标": "Landmark",
  "CBD": "CBD",
  "商业区": "Commercial",
  "数据区": "Data",
  "别墅区": "Villas",
  "住宅区": "Residential",
  "山地": "Mountain",
  "比特币历史上的重要区块": "A key block in Bitcoin history",
  "比特币历史上的重要区块。地标在首页常驻推荐，帖子曝光更高。":
    "A key block in Bitcoin history. Landmarks are always featured on the home page, so their posts get seen more.",
  "本减半周期手续费前 1%": "Top 1% by fees this halving epoch",
  "手续费排在本减半周期最前面，高楼林立，是城市的商务核心。":
    "Among the highest fees of this halving epoch: a forest of towers, the city's business core.",
  "本减半周期手续费前 1% 到 10%": "Top 1% to 10% by fees this halving epoch",
  "交易活跃的商业街，适合开店和办活动。": "A busy shopping street, good for opening a shop or hosting events.",
  "四成以上的交易带有铭文": "Over 40% of transactions carry inscriptions",
  "铭文集中的区块，像城市的数据中心。": "A block packed with inscriptions, like the city's data center.",
  "交易少，但每笔金额大": "Few transactions, but large ones",
  "交易很少但金额很大，地块宽敞，独栋别墅带泳池。":
    "Few transactions but large amounts: roomy parcels and detached villas with pools.",
  "其余区块": "All other blocks",
  "普通区块，安静的住宅街区。": "An ordinary block, a quiet residential district.",
  "只有矿工的 coinbase 一笔交易": "Only the miner's coinbase transaction",
  "整个区块只有矿工的一笔交易，是还没开发的山地。":
    "The whole block holds just the miner's transaction: undeveloped mountain land.",

  // Landmarks (lib/zones.ts LANDMARKS)
  "创世块": "Genesis block",
  "披萨块": "Pizza block",
  "第一次减半": "First halving",
  "第二次减半": "Second halving",
  "SegWit 激活": "SegWit activation",
  "第三次减半": "Third halving",
  "Taproot 激活": "Taproot activation",
  "第一个铭文": "First inscription",

  // Prosperity (lib/prosperity.ts, components/ProsperityCard.tsx)
  "居民": "Residents",
  "近 30 天帖子": "Posts, last 30 days",
  "近 30 天回复": "Replies, last 30 days",
  "关注": "Followers",
  "近 30 天签到": "Check-ins, last 30 days",
  "邻居的热闹": "Neighbours' activity",
  "荒地": "Wild",
  "村落": "Village",
  "小镇": "Town",
  "繁华": "Metropolis",
  "一片草地": "a meadow",
  "几间小屋": "a few cottages",
  "成排的住宅": "rows of houses",
  "公寓楼": "apartment blocks",
  "高层住宅区": "high-rise housing",
  "空着的草坪": "an empty lawn",
  "带花园的小屋": "a cottage with a garden",
  "别墅": "a villa",
  "带泳池的大宅": "a mansion with a pool",
  "庄园": "an estate",
  "几个摊位": "a few stalls",
  "街边小店": "small street shops",
  "商业街": "a shopping street",
  "商场": "a mall",
  "购物中心和写字楼": "shopping centers and offices",
  "工地": "a building site",
  "几栋写字楼": "a few office buildings",
  "办公区": "an office district",
  "高楼群": "a cluster of towers",
  "摩天楼天际线": "a skyscraper skyline",
  "一个机柜棚": "a server shed",
  "机房": "a server room",
  "数据中心": "a data center",
  "大型数据中心": "a large data center",
  "超算园区": "a supercomputing campus",
  "荒山": "a bare hill",
  "山间小屋": "a mountain hut",
  "山村": "a mountain village",
  "缆车和山村": "a cable car and village",
  "山地度假区": "a mountain resort",
  "纪念碑": "a monument",
  "纪念广场": "a memorial square",
  "城市地标": "a city landmark",
  "繁荣度": "Prosperity",
  "繁荣度 {level} 级 · {name}": "Prosperity level {level} · {name}",
  "现在是{now}，再涨 {n} 分升到 {level} 级，会变成{next}。":
    "Now {now}. {n} more points reach level {level} and it becomes {next}.",
  "现在是{now}，已经是最高等级。": "Now {now}, the top level.",
  "这里属于园区「{name}」，园区合计 {score} 分，地图上按 {level} 级 · {levelName}显示。":
    "This is part of the park “{name}”, which has {score} points together, so the map shows it at level {level} · {levelName}.",
  "只算近 30 天的帖子、回复和签到，没人来就会慢慢降回去。":
    "Only posts, replies and check-ins from the last 30 days count, so it slowly drops back if nobody comes.",

  // Look (lib/style.ts): colours and decorations
  "橙": "Orange",
  "红": "Red",
  "蓝": "Blue",
  "绿": "Green",
  "紫": "Purple",
  "金": "Gold",
  "旗帜": "Flag",
  "花坛": "Flower beds",
  "路灯": "Street lamps",
  "喷泉": "Fountain",
  "雕像": "Statue",
};
