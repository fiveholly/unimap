// 指标 (components/Metrics.tsx), on the admin page.
export const metrics: Record<string, string> = {
  "指标": "Metrics",
  "每周从周一开始（UTC）。本周还没过完，按到现在为止算；看门槛用上一个完整的周。":
    "Weeks start on Monday (UTC). This week counts what has happened so far, so the gates are read from the last full week.",
  "第一阶段 · 收到打赏的街区": "Stage one · Districts that got tips",
  "上周过了门槛。": "Last week passed the gate.",
  "上周还差 {n} 个到门槛。": "Last week was {n} short of the gate.",
  "本周到现在 {n} 个": "{n} so far this week",
  "第二阶段 · 每周回来的人": "Stage two · People coming back each week",
  "4 周前还没有回来的人，先攒一个起点。": "Nobody was coming back 4 weeks ago yet, so there's no baseline to compare with.",
  "是 4 周前（{n}）的 {x} 倍，门槛是翻一倍。": "{x}× the number 4 weeks earlier ({n}). The gate is 2×.",
  "上周活跃 {a}，其中新来的 {b}": "Active last week: {a}, of whom new: {b}",
  "第三阶段 · 站内成交": "Stage three · Trades on unimap",
  "上周 {n} 笔交易；店铺卖了 {s} 聪（{o} 单）": "Trades last week: {n}. Shop sales: {s} sats ({o} orders)",
  "周": "Week",
  "收到打赏的街区": "Districts tipped",
  "打赏（聪）": "Tips (sats)",
  "活跃": "Active",
  "回来的": "Returning",
  "新来的": "New",
  "成交（聪）": "Trades (sats)",
  "店铺（聪）": "Shop (sats)",
  "（本周）": "(this week)",
  "活跃：这一周登录、签到、发帖或回复、点赞、投票、打赏或在店里买过东西的地址。回来的：其中在更早的周也活跃过的。成交：站内挂单被买下和出价被接受的金额。":
    "Active: addresses that signed in, checked in, posted or replied, liked, voted, tipped or bought in a shop that week. Returning: those who were also active in an earlier week. Trades: listings bought and offers accepted on unimap.",
};
