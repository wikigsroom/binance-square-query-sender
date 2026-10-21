import '../../network.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { config, assertConfiguration, relativeToProject, resolveProject } from './config.mjs';
import { readText, writeJson } from './files.mjs';
import { batchArg, prepareBatch, refreshMarket, runNode } from './commands.mjs';
import { collectNews } from './news.mjs';
import { generateDrafts, repairDrafts } from './llm.mjs';
import { validateDrafts, validateNewsUsage } from './validation.mjs';

let active = false;

function acquireLock() {
  const lockPath = path.join(config.appRoot, '.run.lock');
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      process.kill(lock.pid, 0);
      throw new Error(`Another run is active (pid ${lock.pid}).`);
    } catch (error) {
      if (error.message.startsWith('Another run')) throw error;
      fs.rmSync(lockPath, { force: true });
    }
  }
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return () => fs.rmSync(lockPath, { force: true });
}

function log(message, details = '') {
  const suffix = details ? ` ${details}` : '';
  console.log(`[${new Date().toISOString()}] ${message}${suffix}`);
}

function assertFresh(snapshot) {
  const age = Date.now() - Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(age) || age > 15 * 60 * 1000) throw new Error('Market snapshot is older than 15 minutes; no post was submitted.');
}

function draftInput(snapshot, specs, news) {
  return {
    snapshot,
    specs,
    news,
    rules: readText('CONTENT_RULES.md'),
    writingGuide: readText('.agents/skills/binance-square-posts/references/writing.md'),
    newsGuide: readText('.agents/skills/binance-square-posts/references/news.md'),
  };
}

async function prepareContentCycle() {
  log('刷新币安现货滚动24小时榜单');
  const market = await refreshMarket();
  log('按 keys.txt 创建独立批次');
  const batch = await prepareBatch();
  const specs = batch.specs.specs;
  const news = await collectNews([...new Set(specs.flatMap(spec => spec.tokens))]);
  log('检索公开新闻完成', `${news.items.length} 条可用消息`);
  const input = draftInput(market.snapshot, specs, news);
  const validateGenerated = (value) => {
    const drafts = validateDrafts({ drafts: value?.drafts, specs, snapshot: market.snapshot });
    const usage = validateNewsUsage({ usedNews: value?.usedNews, specs, newsItems: news.items });
    return {
      valid: drafts.valid && usage.valid,
      errors: [...drafts.errors, ...usage.errors],
      warnings: drafts.warnings,
    };
  };
  let generated = await generateDrafts(input);
  let validation = validateGenerated(generated);
  if (!validation.valid) {
    log('模型初稿未通过本地事实校验，发起一次定向修复', validation.errors.join(' | '));
    generated = await repairDrafts({ ...input, previous: generated }, validation);
    validation = validateGenerated(generated);
  }
  if (!validation.valid) throw new Error(`模型文案校验失败：${validation.errors.join(' | ')}`);
  writeJson(`${batch.directory}/drafts.json`, { drafts: generated.drafts });
  writeJson(`${batch.directory}/generation.json`, {
    provider: 'remote-openai-compatible',
    model: config.lunaModel,
    endpoint: `${config.lunaBaseUrl}/v1/chat/completions`,
    reasoningEffort: config.lunaReasoningEffort,
    generatedAt: new Date().toISOString(),
  });
  writeJson(`${batch.directory}/news.json`, newsDocument(batch.batchId, news, generated, specs));
  log('文案和新闻记录已保存', `preferredWarnings=${validation.warnings.length}`);

  const batchPath = batchArg(batch.directory);
  await runNode(config.batchScript, ['finalize', '--batch', batchPath, '--drafts', `${batchPath}/drafts.json`]);
  const preflight = await runNode('square-batch.mjs', [
    '--accounts', `${batchPath}/accounts.json`, '--posts', `${batchPath}/posts.json`,
  ]);
  if (!preflight.stdout.includes('Validated.')) throw new Error('Square preflight did not confirm validation.');
  return { market, batch, batchPath, validation };
}

function newsDocument(batchId, news, generated, specs) {
  const usage = new Map((Array.isArray(generated.usedNews) ? generated.usedNews : []).map(item => [item.sourceId, item.jobIds || []]));
  const items = news.items.map(item => ({ ...item, usedBy: usage.get(item.id) || [] }));
  const cited = new Set(items.flatMap(item => item.usedBy));
  const withoutNews = specs.map(spec => spec.id).filter(id => !cited.has(id)).map(jobId => ({
    jobId,
    reason: news.reason || '本篇未引用可核实新闻，依据本轮行情与个人观点撰写。',
  }));
  return { batchId, checkedAt: news.checkedAt, items, withoutNews, reason: news.reason || null };
}

async function runOnce() {
  if (active) { log('跳过重叠轮次'); return; }
  active = true;
  let release = () => {};
  let batch;
  try {
    release = acquireLock();
    assertConfiguration();
    let cycle;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      cycle = await prepareContentCycle();
      if (Date.now() - Date.parse(cycle.market.snapshot.fetchedAt) <= 15 * 60 * 1000) break;
      if (attempt === 2) throw new Error('Market snapshot remained older than 15 minutes after refresh; no post was submitted.');
      log('模型生成期间行情过期，刷新榜单、新闻和正文后重新预检');
    }
    ({ batch } = cycle);
    const { market, batchPath, validation } = cycle;
    assertFresh(market.snapshot);
    if (config.dryRun) {
      log('DRY_RUN=true，已完成预检，未提交发布');
      writeJson('app/state/last-run.json', { batchId: batch.batchId, status: 'dry-run', at: new Date().toISOString(), validation });
      return;
    }
    log('开始向各账户发布');
    const sent = await runNode('square-batch.mjs', [
      '--accounts', `${batchPath}/accounts.json`, '--posts', `${batchPath}/posts.json`, '--send',
    ], { allowFailure: true });
    if (sent.code !== 0) log('发布命令部分失败，继续核验已返回结果的任务');
    const verified = await runNode('verify-batch.mjs', [batchPath], { allowFailure: true });
    const reportPath = resolveProject(`${batchPath}/report.json`);
    const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
    writeJson('app/state/last-run.json', {
      batchId: batch.batchId, status: verified.code === 0 ? 'verified' : 'partial-or-pending',
      at: new Date().toISOString(), published: report?.published ?? null, verified: report?.verified ?? null,
      report: relativeToProject(reportPath),
    });
    log('本轮结束', `published=${report?.published ?? 0} verified=${report?.verified ?? 0}`);
  } finally {
    release();
    active = false;
  }
}

async function main() {
  const once = process.argv.includes('--once');
  if (once) {
    await runOnce();
    return;
  }
  log('定时发布器已启动', `intervalMinutes=${config.intervalMs / 60000} runOnStart=${config.runOnStart} dryRun=${config.dryRun}`);
  if (config.runOnStart) {
    try { await runOnce(); } catch (error) { log('首轮失败', error.message); }
  }
  const timer = setInterval(async () => {
    try { await runOnce(); } catch (error) { log('定时轮次失败', error.message); }
  }, config.intervalMs);
  const stop = () => { clearInterval(timer); log('定时发布器已停止'); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch(error => { log('程序退出', error.message); process.exitCode = 1; });
