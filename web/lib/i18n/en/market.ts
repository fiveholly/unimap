// English for 站内交易 (buying and selling in unimap with PSBTs): components/Market.tsx.
export const market: Record<string, string> = {
  "{wallet} 不能签交易，换 UniSat、Xverse 或 OKX 连接": "{wallet} can't sign transactions. Connect with UniSat, Xverse or OKX instead",
  "测试网 {net}": "Test network {net}",
  "价格至少 1,000 聪": "The price is at least 1,000 sats",
  "在 unimap 下架？你签过的挂单在铭文转走之前仍然有效，想彻底作废就把铭文转到你自己的另一个地址。":
    "Take it down from unimap? The listing you signed stays valid until the inscription moves. To void it for good, send the inscription to another address of your own.",
  "在 unimap 出售": "Sell on unimap",
  "你挂了 {price}，买家在这个页面就能直接买。": "You listed it for {price}. Buyers can buy it right on this page.",
  "下架": "Take down",
  "挂在 unimap，买家看得到这条街的居民和帖子，在这里就能买。钱和铭文都不经过 unimap。":
    "List it on unimap and buyers see the street's residents and posts, and buy it here. Neither the money nor the inscription passes through unimap.",
  "挂单出售": "List for sale",
  "价格（聪）": "Price (sats)",
  "你的钱包会签一个半成品交易：这个铭文换一笔付到你地址的钱，金额就是这个价格。只有付够钱的交易能用这个签名，unimap 改不了它。铭文所在的那点聪会随铭文一起给买家。":
    "Your wallet signs half a transaction: this inscription, in exchange for this price paid to your address. Only a transaction that pays in full can use that signature, and unimap can't change it. The few sats the inscription sits on go to the buyer with it.",
  "unimap 向买家收 {pct}% 手续费，写在交易里，双方签名前都看得到。": "unimap charges the buyer a {pct}% fee, written into the transaction where both sides see it before signing.",
  "签名挂单": "Sign and list",
  "在 unimap 购买": "Buy on unimap",
  "unimap 用你钱包里的聪拼好这笔交易：铭文到你的地址，钱到卖家的地址。你的钱包会显示每一笔进出，确认无误再签名。unimap 不经手钱和铭文。":
    "unimap puts the transaction together from the sats in your wallet: the inscription to your address, the money to the seller's. Your wallet shows every input and output; check them before you sign. unimap never holds the money or the inscription.",
  "第一次在 unimap 买之前，你的付款地址需要两笔各 {n} 聪的小额 UTXO，用来把铭文准确地放进你的地址。先发一笔转给自己的小交易，确认以后（大约 10 分钟）再回来买。":
    "Before your first purchase on unimap, your paying address needs two small outputs of {n} sats each, which steer the inscription into your address. Send yourself one small transaction first, then come back to buy once it confirms (about 10 minutes).",
  "小额 UTXO 已经发出。等它被打包确认后，再点一次购买。": "The small outputs are on their way. Once they confirm, tap Buy again.",
  "价格": "Price",
  "unimap 手续费": "unimap fee",
  "矿工费（{rate} 聪/vB）": "Network fee ({rate} sat/vB)",
  "一共": "Total",
  "交易已发出。打包确认后，这块地就是你的了。": "The transaction is out. Once it confirms, the land is yours.",
  "正在拼交易…": "Putting the transaction together…",
  "下一步": "Next",
  "准备小额 UTXO": "Make the small outputs",
  "签名购买": "Sign and buy",
  "{who} 在 unimap 买下了你的 {place}，钱已经随交易付到你的地址": "{who} bought your {place} on unimap. The money was paid to your address in the same transaction",
};
