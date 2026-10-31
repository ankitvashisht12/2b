import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { startDashboard } from '../src/v3/server.ts';
import type { ObjectRecord, Relationship } from '../src/v3/models.ts';

// Graph checks on an isolated fixture vault. The real vault and the source vaults are never opened.
// By default the page comes from the Vite dev server, so this check does not need or change dash-v3/dist.
// `--dist` uses the built bundle that the 2b server serves.
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), '2bv3-graph-')));
process.env.TWOB_APP_HOME = path.join(temporary, 'app');
const root = path.join(temporary, 'vault');
const app = await startDashboard(root, 0);
const store = app.store;
const apiUrl = `http://127.0.0.1:${app.port}`;
const useDist = process.argv.includes('--dist');
process.env.TWOB_API = apiUrl;
const vite = useDist ? null : await createServer({ configFile: path.resolve('dash-v3/vite.config.ts'), logLevel: 'warn', server: { port: 5199, strictPort: false } });
if (vite) await vite.listen();
const url = vite ? vite.resolvedUrls!.local[0].replace(/\/$/, '') : apiUrl;
const evidence = path.resolve('local/validation/graph');
fs.mkdirSync(evidence, { recursive: true });

// ---------- fixture ----------
const now = new Date().toISOString();
const record = (id: string, type: string, name: string, tags: string[], properties: Record<string, unknown> = {}): ObjectRecord =>
  ({ id, type, name, description: '', tags, path: null, createdAt: now, modifiedAt: now, properties });
let relationCount = 0;
const relation = (from: string, kind: string, to: string): Relationship => ({ id: 'fixture-relation-' + relationCount++, from, kind, to, properties: {} });

await store.defineType({ id: 'evidence', name: 'evidence', description: 'Imported evidence and logs', properties: [] });
await store.defineType({ id: 'tag', name: 'tag', description: 'A tag', properties: [] });
const HUB_LINKS = 2500;
const records = [
  record('hub', 'task', 'AI Analytics fixture hub', ['work']),
  record('cross-work', 'note', 'Cross work note', ['work']),
  record('cross-personal', 'note', 'Cross personal note', ['personal']),
  record('both-project', 'project', 'Shared project', ['work', 'personal']),
  record('fixture-tag', 'tag', 'fixturetag', []),
  record('fixture-log', 'evidence', 'Fixture log file', ['work']),
  record('alone', 'note', 'Isolated note', ['work']),
];
const relations = [
  relation('cross-work', 'links-to', 'cross-personal'),
  relation('cross-work', 'part-of', 'both-project'),
  relation('cross-personal', 'part-of', 'both-project'),
  relation('cross-work', 'tagged-with', 'fixture-tag'),
  relation('cross-personal', 'tagged-with', 'fixture-tag'),
  relation('fixture-log', 'part-of', 'cross-work'),
  relation('cross-work', 'mentions', 'hub'),
];
for (let index = 0; index < HUB_LINKS; index++) {
  records.push(record('spoke-' + index, 'note', `Spoke note ${index}`, [index % 2 ? 'work' : 'personal']));
  relations.push(relation('spoke-' + index, 'part-of', 'hub'));
  if (index % 5) relations.push(relation('spoke-' + index, 'links-to', 'spoke-' + (index - 1)));
}
// The database takes a limited request size, so the fixture goes in chunks.
for (let start = 0; start < records.length; start += 500) await store.upsertMany(records.slice(start, start + 500));
for (let start = 0; start < relations.length; start += 500) await store.upsertRelationships(relations.slice(start, start + 500));

// ---------- checks ----------
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const checks: string[] = [];
const metrics: Record<string, number> = {};
const check = (name: string) => { checks.push(name); console.log('ok -', name); };
const main = page.locator('main');
const canvasBox = page.locator('[data-graph-canvas]');
const itemList = main.getByRole('region', { name: 'Items in this graph' });
const selectedHeading = () => main.getByRole('region', { name: 'Selected item' }).getByRole('heading', { level: 2 });
const probe = <T,>(script: string) => canvasBox.evaluate((element, body) => new Function('probe', body)((element as any).graphProbe), script) as Promise<T>;
const screenOf = async (id: string) => {
  const box = (await canvasBox.boundingBox())!;
  const point = await probe<{ x: number; y: number } | null>(`return probe.screen(${JSON.stringify(id)})`);
  if (!point) throw new Error('No position for ' + id);
  return { x: box.x + point.x, y: box.y + point.y };
};
const zoom = () => probe<number>('return probe.zoom()');
async function settled(timeout = 20_000) {
  const started = Date.now();
  await expect(canvasBox).toHaveAttribute('data-layout', 'stopped', { timeout });
  const elapsed = Date.now() - started;
  await page.waitForTimeout(350); // the first stop fits the view in 250 ms
  return elapsed;
}
async function openGraph(page: Page, hash: string) {
  const started = Date.now();
  await page.goto(url + '/' + hash);
  await expect(page.locator('[data-graph-canvas] canvas')).toBeVisible({ timeout: 15_000 });
  return Date.now() - started;
}

try {
  await page.goto(url + '/#today');
  await page.evaluate(() => localStorage.setItem('2b.scope', 'all'));

  // Overview: a bounded, honest canvas graph without tags, files, or unlinked items.
  metrics.overviewCanvasMs = await openGraph(page, '#graph');
  await expect(page.getByRole('heading', { level: 1, name: 'Graph' })).toBeVisible();
  await expect(main.getByText(/1,000 of 2,50\d linked items/)).toBeVisible();
  metrics.overviewSettleMs = await settled();
  metrics.overviewLabelsAtFit = await probe<number>('return probe.labels()');
  expect(metrics.overviewLabelsAtFit).toBeLessThanOrEqual(14);
  const finder = main.getByRole('searchbox', { name: 'Find an item in the graph' });
  for (const hidden of ['fixturetag', 'Fixture log file', 'Isolated note']) {
    await finder.fill(hidden);
    await expect(main.getByText('0 matching')).toBeVisible();
  }
  await finder.fill('');
  await page.screenshot({ path: path.join(evidence, 'graph-overview-desktop.png') });
  check('Overview: Canvas graph, 1,000 of all drawn and said, tags, files, and unlinked items left out');

  // Limit: All draws every linked item.
  await main.getByRole('radio', { name: 'All' }).click();
  await expect(main.getByText(/^2,50\d linked items/)).toBeVisible();
  await settled();
  check('Limit: All draws every linked item');

  // Search, then select from the list: the camera centres on the item; the layout does not restart.
  await finder.fill('Cross work');
  await finder.press('Enter');
  await expect(selectedHeading()).toHaveText('Cross work note');
  await expect(canvasBox).toHaveAttribute('data-layout', 'stopped');
  await page.waitForTimeout(300);
  check('Search: Enter selects the first match and keeps the layout still');

  // Zoom buttons and wheel, then Fit.
  const viewBox = (await canvasBox.boundingBox())!;
  const zoomStart = await zoom();
  await main.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(zoom).toBeGreaterThan(zoomStart * 1.4);
  await main.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(zoom).toBeLessThan(zoomStart * 1.1);
  await page.mouse.move(viewBox.x + viewBox.width / 2, viewBox.y + viewBox.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(zoom).toBeGreaterThan(zoomStart * 1.2);
  await main.getByRole('button', { name: 'Fit to view' }).click();
  await expect.poll(zoom).toBeLessThan(zoomStart * 1.2);
  check('Zoom in, zoom out, wheel zoom, and Fit');

  // A small local graph for pointer checks: in the 2,500-spoke cloud the dots overlap at fit zoom.
  await openGraph(page, '#graph/cross-work');
  await settled();
  // Click a node: it is selected and the camera stays.
  const zoomBefore = await zoom();
  const personal = await screenOf('cross-personal');
  await page.mouse.click(personal.x, personal.y);
  await expect(selectedHeading()).toHaveText('Cross personal note');
  expect(await zoom()).toBeCloseTo(zoomBefore, 5);
  const afterClick = await screenOf('cross-personal');
  expect(Math.hypot(afterClick.x - personal.x, afterClick.y - personal.y)).toBeLessThan(2);
  await expect(canvasBox).toHaveAttribute('data-layout', 'stopped');
  check('Node click selects without a camera move or a layout restart');

  // Drag a node: it follows the pointer.
  await page.mouse.move(afterClick.x, afterClick.y);
  await page.mouse.down();
  await page.mouse.move(afterClick.x + 60, afterClick.y + 40, { steps: 8 });
  await page.mouse.move(afterClick.x + 120, afterClick.y + 80, { steps: 8 });
  const dragged = await screenOf('cross-personal');
  await page.mouse.up();
  expect(Math.hypot(dragged.x - afterClick.x - 120, dragged.y - afterClick.y - 80)).toBeLessThan(12);
  check('Drag: the node follows the pointer');
  await settled();

  // Pan: dragging empty space moves the whole view.
  const box = (await canvasBox.boundingBox())!;
  const emptyPoint = { x: box.x + box.width - 30, y: box.y + box.height - 60 };
  const anchorBefore = await screenOf('hub');
  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await page.mouse.down();
  await page.mouse.move(emptyPoint.x - 80, emptyPoint.y - 50, { steps: 10 });
  await page.mouse.up();
  const anchorAfter = await screenOf('hub');
  expect(Math.abs(anchorAfter.x - anchorBefore.x + 80)).toBeLessThan(6);
  expect(Math.abs(anchorAfter.y - anchorBefore.y + 50)).toBeLessThan(6);
  check('Pan: dragging the background moves the view');

  // Stop and run the layout.
  await main.getByRole('button', { name: 'Run the layout again' }).click();
  await expect(canvasBox).toHaveAttribute('data-layout', 'running');
  await main.getByRole('button', { name: 'Stop the layout' }).click();
  await expect(canvasBox).toHaveAttribute('data-layout', 'stopped');
  const pinned = await screenOf('hub');
  await page.waitForTimeout(400);
  expect(await screenOf('hub')).toEqual(pinned);
  await main.getByRole('button', { name: 'Run the layout again' }).click();
  await settled();
  check('Layout: Stop holds every item still; Run starts it again');

  // Keyboard: the list is the Canvas fallback.
  await finder.fill('Shared project');
  await finder.press('Tab');
  await expect(itemList.getByRole('button', { name: /Shared project/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(selectedHeading()).toHaveText('Shared project');
  const linkedHere = main.getByRole('region', { name: 'Selected item' }).getByRole('listitem');
  await expect(linkedHere).toHaveCount(2);
  check('Keyboard: list items select; the selection lists its linked items');

  // Scope: a link shows only when both ends are in the scope.
  await page.locator('header').getByRole('radio', { name: 'Show Work items' }).click();
  await finder.fill('Cross personal');
  await expect(main.getByText('0 matching')).toBeVisible();
  await finder.fill('Shared project');
  await itemList.getByRole('button', { name: /Shared project/ }).click();
  await expect(linkedHere).toHaveCount(1);
  await expect(linkedHere.first()).toContainText('Cross work note');
  check('Scope: Work hides Personal items and their links');

  // Local graph from the selection, out-of-scope focus, and back to the whole graph.
  await main.getByRole('link', { name: 'Show its links' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Shared project' })).toBeVisible();
  await page.goto(url + '/#graph/cross-personal');
  await expect(main.getByText('Not in Work')).toBeVisible();
  await main.getByRole('button', { name: 'Show all scopes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cross personal note' })).toBeVisible();
  await expect(selectedHeading()).toHaveText('Cross personal note');
  await main.getByRole('link', { name: 'Open item' }).click();
  await expect(page).toHaveURL(/#item\/cross-personal$/);
  await page.goto(url + '/#graph/cross-personal');
  await main.getByRole('link', { name: 'Whole graph' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Graph' })).toBeVisible();
  check('Local graph: Show its links, out-of-scope choice, Open item, Whole graph');

  // High degree: 2,500 neighbours stay bounded and responsive.
  metrics.hubCanvasMs = await openGraph(page, '#graph/hub');
  await expect(main.getByText(/^300 of 2,50\d items/)).toBeVisible();
  await main.getByRole('radio', { name: 'All' }).click();
  await expect(main.getByText(/^2,50\d items/)).toBeVisible();
  const hubStarted = Date.now();
  // Frame gaps while the full star lays out: a long gap means the page froze.
  metrics.hubLongestFrameMs = await page.evaluate(() => new Promise<number>(resolve => {
    let last = performance.now(), longest = 0, frames = 0;
    const step = () => { const time = performance.now(); longest = Math.max(longest, time - last); last = time; if (++frames < 90) requestAnimationFrame(step); else resolve(Math.round(longest)); };
    requestAnimationFrame(step);
  }));
  await settled(30_000);
  metrics.hubAllSettleMs = Date.now() - hubStarted;
  await page.screenshot({ path: path.join(evidence, 'graph-hub-all-desktop.png') });
  // The selected hub highlights every neighbour, but labels stay within the zoomed-out budget.
  await expect(selectedHeading()).toHaveText('AI Analytics fixture hub');
  metrics.hubLabelsAtFit = await probe<number>('return probe.labels()');
  expect(metrics.hubLabelsAtFit).toBeGreaterThan(0);
  expect(metrics.hubLabelsAtFit).toBeLessThanOrEqual(14);
  expect(metrics.hubLongestFrameMs).toBeLessThan(500);
  check('High degree: 300 of 2,500 by default; All stays responsive; labels bounded at fit');

  // Tag focus shows tagged items; an item with no links says so.
  await page.goto(url + '/#graph/fixture-tag');
  await expect(itemList.getByRole('button', { name: /Cross work note/ })).toBeVisible();
  await page.goto(url + '/#graph/alone');
  await expect(main.getByText('No links yet')).toBeVisible();
  await page.goto(url + '/#graph/missing-item');
  await expect(main.getByText('This item is not in the vault. The link may be old.')).toBeVisible();
  check('Tag focus, no links, and missing item');

  // Resize: the canvas follows the viewport and the sidebar.
  await openGraph(page, '#graph/cross-work');
  const wide = (await page.locator('[data-graph-canvas] canvas').boundingBox())!.width;
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect.poll(async () => (await page.locator('[data-graph-canvas] canvas').boundingBox())!.width).toBeLessThan(wide - 200);
  const beforeSidebar = (await page.locator('[data-graph-canvas] canvas').boundingBox())!.width;
  await page.locator('header').getByRole('button', { name: 'Toggle Sidebar' }).click();
  await expect.poll(async () => (await page.locator('[data-graph-canvas] canvas').boundingBox())!.width).toBeGreaterThan(beforeSidebar + 100);
  check('Resize: the canvas follows the viewport and the sidebar');

  // Keep a selected item while shrinking the existing desktop canvas: a fresh route hides sizing bugs.
  await openGraph(page, '#graph');
  await itemList.getByRole('button').first().click();
  await expect(main.getByRole('region', { name: 'Selected item' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  for (const name of ['Zoom in', 'Zoom out', 'Fit to view']) {
    const button = (await main.getByRole('button', { name }).boundingBox())!;
    expect(button.x + button.width).toBeLessThanOrEqual(390);
    expect(button.height).toBeGreaterThanOrEqual(40);
  }
  await settled();
  await page.screenshot({ path: path.join(evidence, 'graph-overview-mobile.png'), fullPage: true });
  check('Phone 390: no sideways scroll; zoom and fit buttons usable');

  // Reduced motion: the layout is worked out before the first paint and stays still.
  const still = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  still.on('pageerror', error => errors.push(error.message));
  await still.goto(url + '/#graph');
  await expect(still.locator('[data-graph-canvas]')).toHaveAttribute('data-layout', 'stopped', { timeout: 15_000 });
  const stillBox = still.locator('[data-graph-canvas]');
  const first = await stillBox.evaluate(element => (element as any).graphProbe.screen('hub'));
  await still.waitForTimeout(600);
  expect(await stillBox.evaluate(element => (element as any).graphProbe.screen('hub'))).toEqual(first);
  await still.screenshot({ path: path.join(evidence, 'graph-overview-reduced-motion.png') });
  await still.close();
  check('Reduced motion: no layout movement after the first paint');

  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(evidence, 'graph-results.json'), JSON.stringify({ ok: true, checks, metrics, errors }, null, 2));
  console.log('metrics', metrics);
  console.log(`PASS: ${checks.length} graph checks.`);
} catch (error) {
  await page.screenshot({ path: path.join(evidence, 'graph-failure.png') }).catch(() => {});
  console.error(errors.length ? `Page errors: ${errors.join('\n')}` : 'No page errors.');
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser.close();
  await vite?.close();
  await new Promise<void>(resolve => app.server.close(() => resolve()));
  fs.rmSync(temporary, { recursive: true, force: true });
}
