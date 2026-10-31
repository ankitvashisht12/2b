import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { startDashboard, createObject } from '../src/v3/server.ts';
import { metadataDirectory } from '../src/v3/config.ts';

// Isolated fixture vault and app home. The real vault and the source vaults are never opened.
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), '2bv3-browser-')));
process.env.TWOB_APP_HOME = path.join(temporary, 'app');
const root = path.join(temporary, 'vault');
const serveOnly = process.argv.includes('--serve');
const app = await startDashboard(root, serveOnly ? Number(process.env.PORT || 4499) : 0);
const url = `http://127.0.0.1:${app.port}`;
const store = app.store;

const istDay = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + offset * 86_400_000));
const istTime = (offset: number, clock: string) => new Date(`${istDay(offset)}T${clock}:00+05:30`).toISOString();

async function imported(id: string, type: string, name: string, tags: string[], sourcePath: string, created: string, modified: string, extra: Record<string, unknown> = {}, file?: { path: string; text: string }) {
  if (file) { fs.mkdirSync(path.dirname(path.join(root, file.path)), { recursive: true }); fs.writeFileSync(path.join(root, file.path), file.text); }
  return store.upsert({ id, type, name, description: '', tags, path: file?.path ?? null, createdAt: created, modifiedAt: new Date().toISOString(), properties: { sourceVault: 'legacy', sourcePath, sourceCreatedAt: created, sourceModifiedAt: modified, processingState: 'imported', dateConfidence: 'unknown', ...extra } });
}

async function cleanup() {
  await new Promise<void>(resolve => app.server.close(() => resolve()));
  try { const state = JSON.parse(fs.readFileSync(path.join(metadataDirectory(root), 'server.json'), 'utf8')); process.kill(state.pid, 'SIGTERM'); } catch {}
  fs.rmSync(temporary, { recursive: true, force: true });
}

// ---------- fixture ----------
let fixtureReady = false;
try {
await store.defineType({ id: 'evidence', name: 'evidence', description: 'Imported evidence and logs', properties: [] });
const project = await createObject(store, root, { type: 'project', name: 'Analytics fixture', tags: ['work', 'analytics'], properties: { kind: 'ongoing', area: 'work' } });
const home = await createObject(store, root, { type: 'project', name: 'Home fixture', tags: ['personal', 'home'], properties: { kind: 'finite', area: 'personal' } });
const person = await createObject(store, root, { type: 'person', name: 'Person fixture', tags: ['work'] });
await store.relate(project.id, 'worked-with', person.id);
const overdue = await createObject(store, root, { type: 'task', name: 'Overdue work task', tags: ['work'], properties: { due: istDay(-2), status: 'todo' } });
await store.relate(overdue.id, 'part-of', project.id);
const doing = await createObject(store, root, { type: 'task', name: 'Paint the balcony', tags: ['personal'], properties: { status: 'doing' } });
await store.relate(doing.id, 'part-of', home.id);
await createObject(store, root, { type: 'task', name: 'Ship the weekly report', tags: ['work'], properties: { due: istDay(0), status: 'todo' } });
await createObject(store, root, { type: 'task', name: 'Renew the passport', tags: ['personal'], properties: { due: istDay(3), status: 'todo' } });
await createObject(store, root, { type: 'meeting', name: 'Design review', tags: ['work'], properties: { startsAt: istTime(0, '15:00'), endsAt: istTime(0, '16:00') } });
await createObject(store, root, { type: 'reminder', name: 'Call the plumber', tags: ['personal'], properties: { at: istTime(0, '18:30'), enabled: false } });
await createObject(store, root, { type: 'note', name: 'Inbox thought fixture', tags: ['personal'], properties: { processingState: 'inbox' }, body: '# Inbox thought fixture\n\nTo sort later.' });
const reading = await createObject(store, root, { type: 'note', name: 'Reading fixture', tags: ['work'], body: `# Reading fixture\n\n[[${project.path!.replace(/\.md$/, '')}|Open project]]\n\n| Topic | State |\n| --- | --- |\n| Feedback | Ready |\n\n- [x] Draft written\n- [ ] Review pending\n\n<script>window.injected = true</script>\n` });
const importedTask = await imported('import-fixture-task', 'task', 'Imported migration task', ['work', 'analytics'], 'projects/analytics/tasks/fixture-task/readme.md', istTime(-1, '10:00'), istTime(-1, '16:20'), { status: 'done' });
await imported('import-fixture-project', 'project', 'Imported analytics project', ['work', 'analytics'], 'projects/analytics/readme.md', istTime(-40, '09:00'), istTime(-40, '09:00'), { kind: 'ongoing', status: 'active', area: 'work' });
await store.relate(importedTask.id, 'part-of', project.id);
await imported('import-fixture-log', 'evidence', 'Log', ['work', 'analytics'], 'projects/analytics/tasks/fixture-task/log.md', istTime(-1, '10:00'), istTime(0, '11:00'), { archived: true }, {
  path: 'objects/evidence/fixture-log.md',
  text: `- ${istDay(-1)} 10:05 created | Imported migration task\n- ${istDay(-1)} 12:30 status todo -> doing\n- ${istDay(0)} 09:40 note | Started the regression check from the copied log.\n- ${istDay(0)} 11:00 status doing -> done\n`,
});
for (let index = 0; index < 25; index++) {
  const artifact = await imported(`import-fixture-artifact-${index}`, 'artifact', `review-file-${index}.json`, ['work', 'analytics'], `projects/analytics/tasks/fixture-task/notes/review-file-${index}.json`, istTime(0, '08:15'), istTime(0, '08:15'));
  await store.relate(artifact.id, 'part-of', importedTask.id);
}
await imported('import-fixture-journal', 'note', 'Journal fixture', ['personal'], 'journal/fixture.md', istTime(-1, '21:00'), istTime(-1, '21:00'), { contentDate: istDay(-1) });

fixtureReady = true;
if (serveOnly) {
  console.log(`Fixture dashboard: ${url}  (vault ${root}). Press Ctrl+C to stop.`);
  await new Promise<void>(resolve => { process.once('SIGINT', () => resolve()); process.once('SIGTERM', () => resolve()); });
} else await runBrowserChecks({ project, home, person, overdue, reading });
} finally {
  if (!fixtureReady) console.error('Fixture setup failed.');
  await cleanup();
}

async function runBrowserChecks({ project, home, person, overdue, reading }: Record<'project' | 'home' | 'person' | 'overdue' | 'reading', { id: string; path: string | null }>) {

// ---------- browser checks ----------
const evidence = path.resolve('local/validation'); fs.mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const errors: string[] = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const checks: string[] = [];
const check = (name: string) => { checks.push(name); console.log('ok -', name); };
const heading = (name: string | RegExp) => page.getByRole('heading', { level: 1, name, exact: typeof name === 'string' });
const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
const sidebarLink = (name: string) => page.locator('[data-slot="sidebar"]').getByRole('link', { name, exact: true });
const pressKey = async (key: string) => { await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {}); await page.keyboard.press(key); };

async function capture(target: Page, name: string, values: { type?: string; scope?: 'Work' | 'Personal' | 'None'; body?: string; fields?: Record<string, string> } = {}) {
  await target.keyboard.press('Escape');
  await target.getByRole('button', { name: 'New item', exact: true }).click();
  const dialog = target.getByRole('dialog', { name: 'New item' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  if (values.type) {
    await dialog.getByRole('combobox', { name: 'Type' }).click();
    await target.getByRole('option', { name: values.type, exact: true }).click();
  }
  if (values.scope) await dialog.getByRole('radio', { name: values.scope, exact: true }).click();
  for (const [label, value] of Object.entries(values.fields ?? {})) await dialog.getByLabel(label).fill(value);
  if (values.body) await dialog.getByLabel('Content', { exact: true }).fill(values.body);
  return dialog;
}

try {
  await page.goto(url);
  await expect(heading('Today')).toBeVisible();
  const main = page.locator('main');
  const schedule = main.getByRole('region', { name: 'Schedule' });
  await expect(main.getByRole('checkbox', { name: 'Complete Overdue work task' })).toBeVisible();
  await expect(main.getByRole('checkbox', { name: 'Complete Paint the balcony' })).toBeVisible();
  await expect(schedule.getByText('Design review')).toBeVisible();
  await expect(schedule.getByText('Ship the weekly report')).toBeVisible();
  await expect(main.getByText('Started the regression check from the copied log.')).toBeVisible();
  await expect(main.getByRole('button', { name: /26 artifacts, evidence files, and archived records/ })).toBeVisible();
  await expect(main.getByText('review-file-3.json')).toHaveCount(0);
  await expect(schedule.getByText('Disabled', { exact: true })).toBeVisible();
  check('Today: overdue, in progress, schedule, copied log history, folded artifacts, disabled reminder');
  await page.screenshot({ path: path.join(evidence, 'v3-today-desktop.png'), fullPage: true });

  // Scope is visible, filters every view, and survives a reload.
  await page.getByRole('radio', { name: 'Show Personal items' }).click();
  await expect(main.getByText('Overdue work task')).toHaveCount(0);
  await expect(main.getByRole('checkbox', { name: 'Complete Paint the balcony' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Show Personal items' })).toHaveAttribute('aria-checked', 'true');
  await expect(main.getByText('Design review')).toHaveCount(0);
  await sidebarLink('Projects').click();
  await expect(heading('Projects')).toBeVisible();
  await expect(main.getByRole('link', { name: 'Home fixture' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Analytics fixture' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Show all items' }).click();
  await expect(main.getByRole('link', { name: 'Analytics fixture' })).toBeVisible();
  check('Scope: All / Work / Personal filters Today and Projects and persists across reload');

  // Arrow keys in the scope switch move between scopes only; the day stays.
  await sidebarLink('Today').click();
  await page.getByRole('radio', { name: 'Show all items' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Show Work items' })).toBeFocused();
  await expect(page).toHaveURL(/#today$/);
  await expect(heading('Today')).toBeVisible();
  await page.keyboard.press('Space');
  await page.getByRole('radio', { name: 'Show all items' }).click();
  check('Scope switch arrow keys do not change the day');

  // Day navigation: buttons, keyboard, and the date picker.
  await sidebarLink('Today').click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(heading('Yesterday')).toBeVisible();
  await expect(main.getByText('Imported migration task').first()).toBeVisible();
  await expect(main.getByText('Journal fixture').first()).toBeVisible();
  await pressKey('ArrowRight');
  await expect(heading('Today')).toBeVisible();
  await page.getByRole('button', { name: /Choose a date/ }).click();
  // The picker opens with focus on the shown day, so arrow keys move days at once.
  expect(await page.evaluate(() => document.activeElement?.closest('[role="gridcell"]')?.getAttribute('aria-selected'))).toBe('true');
  await page.getByRole('dialog').getByRole('button', { name: /Previous Month|Go to the Previous Month/i }).click();
  await page.getByRole('dialog').getByRole('gridcell').filter({ hasText: /^15$/ }).first().getByRole('button').click();
  await expect(page).toHaveURL(/#day\/\d{4}-\d{2}-15$/);
  check('Day: previous/next buttons, arrow keys, and date picker');

  // Timeline groups by day with range controls.
  await sidebarLink('Timeline').click();
  await expect(heading('Timeline')).toBeVisible();
  await expect(main.getByRole('heading', { level: 2, name: /^Today/ })).toBeVisible();
  await expect(main.getByText('Started the regression check from the copied log.')).toBeVisible();
  await page.getByRole('radio', { name: '30 days' }).click();
  await expect(page).toHaveURL(/days=30/);
  await page.getByRole('button', { name: 'Earlier' }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=/);
  await page.screenshot({ path: path.join(evidence, 'v3-timeline-desktop.png'), fullPage: true });
  check('Timeline: day groups, log lines, presets, earlier range');

  // Calendar month with visible lines; selecting a day shows its agenda.
  await sidebarLink('Calendar').click();
  await expect(heading('Calendar')).toBeVisible();
  await expect(main.locator('.month-cell-line', { hasText: 'Design review' })).toBeVisible();
  await main.locator('.month-cell[data-today]').click();
  await expect(main.getByRole('region', { name: /^Selected day/ }).getByRole('region', { name: 'Schedule' }).getByText('Ship the weekly report')).toBeVisible();
  // Keyboard in the month: the arrow key moves focus to the next day, Enter selects it, and focus stays in the month.
  const step = Number(istDay(0).slice(8)) > 1 ? -1 : 1;
  await main.locator('.month-cell[data-today]').focus();
  await page.keyboard.press(step < 0 ? 'ArrowLeft' : 'ArrowRight');
  expect(await page.evaluate(() => document.activeElement?.querySelector('.month-cell-date')?.textContent)).toBe(String(Number(istDay(step).slice(8))));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`date=${istDay(step)}`));
  expect(await page.evaluate(() => document.activeElement?.classList.contains('month-cell'))).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`date=${istDay(0)}`));
  await page.screenshot({ path: path.join(evidence, 'v3-calendar-desktop.png'), fullPage: true });
  check('Calendar: month cells show items; selected day agenda; keyboard focus moves and stays; Back returns to the previous day');

  // Capture to Inbox, then process it.
  let dialog = await capture(page, 'Browser captured thought', { scope: 'Work', body: 'A note created through the UI.' });
  await dialog.getByRole('button', { name: 'Save to Inbox' }).click();
  await expect(dialog).not.toBeVisible();
  const captured = (await store.list({ search: 'Browser captured thought' }))[0];
  expect(captured.tags).toContain('work');
  expect(captured.properties.processingState).toBe('inbox');
  await sidebarLink('Inbox').click();
  await expect(main.getByRole('link', { name: 'Browser captured thought' })).toBeVisible();
  await main.getByRole('button', { name: 'Mark “Browser captured thought” processed' }).click();
  await expect(main.getByRole('link', { name: 'Browser captured thought' })).toHaveCount(0);
  expect((await store.get(captured.id))!.properties.processingState).toBe('processed');
  check('Capture with scope to Inbox; Inbox processing');

  // A new type from a button and dialog, with a required field.
  await sidebarLink('Types').click();
  await page.getByRole('button', { name: 'New type' }).click();
  dialog = page.getByRole('dialog', { name: 'New type' });
  await dialog.getByLabel('Name', { exact: true }).fill('Course');
  await expect(dialog.getByLabel('ID', { exact: true })).toHaveValue('course');
  await dialog.getByLabel('Key', { exact: true }).fill('progress');
  await dialog.getByRole('combobox', { name: 'Kind' }).click();
  await page.getByRole('option', { name: 'Number', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add field' }).click();
  await dialog.getByLabel('Key', { exact: true }).nth(1).fill('level');
  await dialog.getByRole('checkbox', { name: 'Required' }).nth(1).click();
  await dialog.getByRole('button', { name: 'Create type' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(main.getByRole('link', { name: 'Course', exact: true })).toBeVisible();
  check('Types: New type button opens a dialog; required field defined');

  dialog = await capture(page, 'A custom course', { type: 'Course' });
  await dialog.getByRole('button', { name: 'Save to Inbox' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Level is required');
  await dialog.getByLabel(/^Level/).fill('Beginner');
  await dialog.getByRole('button', { name: 'Save to Inbox' }).click();
  await expect(dialog).not.toBeVisible();
  check('Capture of a custom type enforces the required field');

  await sidebarLink('Inbox').click();
  await main.getByRole('link', { name: 'A custom course' }).click();
  await expect(heading('A custom course')).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('form', { name: 'Edit A custom course' });
  await edit.getByLabel('Progress', { exact: true }).fill('25');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit).not.toBeVisible();
  const courses = await store.list({ type: 'course' });
  expect(courses.map(course => [course.name, course.properties.progress, course.properties.level])).toEqual([['A custom course', 25, 'Beginner']]);
  await page.reload();
  await expect(heading('A custom course')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Item facts' }).locator('.facts').first()).toContainText('25');
  check('Typed property edit persists through reload');

  // Unsaved edits are not lost by a click on the sidebar.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('form', { name: 'Edit A custom course' }).getByLabel('Description', { exact: true }).fill('Unsaved words');
  await sidebarLink('Library').click();
  const leave = page.getByRole('alertdialog', { name: 'Leave without saving?' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL(/#item\//);
  await expect(page.getByRole('form', { name: 'Edit A custom course' }).getByLabel('Description', { exact: true })).toHaveValue('Unsaved words');
  await page.getByRole('form', { name: 'Edit A custom course' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#item\//);
  await expect.poll(async () => {
    const all = await store.list({ type: 'course' });
    return all.map(course => `${course.name}: ${course.description}`).join(' | ');
  }).toBe('A custom course: Unsaved words');
  check('Leaving with unsaved edits asks first; the text stays');

  // Reading view: Markdown table, wiki link, task boxes, no script.
  await page.goto(url + '/#item/' + encodeURIComponent(reading.id));
  await expect(heading('Reading fixture')).toBeVisible();
  await expect(page.locator('.prose table')).toContainText('Feedback');
  await expect(page.locator('.prose').getByRole('link', { name: 'Open project', exact: true })).toHaveAttribute('href', '#item/' + project.id);
  await expect(page.locator('.prose')).toContainText('<script>window.injected = true</script>');
  expect(await page.evaluate(() => (window as unknown as { injected?: boolean }).injected)).toBeUndefined();
  check('Reader: Markdown table, wiki link, escaped script');

  // Named link and backlink.
  await main.getByRole('button', { name: 'Add link' }).click();
  const linkForm = page.getByRole('form', { name: 'Add a link' });
  await linkForm.getByLabel('Link name').fill('mentions');
  await linkForm.getByRole('combobox', { name: 'To item' }).click();
  await page.getByPlaceholder('Search by name').fill('Person fix');
  await page.getByRole('option', { name: /Person fixture/ }).click();
  await linkForm.getByRole('button', { name: 'Add link' }).click();
  await expect(page.locator('main').getByRole('link', { name: 'Person fixture' })).toBeVisible();
  await page.locator('main').getByRole('link', { name: 'Person fixture' }).click();
  await expect(heading('Person fixture')).toBeVisible();
  await expect(main.getByText('Mentioned in')).toBeVisible();
  await expect(main.getByRole('link', { name: 'Reading fixture' })).toBeVisible();
  check('Named link and backlink');

  // Task completion from Today.
  await sidebarLink('Today').click();
  await main.getByRole('checkbox', { name: 'Complete Overdue work task' }).click();
  await expect.poll(async () => (await store.get(overdue.id))!.properties.status).toBe('done');
  check('Task complete');

  // Tag description from a dialog.
  await sidebarLink('Tags').click();
  await main.getByRole('button', { name: 'Add description for analytics' }).click();
  dialog = page.getByRole('dialog', { name: 'Describe #analytics' });
  await dialog.getByLabel('Description').fill('Work on the analytics product.');
  await dialog.getByRole('button', { name: 'Save description' }).click();
  await expect(main.getByText('Work on the analytics product.')).toBeVisible();
  check('Tag description');

  // Local graph and settings check.
  await page.goto(url + '/#graph/' + encodeURIComponent(project.id));
  await expect(page.locator('[data-graph-canvas] canvas')).toBeVisible({ timeout: 15_000 });
  await sidebarLink('Settings').click();
  await expect(main.getByText('Write the weekly update')).toHaveCount(0);
  await main.getByRole('button', { name: 'Check files now' }).click();
  await expect(main.getByText('Checked', { exact: true })).toBeVisible();
  check('Graph and Settings file check');

  // Search palette with keyboard.
  await pressKey('/');
  await page.getByPlaceholder(/^Search/).fill('Analytics fix');
  await page.getByRole('option', { name: /Analytics fixture/ }).first().click();
  await expect(heading('Analytics fixture')).toBeVisible();
  await expect(main.getByText('Open tasks')).toBeVisible();
  check('Search palette opens items');

  // Fast moves between items never show a stale page or an error.
  const ids = [person.id, reading.id, project.id, person.id, reading.id];
  for (let round = 0; round < 3; round++) for (const id of ids) await page.evaluate(target => { location.hash = '#item/' + encodeURIComponent(target); }, id);
  await expect(heading('Reading fixture')).toBeVisible();
  await expect(page.locator('.prose table')).toContainText('Feedback');
  await expect(page.getByText('Could not open this item')).toHaveCount(0);
  await expect(page.getByText('This page did not load')).toHaveCount(0);
  check('Rapid cross-navigation between items');
  await page.screenshot({ path: path.join(evidence, 'v3-item-desktop.png'), fullPage: true });

  // ---------- P1/P2 flows from the UX reviews ----------
  // Inbox Process: a captured note becomes a task in a project with a due date, in one save. ⌘Z undoes it.
  const inboxNote = (await store.list({ search: 'Inbox thought fixture' }))[0];
  const bodyBefore = fs.readFileSync(path.join(root, inboxNote.path!), 'utf8');
  await page.goto(url + '/#inbox');
  await main.getByRole('button', { name: 'Process “Inbox thought fixture”' }).click();
  dialog = page.getByRole('dialog', { name: 'Process' });
  await dialog.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: 'Task', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Project or collection' }).click();
  await page.getByRole('option', { name: /Home fixture/ }).click();
  await dialog.getByLabel('Due').fill(istDay(2));
  await dialog.getByRole('button', { name: 'Save and mark processed' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(main.getByRole('link', { name: 'Inbox thought fixture' })).toHaveCount(0);
  const converted = (await store.get(inboxNote.id))!;
  expect([converted.type, converted.path, converted.properties.processingState, converted.properties.due, converted.properties.status]).toEqual(['task', inboxNote.path, 'processed', istDay(2), 'todo']);
  expect((await store.relationships(inboxNote.id)).some(relation => relation.kind === 'part-of' && relation.to === home.id)).toBe(true);
  // The text stays; the server adds its generated "Related objects" block for the new link.
  expect(fs.readFileSync(path.join(root, inboxNote.path!), 'utf8').startsWith(bodyBefore)).toBe(true);
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => { const item = (await store.get(inboxNote.id))!; return `${item.type} ${item.properties.processingState}`; }).toBe('note inbox');
  await expect(main.getByRole('link', { name: 'Inbox thought fixture' })).toBeVisible();
  await expect.poll(async () => (await store.relationships(inboxNote.id)).filter(relation => relation.kind === 'part-of' && relation.to === home.id).length).toBe(0);
  check('Inbox Process: note to task in a project with a due date in one save; same ID, file, and content; ⌘Z restores the item and its project links');

  // Project page: "Add task" files the new task in the project. No link name to recall.
  await page.goto(url + '/#item/' + encodeURIComponent(project.id));
  await expect(heading('Analytics fixture')).toBeVisible();
  await main.getByRole('region', { name: 'Open tasks' }).getByRole('button', { name: 'Add task' }).click();
  dialog = page.getByRole('dialog', { name: 'New item' });
  await expect(dialog.getByRole('combobox', { name: 'Project or collection: Analytics fixture' })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Type' })).toContainText('Task');
  await dialog.getByLabel('Name', { exact: true }).fill('Context task fixture');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(main.getByRole('region', { name: 'Open tasks' }).getByRole('link', { name: 'Context task fixture' })).toBeVisible();
  const contextTask = (await store.list({ search: 'Context task fixture' }))[0];
  expect((await store.relationships(contextTask.id)).some(relation => relation.kind === 'part-of' && relation.to === project.id)).toBe(true);
  await expect.poll(async () => { const item = (await store.get(contextTask.id))!; return `${item.type} ${item.properties.processingState}`; }).toBe('task processed');
  check('Project page: Add task saves a task in the project and out of the Inbox');

  // Item page: Mark complete shows the saved state at once; the toast's Undo reopens it.
  const weekly = (await store.list({ search: 'Ship the weekly report' }))[0];
  await page.goto(url + '/#item/' + encodeURIComponent(weekly.id));
  await page.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  expect((await store.get(weekly.id))!.properties.status).toBe('done');
  await page.locator('[data-sonner-toast]').filter({ hasText: 'Completed “Ship the weekly report”' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Mark complete' })).toBeVisible();
  await expect.poll(async () => (await store.get(weekly.id))!.properties.status).toBe('todo');
  check('Item page: Mark complete shows the saved state without a reload; Undo restores it');

  // A project in Work through its area only: Edit starts at Work, has one Scope control, and keeps the area.
  const areaOnly = await createObject(store, root, { type: 'project', name: 'Area only fixture', tags: [], properties: { kind: 'ongoing', area: 'work' } });
  await page.goto(url + '/#item/' + encodeURIComponent(areaOnly.id));
  await expect(heading('Area only fixture')).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const areaForm = page.getByRole('form', { name: 'Edit Area only fixture' });
  await expect(areaForm.getByRole('radio', { name: 'Work' })).toHaveAttribute('aria-checked', 'true');
  await expect(areaForm.getByLabel('Area', { exact: true })).toHaveCount(0);
  await areaForm.getByLabel('Description', { exact: true }).fill('Only the description changes.');
  await areaForm.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(areaForm).not.toBeVisible();
  const areaSaved = (await store.get(areaOnly.id))!;
  expect([areaSaved.properties.area, areaSaved.tags.join(','), areaSaved.description]).toEqual(['work', '', 'Only the description changes.']);
  check('Project scope from area: one Scope control, starts at Work; a description edit keeps the area');

  // Focus returns to the opener; search says when nothing matches; "?" opens the shortcuts.
  await page.getByRole('button', { name: 'New item', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'New item' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'New item', exact: true })).toBeFocused();
  await pressKey('/');
  await page.getByPlaceholder(/^Search/).fill('zzqxv-no-such-item');
  await expect(page.getByText('No item matches “zzqxv-no-such-item”')).toBeVisible();
  await page.keyboard.press('Escape');
  await pressKey('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  check('Focus returns to the opener; search says "No item matches"; ? opens the shortcuts');

  // Long words and long tags do not widen the page or push the top bar off the screen.
  const longItem = await createObject(store, root, { type: 'note', name: 'Long ' + 'x'.repeat(180), description: 'y'.repeat(400), tags: ['t'.repeat(110)] });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width > 500 ? 1000 : 844 });
    await page.goto(url + '/#item/' + encodeURIComponent(longItem.id));
    await expect(heading(/^Long x+/)).toBeVisible();
    await noOverflow();
    expect(await page.getByRole('button', { name: 'New item', exact: true }).evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
  }
  check('Long content: the page and top bar stay inside the viewport at 1440 and 390');

  // Phone 375x667: the New type dialog with fields stays on screen and scrolls to Create type.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(url + '/#types?new=1');
  dialog = page.getByRole('dialog', { name: 'New type' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill('Phone check');
  for (let index = 0; index < 2; index++) await dialog.getByRole('button', { name: 'Add field' }).click();
  const dialogBox = (await dialog.boundingBox())!;
  expect(dialogBox.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(667);
  await dialog.getByRole('button', { name: 'Create type' }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Create type' })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  check('Phone 375x667: New type dialog with three fields fits the screen; Create type is reachable');

  // Phone layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url + '/#today');
  await expect(heading('Today')).toBeVisible();
  await noOverflow();
  await expect(page.getByRole('radio', { name: 'Show Work items' })).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'v3-today-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Inbox', exact: true }).click();
  await expect(heading('Inbox')).toBeVisible();
  await noOverflow();
  await page.goto(url + '/#calendar');
  await expect(heading('Calendar')).toBeVisible();
  await noOverflow();
  await page.goto(url + '/#item/' + encodeURIComponent(reading.id));
  await expect(heading('Reading fixture')).toBeVisible();
  await noOverflow();
  await page.screenshot({ path: path.join(evidence, 'v3-item-mobile.png'), fullPage: true });
  check('Phone: no sideways scroll on Today, Inbox, Calendar, item; scope visible; sidebar sheet');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url + '/#projects');
  await main.getByRole('link', { name: 'Analytics fixture' }).click();
  await expect(heading('Analytics fixture')).toBeVisible();
  // Looping animations stop (at a 1 ms duration they strobe); dialogs fade without a zoom.
  expect(await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'animate-pulse';
    document.body.append(probe);
    const name = getComputedStyle(probe).animationName;
    probe.remove();
    return name;
  })).toBe('none');
  check('Reduced motion: skeleton pulse and spinners stop');

  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(evidence, 'browser-results.json'), JSON.stringify({ ok: true, checks, errors }, null, 2));
  console.log(`PASS: ${checks.length} browser checks.`);
} catch (error) {
  await page.screenshot({ path: path.join(evidence, 'browser-failure.png'), fullPage: true });
  console.error(errors.length ? `Page errors: ${errors.join('\n')}` : 'No page errors.');
  throw error;
} finally {
  await browser.close();
}
}
