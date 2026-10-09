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
| GET | `/v1/me` | 当前地址持有的街区、地块和关注列表 |
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
