import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch as networkFetch, ProxyAgent, Agent } from 'undici';

const root = path.dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(fs.readFileSync(new URL('./settings.json', import.meta.url), 'utf8'));
const dispatcher = settings.proxy ? new ProxyAgent(settings.proxy) : new Agent();
const requestTimeoutMs = settings.requestTimeoutMs || 45000;

function writeReceipt(receipt) {
  const output = process.env.SQUARE_RECEIPT_FILE;
  if (!output) return;
  const relative = path.relative(root, path.resolve(output));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Receipt must stay in the project directory');
  fs.writeFileSync(output, JSON.stringify(receipt, null, 2), 'utf8');
}

globalThis.fetch = async (url, options = {}) => {
  const isPublish = new URL(url).pathname.endsWith('/openApi/content/add');
  try {
    const response = await networkFetch(url, {
      ...options,
      dispatcher,
      signal: options.signal || AbortSignal.timeout(isPublish ? 90000 : requestTimeoutMs),
    });
    if (isPublish) {
      const raw = await response.clone().text();
      let payload;
      try { payload = JSON.parse(raw); } catch { payload = { responseText: raw.slice(0, 2000) }; }
      const status = response.ok && payload.code === '000000' && payload.data?.id
        ? 'published'
        : response.status >= 500 || response.status === 202 || !payload.code
          ? 'uncertain'
          : 'failed';
      writeReceipt({ status, httpStatus: response.status, payload, recordedAt: new Date().toISOString() });
    }
    return response;
  } catch (error) {
    if (isPublish) writeReceipt({ status: 'uncertain', error: error.message, recordedAt: new Date().toISOString() });
    throw error;
  }
};
