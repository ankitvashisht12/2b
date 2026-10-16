import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialize } from '../src/frontmatter.ts';

test('round-trips plain, tricky, and list values', () => {
  const fields = {
    title: 'PR 102: fix "limiter" #retry',
    status: 'doing',
    due: null,
    started: '2026-10-15',
    repo: '~/code/app',
    answer: 'yes',
    note: 'dash --- inside',
    prs: ['https://github.com/o/r/pull/102'],
    links: [{ to: 'eval-system', type: 'related' }],
  };
  const text = serialize(fields, '\n# Body\n');
  assert.deepEqual(parse(text), { fields, body: '\n# Body\n' });
});

test('text without frontmatter is all body', () => {
  assert.deepEqual(parse('# Only body\n'), { fields: {}, body: '# Only body\n' });
});

test('a value that is not one-line JSON names its field', () => {
  assert.throws(() => parse('---\nprs: [oops\n---\n'), /prs/);
});
