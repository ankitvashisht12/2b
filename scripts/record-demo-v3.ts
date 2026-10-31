import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, type Locator, type Page } from '@playwright/test';

// Records the v3 demo video from the fake vault that scripts/demo-v3.ts serves.
// Run that script first, then: node --experimental-strip-types scripts/record-demo-v3.ts [output.mp4]
// Needs ffmpeg. The page is 1280×720, so the text stays readable on a phone. The video is sped up to one minute and scaled to 1920×1080.
const base = process.env.DEMO_URL || 'http://127.0.0.1:4500';
const output = path.resolve(process.argv[2] || 'site/public/2b-v3-demo.mp4');
const videoDirectory = fs.mkdtempSync(path.join(os.tmpdir(), '2b-demo-video-'));

// The title card, captions, end card, terminal, and a soft cursor are drawn over the real dashboard.
const overlay = () => {
  const style = document.createElement('style');
  style.textContent = `
    #demo-card { position: fixed; inset: 0; z-index: 100000; display: grid; place-items: center; text-align: center; background: oklch(0.988 0.003 106);
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: oklch(0.255 0.017 254); transition: opacity 900ms cubic-bezier(0.23, 1, 0.32, 1); }
    #demo-card[hidden] { display: grid; opacity: 0; pointer-events: none; }
    #demo-card h1 { margin: 0; font-size: 88px; font-weight: 720; letter-spacing: -0.035em; line-height: 1; }
    #demo-card p { margin: 22px 0 0; font-size: 28px; color: oklch(0.49 0.015 250); }
    #demo-card ul { margin: 40px auto 0; padding: 0; list-style: none; display: grid; gap: 18px; justify-items: start; font-size: 34px; font-weight: 600; letter-spacing: -0.015em; }
    #demo-card li { display: flex; align-items: center; gap: 18px; opacity: 0; transform: translateY(12px); transition: opacity 700ms cubic-bezier(0.23, 1, 0.32, 1), transform 700ms cubic-bezier(0.23, 1, 0.32, 1); }
    #demo-card li::before { content: ""; width: 14px; height: 14px; border-radius: 99px; background: oklch(0.6 0.15 32); flex: none; }
    #demo-card.shown li { opacity: 1; transform: none; }
    #demo-card.shown li:nth-child(2) { transition-delay: 700ms; } #demo-card.shown li:nth-child(3) { transition-delay: 1400ms; } #demo-card.shown li:nth-child(4) { transition-delay: 2100ms; }
    #demo-card .url { margin-top: 30px; font: 600 40px ui-monospace, "SF Mono", Menlo, monospace; color: oklch(0.43 0.12 258); }
    #demo-card > div > * { opacity: 0; transform: translateY(14px); transition: opacity 800ms cubic-bezier(0.23, 1, 0.32, 1), transform 800ms cubic-bezier(0.23, 1, 0.32, 1); }
    #demo-card.shown > div > * { opacity: 1; transform: none; }
    #demo-card.shown > div > :nth-child(2) { transition-delay: 150ms; } #demo-card.shown > div > :nth-child(3) { transition-delay: 450ms; } #demo-card.shown > div > :nth-child(4) { transition-delay: 750ms; }
    #demo-caption { position: fixed; left: 50%; bottom: 34px; z-index: 99999; width: max-content; max-width: 1080px; padding: 14px 26px; border-radius: 14px; background: oklch(0.255 0.017 254 / 0.94);
      color: oklch(0.985 0.003 106); font: 560 24px/1.3 ui-sans-serif, system-ui, -apple-system, sans-serif; letter-spacing: -0.01em; text-align: center;
      box-shadow: 0 18px 40px -18px oklch(0.2 0.02 254 / 0.6); transform: translate(-50%, 0); transition: opacity 500ms cubic-bezier(0.23, 1, 0.32, 1), transform 500ms cubic-bezier(0.23, 1, 0.32, 1); }
    #demo-caption[hidden] { display: block; opacity: 0; transform: translate(-50%, 12px); }
    #demo-cursor { position: fixed; left: 0; top: 0; z-index: 100001; width: 26px; height: 26px; pointer-events: none; transform: translate(640px, 780px);
      transition: transform 900ms cubic-bezier(0.45, 0, 0.2, 1), opacity 400ms; filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.3)); }
    #demo-ripple { position: fixed; z-index: 100000; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 999px; pointer-events: none; background: oklch(0.43 0.12 258 / 0.28); opacity: 0; }
    #demo-ripple.go { animation: demo-ripple 600ms cubic-bezier(0.23, 1, 0.32, 1); }
    @keyframes demo-ripple { from { opacity: 1; transform: scale(0.4); } to { opacity: 0; transform: scale(1.6); } }
    #demo-terminal { position: fixed; right: 36px; bottom: 120px; z-index: 99998; width: 560px; border-radius: 14px; overflow: hidden; background: oklch(0.2 0.012 255);
      box-shadow: 0 30px 60px -24px rgb(0 0 0 / 0.55); font: 16px/1.65 ui-monospace, "SF Mono", Menlo, monospace; color: oklch(0.93 0.008 250);
      transition: opacity 600ms cubic-bezier(0.23, 1, 0.32, 1), transform 600ms cubic-bezier(0.23, 1, 0.32, 1); }
    #demo-terminal[hidden] { display: block; opacity: 0; transform: translateY(16px); }
    #demo-terminal .bar { display: flex; gap: 7px; padding: 11px 14px; background: oklch(0.25 0.012 255); }
    #demo-terminal .bar i { width: 11px; height: 11px; border-radius: 99px; background: oklch(0.4 0.01 255); }
    #demo-terminal pre { margin: 0; padding: 14px 18px 18px; white-space: pre-wrap; font: inherit; min-height: 150px; }
    #demo-terminal .you { color: oklch(0.8 0.1 258); } #demo-terminal .ok { color: oklch(0.78 0.13 160); } #demo-terminal .dim { color: oklch(0.65 0.015 250); }
  `;
  const card = document.createElement('div');
  card.id = 'demo-card';
  const caption = document.createElement('div');
  caption.id = 'demo-caption';
  caption.hidden = true;
  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2.5v17.2l4.6-4.3 2.9 6.6 3-1.3-2.9-6.5h6.3z" fill="#1f2531" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  // After a reload in the middle of the video, the dashboard shows at once, not the blank card.
  card.hidden = sessionStorage.getItem('demo-started') === '1';
  const ripple = document.createElement('div');
  ripple.id = 'demo-ripple';
  const terminal = document.createElement('div');
  terminal.id = 'demo-terminal';
  terminal.hidden = true;
  terminal.innerHTML = '<div class="bar"><i></i><i></i><i></i></div><pre></pre>';
  const mount = () => document.body.append(style, card, caption, cursor, ripple, terminal);
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
  Object.assign(window, { demo: { card, caption, cursor, ripple, terminal } });
};

const pause = (page: Page, milliseconds: number) => page.waitForTimeout(milliseconds);

async function showCard(page: Page, html: string) {
  await page.evaluate(content => {
    const { card } = (window as any).demo;
    card.innerHTML = `<div>${content}</div>`;
    card.classList.remove('shown');
    card.hidden = false;
    (window as any).demo.cursor.style.opacity = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('shown')));
  }, html);
}
const hideCard = (page: Page) => page.evaluate(() => { const { card, cursor } = (window as any).demo; card.hidden = true; cursor.style.opacity = '1'; sessionStorage.setItem('demo-started', '1'); });

async function caption(page: Page, text: string | null) {
  await page.evaluate(async value => {
    const { caption } = (window as any).demo;
    if (!caption.hidden) { caption.hidden = true; await new Promise(resolve => setTimeout(resolve, 350)); }
    if (value) { caption.textContent = value; caption.hidden = false; }
  }, text);
}

let cursorAt = { x: 640, y: 780 };
async function moveTo(page: Page, x: number, y: number) {
  const distance = Math.hypot(x - cursorAt.x, y - cursorAt.y);
  const duration = Math.round(Math.min(1100, Math.max(500, distance * 1.1)));
  await page.evaluate(({ x, y, duration }) => {
    const { cursor } = (window as any).demo;
    cursor.style.transitionDuration = `${duration}ms`;
    cursor.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
  }, { x, y, duration });
  await page.mouse.move(x, y, { steps: 12 });
  cursorAt = { x, y };
  await pause(page, duration + 120);
}

async function pointAt(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await moveTo(page, box.x + Math.min(box.width / 2, 60), box.y + box.height / 2);
}

async function click(page: Page, target: Locator, after = 900) {
  await pointAt(page, target);
  await page.evaluate(({ x, y }) => {
    const { ripple } = (window as any).demo;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.classList.remove('go');
    void ripple.offsetWidth;
    ripple.classList.add('go');
  }, cursorAt);
  await pause(page, 160);
  await target.click();
  await pause(page, after);
}

/** Scrolls the window slowly to a position, so the eye can follow. */
async function scrollTo(page: Page, top: number, duration = 1600) {
  await page.evaluate(({ top, duration }) => new Promise<void>(resolve => {
    const start = window.scrollY;
    const began = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - began) / duration);
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      window.scrollTo(0, start + (top - start) * eased);
      if (progress < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  }), { top, duration });
}

async function typeInTerminal(page: Page, lines: [className: string, text: string, typed: boolean][]) {
  await page.evaluate(() => { const { terminal } = (window as any).demo; terminal.querySelector('pre').innerHTML = ''; terminal.hidden = false; });
  await pause(page, 700);
  for (const [className, text, typed] of lines) {
    await page.evaluate(className => {
      const span = document.createElement('span');
      span.className = className;
      (window as any).demo.terminal.querySelector('pre').append(span);
    }, className);
    for (const piece of typed ? [...text] : [text]) {
      await page.evaluate(piece => { (window as any).demo.terminal.querySelector('pre').lastChild.textContent += piece; }, piece);
      await pause(page, typed ? 38 : 0);
    }
    await pause(page, typed ? 450 : 700);
  }
}

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: 'light', recordVideo: { dir: videoDirectory, size: { width: 1280, height: 720 } } });
await context.addInitScript(overlay);
const page = await context.newPage();
const started = Date.now();
await page.goto(`${base}/#today`);
await showCard(page, '<h1>2b v3 is live! 🎉</h1><p>Your second brain, on your Mac.</p>');
await page.getByRole('heading', { name: 'Today' }).waitFor();
await pause(page, 1500);
const titleShownAt = (Date.now() - started) / 1000;
await pause(page, 3500);
await hideCard(page);
await pause(page, 1200);

// Today.
await caption(page, 'Today: your schedule, open tasks, and what you did');
await moveTo(page, 560, 380);
await pause(page, 1400);
await scrollTo(page, 480, 2200);
await pause(page, 1800);
await scrollTo(page, 0, 1600);
await pause(page, 600);

// Scope.
await caption(page, 'One switch shows Work, Personal, or both, on every page');
await click(page, page.getByRole('radio', { name: 'Show Work items' }), 2200);
await click(page, page.getByRole('radio', { name: 'Show Personal items' }), 2200);
await click(page, page.getByRole('radio', { name: 'Show all items' }), 1200);

// Tick a task.
await caption(page, 'Tick a task. It is saved in your vault at once');
await click(page, page.getByRole('checkbox', { name: 'Complete Write the release notes' }).first(), 2600);

// A project.
await caption(page, 'Every item has a type, and links to other items');
await click(page, page.locator('a[data-slot="sidebar-menu-button"][href="#projects"]'), 1800);
await click(page, page.getByRole('link', { name: /App launch/ }).first(), 2200);
await scrollTo(page, 430, 2000);
await pause(page, 1800);
await scrollTo(page, 0, 1200);

// A person.
await caption(page, 'People link to their meetings, projects, and notes');
await click(page, page.locator('a[data-slot="sidebar-menu-button"][href="#library"]'), 1200);
await click(page, page.getByRole('link', { name: /^People/ }).or(page.getByRole('button', { name: /^People/ })).first(), 1600);
await click(page, page.getByRole('link', { name: /Priya Sharma/ }).first(), 2200);
await scrollTo(page, 300, 1800);
await pause(page, 1600);
await scrollTo(page, 0, 1000);

// Books and other types.
await caption(page, 'Books, notes, people, and tasks are all items. No folders to choose');
await click(page, page.locator('a[data-slot="sidebar-menu-button"][href="#library"]'), 1000);
await click(page, page.getByRole('link', { name: /^Books/ }).or(page.getByRole('button', { name: /^Books/ })).first(), 2600);
await caption(page, 'Add your own types, such as a Course with its progress');
await click(page, page.getByRole('link', { name: /^Courses/ }).or(page.getByRole('button', { name: /^Courses/ })).first(), 1400);
await click(page, page.getByRole('link', { name: /Rust in practice/ }).first(), 3000);

// Graph.
await caption(page, 'The graph shows how everything connects');
await click(page, page.locator('a[data-slot="sidebar-menu-button"][href="#graph"]'), 6000);
await caption(page, 'Pick an item to see its links');
await click(page, page.getByRole('button', { name: /^Priya Sharma/ }), 3800);

// Timeline and calendar.
await caption(page, 'Timeline: what you did, day by day');
await click(page, page.locator('a[data-slot="sidebar-menu-button"][href="#timeline"]'), 1500);
await scrollTo(page, 600, 2400);
await pause(page, 800);
await scrollTo(page, 0, 1000);
await caption(page, 'Calendar: the whole month at a glance');
await click(page, page.locator('a[data-slot="sidebar-menu-button"][href="#calendar"]'), 3000);

// Search.
await caption(page, 'Find anything: press / and type');
await pointAt(page, page.getByRole('button', { name: 'Search' }));
await page.keyboard.press('/');
await pause(page, 700);
await page.keyboard.type('kitchen', { delay: 140 });
await pause(page, 1800);
await page.keyboard.press('Enter');
await pause(page, 2400);

// The agent.
await caption(page, 'Your agent uses the same items through the 2b command');
await click(page, page.locator('a[data-slot="sidebar-menu-button"][href="#inbox"]'), 800);
await typeInTerminal(page, [
  ['you', '› put this in 2b: ask Rahul for the new icon set\n', true],
  ['dim', '$ 2b capture "Ask Rahul for the new icon set"\n', true],
  ['ok', '✓ Saved to your Inbox\n', false],
]);
// What the agent's command does: the server saves the note. The dashboard shows it after a reload.
const saved = await page.evaluate(async () => (await fetch('/api/objects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'note', name: 'Ask Rahul for the new icon set', scope: 'work', properties: { processingState: 'inbox' } }) })).status);
if (saved !== 201) throw new Error(`The demo capture failed with HTTP ${saved}`);
const terminalText = await page.evaluate(() => (window as any).demo.terminal.querySelector('pre').innerHTML);
await pause(page, 900);
await page.reload();
await page.evaluate(([html, text]) => {
  const { terminal, caption } = (window as any).demo;
  terminal.querySelector('pre').innerHTML = html;
  terminal.hidden = false;
  caption.textContent = text;
  caption.hidden = false;
}, [terminalText, 'Your agent uses the same items through the 2b command']);
await page.getByText('Ask Rahul for the new icon set').first().waitFor();
await pause(page, 600);
await pointAt(page, page.getByText('Ask Rahul for the new icon set').first());
await pause(page, 3000);
await page.evaluate(() => { (window as any).demo.terminal.hidden = true; });
await caption(page, null);
await pause(page, 600);

// Closing cards.
await showCard(page, '<h1>Free and open source</h1><ul><li>Runs on your Mac. No account, no cloud</li><li>Your notes stay plain Markdown</li><li>Works with Claude Code and Codex</li></ul>');
await pause(page, 5200);
await showCard(page, '<h1>Get your second brain</h1><div class="url">get2b.vercel.app</div><p>Source on GitHub: ankitvashisht12/2b</p>');
await pause(page, 5000);

const recordedSeconds = (Date.now() - started) / 1000;
await context.close();
await browser.close();

const recording = fs.readdirSync(videoDirectory).find(name => name.endsWith('.webm'))!;
// Start on the title card, not on the page load before it.
const trim = Math.max(0, titleShownAt - 1.2);
// LinkedIn plays the first minute best, so the whole walk-through is sped up evenly to fit 60 seconds.
const targetSeconds = 60;
const speed = (recordedSeconds - trim) / targetSeconds;
const filters = `setpts=PTS/${speed.toFixed(4)},fps=30,scale=1920:1080:flags=lanczos`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', trim.toFixed(2), '-i', path.join(videoDirectory, recording), '-vf', filters, '-t', String(targetSeconds), '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
fs.rmSync(videoDirectory, { recursive: true, force: true });
console.log(`Video: ${output}`);
