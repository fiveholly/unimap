// English for 礼物, the gift sent with a time capsule (components/Gift.tsx, app/capsule/gift); keys are the exact Chinese passed to t().
export const gift: Record<string, string> = {
  // Shared
  "礼物": "Gift",
  "时间锁": "Time lock",
  "测试网 · {net}": "Test network · {net}",
  "测试网的币没有价值，只用来试": "Test-network coins are worth nothing; they're for trying things out",
  "{n} 万聪": "{n}0k sats",
  "锁到区块": "Locked until block",
  "锁到区块 {h}": "Locked until block {h}",
  "地址": "Address",
  "给": "To",
  "状态": "Status",
  "退回": "Refund",
  "礼物地址": "Gift address",

  // Picking a gift (app/capsule)
  "随信附上一份比特币礼物": "Send bitcoin with the letter",
  "礼物金额": "Gift amount",
  "自定义金额": "Custom amount",
  "自定义金额（至少 {n} 聪）": "Custom amount (at least {n} sats)",
  "礼物至少 {n} 聪。": "A gift is at least {n} sats.",
  "测试网上的礼物最多 {n} 聪。": "On the test network a gift is at most {n} sats.",
  "比特币自己把这笔钱锁到区块 {h}（{span}），之前谁都动不了，包括 unimap。收礼人到时用时间锁领走；unimap 不碰这笔钱，也拿不到钥匙。":
    "Bitcoin itself locks these sats until block {h} ({span}); nobody can move them before then, unimap included. The recipient claims them with the time lock; unimap never touches the sats or holds a key to them.",
  "比特币自己把这笔钱锁到打开那一块，之前谁都动不了，包括 unimap。": "Bitcoin itself locks these sats until the opening block; nobody can move them before then, unimap included.",
  "约 5 年后还没人领，就退回给我": "Send it back to me if nobody claims it within about 5 years",
  "收礼人的钱包公钥（可选）": "Recipient's wallet public key (optional)",
  "不填就生成一把礼物钥匙": "Leave empty to make a gift key",
  "不填的话，浏览器会生成一把「礼物钥匙」，放进时间锁交给对方：拿着时间锁的人到时就能领。":
    "Left empty, your browser makes a \"gift key\" and puts it in the time lock you hand over: whoever holds the time lock can claim the gift when the time comes.",
  "退回用的公钥": "Public key for the refund",
  "默认用钱包的公钥": "Your wallet's public key by default",
  "只收「封存」的费用，礼物本身不收一分钱；另付比特币网络的手续费。": "Only the Seal fee is charged; nothing is taken from the gift. Bitcoin network fees are extra.",
  "礼物锁在比特币上，不交给 unimap。打开的钥匙一半在 unimap、一半在时间锁里，到点后 drand 也会公开它。":
    "The gift is locked on Bitcoin, never handed to unimap. The letter's key is split: half with unimap, half in the time lock, and drand publishes it when the time comes.",
  "一半在 unimap，一半在时间锁": "Half with unimap, half in the time lock",
  "区块 {h} 到了，unimap 才交出它那一半；时间锁里是另一半。drand 到点也会公开整把钥匙。":
    "unimap hands over its half only once block {h} is out; the other half is in the time lock. drand also publishes the whole key when the time comes.",
  "礼物属于「封存」：选「封存」再附礼物。": "A gift comes with Seal: pick Seal to add one.",
  "这个站点现在不能附礼物。": "This site can't add gifts right now.",
  "现在看不到测试网的最新区块，稍后再试。": "Can't see the test network's latest block right now; try again later.",
  "收礼人的公钥不对：要 64 位（或 66 位）十六进制。": "That recipient key isn't right: it should be 64 (or 66) hex characters.",
  "退回需要你的公钥：钱包没有给出，填一个，或者关掉退回。": "The refund needs your public key: your wallet didn't give one, so enter one or turn the refund off.",

  // Locking the sats (components/Gift.tsx GiftFund)
  "把礼物锁进去": "Lock the gift in",
  "礼物锁好了": "The gift is locked",
  "{n} 会锁在 {addr}，到区块 {h} 才能动。": "{n} will be locked at {addr} and can't move until block {h}.",
  "先存好时间锁": "Save the time lock first",
  "里面有领礼物的钥匙和一半的备用钥匙，unimap 不会再给第二次。打开、打印，或者把链接发给收礼人。":
    "It holds the key that claims the gift and half of the backup key, and unimap can't give it to you again. Open it, print it, or send the link to the recipient.",
  "打开时间锁（可打印）": "Open the time lock (printable)",
  "复制时间锁链接": "Copy the time lock link",
  "我已经存好时间锁了": "I've saved the time lock",
  "用钱包锁进 {n}": "Lock {n} in from your wallet",
  "钱包付一笔交易（礼物加上刻铭文的手续费），浏览器再签第二笔，把信的密文刻成铭文，和礼物放进同一个输出。":
    "Your wallet pays one transaction (the gift plus the inscription's fee); your browser then signs a second that inscribes the encrypted letter into the same output as the gift.",
  "在区块浏览器里看": "View on the explorer",
  "继续锁礼物": "Continue locking the gift",
  "用演示钱包锁进去": "Lock it in with the demo wallet",
  "用钱包锁进去": "Lock it in with your wallet",
  "看看时间锁": "See the time lock",
  "正在广播第一笔交易（commit）…": "Broadcasting the first transaction (commit)…",
  "正在刻上铭文，把礼物锁进去（reveal）…": "Inscribing and locking the gift in (reveal)…",
  "告诉 unimap 交易号…": "Telling unimap the transaction ids…",
  "这个钱包不能签交易。换 UniSat、Xverse 或 OKX 钱包试试。": "This wallet can't sign transactions. Try UniSat, Xverse or OKX Wallet.",
  "钱包现在不在测试网上：先在钱包里切到 {net}，再试一次。": "Your wallet isn't on the test network: switch it to {net} and try again.",
  "钱包在 {net} 上没有币。先从水龙头领一点测试币。": "Your wallet has no coins on {net}. Get some test coins from a faucet first.",
  "看看封好的信封": "See the sealed envelope",

  // The capsule's page (app/capsule/[id])
  "到时间了。这封信带着礼物，要用收礼人手里的时间锁打开。": "It's time. This letter came with a gift and opens with the time lock the recipient holds.",
  "随信的礼物": "Gift with the letter",
  "已锁在链上": "Locked on-chain",
  "还没锁进去": "Not locked in yet",
  "复制时间锁链接（交给收礼人）": "Copy the time lock link (for the recipient)",
  "时间锁存在封信的那个浏览器里。": "The time lock is in the browser that sealed this letter.",
  "收礼人拿着时间锁，到点就能打开信、领走礼物。": "The recipient holds the time lock and, when the time comes, opens the letter and claims the gift.",
  "打开时间锁": "Open the time lock",

  // The time lock card and page (app/capsule/gift)
  "扫时间锁上的二维码会直接打开这里。二维码扫不出来的话，把卡片上的文字备份贴进来。": "Scanning the time lock's QR code opens this page. If the QR code won't scan, paste the card's text backup here.",
  "时间锁的文字备份": "The time lock's text backup",
  "这段文字不是一张完整的时间锁。": "That text isn't a complete time lock.",
  "时间锁二维码": "Time lock QR code",
  "谁拿着这张时间锁，谁就能在到点后领走礼物、打开信。像现金一样收好，别拍照发到群里。":
    "Whoever holds this time lock can claim the gift and open the letter when the time comes. Keep it like cash; don't post a photo of it.",
  "文字备份（二维码扫不出来时，把这段贴进时间锁页面）": "Text backup (if the QR code won't scan, paste this into the time lock page)",
  "给 {name} 的一封信和一份礼物": "A letter and a gift for {name}",
  "区块 {h} 到了，信和礼物都打开了": "Block {h} is here: the letter and the gift are open",
  "用 drand 公开的钥匙打开": "Opened with the key drand published",
  "用两半备用钥匙打开": "Opened with both halves of the backup key",
  "区块到了，正在打开信…": "The block is here; opening the letter…",
  "正在看测试网的最新区块…": "Checking the test network's latest block…",
  "区块 {h} 出来之前，谁都打不开这封信，也动不了这份礼物。到时这里会自动打开。": "Until block {h} is out nobody can open this letter or move this gift. This page opens it by itself then.",
  "现在还打不开信：{why}": "The letter can't be opened yet: {why}",
  "找不到信的密文。": "Can't find the letter's ciphertext.",
  "再试一次": "Try again",
  "连不上测试网的区块浏览器，过一会儿再看。": "Can't reach the test network's explorer; check back in a while.",
  "链上现在": "On-chain now",
  "已领走或还没到账": "Claimed, or not arrived yet",
  "测试网最新": "Test network tip",
  "区块 {h} 后寄信人可取回": "Sender can take it back after block {h}",
  "没有退回": "No refund",
  "金额可以在区块浏览器里核对：这个地址的钱只能按上面的规则花，unimap 没有钥匙。": "Check the amount on a block explorer: the coins at this address can only be spent by the rules above, and unimap has no key.",
  "显示时间锁卡片（可打印）": "Show the time lock card (printable)",
  "收起时间锁卡片": "Hide the time lock card",
  "打印时间锁": "Print the time lock",
  "也写一封时间胶囊": "Write a time capsule too",
  "领取礼物": "Claim the gift",
  "你的测试网地址 tb1…": "Your test network address tb1…",
  "一键领到这个地址": "Claim it to this address",
  "正在发出…": "Sending…",
  "礼物已经发出": "The gift is on its way",
  "这个地址上现在没有币：可能已经领走了，或者还在路上。": "There are no coins at this address now: they may have been claimed, or are still on the way.",
  "这不像测试网地址（应该是 tb1 开头）。": "That doesn't look like a test network address (it should start with tb1).",
  "这份礼物锁在收礼人的钱包公钥上：请连接那个钱包再领。": "This gift is locked to the recipient's wallet key: connect that wallet to claim it.",
  "这份礼物锁在收礼人的钱包公钥上，要那个钱包来签。": "This gift is locked to the recipient's wallet key; that wallet has to sign.",
  "不靠 unimap 怎么领": "How to claim it without unimap",
  "礼物是一个 Taproot 输出，内部公钥是 BIP-341 的 NUMS 点（没人有私钥），只能走脚本路径：":
    "The gift is a Taproot output whose internal key is BIP-341's NUMS point (nobody has its private key), so it can only be spent by a script path:",
  "到区块 {h} 之后，用礼物钥匙签一笔 nLockTime = {h}、nSequence = 0xfffffffe 的交易，见证是 [签名, 上面的脚本, 控制块]。":
    "From block {h}, sign a transaction with nLockTime = {h} and nSequence = 0xfffffffe using the gift key; the witness is [signature, the script above, control block].",
  "礼物钥匙（私钥，十六进制）：": "Gift key (private key, hex):",
  "仓库里的 web/scripts/claim-gift.mjs 用这张时间锁的文字备份做同样的事，也能用 drand 解开信。":
    "web/scripts/claim-gift.mjs in the repository does the same from this time lock's text backup, and can open the letter with drand.",

  // The demo site's 真实 Signet (lib/signet.ts, lib/signetwallets.ts)
  "真实 Signet": "Real Signet",
  "（演示站）": "(demo site)",
  "测试网 · Signet · 真实交易": "Test network · Signet · real transactions",
  "测试网 · Signet，真实交易，测试币没有价值": "Test network · Signet: real transactions, and test coins are worth nothing",
  "礼物用你自己的钱包在比特币 Signet 测试网上真实交易：先把 UniSat 切到 Signet，准备一点测试币。区块约 10 分钟一个，到点后真的能领走。演示站没有服务器，unimap 那一半钥匙存在这个浏览器里；封存的费用照旧只是模拟。":
    "The gift is sent for real on Bitcoin's Signet test network, from your own wallet: switch UniSat to Signet and have some test coins ready. A block comes about every 10 minutes, and once the block is out the gift really can be claimed. The demo site has no server, so unimap's half of the key is kept in this browser; the Seal fee is still only simulated.",
  "关着时礼物只在演示站里模拟，不碰任何链。打开后，用你的钱包在 Signet 上发真实的测试网交易。":
    "While this is off, the gift is only simulated on the demo site and touches no chain. Turn it on to send real test-network transactions on Signet from your wallet.",
  "连不上 Signet 的区块浏览器（mempool.space），看不到最新区块。稍后再试，或者先关掉真实 Signet。":
    "Can't reach the Signet explorer (mempool.space), so the latest block can't be seen. Try again later, or turn Real Signet off for now.",
  "下一个块（约 10 分钟）": "Next block (about 10 minutes)",
  "两个块后（约 20 分钟）": "In two blocks (about 20 minutes)",
  "Signet 的区块 {h} 到了，演示站才交出 unimap 那一半（它存在这个浏览器里）；时间锁里是另一半。drand 到点也会公开整把钥匙，换一台设备也能打开。":
    "The demo site hands over unimap's half (kept in this browser) only once Signet block {h} is out; the other half is in the time lock. drand also publishes the whole key when the time comes, so it opens on another device too.",
  "没找到能用的钱包：真实 Signet 要装 UniSat（或 Xverse、OKX 钱包）并切到 Signet。": "No wallet found to use: Real Signet needs UniSat (or Xverse or OKX Wallet) installed and switched to Signet.",
  "钱包在 Signet 上的币不够：要 {need}，只有 {have}。先从 Signet 水龙头（比如 signetfaucet.com）领一点测试币，等到账后再试。":
    "Not enough coins on Signet in your wallet: this needs {need} and there are {have}. Get some test coins from a Signet faucet (signetfaucet.com, for one), wait for them to arrive, and try again.",
  "用 {wallet} 在 Signet 上锁进去": "Lock it in on Signet with {wallet}",
  "用钱包在 Signet 上锁进去": "Lock it in on Signet with your wallet",
  "会发两笔真实的 Signet 交易：钱包签第一笔，浏览器签第二笔，都广播到 mempool.space。":
    "This sends two real Signet transactions: your wallet signs the first, your browser the second, and both are broadcast through mempool.space.",
  "让 UniSat 切到 Signet": "Switch UniSat to Signet",
  "Signet 没有收下这笔交易：{why}": "Signet didn't accept the transaction: {why}",
  "{wallet} 现在在 {found} 上，不是 Signet：请在 {wallet} 里切到 Signet（测试网），再试一次。": "{wallet} is on {found}, not Signet: switch {wallet} to Signet (a test network) and try again.",
  "{wallet} 现在不在 Signet 上：请在 {wallet} 里切到 Signet（测试网），再试一次。": "{wallet} isn't on Signet: switch {wallet} to Signet (a test network) and try again.",
  "请在钱包里手动切到 Signet。": "Switch your wallet to Signet yourself.",
  "区块高度和金额都直接读 Signet 链上（mempool.space）。到点后先用 drand 打开信，不行再用两半备用钥匙；在别的设备上打开时只有 drand 这条路。":
    "The block height and the amount are read straight from the Signet chain (mempool.space). When the time comes the letter opens with drand first, or else with both halves of the backup key; on another device only drand can open it.",
  "这台设备不是封信的那一台：演示站没有服务器，unimap 那一半钥匙只存在封信的浏览器里，所以这里只能等 drand 公开钥匙来打开信（大约 {time}）。领礼物不受影响。":
    "This isn't the device that sealed the letter: the demo site has no server and unimap's half of the key lives only in the sealing browser, so here the letter opens only once drand publishes the key (around {time}). Claiming the gift works either way.",
  "drand 要到 {time} 才公开钥匙": "drand publishes the key only at {time}",
  "连不上 drand（{why}）": "Can't reach drand ({why})",
  "这台设备上没有 unimap 那一半（演示站没有服务器，它只存在封信的那个浏览器里）": "unimap's half isn't on this device (the demo site has no server; it lives only in the browser that sealed the letter)",
  "{drand}；备用钥匙也拿不到：{why}": "{drand}; and the backup key can't be had either: {why}",

  // GiftFund, inscribing a letter without a gift
  "信用你自己的钱包真实地刻在比特币 Signet 测试网上：先把 UniSat 切到 Signet，准备一点测试币。演示站没有服务器，unimap 那一半钥匙存在这个浏览器里；服务费照旧只是模拟。":
    "The letter is really inscribed on Bitcoin's Signet test network, from your own wallet: switch UniSat to Signet and get a few test coins first. The demo has no server, so unimap's half of the key is kept in this browser; the service fee is still only simulated.",
  "关着时信只刻在演示站模拟的链上。打开后，用你的钱包在 Signet 上发真实的测试网交易。": "Off, the letter is inscribed only on the demo's pretend chain. On, your wallet sends real test-network transactions on Signet.",
  "正在把信刻成铭文（reveal）…": "Inscribing the letter (reveal)…",
  "信刻上链了": "The letter is inscribed",
  "把信刻上链": "Inscribe the letter",
  "钱包付一笔交易（刻铭文的网络费，加随信的 {n}），浏览器再签第二笔，把信的密文刻成铭文，连同 {n} 送到 {to}。":
    "Your wallet pays one transaction (the inscription's network fee plus the {n} that goes with the letter); the browser signs a second that inscribes the encrypted letter and sends it, with the {n}, to {to}.",
  "钱包付一笔交易（刻铭文的网络费，加随信的 {n}），浏览器再签第二笔，把信的密文刻成铭文；那 {n} 回到你自己的地址。":
    "Your wallet pays one transaction (the inscription's network fee plus the {n} that goes with the letter); the browser signs a second that inscribes the encrypted letter, and the {n} comes back to your own address.",
  "继续刻上链": "Continue inscribing",
  "用 {wallet} 在 Signet 上刻上链": "Inscribe on Signet with {wallet}",
  "用钱包在 Signet 上刻上链": "Inscribe on Signet with your wallet",
  "用演示钱包刻上链": "Inscribe with the demo wallet",
  "用钱包刻上链": "Inscribe with your wallet",
};
