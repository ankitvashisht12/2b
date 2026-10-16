import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeStore } from './helpers.ts';
import { createProject, createTask } from '../src/store.ts';
import { addRule, removeRule, rulesFor, rulesFile, formatRules } from '../src/rules.ts';

test('a task rule with the same key replaces the global rule', () => {
  const root = makeStore();
  const project = createProject(root, 'p', { area: 'work' });
  const task = createTask(root, 'p', 't');
  addRule(rulesFile(root, null), 'tsc', 'Run tsc checks one at a time.');
  addRule(rulesFile(root, null), null, 'Keep answers short.');
  addRule(rulesFile(root, project), null, 'Use the staging database.');
  addRule(rulesFile(root, task), 'tsc', 'Do not run tsc checks.');

  assert.deepEqual(rulesFor(root, task), [
    { level: 'task', key: 'tsc', text: 'Do not run tsc checks.' },
    { level: 'project', key: null, text: 'Use the staging database.' },
    { level: 'global', key: null, text: 'Keep answers short.' },
  ]);
  assert.equal(rulesFor(root, project).find(rule => rule.key === 'tsc')?.text, 'Run tsc checks one at a time.');
  assert.match(formatRules(rulesFor(root, task)), /more specific level wins[\s\S]*- \(task\) \[tsc\] Do not run tsc checks\./);
});

test('adding a rule with an existing key replaces it in place; remove works by key or text', () => {
  const root = makeStore();
  const file = rulesFile(root, null);
  addRule(file, 'tsc', 'first');
  addRule(file, 'tsc', 'second');
  addRule(file, null, 'plain rule');
  assert.equal(fs.readFileSync(file, 'utf8').match(/\[tsc\]/g)?.length, 1);
  assert.ok(removeRule(file, 'tsc'));
  assert.ok(removeRule(file, 'plain rule'));
  assert.equal(removeRule(file, 'missing'), false);
  assert.deepEqual(rulesFor(root, null), []);
  assert.equal(path.basename(file), 'rules.md');
});
