import { Store } from "./core.js";

export const sourceCatalog = [
  {
    id: "source_binance",
    type: "binance_market",
    name: "币安现货 · 24h",
    description: "USDT 现货交易对、滚动 24 小时涨跌幅、成交额与涨跌榜。",
    url: "https://api.binance.com",
    allowedHosts: ["api.binance.com", "data-api.binance.vision"],
    maxAgeSeconds: 900,
  },
  {
    id: "source_jinse",
    type: "jinse",
    name: "金色财经",
    description: "金色 7×24 快讯，读取完整快讯、报道时间和原始报道链接。",
    url: "https://www.jinse2.com/lives",
    allowedHosts: ["www.jinse2.com", "api.jinse2.com"],
    maxAgeSeconds: 259200,
  },
  {
    id: "source_blockbeats",
    type: "blockbeats",
    name: "区块律动 BlockBeats",
    description:
      "律动快讯；网页不可读时使用官方 RSS 或官方公开频道，并保留实际读取地址。",
    url: "https://www.theblockbeats.info/newsflash",
    allowedHosts: [
      "www.theblockbeats.info",
      "m.theblockbeats.info",
      "api.theblockbeats.news",
      "t.me",
    ],
    maxAgeSeconds: 259200,
  },
];

export async function ensureSources(store: Store) {
  for (const source of sourceCatalog) {
    const old = await store.get("sources", source.id);
    if (!old) {
      await store.insert(
        "sources",
        { ...source, enabled: true, adapterVersion: 2 },
        source.id,
      );
    } else if (
      !old.adapterVersion &&
      old.type === source.type &&
      old.url === source.url
    ) {
      // Upgrade only the original built-ins; retain user names, enabled flags and age settings.
      await store.update(
        "sources",
        old.id,
        {
          allowedHosts: [
            ...new Set([...(old.allowedHosts || []), ...source.allowedHosts]),
          ],
          description: old.description || source.description,
          adapterVersion: 2,
        },
        old.version,
      );
    }
  }
}
