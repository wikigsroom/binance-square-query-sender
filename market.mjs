import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './network.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const tickerUrl = 'https://api.binance.com/api/v3/ticker/24hr';
const exchangeUrl = 'https://api.binance.com/api/v3/exchangeInfo';

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Market HTTP ${response.status}`);
  return response.json();
}

const results = await Promise.allSettled([readJson(tickerUrl), readJson(exchangeUrl)]);
for (const result of results) if (result.status === 'rejected') throw result.reason;
const tickers = results[0].value;
const exchange = results[1].value;
const symbols = new Map(exchange.symbols
  .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.isSpotTradingAllowed !== false)
  .map(s => [s.symbol, s.baseAsset]));
const ranked = tickers.filter(t => symbols.has(t.symbol) && Number(t.quoteVolume) > 0)
  .map(t => ({
    token: symbols.get(t.symbol), symbol: t.symbol,
    changePercent: Number(t.priceChangePercent), quoteVolume: t.quoteVolume,
    closeTime: t.closeTime,
  })).sort((a, b) => b.changePercent - a.changePercent);
const snapshot = {
  fetchedAt: new Date().toISOString(),
  scope: 'Binance spot TRADING USDT pairs, rolling 24 hours, nonzero quote volume',
  sources: [tickerUrl, exchangeUrl],
  topGainers: ranked.slice(0, 5),
  topLosers: ranked.slice(-5).reverse(),
};
fs.mkdirSync(path.join(root, 'snapshots'), { recursive: true });
fs.writeFileSync(path.join(root, 'snapshots', 'rankings.json'), JSON.stringify(snapshot, null, 2));
console.log(JSON.stringify(snapshot, null, 2));
