// English for first-visit guidance: the home page's three cards and 30 秒看懂, 新手任务 and the
// 新居民 badge, the one-line page intros, the terms explained in place, the signed-out 我的 and
// the wallet menu in the header.
export const onboarding: Record<string, string> = {
  // Home: the first screen
  "你出生那天、结婚那天，比特币上都出了一个块。在这里，每个块是一个{bitmap}，你可以去逛、签到，也可以给未来写一封信。":
    "The day you were born, the day you got married: Bitcoin mined a block on each. Here every block is a {bitmap} you can walk around, check in at, or use to write to the future.",
  "你出生那天，比特币上也出了一个块。": "Bitcoin mined a block on the day you were born, too.",
  "城市概况": "The city at a glance",
  "现在就能做 · 不用钱包": "Do it now · no wallet needed",
  "找到你生日那天的区块": "Find the block of your birthday",
  "看看那天比特币出了第几个块，那个街区现在什么样": "See which block Bitcoin mined that day, and what that district looks like now",
  "不用钱包，10 秒": "No wallet, 10 seconds",
  "10 秒": "10 sec",
  "给未来写一封信": "Write a letter to the future",
  "时间胶囊：锁在区块里，到那一天才能打开": "Time capsule: locked in a block until the day it opens",
  "第一封免费": "First one free",
  "今天去这 3 个街区逛逛": "Visit these 3 districts today",
  "今天的 3 个街区都逛过了": "You've been to all 3 of today's districts",
  "今日巡城：{stops}": "Today's tour: {stops}",
  "每天三个街区，都去签到就得到巡城徽章": "Three districts a day; check in at all of them for the tour badge",
  "第一次来？": "New here? ",
  "30 秒看懂 unimap": "unimap in 30 seconds",
  "收起": "Hide",
  "地图上每一格是比特币的一个区块，楼的样子由区块里的交易决定。每次减半是一个{epoch}，一块大陆。点一个街区进去看看，可以从{genesis}、{halving}或者{rank}开始。":
    "Every square on the map is a Bitcoin block, and its buildings are drawn from the block's transactions. Each halving is an {epoch}, one continent. Click a district to go in; you could start at the {genesis}, the {halving} or the {rank}.",
  "持有某个区块的 Bitmap 铭文，你就是那个街区的主人；持有街区里的一个{parcel}（一笔交易），你就是那里的居民。想先当居民的话，{recruit}。":
    "Hold a block's Bitmap inscription and you own that district; hold one of its {parcel} (a transaction) and you live there. To start as a resident, {recruit}.",
  "连接钱包后可以关注、签到、发帖和回复，都用钱包签名，不花钱。街区越热闹，{prosperity}越高，楼越高；每出一个新区块，城里还会抽一次{beat}。":
    "With a wallet connected you can follow, check in, post and reply, each signed by your wallet at no cost. The livelier a district, the higher its {prosperity} and the taller its buildings; and every new block draws a {beat}.",

  // Words with a <Term> explanation, inside a sentence
  "街区#term": "district",
  "纪元#term": "epoch",
  "地块#term": "parcels",
  "繁荣度#term": "prosperity",
  "幸运街区#term": "lucky district",
  "居民#term": "residents",

  // 新手任务
  "新手任务": "Getting started",
  "新手任务 {k}/{n}": "Getting started {k}/{n}",
  "新手任务完成": "Getting started: done",
  "打开新手任务（{k}/{n}）": "Open Getting started ({k}/{n})",
  "去一个街区签到": "Check in at a district",
  "封存你的第一封信": "Seal your first letter",
  "（已完成）": " (done)",
  "（连接钱包）": " (connect a wallet)",
  "下一步：": "Next: ",
  "下一步：{step}": "Next: {step}",
  "找你的生日区块": "find your birthday block",
  "封一封信": "seal a letter",
  "三步做完得到「新居民」徽章": "Do all three for the Newcomer badge",
  "你得到了「新居民」徽章": "You earned the Newcomer badge",
  "三步都做完了，连接钱包领「新居民」徽章": "All three done; connect a wallet to get the Newcomer badge",
  "关闭，不再显示": "Close for good",
  "新居民": "Newcomer",

  // Terms
  "街区 / Bitmap": "District / Bitmap",
  "比特币的每个区块都是一个街区；持有那个区块的 Bitmap 铭文，你就是街区主人。":
    "Every Bitcoin block is a district; hold that block's Bitmap inscription and the district is yours.",
  "地块 / 居民": "Parcel / resident",
  "区块里的每笔交易是一个地块；持有地块，你就是那个街区的居民。":
    "Each transaction in a block is a parcel; hold a parcel and you're a resident of that district.",
  "每次比特币减半是一个纪元，地图上一块大陆。": "Each Bitcoin halving starts an epoch: one continent on the map.",
  "签到、发帖、居民越多，街区越繁荣，地图上的楼越高。":
    "The more check-ins, posts and residents, the more prosperous a district, and the taller its buildings on the map.",
  "区块节拍 / 巡城": "Block Beat / daily tour",
  "每出一个新块抽一次幸运街区；每天给三个街区，都去签到就得到巡城徽章。":
    "Every new block draws a lucky district; each day names three districts, and checking in at all of them earns the tour badge.",

  // Page intros
  "这一页是什么": "About this page",
  "{name}：": "{name}: ",
  "知道了，不再显示": "Got it, don't show again",
  "每出一个新区块，城里就{draw}一次奖。": "Every new block holds a {draw} in the city. ",
  "抽": "draw",
  "今天的幸运街区是 {n}，去签到就能领幸运来访徽章。": "Today's lucky district is {n}: check in there for a Lucky visit badge.",
  "按{prosperity}排的街区排行：签到、发帖和居民越多越靠前。点进任意一个去逛逛，看看热闹的街区在聊什么。":
    "Districts ranked by {prosperity}: the more check-ins, posts and residents, the higher. Open any of them to see what the lively ones are talking about.",
  "这些街区的主人在找{residents}。持有那个区块里的一笔交易，就能住进去。":
    "The owners of these districts are looking for {residents}. Hold a transaction from that block and you can move in.",
  "写一封信，锁在今天的区块里，到你选的那一天才能打开。在浏览器里加密，unimap 看不到内容；封存要用钱包签名。":
    "Write a letter, lock it in today's block, and it opens only on the day you pick. It's encrypted in your browser, so unimap can't read it; sealing takes a wallet signature.",

  // 我的, signed out
  "连上钱包，这里就是你在 unimap 的家": "Connect a wallet and this is your home on unimap",
  "你持有的 Bitmap 街区和地块会自动出现在这里": "The Bitmap districts and parcels you hold show up here by themselves",
  "签到、发帖、关注街区，都用钱包签名，不花钱": "Check in, post and follow districts, each signed by your wallet at no cost",
  "你封存的时间胶囊和收到的私信": "The time capsules you sealed and the messages you got",
  "支持 {wallets}": "Works with {wallets}",
  "不连钱包也可以": "Or, without a wallet",
  "找到你生日的区块": "Find your birthday block",
  "逛今日巡城": "Walk today's tour",
  "看繁荣榜": "See the rankings",

  // The wallet menu
  "钱包菜单": "Wallet menu",
  "钱包菜单：{address}": "Wallet menu: {address}",
  "我的主页": "My page",
  "我的时间胶囊": "My time capsules",
  "{n} 条未读": "{n} unread",
  "断开钱包": "Disconnect wallet",
};
