import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './network.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const id = process.argv[2];
if (!/^\d+$/.test(id || '')) throw new Error('Provide a numeric post ID');
const url = `https://www.binance.com/bapi/composite/v3/friendly/pgc/special/content/detail/${id}`;
const response = await fetch(url, { headers: { clienttype: 'web', lang: 'zh-CN' } });
const raw = await response.text();
let result;
try { result = JSON.parse(raw); } catch { throw new Error(`Post read HTTP ${response.status}: ${raw.slice(0, 200)}`); }
fs.writeFileSync(path.join(root, 'snapshots', `post-${id}.json`), JSON.stringify(result, null, 2));
if (!response.ok || result.code !== '000000' || !result.data) throw new Error(`Post read failed: ${result.code}`);
const data = result.data;
const states = fs.readdirSync(path.join(root, 'runs')).filter(f => f.endsWith('.state.json'));
const stateEntry = states.map(f => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(root, 'runs', f), 'utf8')) }))
  .find(s => s.data.postId === id);
const expectedText = stateEntry?.data.text;
const expectedTokens = expectedText ? [...new Set([...expectedText.matchAll(/\$([A-Za-z0-9]+)/g)].map(match => match[1]))] : [];
const tags = data.coinPairList?.map(t => t.trim().replace(/^\$/, '')) || [];
const verification = {
  postId: String(data.id), author: data.displayName, url: data.webLink,
  text: data.bodyTextOnly, characters: [...data.bodyTextOnly].length,
  tokenTags: tags, imageCount: data.imageList?.length || 0,
  imageUrls: data.imageList || [], verifiedAt: new Date().toISOString(),
};
if (stateEntry && (expectedText !== data.bodyTextOnly || expectedTokens.some(t => !tags.includes(t)) || verification.imageCount !== 1)) {
  throw new Error('Published content does not match the prepared post');
}
if (stateEntry) {
  stateEntry.data.verification = verification;
  const statePath = path.join(root, 'runs', stateEntry.file);
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(stateEntry.data, null, 2));
  fs.renameSync(temporaryPath, statePath);
}
console.log(JSON.stringify(verification, null, 2));
