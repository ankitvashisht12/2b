import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, type Page, type Route } from '@playwright/test';

// Progressive loading checks: Today renders from /api/startup while /api/state is held back.
// Default: an isolated fixture vault and app home; the real vault is never opened.
// `--measure URL`: time a cold Today against a running 2b server. Only GET requests reach it.
// Add `--baseline` to block /api/startup, so the app reads the full vault first, as before.
const baseline = process.argv.includes('--baseline');
const measureUrl = process.argv.includes('--measure') ? process.argv[process.argv.indexOf('--measure') + 1] || 'http://127.0.0.1:4423' : null;
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), '2bv3-progressive-')));
process.env.TWOB_APP_HOME = path.join(temporary, 'app');

// The current source, built to a temporary folder, so dash-v3/dist stays untouched.
const ui = path.join(temporary, 'ui');
execFileSync('npx', ['vite', 'build', '--config', 'dash-v3/vite.config.ts', '--outDir', ui, '--emptyOutDir', '--logLevel', 'error'], { stdio: 'inherit' });

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

/** Serve the temporary build for every non-API request; `api` handles API requests. */
async function openPage(base: string, api: (route: Route) => Promise<void> | void = route => route.continue()) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(base + '/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/api/')) return api(route);
    const file = path.join(ui, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(ui) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: MIME[path.extname(file)] ?? 'application/octet-stream' });
  });
  return { page, errors };
}

const gate = () => { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; };
const checks: string[] = [];
const check = (name: string) => { checks.push(name); console.log('ok -', name); };

try {
  if (measureUrl) await measure(measureUrl);
  else await regressions();
} finally {
  await browser.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}

async function measure(base: string) {
  const runs: unknown[] = [];
  for (let run = 0; run < 3; run++) {
    const sizes: Record<string, number> = {};
    const { page } = await openPage(base, async route => {
      if (route.request().method() !== 'GET') return route.abort();
      if (baseline && route.request().url().includes('/api/startup')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      try {
        const response = await route.fetch();
        const body = await response.body();
        sizes[new URL(route.request().url()).pathname + new URL(route.request().url()).search] = body.length;
        await route.fulfill({ response, body });
      } catch { /* the page closed while the request ran */ }
    });
    const started = Date.now();
    await page.goto(base + '/#today');
    await page.getByRole('heading', { level: 1, name: 'Today', exact: true }).waitFor();
    const title = Date.now() - started;
    await page.locator('main').getByRole('checkbox').first().waitFor();
    const actionable = Date.now() - started;
    const rows = await page.locator('main').getByRole('checkbox').count();
    await page.locator('[data-slot="sidebar"]').getByText(/items in vault$/).waitFor({ timeout: 60_000 });
    const complete = Date.now() - started;
    runs.push({ title, actionable, rows, complete, sizes });
    await page.close();
  }
  console.log(JSON.stringify(runs, null, 2));
}

async function regressions() {
  const { startDashboard, createObject } = await import('../src/v3/server.ts');
  const { metadataDirectory } = await import('../src/v3/config.ts');
  const root = path.join(temporary, 'vault');
  const app = await startDashboard(root, 0);
  const base = `http://127.0.0.1:${app.port}`;
  const store = app.store;
  try {
    const istDay = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + offset * 86_400_000));
    const home = await createObject(store, root, { type: 'project', name: 'Home fixture', tags: ['personal'], properties: { kind: 'finite', area: 'personal' } });
    await createObject(store, root, { type: 'task', name: 'Overdue work task', tags: ['work'], properties: { due: istDay(-2), status: 'todo' } });
    await createObject(store, root, { type: 'task', name: 'Paint the balcony', tags: ['personal'], properties: { status: 'doing' } });
    const inboxNote = await createObject(store, root, { type: 'note', name: 'Inbox thought fixture', tags: ['personal'], properties: { processingState: 'inbox' }, body: '# Inbox thought fixture\n' });
    const reading = await createObject(store, root, { type: 'note', name: 'Reading fixture', tags: ['work'], body: '# Reading fixture\n' });
    for (let index = 0; index < 5; index++) await createObject(store, root, { type: 'artifact', name: `bulk-file-${index}.json`, tags: ['work'] });

    // 1. Today is usable while the full vault is held back. Edits made meanwhile survive the late snapshot.
    const snapshotGate = gate();
    const snapshotTaken = gate();
    const releaseGate = gate();
    const { page, errors } = await openPage(base, async route => {
      if (!route.request().url().includes('/api/state')) return route.continue();
      await snapshotGate.promise;
      const response = await route.fetch();
      snapshotTaken.open();
      await releaseGate.promise;
      await route.fulfill({ response }).catch(() => {});
    });
    const main = page.locator('main');
    await page.goto(base + '/#today');
    await expect(page.getByRole('heading', { level: 1, name: 'Today', exact: true })).toBeVisible();
    await expect(main.getByRole('checkbox', { name: 'Complete Overdue work task' })).toBeVisible();
    await expect(main.getByText('Files and older history are still loading')).toBeVisible();
    await main.getByRole('checkbox', { name: 'Complete Paint the balcony' }).click();
    await expect.poll(async () => (await store.get((await store.list({ search: 'Paint the balcony' }))[0].id))!.properties.status).toBe('done');
    check('Today: title, overdue task, and loading note show before /api/state; a task completes');

    await page.goto(base + '/#library');
    await expect(main.getByText('Loading the library…')).toBeVisible();
    await expect(main.getByText(/No items|empty/i)).toHaveCount(0);
    await page.goto(base + '/#item/' + reading.id);
    await expect(main.getByText('Loading this item…')).toBeVisible();
    await expect(main.getByText(/not in the vault/)).toHaveCount(0);
    check('Library and item deep link: honest loading state, no false empty or not-found');

    // Process the Inbox note into a project (adds a link), let the snapshot read it, then undo (removes the link).
    await page.goto(base + '/#inbox');
    await main.getByRole('button', { name: 'Process “Inbox thought fixture”' }).click();
    const dialog = page.getByRole('dialog', { name: 'Process' });
    await dialog.getByRole('combobox', { name: 'Type' }).click();
    await page.getByRole('option', { name: 'Task', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Project or collection' }).click();
    await page.getByRole('option', { name: /Home fixture/ }).click();
    await dialog.getByRole('button', { name: 'Save and mark processed' }).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(async () => (await store.relationships(inboxNote.id)).length).toBe(1);
    snapshotGate.open();
    await snapshotTaken.promise;
    await page.keyboard.press('Meta+z');
    await expect.poll(async () => (await store.relationships(inboxNote.id)).length).toBe(0);
    await expect(main.getByRole('link', { name: 'Inbox thought fixture' })).toBeVisible();
    await page.getByRole('button', { name: 'New item', exact: true }).click();
    const captureDialog = page.getByRole('dialog', { name: 'New item' });
    await captureDialog.getByLabel('Name', { exact: true }).fill('Captured during load');
    await captureDialog.getByRole('button', { name: 'Save to Inbox' }).click();
    await expect(captureDialog).not.toBeVisible();
    releaseGate.open();
    await expect(main.getByText('Files and older history are still loading')).toHaveCount(0);
    await expect(main.getByRole('link', { name: 'Captured during load' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Inbox thought fixture' })).toBeVisible();
    await page.goto(base + '/#item/' + home.id);
    await expect(page.getByRole('heading', { level: 1, name: 'Home fixture' })).toBeVisible();
    await expect(main.getByText('Inbox thought fixture')).toHaveCount(0);
    check('Late snapshot: a capture, an undone process, and a removed link made during load survive it');
    expect(errors).toEqual([]);
    await page.close();

    // 2. The full vault fails: Today stays usable; Library offers Try again, which loads it.
    let failures = 1;
    const failing = await openPage(base, async route => {
      if (route.request().url().includes('/api/state') && failures-- > 0) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Store is busy' }) });
      return route.continue();
    });
    await failing.page.goto(base + '/#today');
    await expect(failing.page.getByText('The full vault did not load: Store is busy.')).toBeVisible();
    await expect(failing.page.locator('main').getByRole('checkbox', { name: 'Complete Overdue work task' })).toBeVisible();
    await failing.page.goto(base + '/#library');
    await expect(failing.page.getByRole('heading', { level: 1, name: 'Library did not load' })).toBeVisible();
    await failing.page.locator('main').getByRole('button', { name: 'Try again' }).click();
    await expect(failing.page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    await expect(failing.page.locator('main').getByText('Reading fixture')).toBeVisible();
    check('Full vault error: Today stays usable; Library shows the error and Try again loads it');
    await failing.page.close();

    // 3. Two reloads: the slow, older response comes last and is dropped.
    let held: ReturnType<typeof gate> | null = null;
    const staleTaken = gate();
    const ordered = await openPage(base, async route => {
      if (!route.request().url().includes('/api/state') || !held) return route.continue();
      const wait = held;
      held = null;
      const response = await route.fetch();
      staleTaken.open();
      await wait.promise;
      await route.fulfill({ response }).catch(() => {});
    });
    await ordered.page.goto(base + '/#settings');
    await expect(ordered.page.locator('[data-slot="sidebar"]').getByText(/items in vault$/)).toBeVisible();
    await expect(ordered.page.getByText('Files and older history are still loading')).toHaveCount(0);
    const slow = gate();
    held = slow;
    await ordered.page.getByRole('button', { name: 'Reload items' }).click();
    await staleTaken.promise;
    await createObject(store, root, { type: 'note', name: 'Written by another client', tags: ['work'] });
    await ordered.page.getByRole('button', { name: 'Reload items' }).click();
    await ordered.page.goto(base + '/#library');
    await expect(ordered.page.locator('main').getByText('Written by another client')).toBeVisible();
    slow.open();
    await ordered.page.waitForTimeout(300);
    await expect(ordered.page.locator('main').getByText('Written by another client')).toBeVisible();
    check('Reload ordering: the latest request wins over an older, slower one');
    await ordered.page.close();

    console.log(`PASS: ${checks.length} progressive loading checks.`);
  } finally {
    await new Promise<void>(resolve => app.server.close(() => resolve()));
    try { const state = JSON.parse(fs.readFileSync(path.join(metadataDirectory(root), 'server.json'), 'utf8')); process.kill(state.pid, 'SIGTERM'); } catch {}
  }
}
