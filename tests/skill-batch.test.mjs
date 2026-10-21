import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepare, finalize, validate } from '../.agents/skills/binance-square-posts/scripts/batch.mjs';

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(project, 'tests', 'skill-fixture-'));
  t.after(() => {
    const relative = path.relative(path.join(project, 'tests'), root);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'snapshots'));
  fs.mkdirSync(path.join(root, 'imagegen'));
  fs.writeFileSync(path.join(root, 'imagegen', 'one.png'), Buffer.from('image fixture'));
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    topGainers: Array.from({ length: 5 }, (_, i) => ({ token: `W${i}` })),
    topLosers: Array.from({ length: 5 }, (_, i) => ({ token: `L${i}` })),
  };
  fs.writeFileSync(path.join(root, 'snapshots', 'rankings.json'), JSON.stringify(snapshot));
  return { root, snapshot };
}

test('preparation covers both lists and supports more than 100 account aliases', t => {
  const { root } = fixture(t);
  const batch = prepare(root, { count: 101 });
  assert.equal(batch.specs.length, 101);
  assert.equal(new Set(batch.specs.slice(0, 100).map(s => [...s.tokens].sort().join(','))).size, 100);
  for (const spec of batch.specs) {
    assert.equal(new Set(spec.tokens).size, 3);
    assert.ok(spec.gainers.length > 0 && spec.losers.length > 0);
    assert.ok(fs.existsSync(path.join(root, spec.image)));
  }
  assert.deepEqual(fs.readdirSync(path.join(root, batch.directory)).sort(), ['rankings.json', 'specs.json']);
});

test('independent drafts finalize into a credential-free publishing manifest', t => {
  const { root } = fixture(t);
  const batch = prepare(root, { labels: ['alpha', 'beta'] });
  const drafts = batch.specs.map((spec, index) => ({
    id: spec.id,
    text: `${index ? '我偏乐观' : '我有点疑虑'}\n${spec.tokens.map(token => `$${token}`).join('\n')}\n${index ? '等兑现。' : '先观察'}`,
  }));
  fs.writeFileSync(path.join(root, batch.directory, 'drafts.json'), JSON.stringify({ drafts }));
  const report = finalize(root, batch.directory, `${batch.directory}/drafts.json`);
  assert.equal(report.valid, true);
  assert.equal(report.count, 2);
  const posts = JSON.parse(fs.readFileSync(path.join(root, report.postsFile), 'utf8')).posts;
  assert.deepEqual(posts.map(p => p.account), ['alpha', 'beta']);
  assert.deepEqual(Object.keys(posts[0]).sort(), ['account', 'id', 'image', 'marketSnapshot', 'text', 'tokens']);
});

test('changing only token names is rejected as duplicate content', t => {
  const { root } = fixture(t);
  const batch = prepare(root, { count: 2 });
  const posts = batch.specs.map(spec => ({ ...spec, text: `我不服\n${spec.tokens.map(token => `$${token}`).join('\n')}\n谁还信？` }));
  assert.throws(() => validate(root, posts), /Duplicate content/);
});

test('200 Unicode characters including tags and whitespace are accepted, but 201 are rejected', t => {
  const { root } = fixture(t);
  const spec = prepare(root).specs[0];
  const prefix = `我看行情\n${spec.tokens.map(token => `$${token}`).join(' ')}\n`;
  const text = prefix + '🙂'.repeat(200 - [...prefix].length);
  assert.equal(validate(root, [{ ...spec, text }]).posts[0].characters, 200);
  assert.throws(() => validate(root, [{ ...spec, text: text + '字' }]), /200 characters/);
});

test('stale markets and workspace boundaries are enforced', t => {
  const { root, snapshot } = fixture(t);
  assert.throws(() => prepare(root, { snapshotFile: '../outside.json' }), /stay in the workspace/);
  snapshot.fetchedAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  fs.writeFileSync(path.join(root, 'snapshots', 'rankings.json'), JSON.stringify(snapshot));
  assert.throws(() => prepare(root), /current market snapshot/);
});
