import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const original = JSON.parse(fs.readFileSync(path.join(root, 'posts.json'), 'utf8')).posts[0];
const loader = pathToFileURL(path.join(root, 'tests', 'mock-publisher-loader.mjs')).href;

function fixture(t, keys = ['success-a', 'success-b']) {
  const dir = fs.mkdtempSync(path.join(root, 'tests', 'fixture-'));
  t.after(() => {
    const relative = path.relative(path.join(root, 'tests'), dir);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const accounts = keys.map((key, i) => ({ name: `test-account-${i}`, apiKey: `test-only-${key}` }));
  const posts = accounts.map((account, i) => ({ ...original, id: `test-job-${i}`, account: account.name, text: `${i}\n${original.text}` }));
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    topGainers: [
      ...original.tokens.slice(0, 2).map(token => ({ token, changePercent: 1 })),
      ...Array.from({ length: 3 }, (_, i) => ({ token: `TESTWIN${i}`, changePercent: 1 })),
    ],
    topLosers: [
      { token: original.tokens[2], changePercent: -1 },
      ...Array.from({ length: 4 }, (_, i) => ({ token: `TESTLOSS${i}`, changePercent: -1 })),
    ],
  };
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snapshot));
  for (const post of posts) post.marketSnapshot = path.relative(root, path.join(dir, 'snapshot.json'));
  const save = () => {
    fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({ accounts }));
    fs.writeFileSync(path.join(dir, 'posts.json'), JSON.stringify({ posts }));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ concurrency: 2 }));
  };
  save();
  const run = (send = false) => spawnSync(process.execPath, [path.join(root, 'square-batch.mjs'),
    '--accounts', path.join(dir, 'accounts.json'), '--posts', path.join(dir, 'posts.json'),
    '--settings', path.join(dir, 'settings.json'), '--runs', path.join(dir, 'runs'),
    ...(send ? ['--send'] : []),
  ], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, NODE_OPTIONS: `--loader=${loader}` } });
  const states = () => fs.readdirSync(path.join(dir, 'runs')).filter(f => f.endsWith('.state.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, 'runs', f), 'utf8')));
  return { dir, accounts, posts, save, run, states };
}

test('separate accounts run concurrently, with isolated content and one failure', t => {
  const f = fixture(t, ['success-a', 'success-b', 'failure']);
  const result = f.run(true);
  assert.equal(result.status, 1, result.stderr);
  const states = f.states();
  assert.equal(states.filter(s => s.status === 'published').length, 2);
  assert.equal(states.filter(s => s.status === 'failed').length, 1);
  const successful = states.filter(s => s.status === 'published');
  for (const state of successful) {
    assert.equal(state.receipt.payload.data.submittedText, state.text);
    assert.equal(state.postId, f.accounts.find(a => a.name === state.account).apiKey);
  }
  const first = states.find(s => s.jobId === 'test-job-0').receipt.payload.data;
  const second = states.find(s => s.jobId === 'test-job-1').receipt.payload.data;
  assert.ok(Math.max(first.startedAt, second.startedAt) < Math.min(first.finishedAt, second.finishedAt));
});

test('published and uncertain results are skipped without sending again', t => {
  const f = fixture(t, ['success-a', 'uncertain']);
  f.run(true);
  const receiptsBefore = fs.readdirSync(path.join(f.dir, 'runs')).filter(n => n.endsWith('.receipt.json')).length;
  const result = f.run(true);
  assert.match(result.stdout, /SKIP test-job-0: published/);
  assert.match(result.stdout, /SKIP test-job-1: uncertain/);
  assert.equal(fs.readdirSync(path.join(f.dir, 'runs')).filter(n => n.endsWith('.receipt.json')).length, receiptsBefore);
});

test('duplicate content and reused keys are rejected before execution', t => {
  const f = fixture(t);
  f.posts[1].text = f.posts[0].text;
  f.save();
  let result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /different content/);
  f.posts[1].text = original.text;
  f.accounts[1].apiKey = f.accounts[0].apiKey;
  f.save();
  result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /same key/);
});

test('publishing preflight accepts 200 characters and rejects 201 before any submission', t => {
  const f = fixture(t);
  for (const post of f.posts) post.text += '🙂'.repeat(200 - [...post.text].length);
  f.save();
  let result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"characters": 200/);
  f.posts[0].text += '字';
  f.save();
  result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exceeds 200 characters/);
  assert.equal(fs.readdirSync(path.join(f.dir, 'runs')).length, 0);
});
