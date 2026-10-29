export const projectStatuses = ['active', 'paused', 'on-hold', 'done', 'archived'];
export const taskStatuses = ['todo', 'doing', 'blocked', 'done', 'dropped', 'paused'];
const taskPriorities = ['high', 'med', 'low'];
const projectPriorities = ['P1', 'P2', 'P3', 'P4', 'P5'];
const mixedStatuses = [...new Set([...projectStatuses, ...taskStatuses])];
const mixedPriorities = [...taskPriorities, ...projectPriorities];
const policy = (scope, statuses = [], priorities = [], filters = ['area', 'project']) => ({ scope, statuses, priorities, filters: [...filters, ...(statuses.length ? ['status'] : []), ...(priorities.length ? ['priority'] : [])] });
export const viewPolicies = {
  home: policy('Home tasks and projects', mixedStatuses, mixedPriorities),
  due: policy('due tasks and project deadlines', mixedStatuses, mixedPriorities),
  timeline: policy('activity and projects', mixedStatuses, mixedPriorities),
  projects: policy('projects', projectStatuses, projectPriorities),
  project: policy('project tasks', taskStatuses, taskPriorities),
  jobs: policy('jobs', taskStatuses, taskPriorities),
  collections: policy('collections and note content'),
  reminders: policy('reminders', ['scheduled', 'sent', 'cancelled']),
  inbox: policy('inbox and learning content', [], [], ['folder']),
};
export function normalizeFilters(params, view) {
  const selected = viewPolicies[view] || viewPolicies.home;
  for (const key of ['area', 'project', 'folder', 'status', 'priority']) if (!selected.filters.includes(key)) params.delete(key);
  const statuses = (params.get('status') || '').split(',').filter(status => selected.statuses.includes(status));
  if (statuses.length) params.set('status', statuses.join(',')); else params.delete('status');
  if (!selected.priorities.includes(params.get('priority'))) params.delete('priority');
  if (params.has('area') && !['work', 'personal'].includes(params.get('area'))) params.delete('area');
  if (params.has('folder') && !['inbox', 'learnings'].includes(params.get('folder'))) params.delete('folder');
  return params;
}
export function transitionParams(params) {
  const next = new URLSearchParams();
  for (const key of ['area', 'project']) if (params.get(key)) next.set(key, params.get(key));
  return next;
}
export function creationDraftKey(kind, context) {
  return JSON.stringify([kind, context.project || '', context.collection || '', context.folder || '']);
}
export function scheduleValue(kind, time, days, advanced) {
  if (kind === 'custom') return advanced;
  if (kind === 'hourly') return 'hourly';
  if (kind === 'selected' && !days.length) throw new Error('Select at least one day.');
  return `${kind === 'selected' ? days.join(',') : kind} ${time}`;
}
export function homeGroups(tasks, day) {
  const personal = tasks.filter(task => task.kind !== 'recurring');
  const overdue = personal.filter(task => !['done', 'dropped', 'archived'].includes(task.status) && /^\d{4}-\d{2}-\d{2}$/.test(task.due || '') && task.due < day);
  return { overdue, inProgress: personal.filter(task => task.status === 'doing' && !overdue.includes(task)), next: personal.filter(task => task.status === 'todo' && !overdue.includes(task)) };
}

export function searchExcerpt(body, query) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  const search = String(query || '').trim().toLowerCase();
  const match = search ? text.toLowerCase().indexOf(search) : -1;
  if (match < 0) return '';
  const start = Math.max(0, match - 50);
  const end = Math.min(text.length, Math.max(start + 160, match + search.length));
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
