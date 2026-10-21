function normalized(text) {
  return text.replace(/\s+/g, '').toLowerCase();
}

function diversityKey(text) {
  return normalized(text)
    .replace(/\$[a-z0-9]+/gi, '$token')
    .replace(/\d+(?:\.\d+)?%/g, 'pct%')
    .replace(/[\p{P}\p{S}]/gu, '');
}

function shingleSimilarity(left, right) {
  const a = diversityKey(left);
  const b = diversityKey(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shingles = value => new Set([...value].slice(0, -1).map((char, index) => `${char}${value[index + 1]}`));
  const leftSet = shingles(a);
  const rightSet = shingles(b);
  const intersection = [...leftSet].filter(item => rightSet.has(item)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
}

const forbiddenMetaWords = ['情绪', '情感', '情绪化', '心态', '翻译腔'];
const stiffPhrases = [
  '这让我', '这使我', '我会承认', '不能据此', '至少我', '我更愿意',
  '我暂时把', '真要让我', '这组数字让我想到', '从这个角度看',
  '值得注意的是', '换句话说', '不难看出', '这意味着', '在我看来',
  '就目前来看', '从长远来看', '总体而言', '归根结底',
];

function contentStyleErrors(text) {
  const errors = [];
  const meta = forbiddenMetaWords.find(word => text.includes(word));
  if (meta) errors.push(`contains forbidden meta wording: ${meta}`);
  const phrase = stiffPhrases.find(item => text.includes(item));
  if (phrase) errors.push(`contains stiff or translation-like phrase: ${phrase}`);
  if (/不是.{0,20}而是/u.test(text)) errors.push('contains stiff contrast pattern: 不是…而是…');
  if (!/(我|咱|自己|散户)/u.test(text)) errors.push('lacks a first-person retail-investor voice.');
  if (!/[。！？!?；;]/u.test(text)) errors.push('lacks natural sentence punctuation.');
  return errors;
}

function edgeKey(text, side) {
  const clean = normalized(text).replace(/\$[a-z0-9]+/gi, '').replace(/\d+(?:\.\d+)?%/g, '');
  return side === 'start' ? clean.slice(0, 14) : clean.slice(-14);
}

function percentage(value) {
  return Math.abs(Number(value)).toFixed(2);
}

function hasMarketFact(text, token, change) {
  const direction = Number(change) >= 0 ? '涨' : '跌';
  const value = percentage(change);
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const direct = new RegExp(`\\$${escaped}[^\\n]{0,32}${direction}[^0-9%]{0,8}${value}%`, 'i');
  const reverse = new RegExp(`${direction}[^0-9%]{0,8}${value}%[^\\n]{0,32}\\$${escaped}`, 'i');
  return direct.test(text) || reverse.test(text);
}

export function validateDrafts({ drafts, specs, snapshot }) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(drafts) || drafts.length !== specs.length) {
    return { valid: false, errors: [`Expected ${specs.length} drafts.`], warnings };
  }
  const winnerSet = new Set(snapshot.topGainers.map(row => row.token));
  const loserSet = new Set(snapshot.topLosers.map(row => row.token));
  const ids = new Set();
  const texts = new Set();
  const presentDrafts = [];
  for (const spec of specs) {
    const draft = drafts.find(item => item?.id === spec.id);
    if (!draft) { errors.push(`${spec.id}: missing draft.`); continue; }
    if (ids.has(draft.id)) errors.push(`${spec.id}: duplicate id.`);
    ids.add(draft.id);
    if (typeof draft.text !== 'string' || !draft.text.trim()) { errors.push(`${spec.id}: empty text.`); continue; }
    const chars = [...draft.text].length;
    if (chars > 200) errors.push(`${spec.id}: ${chars} Unicode characters exceeds 200.`);
    if (chars < 120) warnings.push(`${spec.id}: ${chars} characters is below the preferred 120.`);
    for (const styleError of contentStyleErrors(draft.text)) errors.push(`${spec.id}: ${styleError}.`);
    const textKey = normalized(draft.text);
    if (texts.has(textKey)) errors.push(`${spec.id}: duplicated content.`);
    texts.add(textKey);
    presentDrafts.push({ id: spec.id, text: draft.text });
    const tags = [...new Set([...draft.text.matchAll(/\$([A-Za-z0-9]+)/g)].map(match => match[1]))];
    if (tags.length !== 3) errors.push(`${spec.id}: expected exactly 3 token tags, found ${tags.length}.`);
    if (tags.length === 3 && spec.tokens.some(token => !tags.includes(token))) errors.push(`${spec.id}: tags do not match specs.`);
    if (tags.some(token => !winnerSet.has(token) && !loserSet.has(token))) errors.push(`${spec.id}: tag outside current top-five lists.`);
    if (!tags.some(token => winnerSet.has(token)) || !tags.some(token => loserSet.has(token))) errors.push(`${spec.id}: both gainers and losers must be represented.`);
    for (const token of spec.tokens) {
      const row = [...snapshot.topGainers, ...snapshot.topLosers].find(item => item.token === token);
      if (!row || !hasMarketFact(draft.text, token, row.changePercent)) errors.push(`${spec.id}: missing exact 24h fact for ${token}.`);
    }
  }
  for (let i = 0; i < presentDrafts.length; i += 1) {
    for (let j = i + 1; j < presentDrafts.length; j += 1) {
      const similarity = shingleSimilarity(presentDrafts[i].text, presentDrafts[j].text);
      if (similarity >= 0.78) {
        errors.push(`${presentDrafts[i].id} and ${presentDrafts[j].id}: content is too structurally similar (${similarity.toFixed(2)}); rewrite both independently.`);
      }
      const sameStart = edgeKey(presentDrafts[i].text, 'start') === edgeKey(presentDrafts[j].text, 'start');
      const sameEnd = edgeKey(presentDrafts[i].text, 'end') === edgeKey(presentDrafts[j].text, 'end');
      if (sameStart && edgeKey(presentDrafts[i].text, 'start').length >= 10) {
        errors.push(`${presentDrafts[i].id} and ${presentDrafts[j].id}: repeated opening; change the entry point.`);
      }
      if (sameEnd && edgeKey(presentDrafts[i].text, 'end').length >= 10) {
        errors.push(`${presentDrafts[i].id} and ${presentDrafts[j].id}: repeated closing; change the final stance.`);
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function validateNewsUsage({ usedNews, specs, newsItems }) {
  const errors = [];
  const sourceIds = new Set((Array.isArray(newsItems) ? newsItems : []).map(item => item?.id).filter(Boolean));
  const specIds = new Set(specs.map(spec => spec.id));
  const usedJobs = new Set();
  if (!Array.isArray(usedNews)) return { valid: false, errors: ['usedNews must be an array.'] };
  for (const item of usedNews) {
    if (!item || typeof item.sourceId !== 'string' || !sourceIds.has(item.sourceId)) {
      errors.push(`usedNews references an unknown sourceId: ${item?.sourceId ?? '(missing)'}.`);
      continue;
    }
    if (!Array.isArray(item.jobIds)) {
      errors.push(`usedNews ${item.sourceId} must contain a jobIds array.`);
      continue;
    }
    for (const jobId of item.jobIds) {
      if (!specIds.has(jobId)) errors.push(`usedNews ${item.sourceId} references an unknown jobId: ${jobId}.`);
      if (usedJobs.has(jobId)) errors.push(`usedNews assigns jobId more than once: ${jobId}.`);
      usedJobs.add(jobId);
    }
  }
  return { valid: errors.length === 0, errors };
}
