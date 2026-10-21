import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const keyLines = fs.readFileSync(path.join(root, 'keys.txt'), 'utf8').replace(/^\uFEFF/, '')
  .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
if (keyLines.some(key => !/^[0-9a-f]{32}$/i.test(key))) throw new Error('Unexpected key format in keys.txt');
const keys = [...new Set(keyLines)];
if (!keys.length) throw new Error('keys.txt is empty');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'snapshots', 'rankings.json'), 'utf8'));
if (Date.now() - Date.parse(snapshot.fetchedAt) > 10 * 60 * 1000) throw new Error('Refresh rankings before preparation');
function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
const imageDirectory = path.join(root, 'imagegen');
const images = shuffle(fs.readdirSync(imageDirectory).filter(name => {
  if (!/\.(png|jpe?g|webp)$/i.test(name)) return false;
  const file = fs.statSync(path.join(imageDirectory, name));
  return file.isFile() && file.size > 0;
}));
if (images.length < keys.length) throw new Error('Not enough distinct images');
const batchId = `keys-${Date.now()}`;
const batchDir = path.join(root, 'batches', batchId);
fs.mkdirSync(batchDir, { recursive: true });
const snapshotFile = path.relative(root, path.join(batchDir, 'rankings.json'));
fs.writeFileSync(path.join(batchDir, 'rankings.json'), JSON.stringify(snapshot, null, 2));
const accounts = keys.map((apiKey, index) => ({ name: `key-${index + 1}`, apiKey }));
const seen = new Set();
const specs = accounts.map((account, index) => {
  let gainers, losers, tokenSet;
  do {
    const winnerCount = randomInt(1, 3);
    gainers = shuffle(snapshot.topGainers.map(row => row.token)).slice(0, winnerCount);
    losers = shuffle(snapshot.topLosers.map(row => row.token)).slice(0, 3 - winnerCount);
    tokenSet = [...gainers, ...losers].sort().join(',');
  } while (seen.has(tokenSet));
  seen.add(tokenSet);
  return {
    id: `${batchId}-${index + 1}`, account: account.name,
    gainers, losers, tokens: shuffle([...gainers, ...losers]),
    image: `imagegen/${images[index]}`, marketSnapshot: snapshotFile,
  };
});
fs.writeFileSync(path.join(batchDir, 'accounts.json'), JSON.stringify({ accounts }, null, 2));
fs.writeFileSync(path.join(batchDir, 'specs.json'), JSON.stringify({ batchId, specs }, null, 2));
fs.writeFileSync(path.join(root, 'batches', 'latest.json'), JSON.stringify({ batchId, directory: path.relative(root, batchDir) }, null, 2));
console.log(JSON.stringify({ batchId, keyCount: keys.length, duplicateKeyLines: keyLines.length - keys.length, directory: path.relative(root, batchDir), specs }, null, 2));
