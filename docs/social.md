# 社交接口

身份全部按索引器的持有关系实时判定（`api/roles.py`）：

| 身份 | 条件 | 能做什么 |
|---|---|---|
| 社区主（owner） | 持有街区铭文 | 发帖、回复、编辑主页、置顶、删帖、禁言、关闭访客回复 |
| 居民（resident） | 持有该街区下的地块 | 发帖、回复，帖子带居民标识和地块号 |
| 访客（visitor） | 其他钱包 | 回复（社区主可关闭），关注、点赞 |

街区转手后，管理权立刻跟着新持有人走；历史帖子保留发帖时的身份。被禁言的地址在该街区不能发帖或回复。每个地址每分钟最多发 5 条。

## 登录

1. `POST /v1/auth/nonce {"address"}` 返回 `message`，有效期 10 分钟。
2. 钱包对 `message` 签名（BIP-322 simple，或旧式 Bitcoin Signed Message）。
3. `POST /v1/auth/login {"address", "nonce", "signature"}` 返回 `token`，之后带 `Authorization: Bearer <token>`，有效期 30 天。

支持的地址：P2TR、P2WPKH（BIP-322 或旧式签名），P2SH-P2WPKH、P2PKH（旧式签名）。P2TR 的旧式签名按无脚本树的 key tweak 校验，对应 UniSat 的 ecdsa 模式。

## 发帖签名

每条帖子和回复都要钱包签名，签名内容由服务端按字段重建后校验，签名和原文随帖子一起返回，任何人都能离线复核。格式（`api/social.py` 的 `post_message`）：

```
unimap post
district: 840000.bitmap
reply-to: none
as: none
time: 1760000000
media: none

正文
```

- `reply-to`：回复的帖子 id，发帖时为 `none`。只能回复顶层帖子。
- `as`：以自己持有的另一个街区身份发言，例如 `840001.bitmap`；不选为 `none`。
- `time`：签名时的 unix 秒，和服务器时间相差不能超过 10 分钟。
- `media`：每个图片链接一行 `media: https://…`，没有图片时为 `media: none`。
- 正文换行用 `\n`。

请求体：`POST /v1/districts/{n}/posts {"body", "media", "reply_to", "as_bitmap", "signed_at", "signature"}`。

## 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/me` | 当前地址持有的街区、地块、关注列表和关联钱包 |
| GET | `/v1/districts/{n}` | 主页信息、置顶帖、关注数、访问者身份 |
| PUT | `/v1/districts/{n}/profile` | 社区主修改简介、封面、访客回复开关 |
| GET | `/v1/districts/{n}/posts` | 顶层帖子，新的在前，`before_id` 翻页 |
| POST | `/v1/districts/{n}/posts` | 发帖或回复 |
| GET | `/v1/posts/{id}` / `/v1/posts/{id}/replies` | 单帖 / 回复（旧的在前） |
| DELETE | `/v1/posts/{id}` | 作者或社区主删除 |
| PUT / DELETE | `/v1/districts/{n}/pin` | 置顶 / 取消置顶 |
| GET / PUT / DELETE | `/v1/districts/{n}/mutes[/{address}]` | 禁言管理 |
| PUT / DELETE | `/v1/districts/{n}/follow` | 关注 |
| PUT / DELETE | `/v1/posts/{id}/like` | 点赞 |
| GET | `/v1/feed` | 关注街区的帖子和链上事件，按时间倒序 |
| GET | `/v1/districts/{n}/neighbors` | 相邻 ±10 个高度街区的最新帖子 |
| GET | `/v1/land/{n}/events` | 街区和地块的认领、转手记录 |
| POST | `/v1/districts/{n}/checkin` | 签到，每个地址每个街区每天（UTC）一次，重复返回 409 |
| GET | `/v1/rankings` | 繁荣榜：繁荣度最高的 50 个已认领街区，地标除外，缓存 5 分钟 |
| PUT / DELETE | `/v1/districts/{n}/recruit` | 街区主人发布或结束招募 `{"message", "parcels"}` |
| GET | `/v1/recruiting` | 正在招募的街区，新的在前 |
| PUT / DELETE | `/v1/districts/{n}/application` | 访客申请入住 `{"note"}` / 撤回 |
| GET | `/v1/districts/{n}/applications` | 街区主人查看申请 |
| GET / POST | `/v1/districts/{n}/polls` | 投票列表 / 街区主人发起 `{"question", "options", "days"}` |
| PUT | `/v1/polls/{id}/vote` | 主人和居民投票 `{"option"}`，截止前可以改 |
| POST | `/v1/polls/{id}/close` | 街区主人提前结束 |
| PUT | `/v1/districts/{n}/style` | 街区主人设置外观 `{"color", "deco"}` |
| GET | `/v1/parks/{id}` | 园区 |
| POST / PUT / DELETE | `/v1/parks[/{id}]` | 建立、修改、解散园区 `{"name", "members"}` |
| GET / DELETE | `/v1/x/link` | 查看 / 解除绑定的 X 账号 |
| POST | `/v1/x/link/start` / `/v1/x/link/finish` | 开始绑定 X / 交回 X 的授权码 `{"code", "state"}` |
| GET | `/v1/search?q=` | 搜索：区块号、园区名、地址开头（至少 6 位）或 X 账号，每类最多 5 条 |
| GET | `/v1/me/wallets` | 关联在一起的钱包，主地址在前 |
| POST | `/v1/me/wallets/nonce` / `/v1/me/wallets` | 给另一个地址发签名消息 `{"address"}` / 交回签名完成关联 `{"address", "nonce", "signature"}` |
| DELETE | `/v1/me/wallets/{address}` | 解除一个关联的钱包（主地址不能解除） |

## 繁荣度

街区的繁荣度决定它在地图上的样子，分 5 级：荒地、村落、小镇、城区、繁华。地段由链上数据决定，不会因此改变。

分数是下面各项乘以权重的和，四舍五入：

| 项目 | 权重 |
|---|---|
| 已认领的地块（居民） | 3 |
| 近 30 天的顶层帖子 | 4 |
| 近 30 天的回复 | 1.5 |
| 关注数 | 0.5 |
| 近 30 天的签到 | 1 |
| 前后各 5 个街区近 30 天的帖子和回复（邻居的热闹） | 0.3 |

达到 25、80、200、450 分分别升到 2、3、4、5 级。地标区块固定是 5 级。除了居民和关注，其他都只算近 30 天，所以街区没人来就会慢慢降回去。

`GET /v1/districts/{n}` 返回 `prosperity`（`score`、`level`、`parts`、`next`，`next` 是下一级需要的分数，已满级为 `null`）和 `checked_in_today`；`GET /v1/land` 的每个格子带 `level`。权重和门槛在 `api/prosperity.py` 和 `web/lib/prosperity.ts` 两处，要一起改。

图片上传（S3）还没做，目前 `media` 只接受 https 链接。

## 招募居民

街区主人写一段招募说明，可以列出开放的地块编号（只能列还没被认领的）。登录的访客可以带一句留言申请入住，主人在管理面板里看到申请列表。地块的交接仍然在链上完成：主人把地块铭刻成街区的子铭文转给对方，索引器看到后对方就是居民。街区转手后，旧主人的招募自动失效；新主人重新发布时，旧的申请会清掉。

## 街区投票

街区主人发起投票，2 到 4 个选项，时长 1 到 30 天。主人和居民每人一票，截止前可以改票；身份按投票那一刻算。所有人都能看结果。主人可以提前结束。

## 外观装扮

街区主人可以选一个主题色和最多 3 个装饰，装饰按繁荣度解锁：

| 装饰 | 解锁等级 |
|---|---|
| 旗帜 | 1 |
| 花坛 | 2 |
| 路灯 | 3 |
| 喷泉 | 4 |
| 雕像 | 5 |

主题色里紫色 3 级解锁，金色 5 级解锁，其余一开始就能用。街区降级后，超出等级的装饰会暂时隐藏，金色、紫色退回橙色，升回来后自动恢复。保存的外观出现在 `/v1/land` 的 `style` 和街区主页的 `profile.style` 里。

## 园区

同一个地址持有的、在地图上连成一片的街区可以组成园区。地图把每 8 × 8 个区块排成一个街坊，街坊之间隔着马路。成员之间边挨着边，或者隔着马路正对着，都算连在一起，所以园区可以跨过马路、连起几个街坊。园区里各街区的分数加在一起算等级，所有成员都按这个等级显示。成员只在园区主人还持有它时才算数，卖掉的街区自动退出；剩下不到两个时园区不再显示。`/v1/land` 的每个格子带 `park`（园区 id），街区主页带 `park`（名称、成员、合计分数和等级）。

## 分享

街区、帖子、繁荣榜和首页都有自己的分享卡片（1200 × 630），贴到 X 或聊天软件里会显示在链接下面。卡片由网页服务端用 next/og 画出，代码在 `web/app/**/opengraph-image.tsx`，公共的边框、字体和 Mondrian 图在 `web/lib/og.tsx`。

- **街区卡片：** 显示号码、纪元、地标名、分区、等级和繁荣度、所属园区、地块和关注数，右边是这个区块的 Mondrian 地块图，已认领的地块用分区颜色点亮。
- **帖子卡片：** 显示作者和身份、正文、回复和点赞数。每条帖子有自己的页面 `/post/{id}`，分享的就是这个链接。
- **繁荣榜卡片：** 显示前五名。

卡片缓存 10 分钟。中文字体按卡片上的字从 Google Fonts 现取一个子集；服务器连不上时卡片照样生成，只是中文显示不出来。服务端取数据用 `API_INTERNAL_URL`（部署时是 `http://127.0.0.1:8000`），链接里的网址用 `NEXT_PUBLIC_SITE_URL`。

页面上的「分享」按钮提供「分享到 X」（打开 X 的发帖页，带好文字和链接）、「复制链接」，手机上还有系统分享。另外，街区主页的园区条上有「晒园区」；建好园区和发布招募之后，管理面板里会提示把它分享出去。

## 藏品（钱包资产变成宠物）

街区主人可以把钱包里有代表性的资产展示成街区里的宠物和摆设，一个街区最多同时摆 3 种（`MAX_SHOWN`），按勾选的顺序摆在左前边、右前边和前角。一共六种，定义在 `api/holdings.py` 的 `ASSETS`（前端 `web/lib/pets.ts` 同步）：

| 资产 | 类型 | 1 档 | 2 档 | 3 档 |
|---|---|---|---|---|
| DOG•GO•TO•THE•MOON | Rune | 持有就有一只小狗 | 100 万起是一只大狗 | 1 亿起有狗窝和第二只狗 |
| Quantum Cats | 铭文系列 | 1 只：一只猫 | 3 只起：两只猫 | 10 只起：一群猫 |
| Bitcoin Puppets | 铭文系列 | 1 个：一个提线木偶 | 3 个起：两个木偶 | 10 个起：加一座木偶戏台 |
| NodeMonkes | 铭文系列 | 1 只：一只猴子 | 3 只起：两只猴子 | 10 只起：加一棵椰子树 |
| Bitcoin Frogs | 铭文系列 | 1 只：一只青蛙 | 5 只起：青蛙和池塘 | 20 只起：一池青蛙 |
| Runestone | 铭文 | 1 块：一块符文石 | 3 块起：一块大符文石 | 10 块起：一圈符文石 |

- **默认不展示。** 展示等于公开钱包里有什么，所以主人要在「管理街区 → 藏品」里逐项勾选。选择记在 `social.showcase`，只在做选择的地址还持有这个街区时算数；街区转手后，新主人的钱包不会自动露出来。
- **数据来源。** 持有量从 Hiro 的公开 Ordinals 和 Runes 接口查（`HOLDINGS_API_URL`、`HOLDINGS_API_KEY` 可改），结果缓存在 `social.holdings`，6 小时内不重复查；地图只读缓存。主人点「重新查询」最多 10 分钟一次。查询失败时继续用上次的结果。自己的 ord 节点目前没开地址和 Runes 索引，以后开了可以换成自己的数据。
- **铭文系列。** 一个铭文属不属于某个系列，看 `api/collections/<slug>.json` 里的铭文 ID 清单。`scripts/fetch_collections.py` 从社区维护的 ordinals-collections 仓库下载（`quantum-cats`、`bitcoin-puppets`、`nodemonkes`、`bitcoin-frogs`、`runestone`），部署脚本会自动跑；清单缺失时这个宠物不显示。这几个 slug 还没有对着那个仓库核对过，部署后看脚本的输出，哪个下载失败就改成仓库里的实际名字。
- **接口。** `/v1/land` 的格子带 `pets`（例如 `["dog:2", "cat:1"]`），街区主页带 `pets`（资产、档位、数量）。主人用 `GET /v1/districts/{n}/showcase` 看自己持有什么，`PUT` 同一路径保存选择，`POST …/showcase/refresh` 重新查询。
- **合计关联的钱包。** 数量按街区主人的地址加上它关联的所有钱包合计（见下面的关联钱包）；没关联时只算这一个地址。

## 关联钱包

一个人的土地和藏品常常放在不同地址。登录一个地址后，在“我的土地”里选一个钱包、在钱包里切换到另一个账户，签一条消息：

```
Link this wallet on unimap
address: <要关联的地址>
to: <主地址>
nonce: …
expires: …
```

签名用 BIP-322，和登录一样，十分钟有效、只能用一次；消息开头不同，不能拿来登录那个地址。验证通过后两个地址成为一组（`social.wallet_links`），第一个登录的是主地址。

- 一个地址只能在一组里；已经关联在别处、或者自己带着关联钱包的地址要先在那边解除。一组最多再关联 10 个。
- 组里任何地址登录都能看到同一组，可以解除除主地址以外的成员。
- 关联只影响藏品数量的合计，发帖、角色和管理街区仍然按各自的地址。

## 通知

有人回复你的帖子、赞你的帖子、在你的街区发新帖、关注你的街区，或者申请入住你的街区时，会给你记一条通知（`api/notify.py`，表 `social.notifications`）。自己做的事不通知自己；同一个人对同一条帖子取消再点赞、取消再关注，只通知一次。

- 顶栏的铃铛显示未读数，每分钟和每次换页时检查一次。通知页 `/notifications` 打开后把列表里的都标成已读，同一条帖子的点赞、同一个街区的关注合成一行。
- 接口：`GET /v1/notifications?before=`（每页 30 条，带帖子摘要和未读数）、`GET /v1/notifications/unread`、`POST /v1/notifications/read`（`up_to` 不填就是全部）。
- 下一步可以把同样的通知推到电报机器人或邮件。

## 绑定 X 账号

钱包地址看不出是谁，所以地址可以绑定一个 X 账号（`api/xlink.py`，表 `social.x_accounts`）。绑定后，街区主页的拥有者旁边、帖子作者旁边都会显示 `@用户名`，点开就是 X 主页。

- 流程：在「我的土地」点「绑定 X」→ `POST /v1/x/link/start` 返回 X 的授权地址（OAuth 2.0 授权码 + PKCE，权限只有 `users.read tweet.read`）→ 用户在 X 同意后回到网页 `/x/callback` → 网页把 code 交给 `POST /v1/x/link/finish`，服务器换取令牌、读一次账号信息，然后立刻撤销令牌。我们只存 X 的用户 id、用户名、昵称和头像地址，不存令牌，也不会替用户发推。
- 授权的 state 绑定发起它的地址，10 分钟内只能用一次，所以别人拿到回调链接也绑不到自己的地址上。
- 一个地址只绑一个 X 账号，再绑会换成新的；同一个 X 账号可以绑多个地址（一个人有好几个钱包）。`DELETE /v1/x/link` 解除绑定，`GET /v1/x/link` 查看当前绑定以及服务器是否开启了这项功能。
- 设置：在 X 开发者后台建一个 Web App，回调地址填 `https://你的域名/x/callback`，把 Client ID 和 Client Secret 写进 `/etc/unimap/unimap.env` 的 `X_CLIENT_ID`、`X_CLIENT_SECRET`。不填就不显示绑定按钮。
- 帖子里贴推文链接（`x.com/…/status/…` 或 `twitter.com/…`），帖子下面会显示这条推文，最多两条。用的是 X 官方的嵌入脚本，脚本加载不了时显示成一个链接卡片。

## 纪元大陆（地形）

每个减半周期是地图上的一片大陆：老城区（区块 0 到 209,999）、第一纪元、第二纪元，依此类推（`web/lib/terrain.ts`）。区块的位置不变，变的只是街道的画法：一条街两边的区块如果属于不同的纪元，这条街就画成海，所以每次减半都在地图上横切出一道海峡。

- 海峡上每段都有一座桥。减半区块所在的那一片如果不是从减半区块开始，它就是两片大陆仍然相连的地峡。第四次减半（840,000）正好是一片的第一个区块，所以那里只有桥。
- 地图外面是海，每片大陆的海岸是各自的颜色。缩小到城区视图时街道太细，看不出是海，所以海峡两岸的楼会往后退，把岸边让给海。
- 地图右上角显示当前所在的大陆和它的区块范围。
- 园区的“跨马路相连”同样适用于海峡两岸。
