import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const send = args.includes('--send');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex < 0 ? null : args[onlyIndex + 1];
function inProject(name) {
  const resolved = path.resolve(root, name);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path is outside project');
  return resolved;
}

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value: ${name}`);
  return args[index + 1];
}
const read = name => JSON.parse(fs.readFileSync(inProject(name), 'utf8'));
const settings = read(option('--settings', 'settings.json'));
const accounts = read(option('--accounts', 'accounts.json')).accounts;
const allPosts = read(option('--posts', 'posts.json')).posts;
const posts = only ? allPosts.filter(p => p.id === only) : allPosts;
if (!posts.length) throw new Error('No matching posts');

const accountsByName = new Map();
const keys = new Set();
for (const account of accounts) {
  if (!account.name || accountsByName.has(account.name)) throw new Error('Account names must be unique');
  if (typeof account.apiKey !== 'string' || !account.apiKey.trim()) throw new Error(`Missing key: ${account.name}`);
  if (keys.has(account.apiKey.trim())) throw new Error('The same key is assigned to multiple accounts');
  keys.add(account.apiKey.trim());
  accountsByName.set(account.name, account);
}

const ids = new Set();
const texts = new Set();
const usedAccounts = new Set();
const imageRoot = path.join(root, 'imagegen');
const prepared = posts.map(post => {
  if (!/^[A-Za-z0-9_-]+$/.test(post.id || '') || ids.has(post.id)) throw new Error('Invalid or duplicate job ID');
  ids.add(post.id);
  const account = accountsByName.get(post.account);
  if (!account) throw new Error(`Unknown account: ${post.account}`);
  if (usedAccounts.has(post.account)) throw new Error('Use one post per account in each batch');
  usedAccounts.add(post.account);
  if (typeof post.text !== 'string' || !post.text.trim()) throw new Error(`Missing text: ${post.id}`);
  const characters = [...post.text].length;
  if (characters > 200) throw new Error(`Post exceeds 200 characters: ${post.id} (${characters})`);
  const normalizedText = post.text.replace(/\s+/g, '').toLowerCase();
  if (texts.has(normalizedText)) throw new Error('Each account must have different content');
  texts.add(normalizedText);
  const tags = [...new Set([...post.text.matchAll(/\$([A-Za-z0-9]+)/g)].map(m => m[1]))];
  if (tags.length !== 3 || !Array.isArray(post.tokens) || post.tokens.length !== 3 || post.tokens.some(t => !tags.includes(t))) {
    throw new Error(`Exactly three matching token tags are required: ${post.id}`);
  }
  const image = inProject(post.image);
  const imageRelative = path.relative(imageRoot, image);
  if (imageRelative.startsWith('..') || path.isAbsolute(imageRelative) || !fs.statSync(image).isFile()) {
    throw new Error(`Image must be a file in imagegen: ${post.id}`);
  }
  const snapshotPath = inProject(post.marketSnapshot);
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const winners = new Set(snapshot.topGainers.map(t => t.token));
  const losers = new Set(snapshot.topLosers.map(t => t.token));
  if (!tags.every(t => winners.has(t) || losers.has(t)) || !tags.some(t => winners.has(t)) || !tags.some(t => losers.has(t))) {
    throw new Error(`Choose three tokens from both top-five lists: ${post.id}`);
  }
  if (send && (Date.now() - Date.parse(snapshot.fetchedAt) > 15 * 60 * 1000 || !Number.isFinite(Date.parse(snapshot.fetchedAt)))) {
    throw new Error('Refresh the market snapshot before publishing');
  }
  const fingerprint = createHash('sha256').update(account.apiKey.trim()).update('\0').update(post.text)
    .update('\0').update(fs.readFileSync(image)).digest('hex');
  return { post, account, image, snapshot, characters, fingerprint };
});

const runs = inProject(option('--runs', 'runs'));
fs.mkdirSync(runs, { recursive: true });
const existing = fs.readdirSync(runs).filter(f => f.endsWith('.state.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(runs, f), 'utf8')));

function execute(item) {
  const { post, account, image, snapshot, fingerprint } = item;
  const previous = existing.find(s => s.jobId === post.id || s.fingerprint === fingerprint);
  if (previous && ['published', 'uncertain', 'running'].includes(previous.status)) {
    console.log(`[${post.account}] SKIP ${post.id}: ${previous.status}${previous.link ? ` ${previous.link}` : ''}`);
    return Promise.resolve(previous);
  }
  const statePath = path.join(runs, `${post.id}.state.json`);
  const receiptPath = path.join(runs, `${post.id}.${Date.now()}.receipt.json`);
  const state = {
    jobId: post.id, account: post.account, fingerprint, status: 'running',
    text: post.text, image: post.image, marketSnapshot: snapshot,
    startedAt: new Date().toISOString(), receiptFile: path.relative(root, receiptPath),
  };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`[${post.account}] Uploading and publishing ${post.id}`);
  return new Promise(resolve => {
    const child = spawn(process.execPath, [
      '--import', pathToFileURL(path.join(root, 'network.mjs')).href,
      'scripts/post-image.mjs', '--text', post.text, '--images', image,
    ], {
      cwd: path.join(root, 'vendor', 'square-post'),
      env: { ...process.env, BINANCE_SQUARE_OPENAPI_KEY: account.apiKey.trim(), SQUARE_RECEIPT_FILE: receiptPath },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const finish = (code, spawnError) => {
      if (finished) return;
      finished = true;
      const receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null;
      state.status = receipt?.status || (stdout.includes('Publishing...') ? 'uncertain' : 'failed');
      state.completedAt = new Date().toISOString();
      state.exitCode = code;
      state.stdout = stdout;
      state.stderr = spawnError?.message || stderr;
      state.receipt = receipt;
      const id = receipt?.payload?.data?.id;
      if (id) {
        state.postId = String(id);
        state.link = receipt.payload.data.shareLink || `https://www.binance.com/square/post/${id}`;
      }
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      console.log(`[${post.account}] ${state.status.toUpperCase()}${state.link ? ` ${state.link}` : ''}`);
      if (state.status !== 'published') console.log(`[${post.account}] ${state.stderr.trim() || JSON.stringify(receipt)}`);
      resolve(state);
    };
    child.once('error', error => finish(null, error));
    child.once('close', code => finish(code));
  });
}

if (!send) {
  for (const item of prepared) console.log(JSON.stringify({
    jobId: item.post.id, account: item.post.account, characters: item.characters,
    text: item.post.text, image: item.post.image, tokens: item.post.tokens,
  }, null, 2));
  console.log('Validated. Add --send to publish.');
} else {
  let cursor = 0;
  const results = [];
  const worker = async () => {
    while (cursor < prepared.length) {
      const item = prepared[cursor++];
      results.push(await execute(item));
    }
  };
  const workers = Math.max(1, Math.min(Number(settings.concurrency) || 3, prepared.length));
  const completed = await Promise.allSettled(Array.from({ length: workers }, worker));
  for (const result of completed) if (result.status === 'rejected') throw result.reason;
  if (results.some(r => r.status !== 'published')) process.exitCode = 1;
}
