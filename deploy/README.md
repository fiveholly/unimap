# 在一台 VPS 上跑主网

这里的文件把整套 unimap 装到一台 Ubuntu 24.04 机器上：比特币节点、两个 ord 索引器、OPI 的街区索引、unimap 的地块/持有人/地段索引、API、网站，以及自动申请 HTTPS 证书的 Caddy。

## 机器

| 项目 | 建议 | 原因 |
| --- | --- | --- |
| 硬盘 | 2 TB NVMe 起，最好 4 TB | 节点不能裁剪且要开 `txindex`，另外有两份 ord 索引。下面的占用是估算，要以实际同步为准 |
| 内存 | 32 GB | 首次同步时节点的 UTXO 缓存（`dbcache`，脚本取内存的 1/4）加上两个 ord 的索引缓存 |
| CPU | 8 核 | 首次同步时几个索引器同时在跑 |
| 系统 | Ubuntu 24.04 | 脚本只在这个版本上试过 |

硬盘占用估算：比特币节点（含 txindex）约 0.8 到 1 TB，原版 ord 索引和 OPI 的 ord 索引各几百 GB，Postgres 很小。必须用 NVMe 或 SSD，机械硬盘同步会慢到不可用。独立服务器（例如带两块 NVMe 的那类）通常比同样配置的云主机便宜得多。

## 首次同步要多久

都是估算，取决于硬盘和网络：

1. 比特币节点从零同步：1 到 3 天。
2. 两个 ord 索引器跟在节点后面。铭文从 767430 块开始，之后的区块很重，大约还要几天。
3. 地段索引从第 0 块开始逐块读 `getblockstats`。早期区块很快，整体在节点同步完后约几小时到一天。
4. 街区、地块、持有人索引跟在 OPI 的 ord 后面，比 ord 慢不了多少。

网站一开始就能打开。地图会随着索引推进逐渐填满，没算到的区块显示"地段计算中"。

## 步骤

1. 把域名的 A 记录指向这台机器，并开放 80、443 端口（Caddy 申请证书需要），8333 可选（让节点接受入站连接）。
2. 在机器上取得这个仓库，然后运行：

   ```bash
   sudo deploy/install.sh
   ```

   第一次运行只会生成 `/etc/unimap/unimap.env`。按里面的注释填上域名和两个密码，密码只能用字母、数字和 `. _ -`。如果数据盘不在 `/data`，也改一下 `DATA_DIR`。

3. 再运行一次 `sudo deploy/install.sh`。它会：
   - 下载 Bitcoin Core 28.1 并对照官方 SHA256SUMS 校验，下载 ord 0.23.2 并对照写死的哈希校验，下载 Node 22；
   - 拉取 OPI、打补丁并编译它的 ord；
   - 建 Postgres 数据库和表，生成配置文件，构建网站；
   - 安装并启动 9 个 systemd 服务。

4. 用 `sudo deploy/status.sh` 查看各部分同步到了哪一块。

## 服务

| 服务 | 作用 | 端口（只监听本机） |
| --- | --- | --- |
| `unimap-bitcoind` | Bitcoin Core | RPC 8332，P2P 8333 |
| `unimap-ord` | 原版 ord server，查铭文持有人和每块铭文数 | 8080 |
| `unimap-opi-ord` | OPI 版 ord，给街区和地块索引读铭文 | 11030 |
| `unimap-bitmap-index` | OPI 街区索引 | |
| `unimap-indexer` | 地块索引 | |
| `unimap-owners` | 持有人追踪 | |
| `unimap-zones` | 地段划分 | |
| `unimap-api` | API | 8000 |
| `unimap-web` | 网站 | 3000 |

Caddy 把 `https://域名/v1/*` 转给 API，其余转给网站。网站和 API 同源，所以不需要跨域设置。

常用命令：

```bash
sudo deploy/status.sh                      # 同步进度
journalctl -u unimap-zones -f              # 看某个服务的日志
sudo systemctl restart unimap-api          # 重启某个服务
```

## 更新

代码更新后，在仓库目录 `git pull`，再运行 `sudo deploy/install.sh`。脚本会同步代码、重建网站，并重启各个索引器、API 和网站。节点和两个 ord 不会被重启，因为重启要花几分钟写缓存。升级了它们的版本时，用 `sudo deploy/install.sh --restart-all`。

## 没做的事

- 防火墙：脚本不改防火墙，避免把 SSH 锁在外面。除了 80、443、8333，其余端口都只监听本机。
- 备份：链上数据都能重新同步，但社交数据（帖子、关注、点赞，在 Postgres 的 `social` schema）丢了就没了。上线后应该每天 `pg_dump -n social` 一次，存到别的地方。
- 监控和告警：目前只有 `status.sh`。
