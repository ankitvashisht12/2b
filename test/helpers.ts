import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initStore } from '../src/store.ts';

export function makeStore(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2b-'));
  initStore(root);
  return root;
}
