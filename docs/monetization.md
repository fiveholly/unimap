# 收费开关

现在 unimap 不向任何人收钱。这里列出以后可能收费的地方，接口和开关已经预留好，**全部默认关闭**：环境变量不设、表里没有数据时，网站和现在完全一样。开关都写在 `/etc/unimap/unimap.env`（样例见 `deploy/unimap.env.example`，里面都是空的），改完重启 API。

## 开关一览

| 开关 | 做什么 | 默认 |
|---|---|---|
| `AGENT_PRICE_SATS`、`AGENT_LIGHTNING_ADDRESS` | 街区 agent 每 30 天的价格和收款闪电地址（`api/agent.py`） | 空：免费 |
| `MARKET_FEE_BPS`、`MARKET_FEE_ADDRESS` | 站内交易的手续费，按价格的万分比，作为交易里的一个输出直接付到这个比特币地址（`api/market.py`） | 空：不收 |
| `GAME_SEASON_POOL_SATS` | 赛季奖池金额，由项目方用闪电发给前三名（`api/seasons.py`） | 空：不显示 |
| `GAME_SEASON_SPONSOR_NAME`、`GAME_SEASON_SPONSOR_URL` | 奖池赞助商，`/game` 显示「本季奖池由 X 赞助」；链接只接受 https，不是 https 就只显示名字 | 空：不显示 |
| `PLATFORM_LIGHTNING_ADDRESS` | unimap 自己产品的收款闪电地址，钱包要支持 LUD-21 verify；没设时用 `AGENT_LIGHTNING_ADDRESS` | 空 |
| `BILLING_PRICE_<产品>_SATS` | 某个产品的价格（聪）。现在有 `STYLE` 和 `PROMOTION` 两个产品 | 空或 0：不卖 |
| `BILLING_COSMETICS` | 设成 `1` 时，外观里标为高级的选项要有权益 `style:<选项>` 才能用；现在没有任何选项标为高级 | 空：全部免费 |
| `RATE_LIMIT_KEY_WRITES`、`RATE_LIMIT_KEY_WRITES_<档位>` | 带有效 `X-API-Key` 的写操作每分钟上限，按 key 计数而不是按 IP | 空：600 |

街区活动（`api/events.py`）的主人可以给活动写一个赞助商名字和 https 链接，显示为「赞助：X」，链接带 `rel="sponsored noopener"`；不写就不显示。这个不需要开关。

## 平台收费（`api/billing.py`）

所有 unimap 自己的付费产品走同一个流程，和 agent 付费一样：

1. `GET /v1/billing/products`：现在在卖什么，默认是空列表；`cosmetics` 表示高级外观是否在收费。
2. `POST /v1/billing/pay {"product", "ref"}`：向 `PLATFORM_LIGHTNING_ADDRESS` 的钱包要一张发票。产品不存在是 404，没定价是 409。每个钱包组 10 分钟最多要 5 张。
3. `GET /v1/billing/payments/{id}`：只有付款人（含关联钱包）能查；还没到账时问钱包的 verify 地址，60 分钟后最后再查一次，还没付就标成过期。
4. 到账后调用这个产品的 `on_settled`：

| 产品 | `ref` | 到账后 |
|---|---|---|
| `style` | 一个标为高级的外观选项 | 给付款人权益 `style:<选项>`，永久。只在 `BILLING_COSMETICS=1` 时出售 |
| `promotion` | 付款人持有的街区号 | 建一条等管理员审核的推广（没有开始时间，不显示）。管理员用 `POST /v1/admin/promotions/{id}/approve {"days"}` 让它从现在开始显示；不通过的话手动退款 |

付款记在 `social.payments`。agent 的付款还在原来的 `social.agent_payments`，以后可以搬成这里的一个产品。

## 权益

`social.entitlements`：某个地址能用什么（`item`，比如 `style:gold`），来源 `free`、`paid`、`sponsor` 或 `admin`，可以有到期时间。判断时把关联钱包算在一起（`billing.has`）。

- `GET /v1/me/entitlements`：自己的有效权益。
- 管理员：`GET /v1/admin/entitlements?address=`，`POST /v1/admin/entitlements {"address", "item", "ref", "source", "days"}`（不写 `days` 是永久），`DELETE /v1/admin/entitlements/{id}`。

高级外观：在 `api/style.py` 的 `PREMIUM` 里加上颜色或装饰的键，同时在 `web/lib/style.ts` 里给它加 `premium: true`（外观设置里会标「高级」）。`BILLING_COSMETICS=1` 时保存没有对应权益的高级选项返回 402；关着时照常免费。已经保存的外观不会因为权益到期被藏起来。

## 推广位

`social.promotions`：首页的推广位（`slot` 现在只有 `home`）。首页有正在推广的街区时，显示一个标着「推广」的小区块；没有时什么都不显示（默认）。

- `GET /v1/promotions?slot=home`：现在正在显示的，最多 5 个。
- 管理员：`GET /v1/admin/promotions`（没结束的，待审核的在前），`POST /v1/admin/promotions {"bitmap_number", "slot", "starts_at", "ends_at", "note"}`（不写时间就是从现在开始 7 天），`POST /v1/admin/promotions/{id}/approve`，`DELETE /v1/admin/promotions/{id}`。

## 数据 API 的 key

`social.api_keys`，只存 key 的 sha256。

- 管理员：`POST /v1/admin/api-keys {"tier", "owner", "note"}` 返回 key，只显示这一次；`GET /v1/admin/api-keys` 列出（不含 key）；`DELETE /v1/admin/api-keys/{id}` 吊销。
- 写操作带 `X-API-Key: <key>` 时按 key 计数，上限是 `RATE_LIMIT_KEY_WRITES_<档位>`，没设用 `RATE_LIMIT_KEY_WRITES`，再没设是 600。key 无效或已吊销时按 IP 照常计数；`RATE_LIMIT_WRITES=0`（不限）时 key 也不起作用。登录接口不受 key 影响。
- 每个进程最多 60 秒查一次某个 key，所以吊销后另一个 API 进程最多还认它 1 分钟。
- 读接口一直免费，不需要 key。

## 收入汇总

`GET /v1/admin/revenue`（管理员）：已到账的付款按月份和产品汇总，包括 agent 的付款。交易手续费是在每笔交易里直接付到 `MARKET_FEE_ADDRESS` 的链上输出，不经过这里，也不在这里统计。

## 建议的打开顺序

1. 上线时：agent 收费（`AGENT_PRICE_SATS`），它有实际的模型成本。
2. 赞助：赛季奖池赞助商、街区活动赞助商。不向用户收钱，只是署名。
3. 高级外观：先在 `PREMIUM` 里挑几个新选项（不要把现在免费的改成收费），再设 `BILLING_COSMETICS=1` 和 `BILLING_PRICE_STYLE_SATS`。
4. 交易手续费（`MARKET_FEE_BPS`）：等站内交易通过外部安全审计、主网开放（`MARKET_MAINNET_AUDITED=1`）以后。

推广位和数据 API 的 key 什么时候需要什么时候开，管理员不建数据就不会有任何变化。
