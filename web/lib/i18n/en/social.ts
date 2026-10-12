// English for the social strings; keys are the exact Chinese passed to t() / tn().
// Posts, notifications, sharing, My land, the ranking and recruiting pages, X and wallets.
export const social: Record<string, string> = {
  // Shared
  "取消": "Cancel",
  "街区": "District",
  "回复": "Reply",
  "地块 #{n}": "Parcel #{n}",
  "街区主人": "Owner",
  "访客": "Visitor",
  "居民 · 地块 #{n}": "Resident · parcel #{n}",
  "区块 {n}": "Block {n}",
  "{n} 级": "Level {n}",
  // Level, zone and landmark names, 居民, 关注, 帖子, 地块 and 加载中… are in map.ts.

  // My land (app/me)
  "连接钱包后可以看到你的街区和地块。": "Connect a wallet to see your districts and parcels.",
  "我的土地": "My land",
  "这个地址没有持有街区。": "This address holds no districts.",
  "这个地址没有持有地块。": "This address holds no parcels.",
  "还没有关注街区。": "Not following any districts yet.",
  "解除绑定后，街区和帖子上不再显示你的 X 账号。": "After unlinking, your X account no longer shows on your districts and posts.",
  "X 账号": "X account",
  "解除绑定": "Unlink",
  "绑定后，你的街区和帖子旁会显示 X 账号，别人一眼知道是谁。我们只读取账号名和头像，不会替你发推。":
    "Once linked, your X account shows next to your districts and posts, so people know who you are. We only read your name and avatar and never post for you.",
  "绑定 X": "Link X",
  "这个站点还没有开启 X 绑定。": "Linking X isn't enabled on this site yet.",
  "{wallet} 现在选中的是已经关联的地址，请在钱包里切换到另一个账户再试。":
    "{wallet} has an address selected that's already linked. Switch to another account in the wallet and try again.",
  "解除关联后，这个钱包里的藏品不再算进你的街区。": "After unlinking, the collectibles in this wallet no longer count toward your districts.",
  "关联钱包": "Linked wallets",
  "土地和藏品放在不同地址？用另一个钱包签个名证明它也是你的，街区上的宠物会合计所有关联钱包的数量。发帖和管理街区仍按各自地址。":
    "Keep your land and collectibles at different addresses? Sign with the other wallet to prove it's yours too, and the pets on your districts will count what all linked wallets hold. Posting and running a district still go by each address.",
  "主地址": "Main",
  "当前登录": "Signed in",
  "解除": "Unlink",
  "选一个钱包，在钱包里切换到要关联的账户，再签名。签名不花钱，也不会发起交易。":
    "Pick a wallet, switch to the account you want to link, then sign. Signing is free and sends no transaction.",
  "等待签名…": "Waiting for signature…",
  "手动粘贴签名": "Paste a signature",
  "关联另一个钱包": "Link another wallet",

  // Notifications
  "通知": "Notifications",
  "通知，{n} 条未读": "Notifications, {n} unread",
  " 等 {n} 人": " ({n} people)",
  "{who} 回复了你在 {place} 的帖子": "{who} replied to your post in {place}",
  "{who} 赞了你在 {place} 的帖子": "{who} liked your post in {place}",
  "{who} 在你的街区 {place} 发了帖子": "{who} posted in your district {place}",
  "{who} 关注了你的街区 {place}": "{who} followed your district {place}",
  "{who} 申请入住你的街区 {place}，去「管理街区 → 招募」看看":
    "{who} applied to move into your district {place}. See Manage district → Recruiting",
  "连接钱包后可以看到你的通知。": "Connect a wallet to see your notifications.",
  "还没有通知。有人回复、点赞、打赏你的帖子，关注你的街区或者申请入住，或者区块给你送来宝箱时，会在这里告诉你。":
    "No notifications yet. When someone replies to, likes or tips your post, follows your district or applies to move in, or a block brings you a treasure, you'll see it here.",
  "更早的通知": "Older notifications",

  // Posts (PostCard, Composer, post page)
  "连接钱包后才能点赞": "Connect a wallet to like posts",
  "删除这条帖子？": "Delete this post?",
  "置顶": "Pin",
  "禁言作者": "Mute author",
  "删除": "Delete",
  "街区主人置顶": "Pinned by the owner",
  "这条帖子由作者的比特币钱包签名，点击查看": "Signed by the author's Bitcoin wallet. Click to see the signature",
  "已签名": "Signed",
  "条回复": "replies",
  "个赞": "likes",
  "签名地址 {address}": "Signed by {address}",
  "更多操作": "More actions",
  "写下你的回复…": "Write a reply…",
  "说点什么…": "Say something…",
  "发帖": "Post",
  "图片链接（https://…），多个用空格隔开": "Image links (https://…), separated by spaces",
  "图片链接": "Image links",
  "发言身份": "Post as",
  "以{who}发言": "Post as {who}",
  "以我的地址发言": "Post as my address",
  "以 {n}.bitmap 发言": "Post as {n}.bitmap",
  "添加图片": "Add images",
  "等待钱包签名…": "Waiting for your wallet…",
  "签名并回复": "Sign and reply",
  "签名并发布": "Sign and post",
  "这条帖子不存在，或者已经删除了。": "This post doesn't exist or was deleted.",
  "去 {n}.bitmap 看看": "Visit {n}.bitmap",

  // Land events
  "{n}.bitmap 的地块 #{i}": "Parcel #{i} of {n}.bitmap",
  "{what} 从 {from} 转给了 {to}": "{what} moved from {from} to {to}",
  "{what} 被 {to} 认领": "{what} claimed by {to}",

  // Session and manual signing
  "不认识这个钱包": "Unknown wallet",
  "这个浏览器没有安装 {wallet}": "{wallet} isn't installed in this browser",
  "请先连接钱包": "Connect a wallet first",
  "找不到钱包，请重新连接": "Wallet not found. Please connect again",
  "你的地址": "Your address",
  "持有 Bitmap 铭文的那个地址。": "The address that holds your Bitmap inscriptions.",
  "签名这条消息": "Sign this message",
  "用 {address} 签名，例如 {command}，再把签名（base64）粘贴到下面。":
    "Sign with {address}, for example {command}, then paste the signature (base64) below.",
  "复制消息": "Copy message",
  "签名": "Signature",
  "继续": "Continue",
  "演示钱包": "Demo wallet",
  "演示钱包 2": "Demo wallet 2",

  // Sharing
  "分享": "Share",
  "链接已复制": "Link copied",
  "分享到 X": "Share on X",
  "复制链接": "Copy link",
  "更多方式…": "More…",
  "{n} 级{name}": "Level {n} {name}",
  "（{name}）": " ({name})",
  "我在 unimap 的街区 {n}.bitmap{landmark}": "My district on unimap: {n}.bitmap{landmark}",
  "来 unimap 逛逛 {n}.bitmap{landmark}": "Come visit {n}.bitmap{landmark} on unimap",
  "，属于园区「{name}」": ", part of the park “{name}”",
  "，现在是 {level}": ", now {level}",
  "。": ". ",
  "我在 unimap 建了园区「{name}」：{n} 个街区连成一片，现在是 {level}。#Bitmap #unimap":
    "I built the park “{name}” on unimap: {n} districts joined together, now {level}. #Bitmap #unimap",
  "unimap 上的园区「{name}」：{n} 个街区连成一片，现在是 {level}。#Bitmap #unimap":
    "The park “{name}” on unimap: {n} districts joined together, now {level}. #Bitmap #unimap",
  "“{clip}”，来自 unimap 的 {n}.bitmap": "“{clip}” from {n}.bitmap on unimap",
  "一条帖子，来自 unimap 的 {n}.bitmap": "A post from {n}.bitmap on unimap",
  "{n}.bitmap 在招居民：{message} 来 unimap 申请入住。#Bitmap #unimap":
    "{n}.bitmap is recruiting residents: {message} Apply to move in on unimap. #Bitmap #unimap",
  "unimap 繁荣榜：比特币城市里最热闹的街区。#Bitmap #unimap": "unimap Rankings: the liveliest districts in the Bitcoin city. #Bitmap #unimap",

  // Ranking and recruiting
  "繁荣榜还没有上线。": "Rankings aren't live yet.",
  "最热闹的 50 个街区。按繁荣度排序，只算近 30 天的帖子、回复和签到，所以名次每天都会变。":
    "The 50 liveliest districts, ranked by prosperity. Only posts, replies and check-ins from the last 30 days count, so the ranking changes every day.",
  "招募居民": "Recruiting residents",
  "这些街区在找新邻居。进去看看说明，申请入住后，街区主人会把地块转给你。":
    "These districts are looking for new neighbors. Read what they say and apply to move in; the owner will transfer a parcel to you.",
  "现在没有街区在招募。": "No districts are recruiting right now.",
  "开放地块": "Open parcels",

  // X
  "已绑定 X 账号 @{username}": "Linked X account @{username}",
  "{user} 在 X 上的推文": "Post by {user} on X",
  "打开 ↗": "Open ↗",
  "你在 X 上取消了授权。": "You cancelled the authorization on X.",
  "X 没有完成授权。": "X didn't finish the authorization.",
  "请先连接钱包，再绑定 X。": "Connect a wallet first, then link X.",
  "链接不完整，请回到我的土地重新绑定。": "The link is incomplete. Go back to My land and link again.",
  "回到我的土地": "Back to My land",
  "正在确认 X 账号…": "Confirming your X account…",
  // Person page (app/address/[a])
  "复制地址": "Copy address",
  "已复制": "Copied",
  "{who} 在 unimap 上的街区和帖子 #Bitmap": "{who}'s districts and posts on unimap #Bitmap",
  "这是你的主页，别人看到的就是这样。": "This is your page, as others see it.",
  "管理我的土地": "Manage my land",
  "回复#count": "Replies",
  "街区#count": "Districts",
  "帖子和回复": "Posts and replies",
  "从 {date} 开始发帖": "Posting since {date}",
  "还没有发过帖子。": "No posts yet.",
  "更早的帖子": "Older posts",
  "看看别人眼中的我的主页": "See my public page",
};
