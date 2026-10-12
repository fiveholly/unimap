"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { TipDialog } from "./Tip";
import { api, type ShopItem } from "@/lib/api";
import { short } from "@/lib/format";
import { t } from "@/lib/i18n";

const sats = (n: number) => n.toLocaleString("en-US");
const isLink = (s: string) => /^https?:\/\/\S+$/.test(s.trim());

/** What a buyer got: a link opens in a new tab, anything else is shown as written. */
export function Delivered({ content }: { content: string }) {
  return isLink(content) ? (
    <a href={content.trim()} target="_blank" rel="noopener noreferrer nofollow" className="break">
      {content.trim()}
    </a>
  ) : (
    <pre className="message shop-content">{content}</pre>
  );
}

/** 店铺: digital goods the district's owner and its residents sell, paid over Lightning straight to them. */
export function Shop({ n, token, seller }: { n: number; token: string | null; seller: { parcel: number | null } | null }) {
  const [items, setItems] = useState<ShopItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<ShopItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ShopItem | null>(null);
  const load = useCallback(() => api<{ items: ShopItem[] }>(`/v1/districts/${n}/shop`, { token: token ?? undefined }).then((r) => setItems(r.items)), [n, token]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  if (!items) return error ? <p className="error">{error}</p> : <p className="muted">{t("加载中…")}</p>;
  const act = (path: string, method: string, body?: unknown) => {
    setError(null);
    return api(path, { method, token: token ?? undefined, body })
      .then(() => load())
      .catch((e) => setError(e.message));
  };

  return (
    <div className="agent shop">
      <p className="muted small">{t("这里卖的是数字商品：下载链接、兑换码、一段文字。付款通过闪电网络直接进卖家的钱包，unimap 不经手；确认到账后，你买到的内容就显示在这里。")}</p>
      {seller && !adding && !editing && (
        <div className="row end">
          <button type="button" className="primary sm" onClick={() => setAdding(true)}>
            {t("上架商品")}
          </button>
        </div>
      )}
      {seller && token && (adding || editing) && (
        <ItemForm
          n={n}
          token={token}
          parcel={seller.parcel}
          item={editing}
          onDone={() => (setAdding(false), setEditing(null), load())}
          onCancel={() => (setAdding(false), setEditing(null))}
        />
      )}
      {error && <p className="error small">{error}</p>}
      {items.length === 0 ? (
        <p className="muted empty">{seller ? t("店里还没有东西。上架第一件商品吧。") : t("店里还没有东西。")}</p>
      ) : (
        items.map((i) => (
          <article key={i.id} className={`agent-card shop-item${i.on_sale ? "" : " off"}`} aria-label={i.title}>
            <div className="row between">
              <b>{i.title}</b>
              <span className="shop-price mono">{t("{n} 聪", { n: sats(i.price_sats) })}</span>
            </div>
            {i.description && <p className="small shop-desc">{i.description}</p>}
            <p className="muted small">
              {i.tx_index == null ? t("街区主人在卖") : t("地块 #{n} 的居民在卖", { n: i.tx_index })}
              {" · "}
              {i.left == null ? t("不限量") : i.left === 0 ? t("卖完了") : t("还剩 {n} 件", { n: i.left })}
              {i.sold > 0 && ` · ${t("卖出 {n} 件", { n: i.sold })}`}
            </p>
            {(i.bought ?? []).length > 0 && (
              <div className="callout small">
                <b>{t("你买到的内容")}</b>
                {i.bought!.map((b) => (
                  <Delivered key={b.order_id} content={b.content} />
                ))}
              </div>
            )}
            <div className="row wrap end">
              {i.mine ? (
                <>
                  {!i.on_sale && <span className="tag">{i.active ? (i.left === 0 ? t("卖完了") : t("你已经不持有这里，买不了")) : t("已下架")}</span>}
                  <button type="button" className="ghost sm" onClick={() => (setAdding(false), setEditing(i))}>
                    {t("编辑")}
                  </button>
                  {i.active ? (
                    <button type="button" className="ghost sm" onClick={() => confirm(t("下架这件商品？买过的人仍然能看到他们买到的内容。")) && act(`/v1/shop/items/${i.id}`, "DELETE")}>
                      {t("下架")}
                    </button>
                  ) : (
                    <button type="button" className="ghost sm" onClick={() => act(`/v1/shop/items/${i.id}`, "PUT", { active: true })}>
                      {t("重新上架")}
                    </button>
                  )}
                </>
              ) : token ? (
                <button type="button" className="primary sm" disabled={!i.on_sale} onClick={() => setBuying(i)}>
                  {(i.bought ?? []).length > 0 ? t("再买一份") : t("买 {n} 聪", { n: sats(i.price_sats) })}
                </button>
              ) : (
                <span className="muted small">{t("连接钱包后就能买。")}</span>
              )}
            </div>
          </article>
        ))
      )}
      {buying && token && (
        <TipDialog
          target={{ bitmap_number: n }}
          to={short(buying.seller)}
          token={token}
          fixed={buying.price_sats}
          bill={{
            title: t("买「{title}」", { title: buying.title }),
            note: t("聪通过闪电网络直接付给卖家 {who}，unimap 不经手。确认到账后，你买到的内容会显示在商品下面。", { who: short(buying.seller) }),
            done: t("付款成功，内容已经解锁。"),
            create: `/v1/shop/items/${buying.id}/buy`,
            status: (id) => `/v1/shop/orders/${id}`,
          }}
          close={() => {
            setBuying(null);
            load().catch(() => {});
          }}
        />
      )}
    </div>
  );
}

function ItemForm({ n, token, parcel, item, onDone, onCancel }: { n: number; token: string; parcel: number | null; item: ShopItem | null; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? String(item.price_sats) : "");
  const [content, setContent] = useState("");
  const [stock, setStock] = useState(item?.stock != null ? String(item.stock) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The seller sees what buyers get only when editing it, fetched on its own.
  useEffect(() => {
    if (item) api<ShopItem>(`/v1/shop/items/${item.id}`, { token }).then((x) => setContent(x.content ?? "")).catch(() => {});
  }, [item, token]);
  const save = async () => {
    setError(null);
    setBusy(true);
    const body = { title, description, price_sats: Number(price), content, ...(stock ? { stock: Number(stock) } : item ? { unlimited: true } : {}) };
    try {
      if (item) await api(`/v1/shop/items/${item.id}`, { method: "PUT", token, body });
      else await api(`/v1/districts/${n}/shop`, { method: "POST", token, body: { ...body, ...(parcel != null ? { parcel } : {}) } });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="agent-card agent-setup shop-form" onSubmit={(e) => (e.preventDefault(), save())}>
      <b>{item ? t("编辑商品") : parcel != null ? t("以地块 #{n} 居民的身份上架", { n: parcel }) : t("以街区主人的身份上架")}</b>
      <label className="small">
        {t("名称")}
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} required placeholder={t("比如：街区壁纸包")} />
      </label>
      <label className="small">
        {t("介绍")}
        <textarea rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("买家付款前能看到的说明")} />
      </label>
      <div className="row wrap">
        <label className="small">
          {t("价格（聪）")}
          <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 7))} required placeholder="2100" />
        </label>
        <label className="small">
          {t("数量（不填就不限量）")}
          <input inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="∞" />
        </label>
      </div>
      <label className="small">
        {t("买家付款后看到的内容")}
        <textarea rows={3} maxLength={4000} value={content} onChange={(e) => setContent(e.target.value)} required placeholder={t("下载链接、兑换码，或者一段文字")} />
      </label>
      <p className="muted small">
        {t("买家的聪直接进你在「我的」里设置的闪电钱包。钱包要支持 LUD-21，unimap 才能确认到账、把内容交给买家。")} <Link href="/me">{t("去设置")}</Link>
      </p>
      {error && <p className="error small">{error}</p>}
      <div className="row end">
        <button type="button" className="ghost sm" onClick={onCancel} disabled={busy}>
          {t("取消")}
        </button>
        <button type="submit" className="primary sm" disabled={busy || !title.trim() || !price || !content.trim()}>
          {busy ? t("保存中…") : item ? t("保存") : t("上架")}
        </button>
      </div>
    </form>
  );
}
