# unimap

基于 [OPI](https://github.com/bestinslot-xyz/OPI) 的 Bitmap 索引器扩展：在 OPI 的街区（District）索引之上，补充地块（Parcel）、持有人和区块数据，并为游戏、社交等应用提供统一 API。

设计文档：[Bitmap 索引器设计](https://claude.ai/code/artifact/53ee710c-d999-404e-89b1-73feef0cabc1)

## 目录

- `parcel_index/`：地块索引。规则在 `rules.py`（说明见 [docs/parcel-rules.md](docs/parcel-rules.md)），主循环在 `indexer.py`，表结构在 `db_init.sql`。
- `patches/`：对 OPI 的修补。OPI 的 `getInscriptionInfo` 接口有两个 bug（互斥锁重复加锁导致死锁；条目解码偏移错 1 字节导致 panic），地块索引依赖这个接口。
- `scripts/setup_opi.sh`：拉取固定版本的 OPI、打补丁并编译它的 ord。
- `scripts/regtest/e2e.sh`：regtest 端到端测试。

## 运行

依赖：Bitcoin Core（`-txindex=1`）、Postgres、Python 3（`psycopg2-binary`、`python-dotenv`、`requests`）。

1. `scripts/setup_opi.sh ../OPI`，然后按 OPI 的 README 运行它的 ord 和 `bitmap_index`。
2. 在同一个数据库里执行 `psql -f parcel_index/db_init.sql`。
3. 复制 `parcel_index/.env_sample` 为 `.env` 并填好，然后在该目录运行 `python3 -m parcel_index.indexer`（仓库根目录需在 `PYTHONPATH` 中）。

## 测试

```bash
python3 -m unittest discover -s tests -t .
BITCOIND=... BITCOIN_CLI=... ORD=... OPI_ORD=... OPI_DIR=... PGURL=postgresql://... scripts/regtest/e2e.sh
```

`ORD` 是原版 ord 0.23.2（只用来在 regtest 上铭刻测试数据），`OPI_ORD` 是 `setup_opi.sh` 编译出的 OPI 版 ord。
