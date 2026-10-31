import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startDashboard, setScope } from '../src/v3/server.ts';
import { writeBody } from '../src/v3/files.ts';
import { metadataDirectory } from '../src/v3/config.ts';

// A dashboard on a fake vault for demo videos and screenshots. Every name, date, and note here is made up.
// The real vault and the source vaults are never opened.
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), '2bv3-demo-')));
process.env.TWOB_APP_HOME = path.join(temporary, 'app');
const root = path.join(temporary, 'vault');
const app = await startDashboard(root, Number(process.env.PORT || 4500));
const store = app.store;

const istDay = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + offset * 86_400_000));
const istTime = (offset: number, clock: string) => new Date(`${istDay(offset)}T${clock}:00+05:30`).toISOString();

type Input = { type: string; name: string; scope?: 'work' | 'personal'; tags?: string[]; properties?: Record<string, unknown>; body?: string; at?: [offset: number, clock: string] };

/** Creates an item dated in the past weeks, so Today's activity is not one long list of items made a second ago. */
async function make({ at, scope, body, ...input }: Input) {
  const nameHash = [...input.name].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const [offset, clock] = at ?? [-1 - (nameHash % 14), `${String(9 + (nameHash % 9)).padStart(2, '0')}:${String((nameHash * 7) % 60).padStart(2, '0')}`];
  const when = istTime(offset, clock);
  let record = await store.upsert({ id: randomUUID(), type: input.type, name: input.name, description: '', properties: input.properties ?? {}, tags: input.tags ?? [], path: null, createdAt: when, modifiedAt: when });
  record = await writeBody(root, store, record, body ?? `# ${input.name}\n`);
  await setScope(store, record.id, scope);
  return store.upsert({ ...record, modifiedAt: when, properties: { ...record.properties, activityAt: when } });
}
const link = (from: { id: string }, kind: string, to: { id: string }) => store.relate(from.id, kind, to.id);

/** A project whose copied log feeds the Timeline, Calendar, and Today activity. */
async function projectWithLog(input: Input, slug: string, lines: [offset: number, clock: string, text: string][]) {
  const sourcePath = `projects/${slug}/readme.md`;
  const project = await make({ ...input, type: 'project', properties: { ...input.properties, sourceVault: 'demo', sourcePath } });
  const logPath = `objects/evidence/${slug}-log.md`;
  fs.mkdirSync(path.dirname(path.join(root, logPath)), { recursive: true });
  fs.writeFileSync(path.join(root, logPath), lines.map(([offset, clock, text]) => `- ${istDay(offset)} ${clock} ${text}`).join('\n') + '\n');
  const now = new Date().toISOString();
  await store.upsert({ id: `demo-log-${slug}`, type: 'evidence', name: 'Log', description: '', tags: [], path: logPath, createdAt: now, modifiedAt: now, properties: { sourceVault: 'demo', sourcePath: `projects/${slug}/log.md`, archived: true } });
  return project;
}

async function cleanup() {
  await new Promise<void>(resolve => app.server.close(() => resolve()));
  try { process.kill(JSON.parse(fs.readFileSync(path.join(metadataDirectory(root), 'server.json'), 'utf8')).pid, 'SIGTERM'); } catch {}
  fs.rmSync(temporary, { recursive: true, force: true });
}

try {
  await store.defineType({ id: 'evidence', name: 'evidence', description: 'Copied logs', properties: [] });
  await store.defineType({ id: 'course', name: 'Course', description: 'A course with progress', properties: [{ key: 'progress', type: 'number' }, { key: 'platform', type: 'text' }] });

  const longAgo = istTime(-60, '09:00');
  for (const [id, name] of [['area:work', 'Work'], ['area:personal', 'Personal']])
    await store.upsert({ id, type: 'area', name, description: '', properties: {}, tags: [], path: null, createdAt: longAgo, modifiedAt: longAgo });

  // People and organizations.
  const northwind = await make({ type: 'organization', name: 'Northwind Labs', scope: 'work', properties: { website: 'northwind.example' } });
  const person = (name: string, role: string, scope: 'work' | 'personal', email: string) =>
    make({ type: 'person', name, scope, properties: { role, email, ...(email.endsWith('northwind.example') ? { organization: northwind.id } : {}) }, body: `# ${name}\n\n${role}.\n` });
  const priya = await person('Priya Sharma', 'Product manager at Northwind Labs', 'work', 'priya@northwind.example');
  const rahul = await person('Rahul Mehta', 'Product designer', 'work', 'rahul@northwind.example');
  const ana = await person('Ana Costa', 'Backend engineer', 'work', 'ana@northwind.example');
  const jonas = await person('Jonas Weber', 'Data analyst', 'work', 'jonas@northwind.example');
  const leo = await person('Leo Martin', 'Contractor for the kitchen', 'personal', 'leo@example.com');
  const sara = await person('Sara Kim', 'Mentor, ex-staff engineer', 'personal', 'sara@example.com');
  for (const colleague of [priya, rahul, ana, jonas]) await link(colleague, 'associated-with', northwind);

  // Projects, with history in their logs.
  const launch = await projectWithLog({ type: 'project', name: 'App launch', scope: 'work', properties: { kind: 'finite', status: 'active', priority: 'P1', due: istDay(27) }, body: '# App launch\n\nShip the mobile app to the public by the end of November.\n\n## Why\n\nThe beta group is ready, and sales has three customers waiting.\n' }, 'app-launch', [
    [-26, '10:05', 'created | App launch'], [-24, '14:30', 'note | Kickoff with Priya and Ana.'], [-21, '11:15', 'note | Beta sign-up form live.'], [-18, '16:00', 'note | First beta build.'], [-15, '12:40', 'note | Sync design agreed.'], [-11, '15:20', 'note | Scope agreed with Priya: sign-in, sync, and billing.'], [-9, '11:00', 'status todo -> doing'],
    [-7, '17:45', 'note | Beta build 0.9 sent to 40 testers.'], [-5, '12:10', 'note | Fixed the sign-in redirect on Android.'], [-3, '16:30', 'note | Load test found a slow sync endpoint.'],
    [-2, '10:15', 'note | Release notes first draft.'], [-1, '18:40', 'note | Pricing page copy reviewed with Priya.'], [0, '09:20', 'note | Launch checklist updated.'],
  ]);
  const analytics = await projectWithLog({ type: 'project', name: 'AI analytics', scope: 'work', properties: { kind: 'ongoing', status: 'active', priority: 'P2' }, body: '# AI analytics\n\nWeekly product analytics with an agent that writes the first draft.\n' }, 'ai-analytics', [
    [-29, '09:30', 'created | AI analytics'], [-22, '11:45', 'note | Weekly report sent.'], [-15, '11:45', 'note | Weekly report sent.'], [-10, '14:00', 'note | Cohort query rewritten with date buckets.'], [-8, '11:45', 'note | Weekly report sent.'],
    [-6, '16:10', 'note | Jonas added the retention chart.'], [-1, '11:30', 'note | Weekly report sent.'], [0, '11:05', 'note | Started the cohort chart.'],
  ]);
  const designSystem = await projectWithLog({ type: 'project', name: 'Design system', scope: 'work', properties: { kind: 'ongoing', status: 'active', priority: 'P3' }, body: '# Design system\n\nOne set of components for web and mobile.\n' }, 'design-system', [
    [-9, '15:00', 'created | Design system'], [-4, '14:20', 'note | Rahul shared the new colour tokens.'], [-2, '17:05', 'note | Button audit started.'],
  ]);
  const kitchen = await projectWithLog({ type: 'project', name: 'Kitchen renovation', scope: 'personal', properties: { kind: 'finite', status: 'active', priority: 'P2', due: istDay(40) }, body: '# Kitchen renovation\n\nNew counters, tiles, and lights before the holidays.\n' }, 'kitchen', [
    [-27, '19:00', 'created | Kitchen renovation'], [-20, '18:30', 'note | Visited two showrooms.'], [-14, '19:00', 'note | Asked Leo for a quote.'], [-10, '20:15', 'note | Leo sent the first quote.'], [-6, '10:30', 'note | Picked the counter stone.'], [-1, '20:00', 'note | Tile samples arrived.'],
  ]);
  const rust = await projectWithLog({ type: 'project', name: 'Learn Rust', scope: 'personal', properties: { kind: 'ongoing', status: 'active', priority: 'P4' }, body: '# Learn Rust\n\nOne chapter a week, and a small CLI by the end of the year.\n' }, 'learn-rust', [
    [-25, '07:30', 'created | Learn Rust'], [-18, '07:10', 'note | Finished chapter 5: structs.'], [-8, '07:15', 'note | Finished chapter 6: enums.'], [-4, '07:20', 'note | Finished chapter 7: modules.'], [0, '07:40', 'note | Started chapter 8.'],
  ]);
  for (const [project, people] of [[launch, [priya, ana, rahul]], [analytics, [jonas, priya]], [designSystem, [rahul]], [kitchen, [leo]], [rust, [sara]]] as const)
    for (const member of people) await link(project, 'worked-with', member);
  await link(launch, 'associated-with', northwind);

  // A trip is a collection.
  const japan = await make({ type: 'collection', name: 'Japan trip', scope: 'personal', properties: { place: 'Tokyo and Kyoto', startDate: istDay(52), endDate: istDay(62), tripStatus: 'planned' }, body: '# Japan trip\n\nTen days in spring. Tokyo first, then Kyoto.\n' });

  // Tasks.
  const task = async (name: string, parent: { id: string }, scope: 'work' | 'personal', properties: Record<string, unknown>, body?: string) => {
    const created = await make({ type: 'task', name, scope, properties, body: body ?? `# ${name}\n` });
    await link(created, 'part-of', parent);
    return created;
  };
  const releaseNotes = await task('Write the release notes', launch, 'work', { status: 'doing', priority: 'high', due: istDay(0) }, '# Write the release notes\n\nWhat changed since the beta, in plain words. Priya reviews the final draft.\n');
  await task('Update the pricing page', launch, 'work', { status: 'todo', priority: 'high', due: istDay(-1) });
  await task('Fix the sign-in redirect', launch, 'work', { status: 'done', priority: 'high', completedAt: istTime(-5, '12:10') });
  await task('Load test the sync API', launch, 'work', { status: 'blocked', priority: 'med', blockedReason: 'Waiting on the staging database' });
  await task('Record the launch demo', launch, 'work', { status: 'todo', priority: 'med', due: istDay(3) });
  await task('Send the weekly report', analytics, 'work', { status: 'todo', priority: 'med', due: istDay(0) });
  await task('Add the cohort chart', analytics, 'work', { status: 'doing', priority: 'med' });
  await task('Audit the button styles', designSystem, 'work', { status: 'todo', priority: 'low', due: istDay(6) });
  await task('Choose the kitchen tiles', kitchen, 'personal', { status: 'doing', priority: 'high', due: istDay(2) });
  await task('Book the electrician', kitchen, 'personal', { status: 'todo', priority: 'med', due: istDay(-2) });
  await task('Finish chapter 8', rust, 'personal', { status: 'todo', priority: 'low', due: istDay(4) });
  await task('Book the ryokan in Kyoto', japan, 'personal', { status: 'todo', priority: 'med', due: istDay(5) });
  await task('Buy the rail pass', japan, 'personal', { status: 'done', priority: 'low', completedAt: istTime(-4, '21:15') });

  // Meetings and reminders.
  const meeting = async (name: string, offset: number, start: string, end: string, people: { id: string }[], parent: { id: string }, scope: 'work' | 'personal', body: string) => {
    const created = await make({ type: 'meeting', name, scope, properties: { startsAt: istTime(offset, start), endsAt: istTime(offset, end), location: 'Video call' }, body });
    for (const attendee of people) await link(created, 'has-attendee', attendee);
    await link(created, 'part-of', parent);
    return created;
  };
  await meeting('Launch stand-up', 0, '10:00', '10:15', [priya, ana], launch, 'work', '# Launch stand-up\n\n- Pricing page goes live Monday.\n- Ana owns the sync fix.\n');
  const review = await meeting('Design review', 0, '15:00', '16:00', [rahul, priya], designSystem, 'work', '# Design review\n\nNew onboarding screens and the button audit.\n');
  await meeting('Mentoring call with Sara', 0, '19:30', '20:00', [sara], rust, 'personal', '# Mentoring call with Sara\n\nAsk about error handling in Rust.\n');
  await meeting('Kitchen walkthrough', -3, '18:00', '19:00', [leo], kitchen, 'personal', '# Kitchen walkthrough\n\nMeasured the counters. Leo needs the tile choice by Monday.\n');
  await meeting('Analytics sync', -1, '11:00', '11:30', [jonas, priya], analytics, 'work', '# Analytics sync\n\nRetention is up 4% since the new onboarding.\n');
  const reminder = await make({ type: 'reminder', name: 'Call Leo about the tiles', scope: 'personal', properties: { at: istTime(0, '18:00'), enabled: false, status: 'pending', timezone: 'Asia/Kolkata' } });
  await link(reminder, 'part-of', kitchen);

  // Books and a course of a custom type.
  const book = (name: string, author: string, readingState: string, scope: 'work' | 'personal') => make({ type: 'book', name, scope, properties: { author, readingState }, body: `# ${name}\n\nBy ${author}.\n` });
  const everydayThings = await book('The Design of Everyday Things', 'Don Norman', 'reading', 'work');
  const shapeUp = await book('Shape Up', 'Ryan Singer', 'finished', 'work');
  await book('Thinking, Fast and Slow', 'Daniel Kahneman', 'to-read', 'personal');
  const rustBook = await book('The Rust Programming Language', 'Steve Klabnik and Carol Nichols', 'reading', 'personal');
  const course = await make({ type: 'course', name: 'Rust in practice', scope: 'personal', properties: { progress: 40, platform: 'Online' }, body: '# Rust in practice\n\nVideo course. Two lessons a week.\n' });
  await link(course, 'part-of', rust);
  await link(rustBook, 'part-of', rust);
  await link(rust, 'worked-with', sara);

  // Notes, linked to what they are about.
  const note = async (name: string, noteType: string, scope: 'work' | 'personal', body: string, links: [string, { id: string }][], tags: string[] = []) => {
    const created = await make({ type: 'note', name, scope, tags, properties: { noteType }, body });
    for (const [kind, target] of links) await link(created, kind, target);
    return created;
  };
  await note('Ship the launch behind a flag', 'decision', 'work', '# Ship the launch behind a flag\n\nWe turn the app on for 10% of users first. Priya and Ana agreed. If sync errors stay under 0.5%, we go to 100% after two days.\n', [['part-of', launch], ['mentions', priya], ['mentions', ana]]);
  await note('Cohort queries need date buckets', 'learning', 'work', '# Cohort queries need date buckets\n\nGroup by the signup week, not the signup day. Daily buckets made the chart too noisy to read.\n', [['part-of', analytics], ['mentions', jonas]], ['learning']);
  await note('Design review notes', 'meeting', 'work', '# Design review notes\n\n- Rahul: fewer button sizes, three instead of seven.\n- Onboarding: cut step 3.\n- Read chapter 2 of The Design of Everyday Things on signifiers.\n', [['part-of', review], ['mentions', rahul], ['mentions', everydayThings]]);
  await note('Appetite, not estimates', 'learning', 'work', '# Appetite, not estimates\n\nFrom Shape Up: decide how much time a problem deserves, then shape the work to fit.\n', [['mentions', shapeUp], ['part-of', launch]], ['learning']);
  await note('Ownership in one picture', 'learning', 'personal', '# Ownership in one picture\n\nEach value has one owner. Borrowing lends it without moving it.\n', [['part-of', rust], ['mentions', rustBook]], ['learning']);
  await note('Kyoto food list', 'general', 'personal', '# Kyoto food list\n\n- Nishiki market in the morning\n- Tofu lunch near Nanzen-ji\n', [['part-of', japan]]);
  await note('Release notes: what to say first', 'general', 'work', '# Release notes: what to say first\n\nLead with sync. It is what beta users asked for most.\n', [['part-of', releaseNotes]]);
  await make({ type: 'note', name: 'Idea: a weekly review template', scope: 'personal', at: [0, '08:10'], properties: { processingState: 'inbox' }, body: '# Idea: a weekly review template\n\nThree questions: what moved, what is stuck, what is next.\n' });
  await make({ type: 'note', name: 'Ask Ana about offline mode', scope: 'work', at: [0, '10:20'], properties: { processingState: 'inbox' }, body: '# Ask Ana about offline mode\n' });

  console.log(`Demo dashboard: http://127.0.0.1:${app.port}  (fake vault in ${root}). Press Ctrl+C to stop.`);
  await new Promise<void>(resolve => { process.once('SIGINT', () => resolve()); process.once('SIGTERM', () => resolve()); });
} finally {
  await cleanup();
}
