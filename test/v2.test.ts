import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeStore } from './helpers.ts';
import { createProject, createTask, createCollection, createCollectionNote, listNotes, resolve, addArtifact, reverseLinks, writeEntry } from '../src/store.ts';
import { createReminder, listReminders, cancelReminder, dispatchReminders, reminderTime, nextReminderTime, reminderDir } from '../src/reminders.ts';
import { syncSchedules, buildPrompt, agentArgv } from '../src/schedule.ts';
import { readAllEvents } from '../src/week.ts';
import { checkStore } from '../src/check.ts';
import { startDashboard, dashboardState, entryDetail } from '../src/dash.ts';

process.env.TWOB_NO_NOTIFY = '1';
const now = new Date('2030-01-01T00:00:00Z');
function setup() {
  const root = makeStore();
  createProject(root, 'sample', { area: 'personal', body: 'A project for testing.' });
  return root;
}

test('collections hold notes and files without tasks, with source links when needed', () => {
  const root = setup();
  const collection = createCollection(root, 'sample', 'research', { title: 'Research' });
  const direct = createCollectionNote(root, collection.id, 'first', { body: 'An independent note.', type: 'research' });
  assert.equal(resolve(root, direct.id).body.includes('independent'), true);
  assert.equal(listNotes(root, collection.id).length, 1);
  const task = createTask(root, 'sample', 'digest', { every: 'hourly', body: 'Write the digest.', output: collection.id });
  assert.equal(task.fields.agent, 'codex');
  assert.match(buildPrompt(root, task), /Save output in collection sample\/collections\/research/);
  assert.equal(agentArgv('codex', 'Summarize', root)[0], 'codex');
  const note = createCollectionNote(root, collection.id, 'digest', { source: task.id });
  assert.ok(reverseLinks(root, note.id).some(link => link.from === task.id && link.type === 'produces'));
  addArtifact(collection, 'report.html', { about: 'Report', why: 'Share findings' });
  assert.equal(entryDetail(root, collection.id).artifacts.html.length, 1);
  assert.equal(dashboardState(root).collections.length, 1);
  assert.equal(dashboardState(root).notes.length, 2);
  assert.ok(readAllEvents(root).some(event => event.entry === note.id && event.event === 'note created'));
  assert.deepEqual(checkStore(root), []);
  assert.throws(() => createCollectionNote(root, collection.id, 'bad', { source: collection.id }), /source must/);
  assert.throws(() => createTask(root, 'sample', 'bad', { output: note.id }), /output must/);
  assert.throws(() => createCollectionNote(root, collection.id, '../escape'), /lowercase/);
});

test('one-time reminders catch up after downtime and dispatch only once', () => {
  const root = makeStore();
  const reminder = createReminder(root, 'dentist', { message: 'Call dentist', at: '2030-01-01 10:00', timezone: 'Asia/Kolkata' }, now);
  assert.equal(reminder.nextAt, '2030-01-01T04:30:00.000Z');
  assert.equal(reminder.project, null);
  let deliveries = 0;
  assert.deepEqual(dispatchReminders(root, now, () => { deliveries += 1; }).sent, []);
  assert.deepEqual(dispatchReminders(root, new Date('2030-01-02T00:00:00Z'), () => { deliveries += 1; }).sent, [reminder.id]);
  dispatchReminders(root, new Date('2030-01-03T00:00:00Z'), () => { deliveries += 1; });
  assert.equal(deliveries, 1);
  assert.equal(listReminders(root)[0].status, 'sent');
  assert.ok(readAllEvents(root).some(event => event.event === 'reminder sent'));
  assert.throws(() => cancelReminder(root, reminder.id), /already sent/);
  assert.deepEqual(checkStore(root), []);
});

test('repeat reminders keep timezone, retry failures, cancel, and preserve history', () => {
  const root = setup();
  const task = createTask(root, 'sample', 'review');
  const reminder = createReminder(root, 'review', { message: 'Review', every: 'daily 10:00', timezone: 'Asia/Kolkata', task: task.id }, now);
  const due = new Date('2030-01-01T05:00:00Z');
  assert.deepEqual(dispatchReminders(root, due, () => { throw new Error('delivery unavailable'); }).failed, [reminder.id]);
  assert.equal(listReminders(root)[0].lastError, 'delivery unavailable');
  assert.equal(listReminders(root)[0].project, 'sample');
  assert.deepEqual(dispatchReminders(root, due, () => {}).sent, [reminder.id]);
  assert.equal(listReminders(root)[0].nextAt, '2030-01-02T04:30:00.000Z');
  cancelReminder(root, reminder.id);
  assert.deepEqual(dispatchReminders(root, new Date('2030-02-01'), () => { throw new Error('cancelled'); }), { sent: [], failed: [] });
  const history = fs.readFileSync(path.join(reminderDir(root, reminder.id), 'log.md'), 'utf8');
  assert.match(history, /reminder failed[\s\S]*reminder sent[\s\S]*reminder cancelled/);
});

test('reminder validation and daylight saving transitions', () => {
  const root = setup();
  for (const options of [
    { message: 'Bad' }, { message: 'Bad', at: '2020-01-01 10:00' },
    { message: 'Bad', at: '2030-02-30 10:00', timezone: 'UTC' },
    { message: 'Bad', every: 'hourly', timezone: 'Moon/Base' },
    { message: 'Bad', at: '2030-01-02 10:00', every: 'hourly' },
  ]) assert.throws(() => createReminder(root, 'bad', options, now));
  assert.throws(() => reminderTime('2026-03-08 02:30', 'America/New_York'), /skipped/);
  assert.equal(nextReminderTime('daily 09:00', 'America/New_York', new Date('2026-03-07T15:00:00Z')).toISOString(), '2026-03-08T13:00:00.000Z');
  assert.equal(nextReminderTime('mon 10:00', 'Asia/Kolkata', new Date('2030-01-01T00:00:00Z')).toISOString(), '2030-01-07T04:30:00.000Z');
});

test('reminder scheduler uses one store-specific worker and removes it after cancellation', () => {
  const root = makeStore();
  const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), '2b-v2-agents-'));
  const reminder = createReminder(root, 'ping', { message: 'Ping', every: 'hourly' }, now);
  const result = syncSchedules(root, { agentsDir, load: false });
  assert.equal(result.written.length, 1);
  const plist = fs.readFileSync(path.join(agentsDir, result.written[0] + '.plist'), 'utf8');
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>StartInterval<\/key><integer>60<\/integer>/);
  assert.match(plist, /<string>reminder<\/string>[\s\S]*<string>dispatch<\/string>/);
  cancelReminder(root, reminder.id);
  assert.equal(syncSchedules(root, { agentsDir, load: false }).removed.length, 1);
});

test('dashboard creates and reads content and reminders, validates links and cancels reminders', async context => {
  const root = setup();
  const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), '2b-v2-agents-'));
  const server = startDashboard(root, 0, { agentsDir, load: false });
  await new Promise<void>(accept => server.once('listening', accept));
  context.after(() => new Promise<void>(accept => server.close(() => accept())));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const post = async (route: string, body: unknown) => {
    const response = await fetch(base + route, { method: 'POST', headers: { 'X-2b': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const collection = await post('/api/collection', { project: 'sample', slug: 'journal', title: 'Journal', body: 'Daily entries' });
  assert.equal(collection.status, 200);
  const note = await post('/api/note', { collection: collection.body.entry.id, slug: 'today', body: 'A good day', type: 'journal' });
  assert.equal(note.status, 200);
  assert.equal((await post('/api/note', { collection: collection.body.entry.id, slug: '../escape' })).status, 400);
  const reminder = await post('/api/reminder', { slug: 'call', message: 'Call dentist', at: '2099-01-01 10:00', timezone: 'Asia/Kolkata' });
  assert.equal(reminder.status, 200);
  assert.equal((await post('/api/reminder', { slug: 'bad', message: 'Bad', every: 'hourly', task: 'missing' })).status, 400);
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.reminders.length, 1);
  assert.equal(state.collections.length, 1);
  assert.equal(state.notes.length, 1);
  const detail = await (await fetch(base + '/api/entry?id=' + encodeURIComponent(collection.body.entry.id))).json();
  assert.equal(detail.notes[0].id, note.body.entry.id);
  assert.equal((await post('/api/reminder/cancel', { id: reminder.body.reminder.id })).body.reminder.status, 'cancelled');
  assert.match((await (await fetch(base + '/api/reminders')).json()).reminders[0].history, /cancelled/);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), '2b-outside-'));
  fs.symlinkSync(outside, path.join(root, 'reminders', 'escape'));
  assert.equal((await post('/api/reminder', { slug: 'escape', message: 'Bad', every: 'hourly' })).status, 404);
});

test('v2 CLI works with an existing store and does not require a task for notes', () => {
  const root = setup();
  const run = (...args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(import.meta.dirname, '../src/cli.ts'), ...args], {
    encoding: 'utf8', env: { ...process.env, TWOB_HOME: root, TWOB_NO_NOTIFY: '1' }, timeout: 5000,
  });
  assert.equal(run('new', 'collection', 'sample', 'notes', '--body', 'Notes').status, 0);
  assert.equal(run('note', 'add', 'sample/collections/notes', 'today', '--body', 'A useful note').status, 0);
  assert.equal(JSON.parse(run('note', 'ls', '--json').stdout).length, 1);
  assert.equal(JSON.parse(run('show', 'sample', '--json').stdout).collections.length, 1);
  assert.match(run('find', 'useful').stdout, /useful/);
  assert.equal(run('note', 'edit', 'sample/collections/notes/notes/today', '--body', 'Revised note').status, 0);
  assert.match(run('show', 'sample/collections/notes/notes/today', '--json').stdout, /Revised note/);
  assert.equal(run('--version').stdout.trim(), JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  assert.equal(run('check').stdout.trim(), 'No problems.');
});

test('daily reminders use one occurrence during a repeated daylight saving hour', () => {
  assert.equal(reminderTime('2026-11-01 01:30', 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(reminderTime('2026-11-01T01:30:00-05:00', 'America/New_York').toISOString(), '2026-11-01T06:30:00.000Z');
  assert.equal(nextReminderTime('daily 01:30', 'America/New_York', new Date('2026-11-01T05:31:00Z')).toISOString(), '2026-11-02T06:30:00.000Z');
  assert.throws(() => reminderTime('2030-02-30T10:00:00Z', 'UTC'), /yyyy-mm-dd/);
});

test('dispatch respects a live process lock and recovers a stale lock', () => {
  const root = makeStore();
  createReminder(root, 'locked', { message: 'Locked', at: '2030-01-02 10:00', timezone: 'UTC' }, now);
  const lock = path.join(root, 'reminders', '.dispatch.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
  assert.deepEqual(dispatchReminders(root, new Date('2030-01-03'), () => { throw new Error('live lock'); }), { sent: [], failed: [] });
  fs.writeFileSync(path.join(lock, 'pid'), '999999999');
  assert.equal(dispatchReminders(root, new Date('2030-01-03'), () => {}).sent.length, 1);
  assert.equal(fs.existsSync(lock), false);
});

test('check reports damaged collection and reminder metadata', () => {
  const root = setup();
  const collection = createCollection(root, 'sample', 'notes');
  const task = createTask(root, 'sample', 'review');
  task.fields.output = task.id;
  writeEntry(task);
  fs.writeFileSync(path.join(collection.dir, 'readme.md'), '---\nlinks: [bad\n---\n');
  const dir = path.join(root, 'reminders', 'bad');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'readme.md'), '---\nmessage: [bad\n---\n');
  const problems = checkStore(root).join('\n');
  assert.match(problems, /output must be a collection/);
  assert.match(problems, /links/);
  assert.match(problems, /reminders\/bad/);
});
