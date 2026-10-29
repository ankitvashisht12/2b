import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFilters, transitionParams, viewPolicies, homeGroups, scheduleValue, creationDraftKey } from '../dash/policy.js';

test('view policy preserves meaningful statuses and removes unsupported URL values', () => {
  assert.equal(normalizeFilters(new URLSearchParams('status=paused&priority=high'), 'jobs').toString(), 'status=paused&priority=high');
  for (const view of ['home', 'due', 'timeline']) assert.equal(normalizeFilters(new URLSearchParams('status=active,on-hold'), view).get('status'), 'active,on-hold');
  assert.equal(normalizeFilters(new URLSearchParams('status=todo&priority=high'), 'reminders').toString(), '');
  assert.deepEqual(viewPolicies.projects.priorities, ['P1', 'P2', 'P3', 'P4', 'P5']);
  assert.deepEqual(viewPolicies.project.priorities, ['high', 'med', 'low']);
  assert.equal(transitionParams(new URLSearchParams('q=abc&status=todo&priority=high&area=work&project=sample')).toString(), 'area=work&project=sample');
});
test('personal action groups exclude jobs and completed overdue work', () => {
  const groups = homeGroups([{ kind: 'recurring', status: 'doing' }, { status: 'done', due: '2020-01-01' }, { status: 'doing' }, { status: 'todo' }], '2026-10-29');
  assert.equal(groups.overdue.length, 0);
  assert.equal(groups.inProgress.length, 1);
  assert.equal(groups.next.length, 1);
});
test('schedule builder keeps existing syntax and context drafts distinct', () => {
  assert.equal(scheduleValue('selected', '14:23', ['mon', 'fri'], ''), 'mon,fri 14:23');
  assert.equal(scheduleValue('hourly', '', [], ''), 'hourly');
  assert.throws(() => scheduleValue('selected', '14:23', [], ''), /Select/);
  assert.notEqual(creationDraftKey('task', { project: 'work' }), creationDraftKey('task', { project: 'personal' }));
  assert.notEqual(creationDraftKey('capture', { folder: 'inbox' }), creationDraftKey('capture', { folder: 'learnings' }));
});

test('dashboard status choices match the store model for both filters and actions', async () => {
  const { PROJECT_STATUSES, TASK_STATUSES } = await import('../src/store.ts');
  const { projectStatuses, taskStatuses } = await import('../dash/policy.js');
  assert.deepEqual(new Set(projectStatuses), new Set(PROJECT_STATUSES));
  assert.deepEqual(new Set(taskStatuses), new Set(TASK_STATUSES));
  assert.equal(new Set(taskStatuses).size, taskStatuses.length);
  for (const view of ['jobs', 'project']) assert.deepEqual(new Set(viewPolicies[view].statuses), new Set(TASK_STATUSES));
  assert.deepEqual(new Set(viewPolicies.projects.statuses), new Set(PROJECT_STATUSES));
});

test('body search excerpts expose a match without returning the full long document', async () => {
  const { searchExcerpt } = await import('../dash/policy.js');
  const body = 'Earlier content. '.repeat(200) + '<img src=x onerror=alert(1)> lighthouse findings' + ' Later content.'.repeat(200);
  const excerpt = searchExcerpt(body, 'LIGHTHOUSE');
  assert.match(excerpt, /lighthouse findings/);
  assert(excerpt.length < 200);
  assert.equal(searchExcerpt(body, 'missing-keyword'), '');
  assert.equal(searchExcerpt(body, ''), '');
});
