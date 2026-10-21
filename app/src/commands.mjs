import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config, relativeToProject, resolveProject } from './config.mjs';

export function runNode(script, args = [], { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: config.projectRoot,
      env: { ...process.env },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => reject(error));
    child.once('close', code => {
      const result = { code, stdout, stderr };
      if (code !== 0 && !allowFailure) {
        const detail = (stderr || stdout).trim().slice(-1800);
        reject(new Error(`${path.basename(script)} exited with ${code}: ${detail}`));
      } else {
        resolve(result);
      }
    });
  });
}

export async function refreshMarket() {
  await runNode('market.mjs');
  return {
    snapshotPath: 'snapshots/rankings.json',
    snapshot: JSON.parse(await readFile(resolveProject('snapshots/rankings.json'), 'utf8')),
  };
}

export async function prepareBatch() {
  await runNode('prepare-keys-batch.mjs');
  const latest = JSON.parse(await readFile(resolveProject('batches/latest.json'), 'utf8'));
  return {
    batchId: latest.batchId,
    directory: latest.directory.replaceAll('\\', '/'),
    specs: JSON.parse(await readFile(resolveProject(`${latest.directory}/specs.json`), 'utf8')),
  };
}

export function batchArg(directory) {
  const absolute = resolveProject(directory);
  return relativeToProject(absolute);
}

export { config };
