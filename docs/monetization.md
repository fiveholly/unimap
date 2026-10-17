# 收费开关

现在 unimap 不向任何人收钱。这里列出以后可能收费的地方，接口和开关已经预留好，**全部默认关闭**：环境变量不设、表里没有数据时，网站和现在完全一样。开关都写在 `/etc/unimap/unimap.env`（样例见 `deploy/unimap.env.example`，里面都是空的），改完重启 API。

## 开关一览

| 开关 | 做什么 | 默认 |
|---|---|---|
| `AGENT_PRICE_SATS`、`AGENT_LIGHTNING_ADDRESS` | 街区 agent 每 30 天的价格和收款闪电地址（`api/agent.py`） | 空：免费 |
| `MARKET_FEE_BPS`、`MARKET_FEE_ADDRESS` | 站内交易的手续费，按价格的万分比，作为交易里的一个输出直接付到这个比特币地址（`api/market.py`） | 空：不收 |
| `GAME_SEASON_POOL_SATS` | 赛季奖池金额，由项目方用闪电发给前三名（`api/seasons.py`） | 空：不显示 |
| `GAME_SEASON_SPONSOR_NAME`、`GAME_SEASON_SPONSOR_URL` | 奖池赞助商，`/game` 显示「本季奖池由 X 赞助」；链接只接受 https，不是 https 就只显示名字 | 空：不显示 |
| `PLATFORM_BTC_ADDRESS` | unimap 自己产品的链上收款地址（P2TR、P2WPKH 或 P2SH），用户从已连接的钱包直接付到这里；默认的付款方式 | 空：不收链上付款 |
| `PLATFORM_LIGHTNING_ADDRESS` | unimap 自己产品的收款闪电地址，钱包要支持 LUD-21 verify；没设时用 `AGENT_LIGHTNING_ADDRESS`。作为第二种付款方式 | 空 |
| `BILLING_PRICE_<产品>_SATS` | 某个产品的价格（聪）。现在有 `STYLE`、`PROMOTION` 和 `CAPSULE`（时间胶囊「封存」，建议 2000）三个产品。有价格、并且上面两种收款方式至少设了一种，才开卖 | 空或 0：不卖 |
| `CAPSULE_INSCRIBE_SATS` | 时间胶囊「刻上链」在写信页上显示的价格（还没开放，不卖）。设了 `GIFT_NETWORK` 又卖 `CAPSULE` 时不用它：每封信都刻上链，首封免服务费，之后每封收 `BILLING_PRICE_CAPSULE_SATS`（见 `docs/social.md`「上链」） | 空：20000 |
| `PRICE_URL` | 写信页把费用折成美元用的 BTC/USD 和主网费率，从这个 mempool.space 风格的 API 要（`api/prices.py`，缓存 5 分钟）。只用来显示 | 空：https://mempool.space/api；`off`：只显示聪 |
| `BILLING_COSMETICS` | 设成 `1` 时，外观里标为高级的选项要有权益 `style:<选项>` 才能用；现在没有任何选项标为高级 | 空：全部免费 |
| `RATE_LIMIT_KEY_WRITES`、`RATE_LIMIT_KEY_WRITES_<档位>` | 带有效 `X-API-Key` 的写操作每分钟上限，按 key 计数而不是按 IP | 空：600 |

街区活动（`api/events.py`）的主人可以给活动写一个赞助商名字和 https 链接，显示为「赞助：X」，链接带 `rel="sponsored noopener"`；不写就不显示。这个不需要开关。

## 平台收费（`api/billing.py`）

所有 unimap 自己的付费产品走同一个流程。付款方式有两种（`billing.METHODS`），哪种设了收款地址就提供哪种，链上在前、是默认：

- `onchain`（用钱包支付）：用户已经连接的比特币钱包（UniSat、Xverse、OKX）直接把这笔付款的准确金额转到 `PLATFORM_BTC_ADDRESS`，网页把钱包返回的 txid 交给服务器；连的是「粘贴签名」钱包或钱包调用失败时，网页显示地址、金额和复制按钮，可以从任何钱包转账后把 txid 贴回来。钱包会在金额之外另收网络手续费（按现在的低费率大约两三百聪），付款页上写明了。
- `lightning`（用闪电网络付款）：向 `PLATFORM_LIGHTNING_ADDRESS` 的钱包要一张发票，和 agent 付费、打赏一样靠 LUD-21 确认到账。

1. `GET /v1/billing/products`：现在在卖什么，默认是空列表；`cosmetics` 表示高级外观是否在收费；`methods` 是现在能用的付款方式，默认的在前。
2. `POST /v1/billing/pay {"product", "ref", "method"}`：开一笔付款。不写 `method` 就用默认的。链上付款返回 `address` 和 `amount_sats`：价格加上 1 到 99 聪（`TAG_SATS`），这个尾数在同一个收款地址所有 pending 的链上付款里不重复（开单时按地址加锁挑一个没用的；99 个都被占着时是 429）；闪电付款返回 `invoice`。产品不存在是 404，没定价是 409，这种方式没开也是 409。每个钱包组 10 分钟最多开 5 笔。
3. `POST /v1/billing/payments/{id}/tx {"txid"}`（只用于链上付款）：交上付这笔钱的交易，马上用 bitcoind 查一次（`getrawtransaction`，节点要开 `txindex`）。交易付到这笔付款记下的收款地址的输出，合计必须正好等于 `amount_sats`；付错地址、少付或多付都是 400，txid 不保存。一个 txid 只能付一笔（`social.payments.txid` 唯一），已经被别的付款用过是 409。节点还没看到这笔交易（或者暂时问不到 bitcoind）时付款保持 pending，之后查状态时再看。
4. `GET /v1/billing/payments/{id}`：只有付款人（含关联钱包）能查；还没到账时问 bitcoind（链上）或钱包的 verify 地址（闪电），最多两秒一次。交上的交易后来被替换、不再付这笔钱时，txid 会被放掉，可以重新交。60 分钟后最后再查一次，还没付就标成过期。
5. 到账后调用这个产品的 `on_settled`：

| 产品 | `ref` | 到账后 |
|---|---|---|
| `style` | 一个标为高级的外观选项 | 给付款人权益 `style:<选项>`，永久。只在 `BILLING_COSMETICS=1` 时出售 |
| `promotion` | 付款人持有的街区号 | 建一条等管理员审核的推广（没有开始时间，不显示）。管理员用 `POST /v1/admin/promotions/{id}/approve {"days"}` 让它从现在开始显示；不通过的话手动退款 |
| `capsule` | 一封等付款的时间胶囊的 id | 把它封存，封存区块是到账那一刻的最新高度。付款由 `POST /v1/capsules` 直接开（`billing.invoice`，默认链上），换成闪电或过期后可以用 `/v1/billing/pay` 再开一笔。详见 `docs/social.md` 时间胶囊 |

产品自己开付款时调用 `billing.invoice(address, product, ref, method=None)`；`billing.refresh(payment_id, force=True)` 在后台再查一次（时间胶囊清理没付款的信时用）。新产品不用为付款方式写任何代码，两种方式都走 `billing.settle()`。

付款记在 `social.payments`：`method` 是 `onchain` 或 `lightning`，链上付款还记 `pay_address`（开单时的 `PLATFORM_BTC_ADDRESS`，之后改环境变量不影响已经开出的单）和 `txid`。`amount_sats` 是实际付的金额，链上付款包括那几聪尾数，所以收入汇总里就是真正到账的数。agent 的付款还在原来的 `social.agent_payments`，以后可以搬成这里的一个产品。

### 链上付款为什么接受 0 确认

交易进了 unimap 节点的内存池就算到账，不等出块。金额只有几千聪，用户付完马上就能看到信封好，这比等十分钟到一小时重要；双花需要用户自己再发一笔替换交易，为几千聪不划算，真发生了就是平台少收一次钱。节点不认识的交易（被拒、被替换掉、或者根本没广播）永远不算到账，只会一直 pending 到过期。

### 为什么金额有尾数

收款地址是公开的，如果每笔付款都是同一个价格，有人可以在内存池里看到别人刚发的交易，抢先把那个 txid 交到自己的付款上。所以每笔等待中的链上付款都有自己独有的准确金额（比如 2,037 聪），交易必须正好付这个数：别人的交易付的是别人的金额，交到自己的付款上只会得到 400。付款页上显示的、钱包按钮发出的、手动转账要填的，都是这个准确金额，用户多付几十聪。闪电付款有自己的发票，不加尾数。

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

`GET /v1/admin/revenue`（管理员）：已到账的付款按月份和产品汇总，链上和闪电的都算，包括 agent 的付款。交易手续费是在每笔交易里直接付到 `MARKET_FEE_ADDRESS` 的链上输出，不经过这里，也不在这里统计。

## 建议的打开顺序

1. 上线时：agent 收费（`AGENT_PRICE_SATS`），它有实际的模型成本。
2. 赞助：赛季奖池赞助商、街区活动赞助商。不向用户收钱，只是署名。
3. 高级外观：先在 `PREMIUM` 里挑几个新选项（不要把现在免费的改成收费），再设 `BILLING_COSMETICS=1` 和 `BILLING_PRICE_STYLE_SATS`。
4. 交易手续费（`MARKET_FEE_BPS`）：等站内交易通过外部安全审计、主网开放（`MARKET_MAINNET_AUDITED=1`）以后。

推广位和数据 API 的 key 什么时候需要什么时候开，管理员不建数据就不会有任何变化。
