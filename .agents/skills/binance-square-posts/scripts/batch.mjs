import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function inside(root, name, mustExist = false) {
  if (typeof name !== 'string' || !name) throw new Error('A project path is required');
  const absolute = path.resolve(root, name);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path must stay in the workspace');
  if (mustExist) {
    const real = fs.realpathSync(absolute);
    const realRelative = path.relative(fs.realpathSync(root), real);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('Linked path leaves workspace');
  }
  return absolute;
}

function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const read = (root, name) => JSON.parse(fs.readFileSync(inside(root, name, true), 'utf8').replace(/^\uFEFF/, ''));
const write = (name, data) => fs.writeFileSync(name, JSON.stringify(data, null, 2), 'utf8');

function recent(snapshot) {
  const timestamp = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > 15 * 60 * 1000 || timestamp - Date.now() > 60000) {
    throw new Error('A current market snapshot is required');
  }
  if (!Array.isArray(snapshot.topGainers) || !Array.isArray(snapshot.topLosers)
    || snapshot.topGainers.length !== 5 || snapshot.topLosers.length !== 5) {
    throw new Error('Both top-five market lists are required');
  }
}

export function prepare(root, { count = 1, labels = null, snapshotFile = 'snapshots/rankings.json' } = {}) {
  if (labels) count = labels.length;
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Count must be a positive integer');
  const accounts = labels || Array.from({ length: count }, (_, i) => `account-${i + 1}`);
  if (accounts.some(label => typeof label !== 'string' || !label.trim()) || new Set(accounts).size !== count) {
    throw new Error('Account aliases must be distinct and nonempty');
  }
  const snapshot = read(root, snapshotFile);
  recent(snapshot);
  const winners = snapshot.topGainers.map(row => row.token);
  const losers = snapshot.topLosers.map(row => row.token);
  if (new Set([...winners, ...losers]).size !== 10) throw new Error('Market lists must contain distinct tokens');
  const pool = [];
  for (const winner of winners) {
    for (let i = 0; i < losers.length; i++) for (let j = i + 1; j < losers.length; j++) {
      pool.push({ gainers: [winner], losers: [losers[i], losers[j]] });
    }
  }
  for (const loser of losers) {
    for (let i = 0; i < winners.length; i++) for (let j = i + 1; j < winners.length; j++) {
      pool.push({ gainers: [winners[i], winners[j]], losers: [loser] });
    }
  }
  const images = fs.readdirSync(inside(root, 'imagegen', true))
    .filter(name => /\.(png|jpe?g|webp)$/i.test(name) && fs.statSync(inside(root, `imagegen/${name}`, true)).isFile());
  if (!images.length) throw new Error('No images found in imagegen');
  const batchId = `square-${Date.now()}-${randomInt(100000, 1000000)}`;
  const directory = inside(root, `batches/${batchId}`);
  fs.mkdirSync(directory, { recursive: true });
  write(path.join(directory, 'rankings.json'), snapshot);
  let combinations = shuffle(pool);
  let imageOrder = shuffle(images);
  const specs = accounts.map((account, index) => {
    if (index && index % pool.length === 0) combinations = shuffle(pool);
    if (index && index % images.length === 0) imageOrder = shuffle(images);
    const combination = combinations[index % pool.length];
    return {
      id: `${batchId}-${index + 1}`, account,
      ...combination, tokens: shuffle([...combination.gainers, ...combination.losers]),
      image: `imagegen/${imageOrder[index % images.length]}`,
      marketSnapshot: `batches/${batchId}/rankings.json`,
    };
  });
  write(path.join(directory, 'specs.json'), { batchId, specs });
  return { batchId, directory: path.relative(root, directory), count, specs };
}

const normalize = text => text.replace(/\$[A-Za-z0-9]+/g, '币').replace(/[\p{P}\p{S}\s]+/gu, '').toLowerCase();
function grams(text) {
  const characters = [...normalize(text)];
  return new Set(characters.slice(1).map((character, index) => characters[index] + character));
}

export function validate(root, posts) {
  if (!Array.isArray(posts) || !posts.length) throw new Error('No posts');
  const ids = new Set(), accounts = new Set(), texts = new Set();
  const warnings = [];
  const summaries = posts.map(post => {
    if (!/^[A-Za-z0-9_-]+$/.test(post.id || '') || ids.has(post.id)) throw new Error('Invalid or reused task ID');
    ids.add(post.id);
    if (!post.account || accounts.has(post.account)) throw new Error('One distinct account alias per post is required');
    accounts.add(post.account);
    if (typeof post.text !== 'string' || !post.text.trim()) throw new Error(`Missing text: ${post.id}`);
    const characters = [...post.text].length;
    if (characters > 200) throw new Error(`More than 200 characters: ${post.id}`);
    const normalized = normalize(post.text);
    if (texts.has(normalized)) throw new Error('Duplicate content after removing token names and formatting');
    texts.add(normalized);
    const tags = [...new Set([...post.text.matchAll(/\$([A-Za-z0-9]+)/g)].map(match => match[1]))];
    if (tags.length !== 3 || !Array.isArray(post.tokens) || new Set(post.tokens).size !== 3 || post.tokens.some(token => !tags.includes(token))) {
      throw new Error(`Three matching token tags are required: ${post.id}`);
    }
    const snapshot = read(root, post.marketSnapshot);
    recent(snapshot);
    const winners = new Set(snapshot.topGainers.map(row => row.token));
    const losers = new Set(snapshot.topLosers.map(row => row.token));
    if (!tags.every(token => winners.has(token) || losers.has(token)) || !tags.some(token => winners.has(token)) || !tags.some(token => losers.has(token))) {
      throw new Error(`Token selection must cover both top-five lists: ${post.id}`);
    }
    const image = inside(root, post.image, true);
    const imageRelative = path.relative(fs.realpathSync(inside(root, 'imagegen', true)), fs.realpathSync(image));
    if (imageRelative.startsWith('..') || path.isAbsolute(imageRelative) || !fs.statSync(image).isFile()) {
      throw new Error(`Image must be a file in imagegen: ${post.id}`);
    }
    return { id: post.id, account: post.account, characters, tokens: tags, image: post.image };
  });
  const sets = posts.map(post => grams(post.text));
  for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) {
    const union = new Set([...sets[i], ...sets[j]]);
    const common = [...sets[i]].filter(item => sets[j].has(item)).length;
    const score = union.size ? common / union.size : 1;
    if (score >= 0.65) warnings.push({ posts: [posts[i].id, posts[j].id], reason: 'Review similar phrasing', score });
  }
  if (posts.length >= 3) {
    const endings = posts.map(post => post.text.trim().split(/\n/).at(-1).trim());
    if (endings.every(ending => /[?？]$/.test(ending))) warnings.push({ reason: 'Every post ends with a question; review voice and structure' });
    if (new Set(endings.map(normalize)).size < endings.length / 2) warnings.push({ reason: 'Several posts share the same closing phrase' });
  }
  return { valid: true, count: posts.length, posts: summaries, diversityWarnings: warnings };
}

export function finalize(root, directory, draftsFile) {
  const batchDirectory = inside(root, directory, true);
  const manifest = read(root, path.relative(root, path.join(batchDirectory, 'specs.json')));
  const drafts = read(root, draftsFile).drafts;
  if (!Array.isArray(drafts) || drafts.length !== manifest.specs.length) throw new Error('Provide one draft for each specification');
  const byId = new Map(drafts.map(draft => [draft.id, draft.text]));
  if (byId.size !== drafts.length) throw new Error('Draft task IDs must be distinct');
  const posts = manifest.specs.map(spec => ({
    id: spec.id, account: spec.account, tokens: spec.tokens, image: spec.image,
    marketSnapshot: spec.marketSnapshot, text: byId.get(spec.id),
  }));
  const report = validate(root, posts);
  write(path.join(batchDirectory, 'posts.json'), { batchId: manifest.batchId, posts });
  write(path.join(batchDirectory, 'validation.json'), report);
  return { ...report, postsFile: path.relative(root, path.join(batchDirectory, 'posts.json')) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const command = args.shift();
  const option = (name, fallback = null) => {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value: ${name}`);
    return args[index + 1];
  };
  const root = path.resolve(option('--workspace', process.cwd()));
  let result;
  if (command === 'prepare') result = prepare(root, {
    count: Number(option('--count', '1')),
    labels: option('--labels')?.split(',').map(label => label.trim()) || null,
    snapshotFile: option('--snapshot', 'snapshots/rankings.json'),
  });
  else if (command === 'finalize') result = finalize(root, option('--batch'), option('--drafts'));
  else if (command === 'validate') result = validate(root, read(root, option('--posts')).posts);
  else throw new Error('Usage: batch.mjs prepare --count N | finalize --batch PATH --drafts PATH | validate --posts PATH');
  console.log(JSON.stringify(result, null, 2));
}
