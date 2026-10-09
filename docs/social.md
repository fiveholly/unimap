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

图片上传（S3）还没做，目前 `media` 只接受 https 链接。
