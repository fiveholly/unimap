# 地块（Parcel）有效性规则

依据 [Bitmap 白皮书 Theory 页](https://github.com/Blockamoto/gitbook/blob/main/bitmap-theory-whitepaper/theory.md)：

> Parcels are the first valid child inscriptions maintaining provenance from the District parent.
> `{tx-index}.{block-height}.bitmap` : a parcel child inscription of a valid district

白皮书没有写的细节，按 OPI 判定街区的方式补齐。一条铭文同时满足以下 5 条才是有效地块：

1. **格式**：内容是 UTF-8 文本，完全匹配 `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.bitmap$`，不允许前导零、空白或其他字符。前一个数字是交易序号 i，后一个是区块高度 H。
2. **铭文属性**：铭文编号 ≥ 0（cursed 铭文不算），content-type 以 `text/plain` 开头，内容不是 JSON。与 OPI 的 `is_valid_bitmap` 一致。
3. **出处**：第一个父铭文必须是 H 号街区的有效铭文（即 OPI `bitmaps` 表中 `bitmap_number = H` 的那条）。
4. **范围**：i 小于 H 号区块的交易数。
5. **先到先得**：同一个 (H, i) 只认铭文编号最小的那条有效铭文。无效铭文不占位。

归属：未单独铭刻的地块属于街区持有人；已铭刻的地块属于该地块铭文的持有人（持有人追踪在下一阶段实现）。

## 校验哈希

每个区块的事件为 `parcel;<inscription_id>;<i>;<H>`，按接受顺序用 `|` 连接后取 SHA-256，得到区块事件哈希；累计哈希为 `sha256(上一块累计哈希 + 本块事件哈希)`，构造方式与 OPI bitmap 模块相同。

## 已知问题：Jubilee 之前的子铭文

在 regtest 上实测：Jubilee 高度（regtest 为 110，主网为 824544，即 2024 年 1 月）之前用 ord 0.23.2 钱包铭刻的子铭文都被标为 cursed（铭文编号为负）。按规则 2 它们会被判为无效，OPI 的 db_reader 也不会返回它们。2023 年 Phase 2 期间主网上铭刻的地块是否同样是 cursed，需要在主网数据上核实后，再决定是否放宽规则 2。
