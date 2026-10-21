export async function load(url, context, nextLoad) {
  if (!url.endsWith('/vendor/square-post/scripts/post-image.mjs')) return nextLoad(url, context);
  return {
    format: 'module', shortCircuit: true,
    source: `
      import fs from 'node:fs';
      const key = process.env.BINANCE_SQUARE_OPENAPI_KEY;
      if (!key?.startsWith('test-only-')) throw new Error('Mock accepts test keys only');
      const startedAt = Date.now();
      await new Promise(resolve => setTimeout(resolve, 250));
      const status = key.endsWith('failure') ? 'failed' : key.endsWith('uncertain') ? 'uncertain' : 'published';
      const args = process.argv.slice(2);
      const payload = status === 'published'
        ? {code: '000000', data: {id: key, submittedText: args[args.indexOf('--text') + 1], startedAt, finishedAt: Date.now()}}
        : {code: status === 'failed' ? '220003' : null, message: 'mock response', startedAt, finishedAt: Date.now()};
      fs.writeFileSync(process.env.SQUARE_RECEIPT_FILE, JSON.stringify({status, httpStatus: status === 'uncertain' ? 504 : 200, payload}));
      console.log('Mock publisher completed');
      process.exitCode = status === 'failed' ? 1 : 0;
    `,
  };
}
