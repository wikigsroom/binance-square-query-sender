import fs from 'node:fs';
import path from 'node:path';
import { config, resolveProject } from './config.mjs';

export function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(resolveProject(relativePath), 'utf8'));
}

export function readText(relativePath) {
  return fs.readFileSync(resolveProject(relativePath), 'utf8');
}

export function writeJson(relativePath, value) {
  const target = resolveProject(relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
}

export function appStatePath(name) {
  return path.join(config.appRoot, 'state', name);
}
