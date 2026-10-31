import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityReader, activityRange } from '../src/v3/activity.ts';
import type { ObjectRecord } from '../src/v3/models.ts';

test('copied dated logs keep original time, project context, and current item names', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), '2bv3-activity-')));
  const record = (id: string, sourcePath: string, type = 'task'): ObjectRecord => ({ id, name: id, type, description: '', tags: ['work'], properties: { sourceVault: 'legacy', sourcePath }, path: null, createdAt: '2026-10-30T12:00:00Z', modifiedAt: '2026-10-30T12:00:00Z' });
  const project = record('Analytics', 'projects/analytics/readme.md', 'project');
  const owner = record('Release review', 'projects/analytics/tasks/review/README.md');
  const log = { ...record('Log', 'projects/analytics/tasks/review/log.md', 'evidence'), path: 'log.md' };
  const records = [project, owner, log];
  try {
    fs.writeFileSync(path.join(root, 'log.md'), '# Log\n- 2026-10-28 09:10 note | Reviewed the release\n- 2026-10-29 18:42 status done\n- 2026-10-31 07:00 note Outside the range\n- 2026-10-29 99:99 invalid ignored\n- 2026-02-30 12:00 invalid ignored\n');
    const reader = new ActivityReader();
    const events = reader.read(root, records, '2026-10-28', '2026-10-29');
    assert.equal(events.length, 2);
    assert.equal(events[0].at, '2026-10-29T18:42:00+05:30');
    assert.equal(events[0].objectId, owner.id);
    assert.equal(events[0].projectId, project.id);
    assert.deepEqual(events[0].tags, ['work']);
    assert.equal(events[1].detail, 'Reviewed the release');
    owner.name = 'Renamed review';
    assert.equal(reader.read(root, records, '2026-10-28', '2026-10-29')[0].objectName, 'Renamed review');
    fs.appendFileSync(path.join(root, 'log.md'), '- 2026-10-29 19:00 note Added later\n');
    assert.equal(reader.read(root, records, '2026-10-28', '2026-10-29').length, 3);
    fs.appendFileSync(path.join(root, 'log.md'), '- 2026-10-29 20:00 IST — Review complete\n- 2026-10-29 note Date only\n- 2026-10-29 00:00 created Explicit midnight\n');
    const updated = reader.read(root, records, '2026-10-29', '2026-10-29');
    assert.ok(updated.some(event => event.kind === 'note' && event.detail === 'Review complete' && event.at.endsWith('20:00:00+05:30')));
    assert.ok(updated.some(event => event.detail === 'Date only' && event.at === '2026-10-29'));
    assert.ok(updated.some(event => event.detail === 'Explicit midnight' && event.at.endsWith('T00:00:00+05:30')));
    assert.equal(reader.read(root, records, '2026-10-30', '2026-10-30').length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('activity dates reject malformed, reversed, impossible, and unbounded ranges', () => {
  for (const [from, to] of [['', '2026-10-30'], ['2026-13-01', '2026-13-02'], ['2026-02-30', '2026-03-01'], ['2026-10-31', '2026-10-30'], ['2024-01-01', '2026-01-01']]) assert.throws(() => activityRange(from, to));
  assert.deepEqual(activityRange('2026-10-30', '2026-10-30'), { from: '2026-10-30', to: '2026-10-30' });
});
