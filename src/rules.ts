import fs from 'node:fs';
import path from 'node:path';
import { UserError, type Entry } from './store.ts';

export type Level = 'global' | 'project' | 'task';
export type Rule = { level: Level; key: string | null; text: string };

const RULE_LINE = /^- (?:\[([a-z0-9-]+)\] )?(.+)$/;

export function assertRuleKey(key: string): void {
  if (!/^[a-z0-9-]+$/.test(key)) throw new UserError(`rule key "${key}" must use lowercase letters, digits, and hyphens`);
}

export function parseRules(text: string, level: Level): Rule[] {
  return text.split('\n').flatMap(line => {
    const match = line.match(RULE_LINE);
    return match ? [{ level, key: match[1] ?? null, text: match[2].trim() }] : [];
  });
}

export function mergeRules(globalRules: Rule[], projectRules: Rule[], taskRules: Rule[]): Rule[] {
  const seenKeys = new Set<string>();
  return [...taskRules, ...projectRules, ...globalRules].filter(rule => {
    if (!rule.key) return true;
    if (seenKeys.has(rule.key)) return false;
    seenKeys.add(rule.key);
    return true;
  });
}

export function rulesFile(root: string, entry: Entry | null): string {
  return entry ? path.join(entry.dir, 'rules.md') : path.join(root, 'rules.md');
}

function readRules(file: string, level: Level): Rule[] {
  return fs.existsSync(file) ? parseRules(fs.readFileSync(file, 'utf8'), level) : [];
}

export function rulesFor(root: string, entry: Entry | null): Rule[] {
  const globalRules = readRules(path.join(root, 'rules.md'), 'global');
  if (!entry) return globalRules;
  const projectRules = readRules(path.join(root, 'projects', entry.project, 'rules.md'), 'project');
  const taskRules = entry.kind === 'task' ? readRules(path.join(entry.dir, 'rules.md'), 'task') : [];
  return mergeRules(globalRules, projectRules, taskRules);
}

export function formatRules(rules: Rule[]): string {
  if (rules.length === 0) return 'No rules.';
  return [
    'If rules conflict, the more specific level wins (task > project > global).',
    ...rules.map(rule => `- (${rule.level}) ${rule.key ? `[${rule.key}] ` : ''}${rule.text}`),
  ].join('\n');
}

export function addRule(file: string, key: string | null, text: string): void {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : ['# Rules', ''];
  const newLine = `- ${key ? `[${key}] ` : ''}${text.replace(/\s+/g, ' ').trim()}`;
  const existingIndex = key ? lines.findIndex(line => line.startsWith(`- [${key}] `)) : -1;
  if (existingIndex >= 0) {
    lines[existingIndex] = newLine;
  } else {
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    lines.push(newLine, '');
  }
  fs.writeFileSync(file, lines.join('\n'));
}

export function removeRule(file: string, keyOrText: string): boolean {
  if (!fs.existsSync(file)) return false;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const index = lines.findIndex(line => line.startsWith(`- [${keyOrText}] `) || line === `- ${keyOrText}`);
  if (index < 0) return false;
  lines.splice(index, 1);
  fs.writeFileSync(file, lines.join('\n'));
  return true;
}
