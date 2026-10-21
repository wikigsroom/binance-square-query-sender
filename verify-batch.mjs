import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = path.dirname(fileURLToPath(import.meta.url));
const latest = JSON.parse(fs.readFileSync(path.join(root, 'batches', 'latest.json'), 'utf8'));
const directory = path.resolve(root, process.argv[2] || latest.directory);
const relative = path.relative(root, directory);
if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Batch directory must stay in project');
const { posts } = JSON.parse(fs.readFileSync(path.join(directory, 'posts.json'), 'utf8'));
const newsFile = path.join(directory, 'news.json');
const news = fs.existsSync(newsFile) ? JSON.parse(fs.readFileSync(newsFile, 'utf8')) : null;
const run = promisify(execFile);
const results = Array(posts.length);
let cursor = 0;
async function worker() {
  while (cursor < posts.length) {
    const index = cursor++;
    const post = posts[index];
    const state = JSON.parse(fs.readFileSync(path.join(root, 'runs', `${post.id}.state.json`), 'utf8'));
    const entry = {
      account: post.account, jobId: post.id, status: state.status,
      postId: state.postId || null, url: state.link || null,
      text: post.text, characters: [...post.text].length,
      image: post.image, tokens: post.tokens,
    };
    if (state.status === 'published') {
      try {
        const { stdout } = await run(process.execPath, [path.join(root, 'verify-post.mjs'), state.postId], {
          cwd: root, windowsHide: true, timeout: 55000,
        });
        entry.verification = JSON.parse(stdout);
        entry.verified = true;
        entry.url = entry.verification.url;
        entry.author = entry.verification.author;
      } catch (error) {
        entry.verified = false;
        entry.verificationError = error.stderr || error.message;
      }
    } else {
      entry.verified = false;
      entry.error = state.stderr || state.receipt?.payload?.message || state.receipt?.error || 'Not confirmed published';
    }
    results[index] = entry;
    console.log(JSON.stringify({ account: entry.account, status: entry.status, verified: entry.verified, url: entry.url, author: entry.author, error: entry.error || entry.verificationError }));
  }
}
const settled = await Promise.allSettled(Array.from({ length: Math.min(3, posts.length) }, worker));
for (const result of settled) if (result.status === 'rejected') throw result.reason;
const report = {
  batchId: path.basename(directory), checkedAt: new Date().toISOString(),
  count: results.length, published: results.filter(r => r.status === 'published').length,
  verified: results.filter(r => r.verified).length,
  posts: results,
  ...(news ? { news } : {}),
};
fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
const markdown = [
  `# ${report.batchId}`, '',
  `发布成功 ${report.published}/${report.count}，正文、标签和配图核验通过 ${report.verified}/${report.count}。`, '',
  '| Key顺序 | 账号 | 正文字数 | 结果 | 帖子 |',
  '| --- | --- | ---: | --- | --- |',
  ...results.map((r, index) => `| ${index + 1} | ${r.author || r.account} | ${r.characters} | ${r.status}${r.verified ? ' / 已核验' : ''} | ${r.url ? `[查看](${r.url})` : r.error || r.verificationError || ''} |`),
  ...(news ? [
    '', '## 新闻来源', '',
    ...(Array.isArray(news.items) && news.items.length
      ? news.items.map(item => `- ${item.source || '来源'}：${item.publishedAt || '日期未记录'} [${item.title}](${item.url})${item.eventAt ? `；事件时间：${item.eventAt}` : ''}`)
      : [news.reason || '本批未引用新闻，依据行情与个人观点撰写。']),
  ] : []),
  '', '## 正文', '',
  ...results.flatMap((r, index) => [`### Key ${index + 1}`, '', r.text, '']),
].join('\n');
fs.writeFileSync(path.join(directory, 'report.md'), markdown, 'utf8');
console.log(JSON.stringify({ batchId: report.batchId, count: report.count, published: report.published, verified: report.verified }));
if (report.verified !== report.count) process.exitCode = 1;
