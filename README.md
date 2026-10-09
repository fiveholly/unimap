# unimap

基于 [OPI](https://github.com/bestinslot-xyz/OPI) 的 Bitmap 索引器扩展：在 OPI 的街区（District）索引之上，补充地块（Parcel）、持有人和区块数据，并为游戏、社交等应用提供统一 API。

设计文档：[Bitmap 索引器设计](https://claude.ai/code/artifact/53ee710c-d999-404e-89b1-73feef0cabc1)

## 目录

- `parcel_index/`：地块索引。规则在 `rules.py`（说明见 [docs/parcel-rules.md](docs/parcel-rules.md)），主循环在 `indexer.py`，表结构在 `db_init.sql`。
- `parcel_index/owners.py`：持有人追踪。每个区块检查哪些已追踪的输出被花费，再向原版 ord 查询这些铭文的新位置，结果写入 `inscription_owners`。
- `parcel_index/zones.py`：地段划分。逐块记录交易数、手续费、转账金额和铭文数（`block_stats`），按减半周期算出分位线（`zone_thresholds`），视图 `block_zones` 据此给每个区块分成地标、CBD、商业区、数据区、别墅区、住宅区、山地七种地段。规则写在文件开头。
- `api/`：FastAPI 服务，包括地块查询接口（见下方「接口」）和社交接口（钱包签名登录、发帖、管理、关注、点赞，见 [docs/social.md](docs/social.md)）。社交数据在 `social` schema，表结构在 `api/social.sql`。
- `web/`：Next.js 前端（首页地图、街区主页、钱包登录、发帖），见 [web/README.md](web/README.md)。
- `patches/`：对 OPI 的修补。OPI 的 `getInscriptionInfo` 接口有两个 bug（互斥锁重复加锁导致死锁；条目解码偏移错 1 字节导致 panic），地块索引依赖这个接口。
- `scripts/setup_opi.sh`：拉取固定版本的 OPI、打补丁并编译它的 ord。
- `scripts/regtest/e2e.sh`：regtest 端到端测试。
- `deploy/`：在一台 Ubuntu VPS 上部署主网的脚本和 systemd 服务，见 [deploy/README.md](deploy/README.md)。

## 运行

在 VPS 上部署主网用 `deploy/install.sh`（见 [deploy/README.md](deploy/README.md)）。下面是手动运行的方式。

依赖：Bitcoin Core（`-txindex=1`）、原版 ord 0.23.2 的 `ord server`（用于持有人追踪）、Postgres、Python 3（`pip install -r requirements.txt`）。

1. `scripts/setup_opi.sh ../OPI`，然后按 OPI 的 README 运行它的 ord 和 `bitmap_index`。
2. 在同一个数据库里执行 `psql -f parcel_index/db_init.sql` 和 `psql -f api/social.sql`。
3. 复制 `parcel_index/.env_sample` 为 `.env` 并填好，然后在该目录分别运行下面四个进程（仓库根目录需在 `PYTHONPATH` 中）：
   - `python3 -m parcel_index.indexer`：地块索引
   - `python3 -m parcel_index.owners`：持有人追踪，跟在地块索引后面
   - `python3 -m parcel_index.zones`：地段划分，从高度 0 开始补全全部区块（主网首次补算要跑很久，需要未裁剪的节点）
   - `uvicorn api.app:app`：API（前端跨域时设置 `API_CORS_ORIGINS`）

## 接口

- `GET /v1/status`：各索引器已处理到的高度。
- `GET /v1/land?start=&end=`：一段区块（最多 1000 个）的地图数据：地段、交易数、是否被认领、持有人、地块数、帖子数。
- `GET /v1/land/{区块号}`：地段、街区是否已被认领、街区铭文与持有人、区块交易数、已认领的地块列表。区块尚未出现时返回 404。
- `GET /v1/land/{区块号}/parcels/{交易序号}`：单个地块及其持有人。
- `GET /v1/addresses/{地址}/land`：该地址持有的街区和地块。

持有人为 `null` 表示持有人追踪还没处理到该铭文；`address` 为 `null` 表示输出脚本没有对应的地址形式。

## 测试

```bash
python3 -m unittest discover -s tests -t .
TEST_PGURL=postgresql://.../unimap_test python3 -m unittest discover -s tests -t .   # 加上社交接口测试（会清空该库）
BITCOIND=... BITCOIN_CLI=... ORD=... OPI_ORD=... OPI_DIR=... PGURL=postgresql://... scripts/regtest/e2e.sh
```

`ORD` 是原版 ord 0.23.2（只用来在 regtest 上铭刻测试数据），`OPI_ORD` 是 `setup_opi.sh` 编译出的 OPI 版 ord。
