import fs from 'node:fs';
import path from 'node:path';
import { UserError } from './store.ts';

export type FindHit = { file: string; line: number; text: string };

const TEXT_EXTENSIONS = new Set(['.md', '.html', '.json', '.jsonl', '.txt', '.csv', '.ts', '.tsx', '.js', '.mjs', '.py', '.yaml', '.yml', '.diff', '.log']);
const SKIPPED_FOLDERS = new Set(['.git', '.obsidian', 'node_modules', 'runs']);
const MAX_FILE_BYTES = 2_000_000;
const MAX_HITS_PER_FILE = 3;

export function findInStore(root: string, query: string, limit = 100): FindHit[] {
  if (!query.trim()) throw new UserError('search text is empty');
  const needle = query.toLowerCase();
  const hits: FindHit[] = [];
  const visit = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (hits.length >= limit) return;
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(item.name)) visit(fullPath);
        continue;
      }
      if (!item.isFile()) continue;
      const relativePath = path.relative(root, fullPath);
      if (relativePath.toLowerCase().includes(needle)) hits.push({ file: relativePath, line: 0, text: '(file name)' });
      if (!TEXT_EXTENSIONS.has(path.extname(item.name).toLowerCase()) || fs.statSync(fullPath).size > MAX_FILE_BYTES) continue;
      let hitsInFile = 0;
      fs.readFileSync(fullPath, 'utf8').split('\n').forEach((text, index) => {
        if (hitsInFile >= MAX_HITS_PER_FILE || hits.length >= limit || !text.toLowerCase().includes(needle)) return;
        hitsInFile += 1;
        hits.push({ file: relativePath, line: index + 1, text: text.trim().slice(0, 160) });
      });
    }
  };
  visit(root);
  return hits;
}
