const element = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const attribute = escapeHtml;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const decodePath = value => { try { return decodeURIComponent(value); } catch { return value; } };
const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDays = (day, amount) => { const date = new Date(`${day}T12:00:00`); date.setDate(date.getDate() + amount); return localDay(date); };
const daysBetween = (from, to) => Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000);
const today = () => store.data?.today || localDay();
const formatDate = (day, options = {}) => dayPattern.test(day || '') ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...options }).format(new Date(`${day}T12:00:00`)) : day === 'unknown' ? 'Unknown' : 'No date';
const formatTimestamp = value => value ? new Date(value.replace(' ', 'T')).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never';
function relativeTime(value) {
  if (!value) return 'No activity';
  const timestamp = new Date(String(value).replace(' ', 'T')).getTime();
  if (!Number.isFinite(timestamp)) return String(value);
  const minutes = Math.round((timestamp - Date.now()) / 60000);
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  if (Math.abs(minutes) < 1440) return relative.format(Math.round(minutes / 60), 'hour');
  return relative.format(Math.round(minutes / 1440), 'day');
}
const iconPaths = {
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  projects: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M8 5V3m8 2V3"/>',
  due: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h3m3 0h2"/>',
  timeline: '<path d="M5 3v18m0-14h7m-7 9h12"/><circle cx="15" cy="7" r="3"/><circle cx="19" cy="16" r="2"/>',
  reminders: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  collections: '<path d="M3 5h7l2 3h9v13H3Z"/>',
  jobs: '<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>',
  inbox: '<path d="M4 4h16l2 12v4H2v-4L4 4Zm-2 12h6l2 3h4l2-3h6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  command: '<path d="M9 7V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2V7Z"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  doing: '<circle cx="12" cy="12" r="8"/><path d="M12 4v8h8"/>',
  blocked: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>',
  pause: '<circle cx="12" cy="12" r="8"/><path d="M9 9v6m6-6v6"/>',
  done: '<circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/>',
  dropped: '<circle cx="12" cy="12" r="8"/><path d="m8 8 8 8"/>',
  flag: '<path d="M5 21V3m0 0c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
  filter: '<path d="M4 5h16l-6 7v6l-4 2v-8Z"/>',
  priority: '<path d="M5 19V13m7 6V8m7 11V3"/>',
  file: '<path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14m0-10H3v17h17v-7"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  link: '<path d="m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  play: '<path d="m7 4 13 8-13 8Z"/>',
  trash: '<path d="M3 6h18m-16 0 1 15h12l1-15M9 6V3h6v3m-5 4v7m4-7v7"/>',
  warning: '<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  sort: '<path d="m8 4-4 4m4-4 4 4M8 4v16m8 0 4-4m-4 4-4-4m4 4V4"/>',
  restore: '<path d="M3 3v6h6M3 9a9 9 0 1 1 0 6"/>',
  branch: '<circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 6v12m0-6h6a6 6 0 0 0 6-4"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.file}</svg>`;
const navigation = [['home', 'Home', 'h'], ['projects', 'Projects', 'p'], ['due', 'Due', 'd'], ['timeline', 'Timeline', 't'], ['jobs', 'Jobs', 'j'], ['collections', 'Collections', 'c'], ['reminders', 'Reminders', 'r'], ['inbox', 'Inbox', 'i']];
const projectStatuses = ['active', 'paused', 'on-hold', 'done', 'archived'];
const taskStatuses = ['todo', 'doing', 'blocked', 'done', 'dropped'];
const projectPriorityLabels = { P1: '🔥 P1', P2: '⚡ P2', P3: '🎯 P3', P4: '🌱 P4', P5: '💤 P5' };
function priorityLabel(priority) { return store.data?.projects.find(project => project.priority === priority)?.priorityLabel || projectPriorityLabels[priority] || priority; }
function compactRelative(value) {
  const result = relativeTime(value);
  return result.replace(/(\d+) minutes?/, '$1m').replace(/(\d+) hours?/, '$1h').replace(/(\d+) days?/, '$1d');
}
const reasonStatuses = ['paused', 'on-hold', 'blocked', 'dropped'];
const closedStatuses = ['done', 'dropped', 'archived'];
const priorityRank = priority => ({ high: 1, med: 2, low: 3, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 }[priority] || 3);
const store = {
  data: null, notes: null, trash: null, entries: new Map(), documents: new Map(), loading: true, refreshing: false,
  error: '', notesError: '', entryErrors: new Map(), selectedId: '', route: null, requestSequence: 0, entryRequests: new Set(), rangeKey: '',
  runningJobs: new Map(), writeRevisions: new Map(), popover: null, popoverAnchor: null, returnFocus: null, paletteReturnFocus: null, toasts: new Map(), pending: new Set(), documentReturnFocus: null,
};
const api = {
  async request(url, options = {}) {
    let response;
    try { response = await fetch(url, { cache: 'no-store', ...options }); } catch { throw new Error('Cannot reach 2b. Check that the dashboard server is running.'); }
    let result;
    try { result = await response.json(); } catch { throw new Error('The server returned an unreadable response. Try again.'); }
    if (!response.ok) throw new Error(String(result.error || `Request failed (${response.status}).`).split('\n')[0]);
    return result;
  },
  get: url => api.request(url),
  post: (url, body) => api.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-2b': '1' }, body: JSON.stringify(body) }),
};
function supportedFilters(view) { return view === 'inbox' ? ['folder'] : view === 'collections' ? ['area', 'project'] : view === 'reminders' ? ['area', 'project', 'status'] : ['area', 'project', 'status', 'priority']; }
function parseRoute() {
  const [path = '/home', query = ''] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  const kind = parts[0] || 'home';
  const route = { path, params, view: kind, id: '', drawer: false };
  if (kind === 't') { route.drawer = true; route.id = decodePath(parts.slice(1).join('/')); route.view = params.get('context') || 'home'; }
  if (kind === 'p') { route.id = decodePath(parts.slice(1).join('/')); route.view = 'project'; }
  if (!['home', 'projects', 'project', 'due', 'timeline', 'jobs', 'collections', 'reminders', 'inbox'].includes(route.view) && !route.view.startsWith('p/')) route.view = 'home';
  if (route.view.startsWith('p/')) { route.projectContext = route.view.slice(2); route.view = 'project'; }
  const supported = supportedFilters(route.view);
  for (const name of ['area', 'status', 'priority', 'project', 'folder']) if (!supported.includes(name)) params.delete(name);
  if (kind !== 't' && kind !== 'p') { const allowedStatuses = route.view === 'reminders' ? ['scheduled', 'sent', 'cancelled'] : route.view === 'projects' ? projectStatuses : taskStatuses; if (params.get('status')?.split(',').some(status => !allowedStatuses.includes(status))) params.delete('status'); }
  return route;
}
function routeUrl(path, updates = {}, keepFilters = true) {
  const params = keepFilters ? new URLSearchParams(store.route?.params) : new URLSearchParams();
  Object.entries(updates).forEach(([key, value]) => value === '' || value == null || value === false ? params.delete(key) : params.set(key, value));
  return `#/${path.replace(/^\//, '')}${params.size ? `?${params}` : ''}`;
}
function navigate(path, updates = {}, replace = false) {
  const url = routeUrl(path, updates);
  if (replace) { history.replaceState(null, '', url); routeChanged(); }
  else if (location.hash === url) routeChanged();
  else location.hash = url;
}
function setFilter(name, value, replace = false) { navigate(store.route.path, { [name]: value, selected: null }, replace); }
function mainPath() { return store.route.drawer ? store.route.params.get('context') || 'home' : store.route.path.replace(/^\//, ''); }
function navigateView(view) { closePopover(false); closePalette(false); navigate(view, { status: null, priority: null, q: null, context: null, note: null, doc: null, runlog: null, full: null, selected: null }); }
function focusLocator(control) {
  if (!control) return '';
  if (control.id) return `#${CSS.escape(control.id)}`;
  const attributes = ['data-open', 'data-note', 'data-document', 'data-runlog', 'data-row', 'data-note-row', 'data-action', 'data-id'];
  return attributes.filter(name => control.hasAttribute(name)).map(name => `[${name}="${CSS.escape(control.getAttribute(name))}"]`).join('');
}
function drawerIsOpen(route = store.route) {
  return Boolean(route?.drawer || ['note', 'doc', 'runlog'].some(name => route?.params.get(name)));
}
function rememberDrawerOpener(control, fallback = '') {
  if (!drawerIsOpen()) store.returnFocus = focusLocator(control) || fallback;
}
function restoreFocus(locator) {
  (locator && document.querySelector(locator) || element('main')).focus({ preventScroll: true });
}
function openEntry(id, opener = document.activeElement) {
  const project = store.data?.projects.some(project => project.id === id);
  rememberDrawerOpener(opener, `[data-open="${CSS.escape(id)}"]`);
  closePopover(false);
  if (project) navigate(`p/${encodeURIComponent(id)}`, { context: null, note: null, doc: null, runlog: null, full: null });
  else navigate(`t/${id.split('/').map(encodeURIComponent).join('/')}`, { context: mainPath(), note: null, doc: null, runlog: null, selected: id });
}
function closeDrawer() {
  navigate(mainPath(), { context: null, note: null, doc: null, runlog: null, full: null });
}
function openDocument(path, runlog = false, id = '', opener = document.activeElement) {
  if (drawerIsOpen()) store.documentReturnFocus = focusLocator(opener);
  else rememberDrawerOpener(opener);
  const target = runlog ? `t/${id.split('/').map(encodeURIComponent).join('/')}` : store.route.path;
  navigate(target, { ...(runlog ? { context: mainPath() } : {}), doc: runlog ? null : path, runlog: runlog ? path : null });
}
function closeDocument() {
  if (store.route.drawer || store.route.params.get('note')) navigate(store.route.path, { doc: null, runlog: null });
  else closeDrawer();
}
function getEntry(id) {
  const summary = [...(store.data?.projects || []), ...(store.data?.tasks || []), ...(store.data?.collections || []), ...(store.data?.notes || [])].find(entry => entry.id === id);
  const detail = store.entries.get(id);
  if (!summary && !detail) return null;
  const fields = detail?.fields || {};
  return { ...fields, ...detail, ...summary, fields, type: ['collection', 'note'].includes(detail?.kind || summary?.type) ? detail?.kind || summary.type : detail?.kind === 'project' || store.data?.projects.some(project => project.id === id) ? 'project' : 'task', statusReason: summary?.statusReason ?? fields['status-reason'], relativeDir: detail?.relativeDir };
}
const isProject = entry => entry?.type === 'project' || store.data?.projects.some(project => project.id === entry?.id);
function matchesFilters(entry) {
  const params = store.route.params;
  const query = (params.get('q') || '').toLowerCase().trim();
  const area = entry.area || store.data?.projects.find(project => project.id === entry.project)?.area;
  if (params.get('area') && params.get('area') !== area) return false;
  if (params.get('status') && !params.get('status').split(',').includes(entry.status)) return false;
  if (params.get('priority') && params.get('priority') !== entry.priority) return false;
  if (params.get('project') && params.get('project') !== (entry.project || entry.id)) return false;
  return !query || `${entry.body || ''} ${entry.title} ${entry.projectTitle || ''} ${entry.id} ${entry.statusReason || ''}`.toLowerCase().includes(query);
}
function compareTasks(first, second) { return priorityRank(first.priority) - priorityRank(second.priority) || (dayPattern.test(first.due || '') ? first.due : '9999').localeCompare(dayPattern.test(second.due || '') ? second.due : '9999') || String(second.lastActivity || '').localeCompare(String(first.lastActivity || '')) || first.id.localeCompare(second.id); }
function compareProjects(first, second) { return priorityRank(first.priority) - priorityRank(second.priority) || String(first.deadline || '9999').localeCompare(String(second.deadline || '9999')) || first.title.localeCompare(second.title); }
function statusIcon(status) { return ({ doing: 'doing', active: 'doing', done: 'done', archived: 'done', blocked: 'blocked', paused: 'pause', 'on-hold': 'pause', dropped: 'dropped' })[status] || 'circle'; }
function statusChip(entry) { return `<button class="chip status-chip status-${attribute(entry.status)}" ${entry.pending ? 'disabled' : ''} data-popover="status" data-id="${attribute(entry.id)}" aria-label="Status: ${attribute(entry.status)} for ${attribute(entry.title)}" aria-haspopup="dialog">${icon(statusIcon(entry.status))}${escapeHtml(entry.status)}</button>`; }
function priorityChip(entry) { const priority = entry.priority || (isProject(entry) ? 'P3' : 'med'); return `<button class="chip priority-chip ${isProject(entry) ? 'priority-project' : `priority-${attribute(priority)}`}" data-popover="priority" ${entry.pending ? 'disabled' : ''} data-id="${attribute(entry.id)}" aria-label="Priority: ${attribute(priority)} for ${attribute(entry.title)}" aria-haspopup="dialog">${escapeHtml(entry.priorityLabel || priorityLabel(priority))}</button>`; }
function dueChip(entry) {
  const date = isProject(entry) ? entry.deadline : entry.due;
  const overdue = dayPattern.test(date || '') && date < today() && !closedStatuses.includes(entry.status);
  return `<button class="chip due-chip ${overdue ? 'overdue' : ''}" data-popover="due" ${entry.pending ? 'disabled' : ''} data-id="${attribute(entry.id)}" title="${attribute(isProject(entry) ? 'Deadline' : 'Due date')}: ${attribute(date || 'No date')}" aria-haspopup="dialog">${icon(isProject(entry) ? 'flag' : 'due')}${formatDate(date)}</button>`;
}
function areaLabel(area) { return `<span class="area-label"><span class="area-mark ${attribute(area)}" aria-hidden="true"></span>${escapeHtml(area || 'No area')}</span>`; }
function pageHeading(title, description, right = '') { return `<div class="page-heading"><div><h1>${escapeHtml(title)}</h1>${description ? `<p>${description}</p>` : ''}</div>${right}</div>`; }
function emptyState(title, description, symbol = 'inbox', extra = '') { return `<div class="empty-state">${icon(symbol)}<h2>${escapeHtml(title)}</h2><p>${description}</p>${extra}</div>`; }
function emptyFiltered() {
  const params = store.route.params;
  const area = params.get('area') || '';
  const query = params.get('q');
  return emptyState('No matches', `No ${escapeHtml(area ? `${area} ` : '')}items match${query ? ` “${escapeHtml(query)}”` : ' these filters'}.`, 'search', '<button class="secondary-button" data-action="clear-filters">Clear filters</button>');
}
function hasFilters() { return ['area', 'status', 'priority', 'q', 'project'].some(name => store.route.params.get(name)); }
function skeletonRows() { return `<div aria-label="Loading dashboard" aria-busy="true">${Array.from({ length: 6 }, () => '<div class="skeleton-row"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>').join('')}</div>`; }
function taskRow(task, deadline = false) {
  const entry = deadline ? { ...task, type: 'project' } : task;
  return `<div class="task-row ${store.selectedId === task.id ? 'selected' : ''}" data-row="${attribute(task.id)}" tabindex="0" aria-label="${attribute(task.title)}, ${attribute(task.status)}">
    ${statusChip(entry)}<button class="task-title" data-open="${attribute(task.id)}">${deadline ? `${icon('flag')} ` : ''}${escapeHtml(task.title)}</button>
    <a class="task-project" href="${routeUrl(`p/${encodeURIComponent(task.project || task.id)}`, { context: null, doc: null, note: null, runlog: null })}">${deadline ? 'Project deadline' : escapeHtml(task.projectTitle || task.project)}</a>
    ${priorityChip(entry)}${dueChip(entry)}<time class="row-age" title="${attribute(task.lastActivity || '')}">${escapeHtml(compactRelative(task.lastActivity))}</time></div>`;
}
function taskList(tasks) { return `<div class="task-list">${tasks.map(task => taskRow(task)).join('')}</div>`; }
function section(title, contents, count, action = '') { return `<section class="section"><div class="section-heading"><h2>${escapeHtml(title)}${count != null ? `<span class="count">${count}</span>` : ''}</h2>${action}</div>${contents}</section>`; }
function renderWeekStrip() {
  const end = store.route.params.get('weekEnd') || (store.route.view === 'timeline' && store.data.to < today() ? store.data.to : today());
  const days = Array.from({ length: 7 }, (_, offset) => addDays(end, offset - 6));
  const events = store.data.events.filter(event => eventMatches(event, true));
  const counts = days.map(day => events.filter(event => event.at.startsWith(day)).length);
  const maximum = Math.max(1, ...counts);
  return `<div class="week-strip" aria-label="Activity this week">${days.map((day, index) => {
    const dues = store.data.tasks.filter(task => task.due === day && !closedStatuses.includes(task.status) && matchesFilters(task)).length + store.data.projects.filter(project => project.deadline === day && matchesFilters(project)).length;
    return `<button class="week-day ${day === today() ? 'today' : ''}" data-day="${day}" aria-label="${attribute(formatDate(day, { weekday: 'long' }))}: ${counts[index]} events, ${dues} due" aria-pressed="${store.route.params.get('day') === day}" ${day === today() ? 'aria-current="date"' : ''}><span>${new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(`${day}T12:00:00`))}</span><span class="day-number">${Number(day.slice(-2))}</span><span class="activity-track"><span class="activity-fill" style="width:${Math.round(counts[index] / maximum * 100)}%"></span></span><span class="due-markers">${Array.from({ length: Math.min(4, dues) }, () => '<span></span>').join('')}</span></button>`;
  }).join('')}</div>`;
}
function renderHome() {
  const tasks = store.data.tasks.filter(matchesFilters);
  const overdue = tasks.filter(task => !closedStatuses.includes(task.status) && dayPattern.test(task.due || '') && task.due < today()).sort(compareTasks);
  const inProgress = tasks.filter(task => task.status === 'doing' && !overdue.includes(task)).sort(compareTasks);
  const openTasks = tasks.filter(task => ['doing', 'todo'].includes(task.status)).sort((first, second) => (first.status === 'doing' ? 0 : 1) - (second.status === 'doing' ? 0 : 1) || compareTasks(first, second));
  const holds = [...store.data.projects.filter(project => ['paused', 'on-hold'].includes(project.status) && matchesFilters(project)), ...tasks.filter(task => task.status === 'blocked')];
  const dueSoon = [...tasks.filter(task => !closedStatuses.includes(task.status) && dayPattern.test(task.due || '') && task.due >= today() && task.due <= addDays(today(), 7)), ...store.data.projects.filter(project => !closedStatuses.includes(project.status) && dayPattern.test(project.deadline || '') && project.deadline >= today() && project.deadline <= addDays(today(), 7) && matchesFilters(project)).map(project => ({ ...project, type: 'project' }))].sort((first, second) => String(first.due || first.deadline).localeCompare(String(second.due || second.deadline)) || compareTasks(first, second));
  const hasDates = [...tasks, ...store.data.projects.filter(matchesFilters)].some(entry => dayPattern.test(entry.due || entry.deadline || ''));
  const failed = store.data.failed.filter(matchesFilters);
  const failureBanner = failed.length ? `<div class="banner">${icon('warning')}<div><strong>${failed.length} ${failed.length === 1 ? 'job needs' : 'jobs need'} attention</strong><p>${escapeHtml(failed.map(job => job.title).join(', '))}</p></div><button class="text-button" data-view="jobs">View jobs ${icon('right')}</button></div>` : '';
  const firstRun = !store.data.projects.length;
  return pageHeading('Home', 'A little space for what needs you.', `<span class="heading-meta">${formatDate(today(), { weekday: 'long', year: 'numeric' })}</span>`) + failureBanner + renderWeekStrip() + (firstRun ? emptyState('A place to begin', 'Create a project to give your tasks a home.', 'projects', creationButton('project', 'New project')) :
    section('Overdue', overdue.length ? taskList(overdue) : '<p class="empty-inline">No overdue tasks.</p>', overdue.length) + section('In progress', inProgress.length ? taskList(inProgress) : '<p class="empty-inline">No tasks in progress.</p>', inProgress.length) + section('Next actions', openTasks.length ? taskList(openTasks.filter(task => task.status === 'todo' && !overdue.includes(task)).slice(0, 5)) : hasFilters() ? emptyFiltered() : '<p class="empty-inline">Nothing needs action right now. Open a project to find your next task.</p>', openTasks.filter(task => task.status === 'todo' && !overdue.includes(task)).slice(0, 5).length, '<button class="text-button" data-view="projects">All projects ' + icon('right') + '</button>') +
    section('On hold', holds.length ? `<div class="hold-list">${holds.map(entry => `<div class="hold-row" data-row="${attribute(entry.id)}" tabindex="0">${statusChip(entry)}<div><button class="task-title" data-open="${attribute(entry.id)}">${escapeHtml(entry.title)}</button><p class="reason">${escapeHtml(entry.statusReason || 'No reason recorded.')}</p></div>${priorityChip(entry)}</div>`).join('')}</div>` : '<p class="empty-inline">No blocked tasks or paused projects.</p>', holds.length) +
    section('Due soon', dueSoon.length ? `<div class="task-list">${dueSoon.map(entry => taskRow(entry, entry.type === 'project')).join('')}</div>` : hasDates ? '<p class="empty-inline">Nothing due in the next 7 days.</p>' : '<p class="empty-inline">No due dates yet — press <kbd>d</kbd> on a task to set one.</p>', dueSoon.length, '<button class="text-button" data-view="due">See dates ' + icon('right') + '</button>'));
}
function renderProjectRow(project) {
  const counts = project.taskCounts;
  const progress = Math.round(counts.done / (counts.total || 1) * 100);
  return `<tr class="table-row ${store.selectedId === project.id ? 'selected' : ''}" data-row="${attribute(project.id)}" tabindex="0">
    <td class="project-name-cell"><div class="project-name">
      <span class="area-mark ${attribute(project.area)}" role="img" aria-label="${attribute(project.area)}"></span>
      <button class="project-title" data-open="${attribute(project.id)}">${escapeHtml(project.title)}</button>
    </div>${project.statusReason ? `<p class="reason">${escapeHtml(project.statusReason)}</p>` : ''}</td>
    <td>${statusChip(project)}</td><td>${priorityChip(project)}</td><td class="numeric">${counts.open} / ${counts.total}</td>
    <td><div class="progress" role="progressbar" aria-label="${attribute(project.title)} tasks complete" aria-valuemin="0" aria-valuemax="${counts.total || 1}" aria-valuenow="${counts.done}"><span style="width:${progress}%"></span></div></td>
    <td class="numeric">${formatDate(project.nextDue)}</td><td>${dueChip(project)}</td>
    <td class="numeric" title="${attribute(project.lastActivity)}">${escapeHtml(relativeTime(project.lastActivity))}</td>
  </tr>`;
}
function renderProjectTable(projects, sort, descending) {
  const columns = [['title', 'Project'], ['status', 'Status'], ['priority', 'Priority'], ['tasks', 'Open / total'], ['progress', 'Progress'], ['nextDue', 'Next due'], ['deadline', 'Deadline'], ['lastActivity', 'Activity']];
  const headings = columns.map(([key, title]) => `<th scope="col" ${sort === key ? `aria-sort="${descending ? 'descending' : 'ascending'}"` : ''}>
    <button data-sort="${key}">${title}${sort === key ? icon('sort') : ''}</button></th>`).join('');
  return `<div class="table-scroll"><table><thead><tr>${headings}</tr></thead><tbody>${projects.map(renderProjectRow).join('')}</tbody></table></div>`;
}
function renderProjects() {
  const sort = store.route.params.get('sort') || 'priority';
  const descending = store.route.params.get('direction') === 'desc';
  const projects = store.data.projects.filter(matchesFilters).sort((first, second) => {
    const comparison = sort === 'priority' ? compareProjects(first, second) : sort === 'tasks' ? first.taskCounts.open - second.taskCounts.open : sort === 'progress' ? (first.taskCounts.done / (first.taskCounts.total || 1)) - (second.taskCounts.done / (second.taskCounts.total || 1)) : String(first[sort] || '9999').localeCompare(String(second[sort] || '9999'));
    return (descending ? -1 : 1) * comparison;
  });
  const active = projects.filter(project => project.status === 'active');
  const holds = projects.filter(project => ['paused', 'on-hold'].includes(project.status));
  const done = projects.filter(project => closedStatuses.includes(project.status));
  return pageHeading('Projects', 'The bigger picture, with room for the next step.', `${creationButton('project', 'New project')}`) + (!projects.length ? hasFilters() ? emptyFiltered() : emptyState('Your first project starts here', 'Create a project to give related tasks a home.', 'projects', creationButton('project', 'New project')) :
    (active.length ? section('Active', renderProjectTable(active, sort, descending), active.length) : '') + (holds.length ? section('On hold', renderProjectTable(holds, sort, descending), holds.length) : '') + (done.length ? `<details class="section" data-url-details="done" ${store.route.params.get('done') === '1' ? 'open' : ''}><summary>Done <span class="count">${done.length}</span></summary>${renderProjectTable(done, sort, descending)}</details>` : ''));
}
function renderDescription(entry) {
  const summary = getEntry(entry.id);
  const body = String(entry.body || '').replace(/^\s*#\s+[^\n]*(?:\n|$)/, '').trim();
  if (summary?.hasReadme === false || (!body && !entry.bodyHtml)) {
    const command = `2b: write the readme for ${entry.id}`;
    return `<div class="description-hint"><p>No description yet. Ask your agent:</p><code>${escapeHtml(command)}</code><br><button class="secondary-button" data-copy="${attribute(command)}">${icon('copy')}Copy instruction</button></div>`;
  }
  const template = document.createElement('template');
  template.innerHTML = entry.bodyHtml || '<p>Description is not available. Reload after the server update.</p>';
  const heading = template.content.firstElementChild;
  if (heading?.tagName === 'H1' && heading.textContent.trim() === summary?.title?.trim()) heading.remove();
  return `<div class="prose">${template.innerHTML}</div>`;
}
function safeHref(value) {
  try {
    const url = new URL(value, location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? attribute(url.href) : '#';
  } catch { return '#'; }
}
function fileUrl(path) { return `/api/file?path=${encodeURIComponent(path)}`; }
function entryFile(entry, path) { return path.startsWith(`${entry.relativeDir}/`) ? path : `${entry.relativeDir}/${path}`; }
function renderLinks(entry) {
  const fields = entry.fields || entry;
  const links = (fields.links || []).map(link => `<li>${escapeHtml(link.type)} <button class="text-button" data-open="${attribute(link.to)}">${escapeHtml(getEntry(link.to)?.title || link.to)}</button></li>`);
  const reverse = (entry.reverseLinks || []).map(link => `<li>Linked from <button class="text-button" data-open="${attribute(link.from)}">${escapeHtml(getEntry(link.from)?.title || link.from)}</button> <span class="count">${escapeHtml(link.type)}</span></li>`);
  const resources = (fields.resources || []).map(resource => `<li>${resource.url ? `<a href="${safeHref(resource.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(resource.title || resource.url)} ${icon('external')}</a>` : resource.path ? `<a href="${fileUrl(entryFile(entry, resource.path))}" target="_blank" rel="noopener noreferrer">${escapeHtml(resource.title || resource.path)}</a>` : escapeHtml(resource.title)}</li>`);
  return section('Links & backlinks', links.length + reverse.length + resources.length ? `<ul class="link-list">${[...links, ...reverse, ...resources].join('')}</ul>` : '<p class="count">No links yet.</p>');
}
function renderRecentEvents(events = []) { return events.length ? events.slice(0, 20).map(renderEvent).join('') : '<p class="count">No activity recorded yet.</p>'; }
function renderProjectPage() {
  const id = store.route.projectContext || store.route.id;
  const entry = store.entries.get(id);
  const project = getEntry(id);
  if (store.entryErrors.has(id)) return renderEntryError(id);
  if (!entry) { ensureEntry(id); return pageHeading(project?.title || 'Project', 'Loading project…') + skeletonRows(); }
  const tasks = store.data.tasks.filter(task => task.project === id && matchesFilters(task)).sort(compareTasks);
  const metadata = `<div class="metadata">${areaLabel(project.area)}${statusChip(project)}${priorityChip(project)}<span>Started ${formatDate(project.started)}</span>${dueChip(project)}</div>`;
  const groups = ['doing', 'todo', 'blocked', 'paused', 'done', 'dropped'].map(status => {
    const items = tasks.filter(task => task.status === status);
    if (!items.length) return '';
    if (closedStatuses.includes(status)) return `<details class="section" data-url-details="tasks-${status}" ${store.route.params.get(`tasks-${status}`) === '1' ? 'open' : ''}><summary>${status === 'done' ? 'Done' : 'Dropped'} <span class="count">${items.length}</span></summary>${taskList(items)}</details>`;
    return section(({ doing: 'In progress', todo: 'To do', blocked: 'Blocked', paused: 'Paused' })[status], taskList(items), items.length);
  }).join('');
  return pageHeading(project.title, '', `<button class="text-button" data-view="projects">${icon('left')} All projects</button>`) + metadata + renderDescription(entry) + section('Collections', contentList(entry.collections || []), entry.collections?.length || 0, creationButton('collection', 'New collection', id)) + section('Tasks', groups || (hasFilters() ? emptyFiltered() : '<p class="empty-inline">No tasks yet. Add one with <code>2b new task ' + escapeHtml(id) + ' task-slug --title "Task title"</code>.</p>'), tasks.length, creationButton('task', 'New task', id)) + renderLinks(entry) + section('Recent activity', renderRecentEvents(entry.recentEvents), entry.recentEvents?.length || 0);
}
function contentList(entries) {
  return entries.length ? `<ul class="link-list">${entries.map(entry => `<li><button class="text-button" data-open="${attribute(entry.id)}">${icon(entry.type === 'collection' ? 'collections' : 'file')}${escapeHtml(entry.title)}</button>${entry['note-type'] ? ` <span class="count">${escapeHtml(entry['note-type'])}</span>` : ''}</li>`).join('')}</ul>` : '<p class="empty-inline">No content yet.</p>';
}
function captureForm(kind, selectedProject) {
  const destination = kind === 'capture' ? '<label>Save to<select name="folder"><option value="inbox">Inbox</option><option value="learnings">Learnings</option></select></label>' : kind === 'project' ? '<label>Area<select name="area"><option value="personal">Personal</option><option value="work">Work</option></select></label>' : `<label>Project<select name="project" required>${store.data.projects.map(project => `<option value="${attribute(project.id)}" ${project.id === selectedProject ? 'selected' : ''}>${escapeHtml(project.title)}</option>`).join('')}</select></label>`;
  return `<form id="${kind}-form" class="v2-form">${destination}<label>Title<input name="title" required maxlength="200"></label><label>Description<textarea name="body" required rows="5"></textarea></label>${kind === 'job' ? '<label>Schedule<input name="every" required placeholder="weekdays 09:00"></label><p class="count">Uses this Mac’s local time zone. Runs Codex with the description as its instruction. Advanced schedules: daily 19:00, mon,fri 10:00, or hourly.</p>' : ''}<button type="submit" class="primary-button">Create ${kind}</button></form>`;
}
function updateRepeatControls(form) {
  const repeating = form.elements['reminder-mode'].value === 'repeat';
  const kind = form.elements['repeat-kind'].value;
  for (const [selector, visible] of [['[data-repeat-time]', kind !== 'hourly' && kind !== 'custom'], ['[data-repeat-custom]', kind === 'custom']]) {
    const field = form.querySelector(selector);
    field.hidden = !visible;
    field.querySelector('input').disabled = !repeating || !visible;
    field.querySelector('input').required = repeating && visible;
  }
}
function collectionForm(selectedProject = '') {
  return `<form id="collection-form" class="v2-form"><label>Project<select name="project" required>${store.data.projects.map(project => `<option value="${attribute(project.id)}" ${project.id === selectedProject ? 'selected' : ''}>${escapeHtml(project.title)}</option>`).join('')}</select></label><label>Title<input name="title" required maxlength="200"></label><label>Description<textarea name="body" required></textarea></label><button type="submit" class="primary-button">Create collection</button></form>`;
}
function noteForm(selectedCollection = '') {
  return `<form id="note-form" class="v2-form"><label>Collection<select name="collection" required>${store.data.collections.map(collection => `<option value="${attribute(collection.id)}" ${collection.id === selectedCollection ? 'selected' : ''}>${escapeHtml(collection.title)} · ${escapeHtml(collection.project)}</option>`).join('')}</select></label><label>Title<input name="title" required maxlength="200"></label><label>Type<select name="type">${['general', 'journal', 'reflection', 'learning', 'research', 'decision', 'meeting'].map(type => `<option>${type}</option>`).join('')}</select></label><label>Content<textarea name="body" required rows="5"></textarea></label><button type="submit" class="primary-button">Save note</button></form>`;
}
function creationButton(kind, label, project = '') {
  return `<button class="${kind === 'note' ? 'secondary-button' : 'primary-button'}" data-action="new-${kind}" ${project ? `data-project="${attribute(project)}"` : ''} aria-haspopup="dialog">${escapeHtml(label)}</button>`;
}
function renderCollections() {
  if (!store.data.projects.length) return pageHeading('Collections', 'Notes and files, grouped within your projects.') + emptyState('Create a project first', 'Each collection belongs to a project. Create one with the CLI.', 'collections');
  const collections = store.data.collections.filter(collection => matchesFilters(collection) || store.data.notes.some(note => note.collection === collection.id && matchesFilters(note)));
  const actions = `<div class="creation-actions">${creationButton('collection', 'New collection')}${store.data.collections.length ? creationButton('note', 'New note') : ''}</div>`;
  return pageHeading('Collections', 'Notes and files, grouped within your projects.', actions) +
    section('Collections', collections.length ? collections.map(collection => section(collection.title, `<p class="count">${escapeHtml(collection.project)}</p>${contentList([collection, ...store.data.notes.filter(note => note.collection === collection.id && (!store.route.params.get('q') || matchesFilters(note)))])}`)).join('') : hasFilters() ? emptyFiltered() : '<p class="empty-inline">Create a collection to start saving notes.</p>', collections.length);
}
function reminderDate(reminder, value) {
  return value ? new Intl.DateTimeFormat(undefined, { timeZone: reminder.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}
function reminderForm() {
  return `<form id="reminder-form" class="v2-form"><label>Message<input name="message" required maxlength="1000"></label><label>Schedule<select name="reminder-mode"><option value="once">One time</option><option value="repeat">Repeating</option></select></label><label data-schedule-field="once">Date and time<input name="at" type="datetime-local" required></label><div data-schedule-field="repeat" hidden><label>Repeat<select name="repeat-kind" disabled><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="mon">Every Monday</option><option value="fri">Every Friday</option><option value="hourly">Every hour</option><option value="custom">Advanced schedule</option></select></label><label data-repeat-time>Time<input name="repeat-time" type="time" value="09:00" disabled></label><label data-repeat-custom hidden>Schedule syntax<input name="every" placeholder="mon,fri 10:00" disabled></label></div><p class="count">Delivery uses the saved time zone. Notifications can arrive about one minute late. Missed reminders arrive when this Mac can run.</p><label>Time zone<input name="timezone" required value="${attribute(Intl.DateTimeFormat().resolvedOptions().timeZone)}"></label><details class="creation-options"><summary>Link to a project or task (optional)</summary><label>Project (optional)<select name="project"><option value="">Outside projects</option>${store.data.projects.map(project => `<option value="${attribute(project.id)}">${escapeHtml(project.title)}</option>`).join('')}</select></label><label>Task (optional)<select name="task"><option value="">No task</option>${store.data.tasks.map(task => `<option value="${attribute(task.id)}">${escapeHtml(task.title)} · ${escapeHtml(task.project)}</option>`).join('')}</select></label></details><button type="submit" class="primary-button">Add reminder</button></form>`;
}
function renderReminders() {
  const reminders = store.data.reminders.filter(reminder => {
    const params = store.route.params;
    return (!params.get('q') || `${reminder.title} ${reminder.message}`.toLowerCase().includes(params.get('q').toLowerCase()))
      && (!params.get('project') || reminder.project === params.get('project'))
      && (!params.get('status') || params.get('status').split(',').includes(reminder.status))
      && (!params.get('area') || store.data.projects.find(project => project.id === reminder.project)?.area === params.get('area'));
  });
  return pageHeading('Reminders', 'A prompt to act, at the time you choose.', creationButton('reminder', 'New reminder')) +
    ['scheduled', 'sent', 'cancelled'].map(status => {
      const items = reminders.filter(reminder => reminder.status === status);
      return section(status[0].toUpperCase() + status.slice(1), items.length ? items.map(reminder => `<article class="reminder-card"><h3>${escapeHtml(reminder.title)}</h3>${reminder.message !== reminder.title ? `<p>${escapeHtml(reminder.message)}</p>` : ''}<p class="count">${escapeHtml(reminderDate(reminder, reminder.nextAt || reminder.lastSent))} · ${escapeHtml(reminder.timezone)}${reminder.every ? ' · ' + escapeHtml(reminder.every) : ''}</p>${reminder.task || reminder.project ? `<button class="text-button" data-open="${attribute(reminder.task || reminder.project)}">${escapeHtml(reminder.task || reminder.project)}</button>` : ''}${reminder.lastError ? `<p role="alert">${escapeHtml(reminder.lastError)}</p>` : ''}<div class="reminder-actions">${status === 'scheduled' ? `<button class="secondary-button" data-action="cancel-reminder" data-id="${attribute(reminder.id)}">Cancel reminder</button>` : ''}<button class="text-button" data-document="${attribute(reminder.id + '/log.md')}">View history</button></div></article>`).join('') : '<p class="empty-inline">No ' + status + ' reminders.</p>', items.length);
    }).join('');
}
let creationOpener = null;
const creationDrafts = new Map();
function openCreationDialog(kind, opener) {
  closePopover(false);
  closePalette(false);
  const dialog = element('creation-dialog');
  const project = opener?.dataset.project || store.route.params.get('project') || '';
  const title = { project: 'New project', task: 'New task', capture: 'Capture note', job: 'New job', collection: 'New collection', note: 'New note', reminder: 'New reminder' }[kind];
  const form = ['project', 'task', 'capture', 'job'].includes(kind) ? captureForm(kind, project) : kind === 'collection' ? collectionForm(project) : kind === 'note' ? noteForm() : reminderForm();
  creationOpener = { element: opener, action: opener?.dataset.action, project: opener?.dataset.project };
  dialog.innerHTML = `<header class="creation-dialog-header"><h2 id="creation-dialog-title">${title}</h2><button type="button" class="icon-button" data-action="close-creation" aria-label="Close ${title.toLowerCase()}">${icon('close')}</button></header>${form}`;
  const formElement = dialog.querySelector('form');
  const submit = formElement.querySelector('[type="submit"]');
  const footer = document.createElement('div');
  footer.className = 'creation-dialog-footer';
  footer.innerHTML = '<button type="button" class="secondary-button" data-action="close-creation">Cancel</button>';
  footer.append(submit);
  const error = document.createElement('p');
  error.className = 'creation-error';
  error.id = 'creation-error';
  error.setAttribute('role', 'alert');
  error.tabIndex = -1;
  formElement.append(error, footer);
  dialog.dataset.kind = kind;
  for (const [name, value] of creationDrafts.get(kind) || []) { const control = formElement.elements.namedItem(name); if (control) control.value = value; }
  if (kind === 'reminder') { formElement.querySelector('[name="reminder-mode"]').dispatchEvent(new Event('change', { bubbles: true })); }
  dialog.showModal();
  formElement.querySelector(kind === 'reminder' ? '[name="message"]' : '[name="title"]').focus();
}
function closeCreationDialog() {
  const dialog = element('creation-dialog');
  if (!dialog.open) return;
  creationDrafts.set(dialog.dataset.kind, [...new FormData(dialog.querySelector('form'))]);
  dialog.close();
  const opener = creationOpener;
  const replacement = opener?.action ? [...document.querySelectorAll(`[data-action="${opener.action}"]`)].find(button => !opener.project || button.dataset.project === opener.project) : null;
  (opener?.element?.isConnected ? opener.element : replacement)?.focus();
}
async function saveV2Form(form) {
  const button = form.querySelector('[type="submit"]');
  if (button.disabled) return;
  const values = Object.fromEntries([...new FormData(form)].filter(([, value]) => String(value).trim()));
  if (values['reminder-mode'] === 'repeat' && values['repeat-kind'] !== 'custom') values.every = values['repeat-kind'] === 'hourly' ? 'hourly' : `${values['repeat-kind']} ${values['repeat-time']}`;
  for (const key of ['reminder-mode', 'repeat-kind', 'repeat-time']) delete values[key];
  values.slug = slugify(values.title || values.message) + '-' + Date.now().toString(36);
  const route = ({ 'capture-form': 'capture', 'job-form': 'task', 'project-form': 'project', 'task-form': 'task', 'collection-form': 'collection', 'note-form': 'note', 'reminder-form': 'reminder' })[form.id];
  if (route === 'reminder' && Boolean(values.at) === Boolean(values.every)) { form.querySelector('.creation-error').textContent = 'Set either a date and time or a repeat schedule.'; return; }
  form.querySelector('.creation-error').textContent = '';
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = 'Saving…';
  form.setAttribute('aria-busy', 'true');
  try {
    const result = await api.post('/api/' + route, values);
    if (element('creation-dialog').contains(form)) closeCreationDialog();
    creationDrafts.delete(element('creation-dialog').dataset.kind);
    if (route === 'capture') store.notes = null;
    await loadState({ force: true });
    showToast(result.warnings?.length ? 'Saved. Scheduling needs attention: ' + result.warnings.join('; ') : `${route[0].toUpperCase() + route.slice(1)} saved.`);
  } catch (error) {
    const message = form.querySelector('.creation-error');
    if (form.isConnected) { message.textContent = error.message; message.focus(); }
    else showToast(error.message, null, { error: true });
  }
  finally { button.disabled = false; button.textContent = originalLabel; form.removeAttribute('aria-busy'); }
}
async function cancelReminder(id) {
  const key = 'cancel:' + id;
  if (store.pending.has(key)) return;
  store.pending.add(key);
  try {
    const result = await api.post('/api/reminder/cancel', { id });
    await loadState({ force: true });
    showToast(result.warnings?.length ? 'Cancelled. Scheduling needs attention: ' + result.warnings.join('; ') : 'Reminder cancelled.');
  } catch (error) { showToast(error.message, null, { error: true }); }
  finally { store.pending.delete(key); }
}
function renderDue() {
  const entries = [...store.data.tasks.filter(task => !closedStatuses.includes(task.status)), ...store.data.projects.filter(project => !closedStatuses.includes(project.status)).map(project => ({ ...project, type: 'project' }))].filter(matchesFilters);
  const groups = new Map();
  entries.forEach(entry => {
    const date = isProject(entry) ? entry.deadline : entry.due;
    const group = !dayPattern.test(date || '') ? 'No date' : date < today() ? 'Overdue' : date === today() ? 'Today' : date === addDays(today(), 1) ? 'Tomorrow' : date <= addDays(today(), 7) ? date : 'Later';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  });
  const dated = entries.some(entry => dayPattern.test(entry.due || entry.deadline || ''));
  const intro = !dated ? emptyState('Give the next step a date', 'Due dates put time-sensitive work in one place. Select a task and press <kbd>d</kbd>, use its date chip, or use the CLI.', 'due', '<pre>2b set &lt;task&gt; due 2026-11-01</pre>') : '';
  const keys = ['Overdue', 'Today', 'Tomorrow', ...[...groups.keys()].filter(key => dayPattern.test(key)).sort(), 'Later', 'No date'];
  return pageHeading('Due', 'A clear view of what is coming up.') + (hasFilters() && !entries.length ? emptyFiltered() : intro + keys.map(key => {
    const items = groups.get(key);
    if (!items?.length) return '';
    items.sort((first, second) => String(first.due || first.deadline || '9999').localeCompare(String(second.due || second.deadline || '9999')) || compareTasks(first, second));
    const contents = `<div class="task-list">${items.map(entry => taskRow(entry, isProject(entry))).join('')}</div>`;
    if (key === 'No date') return `<details class="section" data-url-details="no-date" ${store.route.params.get('no-date') === '1' ? 'open' : ''}><summary>No date <span class="count">${items.length}</span></summary>${contents}</details>`;
    const title = dayPattern.test(key) ? formatDate(key, { weekday: 'long' }) : key;
    return `<section class="section ${key === 'Overdue' ? 'overdue-section' : ''}"><div class="section-heading"><h2 ${key === 'Overdue' ? 'style="color:var(--amber)"' : ''}>${escapeHtml(title)}<span class="count">${items.length}</span></h2>${key === 'Overdue' ? '<button class="text-button" data-popover="reschedule">Reschedule all…</button>' : ''}</div>${contents}</section>`;
  }).join(''));
}
function eventMatches(event, ignoreDay = false) {
  const project = store.data.projects.find(project => project.id === event.project);
  const task = store.data.tasks.find(task => task.id === event.task);
  const entry = { ...project, ...task, title: `${event.taskTitle || ''} ${event.projectTitle || ''} ${event.event} ${event.detail}`, project: event.project };
  if (!ignoreDay && store.route.params.get('day') && !event.at.startsWith(store.route.params.get('day'))) return false;
  return matchesFilters(entry);
}
function renderEvent(event) {
  const entryId = event.entry || event.task || event.project;
  const title = event.entryTitle || event.taskTitle || getEntry(entryId)?.title || event.projectTitle || event.project;
  return `<div class="event-row"><time class="event-time" title="${attribute(event.at)}">${escapeHtml(event.at.slice(11, 16) || '')}</time><span class="event-icon">${icon(event.event.includes('status') ? 'circle' : 'activity')}</span><div class="event-copy"><button ${event.reminder ? `data-document="${attribute(event.reminder + '/log.md')}"` : `data-open="${attribute(entryId)}"`}>${escapeHtml(event.reminder ? event.detail || 'Reminder' : title)}</button> <span>${escapeHtml(event.event)}</span><p>${escapeHtml(event.projectTitle || event.project)}${event.detail ? ` · ${escapeHtml(event.detail)}` : ''}</p></div></div>`;
}
function renderActivity() {
  const events = store.data.events.filter(event => eventMatches(event));
  if (!events.length) return hasFilters() ? emptyFiltered() : emptyState('A quiet stretch', 'Activity will appear here as you work. Choose a wider date range to look back.', 'timeline');
  const days = [...new Set(events.map(event => event.at.slice(0, 10)))].sort().reverse();
  return days.map(day => {
    const dayEvents = events.filter(event => event.at.startsWith(day));
    const folds = new Map();
    dayEvents.forEach(event => {
      const key = `${event.project}|${event.event}`;
      if (!folds.has(key)) folds.set(key, []);
      folds.get(key).push(event);
    });
    const emitted = new Set();
    return `<section class="feed-day"><h2 class="feed-day-heading">${day === today() ? 'Today' : formatDate(day, { weekday: 'long' })}<span class="count"> · ${dayEvents.length} events</span></h2>${dayEvents.map(event => {
      const key = `${event.project}|${event.event}`;
      const related = folds.get(key);
      if (related.length < 3) return renderEvent(event);
      if (emitted.has(key)) return '';
      emitted.add(key);
      const label = /import/i.test(event.detail) ? `${related.length} tasks imported` : `${related.length} ${event.event} events`;
      return `<details class="event-fold"><summary>${escapeHtml(label)} <span class="count">in ${escapeHtml(event.projectTitle || event.project)}</span></summary>${related.map(renderEvent).join('')}</details>`;
    }).join('')}</section>`;
  }).join('');
}
function laneRange() {
  const month = store.route.params.get('laneMonth') || today().slice(0, 7);
  const first = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : `${today().slice(0, 7)}-01`;
  const months = store.route.params.get('zoom') === 'quarter' ? 3 : 1;
  const endDate = new Date(`${first}T12:00:00`);
  endDate.setMonth(endDate.getMonth() + months);
  endDate.setDate(0);
  return { from: first, to: localDay(endDate) };
}
function renderLanes() {
  const { from, to } = laneRange();
  const length = Math.max(1, daysBetween(from, to));
  const position = day => Math.max(0, Math.min(100, daysBetween(from, day) / length * 100));
  const projects = store.data.projects.filter(matchesFilters).sort(compareProjects);
  const controls = `<div class="view-controls"><div class="segmented" aria-label="Timeline zoom">${['month', 'quarter'].map(zoom => `<button data-filter="zoom" data-value="${zoom}" aria-pressed="${(store.route.params.get('zoom') || 'month') === zoom}">${zoom === 'month' ? 'Month' : 'Quarter'}</button>`).join('')}</div><input type="month" aria-label="Lane start month" data-query="laneMonth" value="${from.slice(0, 7)}"><span class="count">Read only</span></div>`;
  if (!projects.length) return controls + (hasFilters() ? emptyFiltered() : emptyState('No projects to place', 'Projects appear from their start date to their deadline or last activity.', 'projects'));
  return controls + `<div class="table-scroll"><div class="lanes"><div class="lane-heading"><span class="count">Project</span><div class="lane-scale">${Array.from({ length: 5 }, (_, offset) => `<span>${formatDate(addDays(from, Math.round(length * offset / 4)))}</span>`).join('')}</div></div>${projects.map(project => {
    const start = dayPattern.test(project.started || '') ? project.started : from;
    const end = dayPattern.test(project.deadline || '') ? project.deadline : project.lastActivity?.slice(0, 10) || start;
    const overlaps = start <= to && end >= from;
    const left = position(start);
    const width = Math.max(.4, position(end) - left);
    const eventDays = [...new Set(store.data.events.filter(event => event.project === project.id && event.at.slice(0, 10) >= from && event.at.slice(0, 10) <= to).map(event => event.at.slice(0, 10)))];
    return `<div class="lane ${closedStatuses.includes(project.status) ? 'closed' : ''}"><button class="project-title" data-open="${attribute(project.id)}">${escapeHtml(project.title)}</button><div class="lane-track" role="img" aria-label="${attribute(project.title)}: ${attribute(formatDate(start))} to ${attribute(formatDate(end))}${overlaps ? '' : ', outside this range'}">${overlaps ? `<span class="lane-bar" style="left:${left}%;width:${Math.min(width, 100 - left)}%" title="${attribute(start)} — ${attribute(end)}"></span>` : ''}${eventDays.map(day => `<span class="lane-tick" style="left:${position(day)}%" title="Activity ${day}"></span>`).join('')}</div></div>`;
  }).join('')}</div></div>`;
}
function renderTimeline() {
  const params = store.route.params;
  const tab = params.get('tab') || 'activity';
  const range = params.get('range') || '7d';
  const rangeControls = `<div class="view-controls"><div class="segmented" aria-label="Activity range">${[['7d', '7 days'], ['30d', '30 days'], ['month', 'Month'], ['custom', 'Custom']].map(([value, label]) => `<button data-filter="range" data-value="${value}" aria-pressed="${range === value}">${label}</button>`).join('')}</div>${range === 'month' ? `<input type="month" aria-label="Activity month" data-query="month" value="${attribute(params.get('month') || today().slice(0, 7))}">` : range === 'custom' ? `<div class="custom-range"><input type="date" data-query="from" aria-label="Range from" value="${attribute(params.get('from') || addDays(today(), -6))}"><span class="count">to</span><input type="date" data-query="to" aria-label="Range to" value="${attribute(params.get('to') || today())}"></div>` : ''}<select data-query="project" aria-label="Filter by project"><option value="">All projects</option>${store.data.projects.map(project => `<option value="${attribute(project.id)}" ${params.get('project') === project.id ? 'selected' : ''}>${escapeHtml(project.title)}</option>`).join('')}</select>${params.get('day') ? `<button class="filter-button active" data-filter="day" data-value="">${formatDate(params.get('day'))}${icon('close')}</button>` : ''}</div>`;
  return pageHeading('Timeline', 'See what changed and what you worked on.') + `<div class="tabs" role="tablist" aria-label="Timeline view"><button class="tab" role="tab" id="activity-tab" aria-controls="timeline-panel" aria-selected="${tab === 'activity'}" data-filter="tab" data-value="activity">Activity</button><button class="tab" role="tab" id="lanes-tab" aria-controls="timeline-panel" aria-selected="${tab === 'lanes'}" data-filter="tab" data-value="lanes">Lanes</button></div>` + `<div id="timeline-panel" role="tabpanel" aria-labelledby="${tab === 'lanes' ? 'lanes-tab' : 'activity-tab'}">${tab === 'lanes' ? renderLanes() : rangeControls + renderWeekStrip() + (store.refreshing ? skeletonRows() : renderActivity())}</div>`;
}
function runLogPath(job, file) {
  const relativeDir = store.entries.get(job.id)?.relativeDir || `projects/${job.project}/tasks/${job.id.split('/').slice(1).join('/')}`;
  return file.startsWith('projects/') ? file : `${relativeDir}/${file.startsWith('runs/') ? file : `runs/${file}`}`;
}
function renderJobs() {
  const jobs = store.data.jobs.filter(job => matchesFilters({ ...job, area: store.data.projects.find(project => project.id === job.project)?.area })).sort(compareTasks);
  if (!jobs.length) return pageHeading('Jobs', 'Recurring work, with a clear record of each run.', creationButton('job', 'New job') + store.data.trash ? `<button class="secondary-button" data-popover="trash">${icon('trash')}Trash (${store.data.trash})</button>` : '') + (hasFilters() ? emptyFiltered() : emptyState('Let the routine take care of itself', 'Create a recurring task with a schedule and a full instruction. It will appear here with its next run and history.', 'jobs', '<pre>2b new task &lt;project&gt; &lt;slug&gt; --title "&lt;title&gt;" --every "daily 19:00" --run agent --body "&lt;instruction&gt;"</pre><p>For example:</p><pre>2b new task personal evening-review --title "Evening review" --every "daily 19:00" --run agent --body "Review today’s activity and write a short summary."</pre>'));
  return pageHeading('Jobs', 'Recurring work, with a clear record of each run.', creationButton('job', 'New job') + `<div class="job-actions"><button class="secondary-button" data-action="reload">${icon('restore')}Refresh</button><button class="secondary-button" data-popover="trash">${icon('trash')}Trash${store.data.trash ? ` (${store.data.trash})` : ''}</button></div>`) + `<div class="table-scroll"><table><thead><tr>${['Name', 'Schedule', 'Next run', 'Schedule service', 'Last run', 'History', 'Status', 'Actions'].map(title => `<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${jobs.map(job => {
    const entry = getEntry(job.id) || job;
    const failed = job.lastResult === 'error';
    const resultLabel = job.lastResult === 'ok' ? 'Passed' : failed ? 'Failed' : 'Not run';
    const paused = ['paused', 'blocked', 'on-hold'].includes(job.status);
    return `<tr class="table-row" data-row="${attribute(job.id)}" tabindex="0"><td class="project-name-cell"><button class="project-title" data-open="${attribute(job.id)}">${escapeHtml(job.title)}</button><p class="count">${escapeHtml(store.data.projects.find(project => project.id === job.project)?.title || job.project)}</p>${entry.statusReason ? `<p class="reason">${escapeHtml(entry.statusReason)}</p>` : ''}</td><td>${escapeHtml(job.schedule || job.every)}</td><td class="numeric" title="${attribute(job.nextRun || '')}">${job.nextRun ? escapeHtml(relativeTime(job.nextRun)) : 'Paused'}</td><td><span class="result">${icon(job.loaded ? 'check' : 'circle')}${job.loaded ? 'Ready' : paused ? 'Paused' : 'Not registered'}</span></td><td><button class="text-button" ${job.lastLog ? `data-runlog="${attribute(runLogPath(job, job.lastLog))}" data-id="${attribute(job.id)}"` : 'disabled'}>${escapeHtml(formatTimestamp(job.lastRun))}</button><br><span class="result ${failed ? 'error' : job.lastResult === 'ok' ? 'ok' : ''}">${icon(failed ? 'warning' : job.lastResult === 'ok' ? 'check' : 'circle')}${resultLabel}</span></td><td><div class="history-dots">${(job.runs || []).slice(0, 10).map(run => `<button class="history-dot ${run.ok === true ? 'ok' : run.ok === false ? 'error' : ''}" data-runlog="${attribute(runLogPath(job, run.file))}" data-id="${attribute(job.id)}" aria-label="${attribute(formatTimestamp(run.at))}: ${run.ok === true ? 'passed' : run.ok === false ? 'failed' : 'unknown result'}"><span></span></button>`).join('') || '<span class="count">No runs</span>'}</div></td><td>${statusChip(entry)}</td><td><div class="job-actions"><button class="secondary-button" data-action="run" data-id="${attribute(job.id)}" ${store.runningJobs.has(job.id) ? 'disabled' : ''}>${icon('play')}${store.runningJobs.get(job.id) || 'Run now'}</button><button class="icon-button" aria-label="${paused ? 'Resume' : 'Pause'} ${attribute(job.title)}" ${paused ? 'data-action="resume"' : 'data-popover="pause"'} data-id="${attribute(job.id)}">${icon(paused ? 'play' : 'pause')}</button><button class="icon-button" aria-label="Delete ${attribute(job.title)}" data-popover="delete" ${store.runningJobs.has(job.id) ? 'disabled' : ''} data-id="${attribute(job.id)}">${icon('trash')}</button></div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function renderInbox() {
  if (!store.notes && !store.notesError) { loadInbox(); return pageHeading('Inbox', 'Small thoughts, ready when you are.', creationButton('capture', 'Capture note')) + skeletonRows(); }
  if (store.notesError) return pageHeading('Inbox', '') + `<div class="banner" role="alert">${icon('warning')}${escapeHtml(store.notesError)}<button data-action="reload-inbox">Try again</button></div>`;
  const query = (store.route.params.get('q') || '').toLowerCase();
  const folder = store.route.params.get('folder') || '';
  const notes = store.notes.filter(note => (!folder || note.folder === folder) && (!query || `${note.title} ${note.path} ${note.body || ''}`.toLowerCase().includes(query)));
  return pageHeading('Inbox', 'Small thoughts, ready when you are.', creationButton('capture', 'Capture note')) + `<div class="segmented" aria-label="Note folder">${[['', 'All notes'], ['inbox', 'Inbox'], ['learnings', 'Learnings']].map(([value, label]) => `<button data-filter="folder" data-value="${value}" aria-pressed="${folder === value}">${label}</button>`).join('')}</div>` + (!notes.length ? query || folder ? emptyFiltered() : emptyState('A clear inbox', 'Capture a thought with the CLI. Open a note here to turn it into a task.', 'inbox', '<pre>2b dump a-thought --title "A thought to keep"</pre>') : `<section class="section" aria-label="Notes">${notes.map(note => `<div class="inbox-row" data-note-row="${attribute(note.path)}" tabindex="0">${icon(note.folder === 'learnings' ? 'file' : 'inbox')}<div class="inbox-copy"><button data-note="${attribute(note.path)}">${escapeHtml(note.title)}</button><p>${escapeHtml(note.folder)} · ${note.created ? escapeHtml(formatTimestamp(note.created)) : 'Date not recorded'}</p></div><button class="icon-button" data-convert="${attribute(note.path)}" aria-label="Turn ${attribute(note.title)} into a task">${icon('arrow')}</button></div>`).join('')}</section>`);
}
function renderNavigation() {
  const current = store.route.view === 'project' ? 'projects' : store.route.view;
  element('navigation').innerHTML = navigation.map(([view, label]) => {
    const count = view === 'home' ? store.data?.tasks.filter(task => ['doing', 'todo'].includes(task.status)).length : view === 'inbox' ? store.notes?.length : null;
    return `<a class="nav-link ${['home', 'projects', 'collections', 'reminders'].includes(view) ? '' : 'mobile-secondary'}" href="${routeUrl(view, { context: null, note: null, doc: null, runlog: null, full: null, selected: null })}" title="${label}" ${current === view ? 'aria-current="page"' : ''}>${icon(view)}<span class="nav-label">${label}</span>${count ? `<span class="nav-count">${count}</span>` : ''}</a>`;
  }).join('') + `<button class="nav-link mobile-more" data-popover="mobile-navigation" aria-haspopup="dialog" ${!['home', 'projects', 'collections', 'reminders'].includes(current) ? 'aria-current="page"' : ''}>${icon('more')}<span class="nav-label">More</span></button>`;
  const dark = document.documentElement.dataset.theme === 'dark' || !document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches;
  element('theme-toggle').innerHTML = icon(dark ? 'sun' : 'moon');
  element('theme-toggle').setAttribute('aria-label', `Use ${dark ? 'light' : 'dark'} theme`);
  element('shortcut-button').innerHTML = icon('help');
}
function renderTopbar() {
  const params = store.route.params;
  const status = params.get('status');
  element('topbar').innerHTML = `<div class="segmented" aria-label="Area">${[['', 'All'], ['work', 'Work'], ['personal', 'Personal']].map(([value, label]) => `<button data-filter="area" data-value="${value}" aria-pressed="${(params.get('area') || '') === value}">${label}</button>`).join('')}</div><div class="filter-group"><button class="filter-button ${status ? 'active' : ''}" data-popover="status-filter" aria-haspopup="dialog">${icon('filter')}${status ? escapeHtml(status.split(',').join(', ')) : 'Status'}${icon('chevron')}</button><button class="filter-button ${params.get('priority') ? 'active' : ''}" data-popover="priority-filter" aria-haspopup="dialog">${icon('priority')}${escapeHtml(params.get('priority') || 'Priority')}${icon('chevron')}</button></div><div class="search-wrap">${icon('search')}<input id="global-search" type="search" placeholder="Search ${store.route.view === 'collections' ? 'collections and note content' : store.route.view}" aria-label="Search ${store.route.view}" value="${attribute(params.get('q') || '')}" autocomplete="off"><kbd>/</kbd></div><button class="command-button" data-action="palette" aria-label="Command palette" title="Command palette (Command K)">${icon('command')}<span>K</span></button>`;
  const supported = supportedFilters(store.route.view);
  if (!supported.includes('area')) element('topbar').querySelector('[aria-label="Area"]').remove();
  for (const name of ['status', 'priority']) if (!supported.includes(name)) element('topbar').querySelector(`[data-popover="${name}-filter"]`).remove();
}
function render() {
  const active = document.activeElement;
  const activeId = active?.id;
  const activeInDrawer = Boolean(active?.closest('.drawer'));
  const focusAttributes = ['data-popover', 'data-id', 'data-open', 'data-note', 'data-document', 'data-runlog', 'data-action', 'data-filter', 'data-value'];
  const activeSelector = active?.tagName === 'BUTTON' ? focusAttributes.filter(name => active.hasAttribute(name)).map(name => `[${name}="${CSS.escape(active.getAttribute(name))}"]`).join('') : active?.hasAttribute('data-row') ? `[data-row="${CSS.escape(active.dataset.row)}"]` : '';
  const selection = active instanceof HTMLInputElement && ['text', 'search'].includes(active.type) ? [active.selectionStart, active.selectionEnd] : null;
  const mainScroll = window.scrollY;
  renderNavigation();
  renderTopbar();
  const viewRenderers = { home: renderHome, projects: renderProjects, project: renderProjectPage, due: renderDue, timeline: renderTimeline, jobs: renderJobs, inbox: renderInbox, collections: renderCollections, reminders: renderReminders };
  const title = store.route.view === 'project' ? getEntry(store.route.projectContext || store.route.id)?.title || 'Project' : navigation.find(([view]) => view === store.route.view)?.[1] || 'Home';
  document.title = `2b — ${title}`;
  const error = store.error ? `<div class="banner" role="alert">${icon('warning')}<span>${escapeHtml(store.error)}</span><button class="text-button" data-action="reload">Try again</button></div>` : '';
  element('main').innerHTML = error + (store.loading ? pageHeading(title, 'Making room for your work…') + skeletonRows() : store.data ? viewRenderers[store.route.view]() : emptyState('Your workspace is unavailable', 'Start the dashboard server, then try again.', 'warning', '<button class="secondary-button" data-action="reload">Try again</button>'));
  renderDrawer();
  if (activeId && element(activeId)) { element(activeId).focus({ preventScroll: true }); if (selection) element(activeId).setSelectionRange(...selection); }
  else if (active?.classList.contains('drawer-content') && !active.isConnected) element('drawer-root').querySelector('.drawer-content')?.focus({ preventScroll: true });
  else if (activeSelector && !active?.isConnected) (activeInDrawer ? element('drawer-root') : element('main')).querySelector(activeSelector)?.focus({ preventScroll: true });
  window.scrollTo({ top: mainScroll, behavior: 'instant' });
}
function renderEntryError(id) { return `<div class="banner" role="alert">${icon('warning')}<span>${escapeHtml(store.entryErrors.get(id))}</span><button class="text-button" data-reload-entry="${attribute(id)}">Try again</button></div>`; }
function renderArtifactGroups(entry) {
  const query = (store.route.params.get('artifact') || '').toLowerCase();
  const groups = entry.artifacts && !Array.isArray(entry.artifacts) ? entry.artifacts : { other: [] };
  const labels = { markdown: 'Markdown', html: 'HTML', data: 'Data', images: 'Images', other: 'Other' };
  let count = 0;
  const html = Object.entries(labels).map(([type, label]) => {
    const items = (groups[type] || []).filter(item => `${item.title} ${item.path} ${item.about} ${item.why}`.toLowerCase().includes(query));
    count += items.length;
    return items.length ? `<div class="artifact-group"><h3>${label} <span class="count">${items.length}</span></h3>${items.map(item => {
      const path = entryFile(entry, item.path);
      const title = item.title || item.path.split('/').pop();
      return `<div class="artifact-row">${icon('file')}<div>${type === 'markdown' ? `<button data-document="${attribute(path)}">${escapeHtml(title)}</button>` : `<a href="${fileUrl(path)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)} ${icon('external')}</a>`}${item.about ? `<p>${escapeHtml(item.about)}</p>` : ''}${item.why ? `<p>${escapeHtml(item.why)}</p>` : ''}<p>${item.size != null ? `${item.size < 1024 ? `${item.size} B` : `${Math.round(item.size / 1024)} KB`}${item.added ? ' · ' : ''}` : ''}${item.added ? escapeHtml(formatDate(item.added.slice(0, 10))) : ''}</p></div></div>`;
    }).join('')}</div>` : '';
  }).join('');
  return `<section class="section"><div class="section-heading"><h2>Artifacts <span class="count">${count}</span></h2><input id="artifact-search" type="search" aria-label="Filter artifacts" placeholder="Filter artifacts…" value="${attribute(store.route.params.get('artifact') || '')}"></div>${html || `<p class="count">${query ? 'No artifacts match this filter.' : 'No artifacts yet.'}</p>`}</section>`;
}
function renderTaskMetadata(task, fields) {
  const prs = fields.prs || task.prs || [];
  const pullRequests = prs.map((url, index) => `<a href="${safeHref(url)}" target="_blank" rel="noopener noreferrer">PR ${index + 1} ${icon('external')}</a>`).join('');
  return `<div class="metadata">${statusChip(task)}${priorityChip(task)}${dueChip(task)}<span>Started ${formatDate(task.started)}</span>
    ${fields.repo ? `<span>${icon('projects')} ${escapeHtml(fields.repo)}</span>` : ''}
    ${fields.branch ? `<span>${icon('branch')} ${escapeHtml(fields.branch)}</span>` : ''}${pullRequests}</div>`;
}
function renderTaskLog(log) {
  const lines = String(log || '').trim().split('\n').filter(Boolean);
  const showAll = store.route.params.get('log') === 'all';
  const contents = (showAll ? lines : lines.slice(-10)).join('\n') || 'No log entries yet.';
  return `<details class="section" data-url-details="log-open" ${store.route.params.get('log-open') === '1' ? 'open' : ''}>
    <summary>Log <span class="count">${lines.length} entries</span></summary><pre class="log-block">${escapeHtml(contents)}</pre>
    ${lines.length > 10 ? `<button class="text-button" data-filter="log" data-value="${showAll ? '' : 'all'}">${showAll ? 'Show last 10' : 'Show all'}</button>` : ''}</details>`;
}
function renderJobActions(task) {
  const running = store.runningJobs.has(task.id);
  return `<div class="job-actions">
    <button class="secondary-button" data-action="run" data-id="${attribute(task.id)}" ${running ? 'disabled' : ''}>${icon('play')}${store.runningJobs.get(task.id) || 'Run now'}</button>
    <button class="secondary-button" ${task.status === 'doing' ? 'data-popover="pause"' : 'data-action="resume"'} data-id="${attribute(task.id)}">${icon(task.status === 'doing' ? 'pause' : 'play')}${task.status === 'doing' ? 'Pause' : 'Resume'}</button>
    <button class="secondary-button" data-popover="delete" ${running ? 'disabled' : ''} data-id="${attribute(task.id)}">${icon('trash')}Delete job</button></div>`;
}
function renderTaskDetail(entry) {
  if (['collection', 'note'].includes(entry.kind)) return `<h1>${escapeHtml(entry.fields.title)}</h1><p class="count">${escapeHtml(entry.kind)} · ${escapeHtml(entry.project || entry.id.split('/')[0])}</p>${renderDescription(entry)}${entry.kind === 'collection' ? section('Notes', contentList(entry.notes || []), entry.notes?.length || 0) : ''}${renderArtifactGroups(entry)}${renderLinks(entry)}${renderTaskLog(entry.log)}`;
  const task = getEntry(entry.id);
  const fields = entry.fields || {};
  const recurring = task.kind === 'recurring' || fields.kind === 'recurring' || entry.job;
  const rules = entry.rules ? `<pre>${escapeHtml(typeof entry.rules === 'string' ? entry.rules : JSON.stringify(entry.rules, null, 2))}</pre>` : '<p class="count">No rules for this task.</p>';
  return `<h1>${escapeHtml(task.title)}</h1>${renderTaskMetadata(task, fields)}
    ${task.statusReason ? `<p class="notice">${escapeHtml(task.statusReason)}</p><br>` : ''}
    ${renderDescription(entry)}${renderArtifactGroups(entry)}${renderLinks(entry)}${section('Rules', rules)}
    ${renderTaskLog(entry.log)}${recurring ? section('Job actions', renderJobActions(task)) : ''}`;
}
function documentHtml(rendered) {
  const template = document.createElement('template');
  template.innerHTML = rendered.html;
  const heading = template.content.firstElementChild;
  if (heading?.tagName === 'H1' && heading.textContent.trim() === rendered.title?.trim()) heading.remove();
  return template.innerHTML;
}
function renderDrawer() {
  const params = store.route.params;
  const note = params.get('note');
  const documentPath = params.get('doc');
  const runlog = params.get('runlog');
  const visible = store.route.drawer || note || documentPath || runlog;
  const root = element('drawer-root');
  if (!visible) { root.innerHTML = ''; root.dataset.key = ''; return; }
  const entering = !root.querySelector('.drawer');
  const oldContent = root.querySelector('.drawer-content');
  const contentHadFocus = document.activeElement === oldContent;
  const focusWasOnBody = document.activeElement === document.body;
  const scroll = oldContent?.scrollTop || 0;
  const oldKey = root.dataset.key;
  const key = `${store.route.id}|${note || ''}|${documentPath || ''}|${runlog || ''}`;
  root.dataset.key = key;
  const id = store.route.drawer ? store.route.id : '';
  const entry = id ? store.entries.get(id) : null;
  const filePath = runlog || documentPath || note;
  let title = getEntry(id)?.projectTitle || getEntry(id)?.project || 'Task';
  let body = '';
  if (filePath) {
    const document = store.documents.get(filePath);
    if (!document) ensureDocument(filePath, Boolean(runlog));
    title = runlog ? 'Run log' : note ? 'Note' : 'Markdown artifact';
    body = document?.error ? `<div class="banner" role="alert">${escapeHtml(document.error)}<button class="text-button" data-reload-document="${attribute(filePath)}">Try again</button></div>` : document ? `<h1>${escapeHtml(document.title || filePath.split('/').pop())}</h1>${note ? `<div class="metadata"><span>${escapeHtml(store.notes?.find(item => item.path === note)?.folder || 'inbox')}</span><button class="secondary-button" data-convert="${attribute(note)}">${icon('arrow')}Turn into task…</button></div>` : ''}${runlog ? `<pre class="log-block">${escapeHtml(document.text)}</pre>` : `<div class="prose">${documentHtml(document)}</div>`}` : skeletonRows();
  } else if (store.entryErrors.has(id)) body = renderEntryError(id);
  else if (!entry) { ensureEntry(id); body = skeletonRows(); }
  else body = renderTaskDetail(entry);
  root.innerHTML = `<aside class="drawer ${entering ? 'is-entering' : ''} ${params.get('full') === '1' ? 'full-page' : ''}" aria-label="${attribute(runlog ? 'Run log' : note || getEntry(id)?.type === 'note' ? 'Note detail' : getEntry(id)?.type === 'collection' ? 'Collection detail' : 'Task detail')}"><header class="drawer-toolbar">${filePath && store.route.drawer ? `<button class="icon-button" data-action="document-back" aria-label="Back to entry">${icon('left')}</button>` : ''}<span class="breadcrumb">${escapeHtml(title)}</span>${id && !filePath && getEntry(id)?.type === 'task' ? `<button class="icon-button" data-action="previous-task" aria-label="Previous task (k)">${icon('left')}</button><button class="icon-button" data-action="next-task" aria-label="Next task (j)">${icon('right')}</button>` : ''}<button class="text-button" data-filter="full" data-value="${params.get('full') === '1' ? '' : '1'}" aria-label="${params.get('full') === '1' ? 'Show drawer' : 'Open full page'}">${icon('expand')}<span>${params.get('full') === '1' ? 'Show drawer' : 'Open full page'}</span></button><button class="icon-button" data-action="close-drawer" aria-label="Close drawer (Escape)">${icon('close')}</button></header><div class="drawer-content" tabindex="-1">${body}</div></aside>`;
  root.querySelector('.drawer-content').scrollTop = oldKey === key ? scroll : 0;
  if (oldKey !== key || contentHadFocus || focusWasOnBody) requestAnimationFrame(() => root.querySelector('.drawer-content')?.focus({ preventScroll: true }));
}
async function ensureEntry(id, force = false) {
  if (!id || store.entryRequests.has(id) || !force && (store.entries.has(id) || store.entryErrors.has(id))) return;
  store.entryRequests.add(id);
  try { store.entries.set(id, await api.get(`/api/entry?id=${encodeURIComponent(id)}`)); store.entryErrors.delete(id); }
  catch (error) { store.entryErrors.set(id, error.message); }
  finally { store.entryRequests.delete(id); render(); }
}
async function ensureDocument(path, raw = false, force = false) {
  if (!force && store.documents.has(path)) return;
  store.documents.set(path, null);
  try {
    if (raw) {
      const response = await fetch(fileUrl(path), { cache: 'no-store' });
      if (!response.ok) throw new Error('Cannot open this run log.');
      store.documents.set(path, { title: path.split('/').pop(), text: await response.text() });
    } else store.documents.set(path, await api.get(`/api/render?path=${encodeURIComponent(path)}`));
  } catch (error) { store.documents.set(path, { error: error.message }); }
  if (['doc', 'note', 'runlog'].some(name => store.route.params.get(name) === path)) render();
}
async function loadInbox(force = false) {
  if (store.notesLoading || !force && store.notes) return;
  store.notesLoading = true;
  store.notesError = '';
  try { store.notes = (await api.get('/api/inbox')).notes; }
  catch (error) { store.notesError = error.message; }
  finally { store.notesLoading = false; render(); }
}
function requestedRange() {
  const params = store.route.params;
  if (store.route.view === 'timeline' && params.get('tab') === 'lanes') return laneRange();
  const range = store.route.view === 'timeline' ? params.get('range') : '7d';
  if (range === 'month') {
    const month = params.get('month') || today().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return { from: 'invalid', to: 'invalid' };
    const last = new Date(`${month}-01T12:00:00`); last.setMonth(last.getMonth() + 1); last.setDate(0);
    return { from: `${month}-01`, to: localDay(last) };
  }
  if (range === 'custom') return { from: params.get('from') || addDays(today(), -6), to: params.get('to') || today() };
  const to = params.get('weekEnd') || today();
  return { from: addDays(to, range === '30d' ? -29 : -6), to };
}
async function loadState({ force = false } = {}) {
  const range = requestedRange();
  const rangeKey = `${range.from}/${range.to}`;
  if (!force && store.rangeKey === rangeKey) return;
  store.rangeKey = rangeKey;
  const sequence = ++store.requestSequence;
  store.refreshing = Boolean(store.data);
  store.error = '';
  try {
    if (!dayPattern.test(range.from) || !dayPattern.test(range.to)) throw new Error('Choose a valid date range.');
    if (range.from > range.to) throw new Error('The end date must be on or after the start date.');
    if (daysBetween(range.from, range.to) >= 400) throw new Error('Choose a date range of 400 days or less.');
    const data = await api.get(`/api/state?from=${range.from}&to=${range.to}`);
    if (sequence !== store.requestSequence) return;
    store.data = { ...data, projects: data.projects || [], tasks: data.tasks || [], events: data.events || [], collections: data.collections || [], notes: data.notes || [], reminders: data.reminders || [], jobs: data.jobs || [], failed: data.failed || [] };
  } catch (error) { if (sequence === store.requestSequence) store.error = error.message; }
  finally { if (sequence === store.requestSequence) { store.loading = false; store.refreshing = false; render(); } }
}
function routeChanged() {
  const previousRoute = store.route;
  store.route = parseRoute();
  const contextIsOpen = previousRoute?.drawer || store.route.drawer || previousRoute?.params.get('note') || store.route.params.get('note');
  const listChanged = previousRoute?.path !== store.route.path || ['area', 'status', 'priority', 'q'].some(key => previousRoute?.params.get(key) !== store.route.params.get(key));
  if (!contextIsOpen && listChanged) window.scrollTo({ top: 0, behavior: 'instant' });
  store.selectedId = store.route.params.get('selected') || (store.route.drawer ? store.route.id : store.selectedId);
  closePopover(false);
  render();
  if (drawerIsOpen(previousRoute) && !drawerIsOpen()) {
    const locator = store.returnFocus;
    requestAnimationFrame(() => restoreFocus(locator));
    store.returnFocus = null;
    store.documentReturnFocus = null;
  } else if ((previousRoute?.params.get('doc') || previousRoute?.params.get('runlog')) && !store.route.params.get('doc') && !store.route.params.get('runlog')) {
    const locator = store.documentReturnFocus;
    requestAnimationFrame(() => restoreFocus(locator));
    store.documentReturnFocus = null;
  }
  loadState();
}
function showToast(message, undo, { error = false, link } = {}) {
  const id = crypto.randomUUID();
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' error' : ''}`;
  toast.setAttribute('role', error ? 'alert' : 'status');
  toast.innerHTML = `<span>${escapeHtml(message)}</span>${link ? `<a href="${attribute(link.href)}">${escapeHtml(link.label)}</a>` : ''}${undo ? '<button type="button">Undo</button>' : ''}`;
  element('toasts').append(toast);
  const dismiss = () => { clearTimeout(timer); toast.remove(); store.toasts.delete(id); };
  const timer = setTimeout(dismiss, 8000);
  store.toasts.set(id, { dismiss, toast });
  if (undo) toast.querySelector('button').onclick = async () => {
    toast.querySelector('button').disabled = true;
    try { await undo(); dismiss(); } catch (failure) { dismiss(); showToast(failure.message, null, { error: true }); }
  };
  return { dismiss, toast };
}
function recalculateCounts() {
  if (!store.data) return;
  store.data.projects.forEach(project => {
    const tasks = store.data.tasks.filter(task => task.project === project.id);
    project.taskCounts = { open: tasks.filter(task => !closedStatuses.includes(task.status)).length, done: tasks.filter(task => task.status === 'done').length, total: tasks.length };
    const dueDates = tasks.filter(task => !closedStatuses.includes(task.status) && dayPattern.test(task.due || '')).map(task => task.due).sort();
    project.nextDue = dueDates[0] || null;
  });
}
function patchEntry(id, patch) {
  ['projects', 'tasks', 'jobs', 'failed'].forEach(collection => store.data?.[collection]?.forEach(entry => { if (entry.id === id) Object.assign(entry, patch); }));
  const detail = store.entries.get(id);
  if (detail) {
    Object.assign(detail, patch);
    detail.fields ||= {};
    Object.entries(patch).forEach(([key, value]) => detail.fields[key === 'statusReason' ? 'status-reason' : key] = value);
  }
  recalculateCounts();
}
async function updateEntry(id, field, value, reason = '') {
  const entry = getEntry(id);
  if (!entry) return;
  const key = `edit:${id}`;
  if (store.pending.has(key)) { showToast('This change is still saving. Try again in a moment.'); return; }
  store.pending.add(key);
  const previous = field === 'status' ? { status: entry.status, statusReason: entry.statusReason || null } : { [field]: entry[field] ?? null };
  const patch = field === 'status' ? { status: value, statusReason: reason || null } : { [field]: value || null };
  if (field === 'priority') { previous.priorityLabel = entry.priorityLabel; patch.priorityLabel = priorityLabel(value); }
  const url = field === 'status' ? '/api/status' : '/api/set';
  const payload = field === 'status' ? { id, status: value, ...(reason ? { reason } : {}) } : { id, field, value };
  const reversePayload = field === 'status' ? { id, status: previous.status, ...(reasonStatuses.includes(previous.status) ? { reason: previous.statusReason || 'Undo last change' } : {}) } : { id, field, value: previous[field] || '' };
  patchEntry(id, patch);
  render();
  let succeeded = false;
  let writeResult;
  let revision;
  let saveFinished;
  const operation = api.post(url, payload).then(result => {
    succeeded = true;
    writeResult = result;
    revision = recordWrite(id);
    return result;
  });
  const notification = showToast(`${field === 'status' ? 'Status' : field === 'priority' ? 'Priority' : field === 'title' ? 'Title' : 'Date'} updated`, async () => {
    await saveFinished;
    if (!succeeded) return;
    if (store.writeRevisions.get(id) !== revision || store.pending.has(key)) { showToast("Can't undo — it changed since"); return; }
    store.pending.add(key);
    patchEntry(id, previous); render();
    try { await api.post(url, reversePayload); recordWrite(id); showToast('Change undone.'); await refreshAfterWrite(id); }
    catch (error) { patchEntry(id, patch); render(); throw error; }
    finally { store.pending.delete(key); }
  });
  saveFinished = (async () => {
    try {
      await operation;
      if (writeResult.warnings?.length) showToast(writeResult.warnings.join(' '), null, { error: true });
      await refreshAfterWrite(id);
    } catch (error) {
      notification.dismiss(); patchEntry(id, previous); render(); showToast(error.message, null, { error: true });
    } finally { store.pending.delete(key); }
  })();
  await saveFinished;
}
async function refreshAfterWrite(id) {
  if (id) store.entryErrors.delete(id);
  const visible = store.route.drawer && store.route.id === id || store.route.view === 'project' && (store.route.projectContext || store.route.id) === id;
  await Promise.all([loadState({ force: true }), visible ? ensureEntry(id, true) : Promise.resolve()]);
}
function recordWrite(id) {
  const revision = (store.writeRevisions.get(id) || 0) + 1;
  store.writeRevisions.set(id, revision);
  return revision;
}
function entryLink(id) {
  return { href: routeUrl(`t/${id.split('/').map(encodeURIComponent).join('/')}`, { context: mainPath(), note: null, doc: null, runlog: null }), label: 'Open task' };
}
function runLogLink(job) {
  return job.lastLog ? { href: routeUrl(`t/${job.id.split('/').map(encodeURIComponent).join('/')}`, { context: mainPath(), note: null, doc: null, runlog: runLogPath(job, job.lastLog) }), label: 'Open log' } : null;
}
async function waitForRun(id, previousRun) {
  const deadline = Date.now() + 120000;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await new Promise(resolve => setTimeout(resolve, Math.min(3000, remaining)));
    if (Date.now() >= deadline) return null;
    await loadState({ force: true });
    const job = store.data.jobs.find(job => job.id === id);
    if (job && job.lastRun !== previousRun) return job;
  }
  return null;
}
async function runJob(id) {
  if (store.runningJobs.has(id)) { showToast('This job is already running.'); return; }
  const entry = getEntry(id);
  if (!entry) return;
  const previousRun = store.data.jobs.find(job => job.id === id)?.lastRun ?? null;
  store.runningJobs.set(id, 'Starting…');
  render();
  try {
    const result = await api.post('/api/run', { id });
    recordWrite(id);
    store.runningJobs.set(id, 'Started');
    render();
    showToast(`Started ${entry.title}.`);
    if (result.warnings?.length) showToast(result.warnings.join(' '), null, { error: true });
    const job = await waitForRun(id, previousRun);
    if (!job) showToast('The run log is still pending. Use Refresh in Jobs to check it.');
    else showToast(job.lastResult === 'error' ? 'Run error.' : 'Run ok.', null, { error: job.lastResult === 'error', link: runLogLink(job) });
    await refreshAfterWrite(id);
  } catch (error) { showToast(error.message, null, { error: true }); }
  finally { store.runningJobs.delete(id); render(); }
}
async function deleteJob(id) {
  const entry = getEntry(id);
  const snapshot = { task: store.data.tasks.find(task => task.id === id), job: store.data.jobs.find(job => job.id === id), failed: store.data.failed.find(job => job.id === id), detail: store.entries.get(id) };
  const restoreSnapshot = status => {
    if (snapshot.task && !store.data.tasks.some(task => task.id === id)) store.data.tasks.push({ ...snapshot.task, ...(status ? { status, statusReason: 'restored from trash' } : {}) });
    if (snapshot.job && !store.data.jobs.some(job => job.id === id)) store.data.jobs.push({ ...snapshot.job, ...(status ? { status, nextRun: null } : {}) });
    if (snapshot.failed && !status) store.data.failed.push(snapshot.failed);
    if (snapshot.detail) store.entries.set(id, snapshot.detail);
    recalculateCounts();
  };
  ['tasks', 'jobs', 'failed'].forEach(collection => store.data[collection] = store.data[collection].filter(task => task.id !== id));
  recalculateCounts();
  closePopover(false);
  if (store.route.drawer && store.route.id === id) closeDrawer();
  render();
  let revision;
  const operation = api.post('/api/delete', { id }).then(result => { revision = recordWrite(id); return result; });
  const notification = showToast(`Moved “${entry.title}” to trash`, async () => {
    const result = await operation;
    if (store.writeRevisions.get(id) !== revision) { showToast("Can't undo — it changed since"); return; }
    restoreSnapshot('paused'); render();
    try { await api.post('/api/restore', { trashId: result.trashId }); recordWrite(id); showToast('Job restored in paused state.'); await refreshAfterWrite(id); }
    catch (error) { ['tasks', 'jobs', 'failed'].forEach(collection => store.data[collection] = store.data[collection].filter(task => task.id !== id)); recalculateCounts(); render(); throw error; }
  });
  try { await operation; await loadState({ force: true }); }
  catch (error) { notification.dismiss(); restoreSnapshot(); render(); showToast(error.message, null, { error: true }); }
}
async function createTask({ project, slug, title, fromNote }) {
  const key = `create:${project}:${slug}`;
  if (store.pending.has(key)) { showToast('This task is still saving.'); return; }
  store.pending.add(key);
  try {
    const result = await api.post('/api/task', { project, slug, title, fromNote });
    if (result.entry?.id) recordWrite(result.entry.id);
    await loadState({ force: true });
    showToast('Task created. The original note stays in your inbox.', null, { link: result.entry?.id ? entryLink(result.entry.id) : null });
  } catch (error) { showToast(error.message, null, { error: true }); }
  finally { store.pending.delete(key); }
}
function openPopover(type, anchor, id = '', extra = {}) {
  closePopover(false);
  store.popover = { type, id, ...extra };
  store.popoverAnchor = anchor || document.activeElement;
  const entry = getEntry(id);
  const root = element('popover-root');
  let html = '';
  if (type === 'mobile-navigation') {
    html = `<h2>More pages</h2>${navigation.filter(([view]) => !['home', 'projects', 'collections', 'reminders'].includes(view)).map(([view, label]) => `<button class="popover-option" data-view="${view}">${icon(view)}<span>${label}</span></button>`).join('')}`;
  } else if (['status', 'pause'].includes(type)) {
    const statuses = isProject(entry) ? projectStatuses : entry?.kind === 'recurring' || entry?.fields?.kind === 'recurring' ? [...taskStatuses, 'paused'] : taskStatuses;
    const options = type === 'pause' ? ['paused'] : statuses;
    html = `<h2>${type === 'pause' ? 'Pause job' : 'Change status'}</h2><input class="popover-search" type="search" aria-label="Find status" placeholder="Find status…" autocomplete="off"><div class="popover-options">${options.map(status => `<button class="popover-option status-${status}" data-status-value="${status}" aria-pressed="${entry?.status === status}"><span>${icon(statusIcon(status))} ${status}</span>${entry?.status === status ? icon('check') : ''}</button>`).join('')}</div><form id="reason-form" hidden><label for="status-reason">Reason <span aria-hidden="true">(required)</span></label><textarea id="status-reason" name="reason" rows="3" required maxlength="2000" placeholder="What needs to change?"></textarea><button class="primary-button" type="submit">Apply status</button></form>`;
  } else if (type === 'priority') {
    const values = isProject(entry) ? ['P1', 'P2', 'P3', 'P4', 'P5'] : ['high', 'med', 'low'];
    const labels = { P1: 'Urgent', P2: 'High', P3: 'Normal', P4: 'Low', P5: 'Someday' };
    const apiLabels = Object.fromEntries(store.data.projects.map(project => [project.priority, project.priorityLabel]));
    html = `<h2>Change priority</h2>${values.map(value => `<button class="popover-option" data-priority-value="${value}" aria-pressed="${entry.priority === value}"><span class="chip ${isProject(entry) ? 'priority-project' : `priority-${value}`}">${escapeHtml(apiLabels[value] || priorityLabel(value))}</span>${labels[value] ? `<span class="count">${labels[value]}</span>` : ''}${entry.priority === value ? icon('check') : ''}</button>`).join('')}`;
  } else if (type === 'due' || type === 'reschedule') {
    const monday = new Date(`${today()}T12:00:00`).getDay();
    const nextMonday = addDays(today(), (8 - monday) % 7 || 7);
    const field = isProject(entry) ? 'deadline' : 'due';
    const value = entry?.[field];
    html = `<h2>${type === 'reschedule' ? 'Reschedule overdue items' : isProject(entry) ? 'Set deadline' : 'Set due date'}</h2>${[['Today', today()], ['Tomorrow', addDays(today(), 1)], ['Next Monday', nextMonday], ['+1 week', addDays(dayPattern.test(value || '') ? value : today(), 7)], ['No date', ''], ['Unknown', 'unknown']].map(([label, date]) => `<button class="popover-option" data-due-value="${date}"><span>${label}</span><span class="count">${date && date !== 'unknown' ? formatDate(date) : ''}</span></button>`).join('')}<form id="due-form" class="popover-footer"><label for="due-date">Choose any date</label><input id="due-date" name="date" type="date" required value="${dayPattern.test(value || '') ? value : ''}"><p id="past-date-warning" class="notice" hidden>This date is in the past. You can still use it for a correction.</p><button class="primary-button" type="submit">${type === 'reschedule' ? 'Reschedule all' : 'Set date'}</button></form>`;
  } else if (type === 'status-filter') {
    const statuses = store.route.view === 'reminders' ? ['scheduled', 'sent', 'cancelled'] : [...new Set([...projectStatuses, ...taskStatuses])];
    const selected = store.route.params.get('status')?.split(',') || [];
    html = `<h2>Filter by status</h2><button class="popover-option" data-status-filter="" aria-pressed="${!selected.length}">All statuses${!selected.length ? icon('check') : ''}</button>${statuses.map(status => `<button class="popover-option" data-status-filter="${status}" aria-pressed="${selected.includes(status)}"><span class="status-${status}">${icon(statusIcon(status))} ${status}</span>${selected.includes(status) ? icon('check') : ''}</button>`).join('')}`;
  } else if (type === 'priority-filter') {
    const labels = Object.fromEntries(store.data?.projects.map(project => [project.priority, project.priorityLabel]) || []);
    html = `<h2>Filter by priority</h2><button class="popover-option" data-priority-filter="">All priorities</button><p class="count" style="padding:.5rem">Tasks</p>${['high', 'med', 'low'].map(value => `<button class="popover-option" data-priority-filter="${value}"><span class="chip priority-${value}">${value}</span>${store.route.params.get('priority') === value ? icon('check') : ''}</button>`).join('')}<p class="count" style="padding:.5rem">Projects</p>${['P1', 'P2', 'P3', 'P4', 'P5'].map(value => `<button class="popover-option" data-priority-filter="${value}">${escapeHtml(labels[value] || priorityLabel(value))}${store.route.params.get('priority') === value ? icon('check') : ''}</button>`).join('')}`;
  } else if (type === 'delete') {
    html = `<h2>Delete “${escapeHtml(entry.title)}”?</h2><p class="count" style="padding:.375rem">This moves the job to trash and stops its schedule. Undo restores it in paused state.</p><button class="primary-button" data-confirm-delete="${attribute(id)}">${icon('trash')}Move to trash</button><button class="popover-option" data-action="close-popover">Keep job</button>`;
  } else if (type === 'rename') {
    html = `<h2>Rename ${isProject(entry) ? 'project' : 'task'}</h2><form id="rename-form"><label for="entry-title">Title</label><input id="entry-title" name="title" required maxlength="500" value="${attribute(entry.title)}"><button class="primary-button" type="submit">Save title</button></form>`;
  } else if (type === 'convert') {
    const note = store.notes?.find(note => note.path === extra.notePath);
    if (!store.data.projects.some(project => !closedStatuses.includes(project.status))) html = '<h2>Choose an open project first</h2><p class="count">Create a project with <code>2b new project</code>, or resume an existing project, then return to this note.</p>';
    else html = `<h2>Turn note into a task</h2><form id="convert-form"><label for="task-project">Project</label><select id="task-project" name="project" required>${store.data.projects.filter(project => !closedStatuses.includes(project.status)).sort(compareProjects).map(project => `<option value="${attribute(project.id)}">${escapeHtml(project.title)}</option>`).join('')}</select><label for="task-title">Title</label><input id="task-title" name="title" required maxlength="500" value="${attribute(note?.title || 'New task')}"><label for="task-slug">Slug</label><input id="task-slug" name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${attribute(slugify(note?.title || 'new-task'))}"><p class="count" style="margin-top:.75rem">The note body is copied. The original note stays in place.</p><button class="primary-button" type="submit">Create task</button></form>`;
  } else if (type === 'trash') {
    html = `<h2>Trash</h2><div id="trash-items"><p class="count" style="padding:.5rem">Loading deleted jobs…</p></div>`;
  }
  root.innerHTML = `<section class="popover" role="dialog" aria-label="${attribute(type === 'convert' ? 'Turn note into a task' : type.replaceAll('-', ' '))}">${html}</section>`;
  positionPopover();
  const firstControl = root.querySelector('input, button, select, textarea');
  requestAnimationFrame(() => firstControl?.focus());
  if (type === 'pause') selectStatus('paused');
  if (type === 'trash') loadTrash();
}
function slugify(title) { return title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'new-task'; }
function positionPopover() {
  const popover = element('popover-root').firstElementChild;
  if (!popover) return;
  const rectangle = store.popoverAnchor?.getBoundingClientRect() || { left: window.innerWidth / 2 - 150, right: window.innerWidth / 2 + 150, bottom: 100, top: 100 };
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const left = Math.max(12, Math.min(rectangle.left, window.innerWidth - width - 12));
  const top = rectangle.bottom + height + 12 <= window.innerHeight ? rectangle.bottom + 6 : Math.max(12, rectangle.top - height - 6);
  popover.style.left = `${left}px`; popover.style.top = `${top}px`;
}
function closePopover(restoreFocus = true) {
  const anchor = store.popoverAnchor;
  element('popover-root').innerHTML = '';
  store.popover = null;
  store.popoverAnchor = null;
  if (restoreFocus) anchor?.focus?.();
}
function selectStatus(status) {
  if (!store.popover) return;
  if (reasonStatuses.includes(status)) {
    store.popover.status = status;
    const form = element('reason-form');
    form.hidden = false;
    form.querySelector('button').textContent = `Set ${status}`;
    element('status-reason').value = getEntry(store.popover.id)?.statusReason || '';
    positionPopover();
    element('status-reason').focus();
  } else { const id = store.popover.id; closePopover(); updateEntry(id, 'status', status); }
}
function applyDue(value) {
  if (!store.popover) return;
  if (store.popover.type === 'reschedule') {
    const entries = [...store.data.tasks, ...store.data.projects].filter(entry => !closedStatuses.includes(entry.status) && matchesFilters(entry) && dayPattern.test(entry.due || entry.deadline || '') && (entry.due || entry.deadline) < today());
    closePopover();
    entries.forEach(entry => updateEntry(entry.id, isProject(entry) ? 'deadline' : 'due', value));
  } else { const id = store.popover.id; const field = isProject(getEntry(id)) ? 'deadline' : 'due'; closePopover(); updateEntry(id, field, value); }
}
async function loadTrash() {
  try {
    const result = await api.get('/api/trash');
    store.trash = Array.isArray(result) ? result : result.items || result.trash || [];
    if (element('trash-items')) element('trash-items').innerHTML = store.trash.length ? store.trash.map(item => `<div class="artifact-row"><div><strong>${escapeHtml(item.task)}</strong><p>${escapeHtml(item.project)} · ${escapeHtml(formatTimestamp(item.deletedAt))}</p><button class="text-button" data-restore="${attribute(item.trashId)}">Restore paused</button></div></div>`).join('') : '<p class="count" style="padding:.5rem">Trash is empty.</p>';
    positionPopover();
  } catch (error) { if (element('trash-items')) element('trash-items').textContent = error.message; }
}
async function restoreJob(trashId) {
  const key = `restore:${trashId}`;
  if (store.pending.has(key)) { showToast('This job is still restoring.'); return; }
  store.pending.add(key);
  closePopover();
  try {
    const result = await api.post('/api/restore', { trashId });
    if (result.entry?.id) recordWrite(result.entry.id);
    await loadState({ force: true });
    showToast('Job restored in paused state.', null, { link: result.entry?.id ? entryLink(result.entry.id) : null });
  } catch (error) { showToast(error.message, null, { error: true }); }
  finally { store.pending.delete(key); }
}
function currentEntryId() {
  if (store.route.drawer) return store.route.id;
  if (store.route.view === 'project' && !store.selectedId) return store.route.projectContext || store.route.id;
  const visibleSelection = visibleRows().some(row => row.dataset.row === store.selectedId) ? store.selectedId : '';
  return document.activeElement?.closest('[data-row]')?.dataset.row || visibleSelection || (store.route.view === 'project' ? store.route.projectContext || store.route.id : '');
}
function paletteItems() {
  const id = currentEntryId();
  const entry = getEntry(id);
  const items = navigation.map(([view, label, shortcut]) => ({ label: `Go to ${label}`, icon: view, key: `g ${shortcut}`, run: () => navigateView(view), group: 'Navigate' }));
  if (document.querySelector('.toast button:not(:disabled)')) items.push({ label: 'Undo latest change', icon: 'restore', key: '⌘ Z', run: undoLatestChange, group: 'Actions' });
  items.push({ label: 'Change theme', icon: 'sun', run: toggleTheme, group: 'Workspace' }, { label: 'Keyboard shortcuts', icon: 'help', key: '?', run: openShortcutSheet, group: 'Workspace' }, { label: 'Restore a deleted job…', icon: 'restore', run: () => openPopover('trash', element('topbar')), group: 'Actions' });
  if (store.route.params.get('note')) items.push({ label: 'Turn this note into a task…', icon: 'arrow', run: () => openPopover('convert', element('topbar'), '', { notePath: store.route.params.get('note') }), group: 'Actions' });
  if (entry && !['collection', 'note'].includes(entry.type)) {
    const anchor = () => document.querySelector(`[data-row="${CSS.escape(id)}"]`) || element('topbar');
    items.push(
      { label: `Change status · ${entry.title}`, icon: 'circle', key: 's', run: () => openPopover('status', anchor(), id), group: 'Selected item' },
      { label: `Set ${isProject(entry) ? 'deadline' : 'due date'} · ${entry.title}`, icon: 'due', key: 'd', run: () => openPopover('due', anchor(), id), group: 'Selected item' },
      { label: `Change priority · ${entry.title}`, icon: 'priority', key: 'p', run: () => openPopover('priority', anchor(), id), group: 'Selected item' },
      { label: `Rename · ${entry.title}`, icon: 'file', run: () => openPopover('rename', anchor(), id), group: 'Selected item' },
    );
    if (entry.kind === 'recurring' || entry.fields?.kind === 'recurring') items.push(
      { label: `Run now · ${entry.title}`, icon: 'play', run: () => runJob(id), group: 'Selected item' },
      { label: `${entry.status === 'doing' ? 'Pause' : 'Resume'} · ${entry.title}`, icon: 'pause', run: () => entry.status === 'doing' ? openPopover('pause', anchor(), id) : updateEntry(id, 'status', 'doing'), group: 'Selected item' },
      { label: `Delete job · ${entry.title}`, icon: 'trash', run: () => openPopover('delete', anchor(), id), group: 'Selected item' },
    );
  }
  store.data?.projects.forEach(project => items.push({ label: project.title, icon: 'projects', run: () => openEntry(project.id), group: 'Projects' }));
  store.data?.tasks.filter(task => !task.pending && !closedStatuses.includes(task.status)).sort(compareTasks).forEach(task => items.push({ label: task.title, icon: 'circle', run: () => openEntry(task.id), group: 'Tasks' }));
  return items;
}
let activePaletteItems = [];
function renderPaletteOptions(query = '') {
  const queryWords = query.toLowerCase().trim().split(/\s+/);
  activePaletteItems = paletteItems().filter(item => queryWords.every(word => item.label.toLowerCase().includes(word)));
  let lastGroup = '';
  element('palette-options').innerHTML = activePaletteItems.length ? activePaletteItems.map((item, index) => {
    const heading = item.group !== lastGroup ? `<h3>${escapeHtml(item.group)}</h3>` : '';
    lastGroup = item.group;
    return `${heading}<button class="palette-option" data-command="${index}">${icon(item.icon)}<span>${escapeHtml(item.label)}</span>${item.key ? `<kbd>${item.key}</kbd>` : ''}</button>`;
  }).join('') : '<p class="empty-state">No commands match. Try a task title or “status”.</p>';
}
function openPalette() {
  if (element('palette-root').children.length) { closePalette(); return; }
  closePopover(false);
  store.paletteReturnFocus = document.activeElement;
  element('palette-root').innerHTML = `<div class="palette-backdrop" data-palette-backdrop><section class="palette" role="dialog" aria-modal="true" aria-label="Command palette"><header class="palette-header">${icon('search')}<input id="palette-search" type="search" placeholder="Find a task or type a command…" aria-label="Search commands" autocomplete="off"><button class="icon-button" data-action="close-palette" aria-label="Close command palette">${icon('close')}</button></header><div id="palette-options" class="palette-options"></div></section></div>`;
  renderPaletteOptions();
  requestAnimationFrame(() => element('palette-search').focus());
}
function closePalette(restoreFocus = true) {
  element('palette-root').innerHTML = '';
  if (restoreFocus) store.paletteReturnFocus?.focus?.();
}
function openShortcutSheet() {
  closePopover(false);
  store.paletteReturnFocus = document.activeElement;
  const shortcuts = [['Search dashboard', '/'], ['Commands and write actions', '⌘ K / Ctrl K'], ['Home / Projects / Due', 'g h / g p / g d'], ['Timeline / Jobs / Inbox', 'g t / g j / g i'], ['Collections / Reminders', 'g c / g r'], ['Next / previous item', 'j / k'], ['Open selected item', 'Enter'], ['Change status', 's'], ['Set due date or deadline', 'd'], ['Change priority', 'p'], ['Undo latest change', '⌘ Z / Ctrl Z'], ['Close drawer or popover', 'Esc'], ['Move in menus', '↑ / ↓'], ['Keyboard shortcuts', '?']];
  element('palette-root').innerHTML = `<div class="palette-backdrop" data-palette-backdrop><section class="palette" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><header class="palette-header"><h2 style="flex:1">Keyboard shortcuts</h2><button class="icon-button" data-action="theme">${icon('sun')}<span class="sr-only">Change theme</span></button><button class="icon-button" data-action="close-palette" aria-label="Close keyboard shortcuts">${icon('close')}</button></header><div class="shortcut-list">${shortcuts.map(([label, key]) => `<span>${label}</span><kbd>${key}</kbd>`).join('')}</div><p class="count" style="padding:.75rem .5rem">Select a row first to change it. All actions are also in the command palette.</p></section></div>`;
  requestAnimationFrame(() => element('palette-root').querySelector('button').focus());
}
function toggleTheme() {
  const currentDark = document.documentElement.dataset.theme === 'dark' || !document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = currentDark ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('2b-theme', theme); } catch {}
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim();
  renderNavigation();
  element('announcer').textContent = `${theme === 'dark' ? 'Dark' : 'Light'} theme`;
}
function selectRow(id, focus = false) {
  store.selectedId = id;
  document.querySelectorAll('[data-row]').forEach(row => row.classList.toggle('selected', row.dataset.row === id));
  if (!store.route.drawer) {
    const url = routeUrl(store.route.path, { selected: id });
    history.replaceState(null, '', url); store.route = parseRoute();
  }
  if (focus) document.querySelector(`[data-row="${CSS.escape(id)}"]`)?.focus();
}
function visibleRows() { return [...document.querySelectorAll('#main [data-row]')].filter(row => row.getClientRects().length); }
function moveSelection(direction) {
  const noteRows = [...document.querySelectorAll('[data-note-row]')].filter(row => row.getClientRects().length);
  if (store.route.view === 'inbox' && !store.route.drawer) {
    if (!noteRows.length) return;
    const active = document.activeElement?.closest('[data-note-row]');
    const current = noteRows.indexOf(active);
    const next = noteRows[Math.max(0, Math.min(noteRows.length - 1, current < 0 ? direction > 0 ? 0 : noteRows.length - 1 : current + direction))];
    next.focus(); next.scrollIntoView({ block: 'nearest' }); return;
  }
  const rows = visibleRows();
  const ids = [...new Set(rows.map(row => row.dataset.row))];
  if (store.route.drawer) {
    const candidates = ids.filter(id => store.data.tasks.some(task => task.id === id));
    if (!candidates.includes(store.route.id)) candidates.unshift(store.route.id);
    const index = candidates.indexOf(store.route.id);
    const next = candidates[Math.max(0, Math.min(candidates.length - 1, index + direction))];
    if (next && next !== store.route.id) openEntry(next);
  } else {
    const current = ids.indexOf(store.selectedId);
    const next = ids[Math.max(0, Math.min(ids.length - 1, current < 0 ? direction > 0 ? 0 : ids.length - 1 : current + direction))];
    if (next) { selectRow(next, true); document.activeElement.scrollIntoView({ block: 'nearest' }); }
  }
}
function undoLatestChange() { [...document.querySelectorAll('.toast button:not(:disabled)')].at(-1)?.click(); }
function trapFocus(event, container) {
  const controls = [...container.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(control => control.getClientRects().length);
  if (!controls.length) return;
  if (event.key === 'Tab') {
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !document.activeElement.matches('textarea, input[type="date"], input[type="month"], select')) {
    const menuControls = container.querySelectorAll('.palette-option').length ? [...container.querySelectorAll('.palette-option')] : controls;
    const current = menuControls.indexOf(document.activeElement);
    const position = event.key === 'Home' ? 0 : event.key === 'End' ? menuControls.length - 1 : current < 0 ? event.key === 'ArrowUp' ? menuControls.length - 1 : 0 : (current + (event.key === 'ArrowDown' ? 1 : -1) + menuControls.length) % menuControls.length;
    if (document.activeElement.matches('input') && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault(); menuControls[position]?.focus();
  }
}
function openNote(path, opener = document.activeElement) {
  rememberDrawerOpener(opener, `[data-note="${CSS.escape(path)}"]`);
  navigate('inbox', { note: path, doc: null, runlog: null, context: null });
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); showToast('Instruction copied.'); }
  catch { showToast('Copy is unavailable. Select the instruction and copy it.'); }
}
const clickActions = {
  'new-capture': control => openCreationDialog('capture', control),
  'new-job': control => openCreationDialog('job', control),
  'new-project': control => openCreationDialog('project', control),
  'new-task': control => openCreationDialog('task', control),
  'new-collection': control => openCreationDialog('collection', control),
  'new-note': control => openCreationDialog('note', control),
  'new-reminder': control => openCreationDialog('reminder', control),
  'close-creation': closeCreationDialog,
  'cancel-reminder': control => cancelReminder(control.dataset.id),
  palette: openPalette, shortcuts: openShortcutSheet, 'close-palette': closePalette, 'close-popover': closePopover,
  'close-drawer': closeDrawer, 'next-task': () => moveSelection(1), 'previous-task': () => moveSelection(-1), theme: toggleTheme,
  reload: () => loadState({ force: true }), 'reload-inbox': () => loadInbox(true),
  'clear-filters': () => navigate(store.route.path, { area: null, status: null, priority: null, q: null, project: null, folder: null }),
  'document-back': closeDocument,
  run: control => runJob(control.dataset.id), resume: control => updateEntry(control.dataset.id, 'status', 'doing'),
};
document.addEventListener('click', event => {
  const control = event.target.closest('button, a, [data-row], [data-note-row]');
  if (event.target.matches('[data-palette-backdrop]')) { closePalette(); return; }
  if (!control) return;
  if (control.matches('.skip-link')) { event.preventDefault(); element('main').focus(); return; }
  if (control.dataset.action) { clickActions[control.dataset.action]?.(control); return; }
  if (control.dataset.view) { navigateView(control.dataset.view); return; }
  if (control.dataset.filter) { closePopover(false); setFilter(control.dataset.filter, control.dataset.value); return; }
  if (control.dataset.open) { openEntry(control.dataset.open, control); return; }
  if (control.dataset.popover) { openPopover(control.dataset.popover, control, control.dataset.id); return; }
  if ('statusValue' in control.dataset) { selectStatus(control.dataset.statusValue); return; }
  if ('priorityValue' in control.dataset) { const id = store.popover.id; closePopover(); updateEntry(id, 'priority', control.dataset.priorityValue); return; }
  if ('dueValue' in control.dataset) { applyDue(control.dataset.dueValue); return; }
  if ('statusFilter' in control.dataset) {
    const value = control.dataset.statusFilter;
    const selected = new Set(store.route.params.get('status')?.split(',') || []);
    if (value) selected.has(value) ? selected.delete(value) : selected.add(value); else selected.clear();
    closePopover(false); setFilter('status', [...selected].join(',')); return;
  }
  if ('priorityFilter' in control.dataset) { closePopover(false); setFilter('priority', control.dataset.priorityFilter); return; }
  if (control.dataset.sort) { const key = control.dataset.sort; navigate(store.route.path, { sort: key, direction: store.route.params.get('sort') === key && store.route.params.get('direction') !== 'desc' ? 'desc' : 'asc' }); return; }
  if (control.dataset.day) { navigate('timeline', { day: control.dataset.day, tab: 'activity', context: null, doc: null, runlog: null, note: null }); return; }
  if (control.dataset.note) { openNote(control.dataset.note, control); return; }
  if (control.dataset.document) { openDocument(control.dataset.document, false, '', control); return; }
  if (control.dataset.runlog) { openDocument(control.dataset.runlog, true, control.dataset.id, control); return; }
  if (control.dataset.convert) { openPopover('convert', control, '', { notePath: control.dataset.convert }); return; }
  if (control.dataset.confirmDelete) { deleteJob(control.dataset.confirmDelete); return; }
  if (control.dataset.restore) { restoreJob(control.dataset.restore); return; }
  if ('command' in control.dataset) { const command = activePaletteItems[Number(control.dataset.command)]; closePalette(false); command?.run(); return; }
  if (control.dataset.copy) { copyText(control.dataset.copy); return; }
  if (control.dataset.reloadEntry) { ensureEntry(control.dataset.reloadEntry, true); return; }
  if (control.dataset.reloadDocument) { ensureDocument(control.dataset.reloadDocument, Boolean(store.route.params.get('runlog')), true); return; }
  if (control.matches('[data-row]')) { selectRow(control.dataset.row); openEntry(control.dataset.row); }
  if (control.matches('[data-note-row]')) openNote(control.dataset.noteRow);
});
document.addEventListener('pointerdown', event => {
  if (store.popover && !element('popover-root').contains(event.target) && !store.popoverAnchor?.contains(event.target)) closePopover(false);
});
document.addEventListener('input', event => {
  const input = event.target;
  if (input.id === 'global-search') setFilter('q', input.value, true);
  if (input.id === 'artifact-search') setFilter('artifact', input.value, true);
  if (input.id === 'palette-search') renderPaletteOptions(input.value);
  if (input.matches('.popover-search')) {
    const query = input.value.toLowerCase();
    element('popover-root').querySelectorAll('[data-status-value]').forEach(option => option.hidden = !option.dataset.statusValue.includes(query));
    positionPopover();
  }
  if (input.id === 'due-date') { element('past-date-warning').hidden = !input.value || input.value >= today(); positionPopover(); }
  if (input.id === 'task-title') element('task-slug').value = slugify(input.value);
});
document.addEventListener('change', event => {
  if (event.target.name === 'reminder-mode') {
    const mode = event.target.value;
    event.target.form.querySelectorAll('[data-schedule-field]').forEach(field => {
      field.hidden = field.dataset.scheduleField !== mode;
      field.querySelectorAll('input, select').forEach(input => { input.disabled = field.hidden; input.required = !field.hidden; });
    });
  }
  if (event.target.name === 'repeat-kind' || event.target.name === 'reminder-mode') updateRepeatControls(event.target.form);
  if (event.target.dataset.query) setFilter(event.target.dataset.query, event.target.value);
});
document.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  if (['capture-form', 'job-form', 'project-form', 'task-form', 'collection-form', 'note-form', 'reminder-form'].includes(form.id)) { saveV2Form(form); return; }
  const values = new FormData(form);
  if (form.id === 'reason-form') {
    const reason = String(values.get('reason')).trim();
    if (!reason) { element('status-reason').setCustomValidity('Enter a reason.'); element('status-reason').reportValidity(); element('status-reason').setCustomValidity(''); return; }
    const { id, status } = store.popover; closePopover(); updateEntry(id, 'status', status, reason);
  }
  if (form.id === 'due-form') applyDue(values.get('date'));
  if (form.id === 'rename-form') { const id = store.popover.id; const title = String(values.get('title')).trim(); if (!title) return; closePopover(); updateEntry(id, 'title', title); }
  if (form.id === 'convert-form') { const fromNote = store.popover.notePath; closePopover(); createTask({ project: values.get('project'), slug: values.get('slug'), title: String(values.get('title')).trim(), fromNote }); }
});
document.addEventListener('focusin', event => {
  const row = event.target.closest('[data-row]');
  if (row && !store.route.drawer) selectRow(row.dataset.row);
});
document.addEventListener('toggle', event => {
  const details = event.target;
  if (!details.isConnected || !details.dataset.urlDetails) return;
  const name = details.dataset.urlDetails;
  const value = details.open ? '1' : '';
  if ((store.route.params.get(name) || '') !== value) {
    history.replaceState(null, '', routeUrl(store.route.path, { [name]: value })); store.route = parseRoute();
  }
}, true);
let goPrefixUntil = 0;
document.addEventListener('keydown', event => {
  if (event.isComposing) return;
  const key = event.key;
  if (element('creation-dialog').open) {
    if (key === 'Tab') trapFocus(event, element('creation-dialog'));
    if (key === 'Escape') { event.preventDefault(); closeCreationDialog(); }
    return;
  }
  const eventTarget = event.target instanceof Element ? event.target : document.body;
  if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'z' && !eventTarget.closest('input, textarea, [contenteditable="true"]') && document.querySelector('.toast button:not(:disabled)')) { event.preventDefault(); undoLatestChange(); return; }
  if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); return; }
  if (key === 'Escape') {
    event.preventDefault();
    if (element('palette-root').children.length) closePalette();
    else if (store.popover) closePopover();
    else if (store.route.params.get('doc') || store.route.params.get('runlog')) closeDocument();
    else if (store.route.drawer || store.route.params.get('note')) closeDrawer();
    else if (document.activeElement.matches('input')) document.activeElement.blur();
    return;
  }
  const floating = element('palette-root').querySelector('.palette') || element('popover-root').querySelector('.popover');
  if (floating) { trapFocus(event, floating); if (key === 'Enter' && document.activeElement.id === 'palette-search') { event.preventDefault(); const command = activePaletteItems[0]; if (command) { closePalette(false); command.run(); } } return; }
  if (key === 'Tab' && element('drawer-root').querySelector('.drawer') && (window.innerWidth <= 520 || store.route.params.get('full') === '1')) { trapFocus(event, element('drawer-root')); return; }
  if (eventTarget.closest('input, textarea, select, [contenteditable="true"]') || event.metaKey || event.ctrlKey || event.altKey) return;
  if (eventTarget.closest('[role="tablist"]') && ['ArrowLeft', 'ArrowRight'].includes(key)) {
    event.preventDefault(); const tabs = [...eventTarget.closest('[role="tablist"]').querySelectorAll('[role="tab"]')]; const next = tabs[(tabs.indexOf(event.target) + 1) % tabs.length]; next.click(); requestAnimationFrame(() => element(next.id)?.focus()); return;
  }
  if (Date.now() < goPrefixUntil) { goPrefixUntil = 0; const destination = navigation.find(([, , shortcut]) => shortcut === key); if (destination) { event.preventDefault(); navigateView(destination[0]); return; } }
  if (key === 'g') { goPrefixUntil = Date.now() + 2000; return; }
  if (key === '/') { event.preventDefault(); element('global-search').focus(); return; }
  if (key === '?') { event.preventDefault(); openShortcutSheet(); return; }
  if (key === 'j' || key === 'k') { event.preventDefault(); moveSelection(key === 'j' ? 1 : -1); return; }
  if (key === 'Enter' && !eventTarget.closest('button, a, summary')) {
    const note = eventTarget.closest('[data-note-row]');
    if (note) { event.preventDefault(); openNote(note.dataset.noteRow); return; }
    const id = eventTarget.closest('[data-row]')?.dataset.row || currentEntryId();
    if (id && !store.route.drawer) { event.preventDefault(); openEntry(id); } return;
  }
  const popoverType = { s: 'status', d: 'due', p: 'priority' }[key];
  if (popoverType) {
    const id = currentEntryId();
    if (getEntry(id) && !['collection', 'note'].includes(getEntry(id).type)) { event.preventDefault(); openPopover(popoverType, document.activeElement.closest('[data-row]') || element('drawer-root').querySelector(`[data-popover="${popoverType}"]`) || document.activeElement, id); }
    else element('announcer').textContent = 'Select a task or project first.';
  }
});
element('creation-dialog').addEventListener('click', event => {
  if (event.target !== event.currentTarget) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeCreationDialog();
});
element('creation-dialog').addEventListener('cancel', event => { event.preventDefault(); closeCreationDialog(); });
window.addEventListener('hashchange', () => { closeCreationDialog(); routeChanged(); });
window.addEventListener('resize', positionPopover);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderNavigation);
element('theme-toggle').onclick = toggleTheme;
element('shortcut-button').onclick = openShortcutSheet;
if (!location.hash) history.replaceState(null, '', '#/home');
store.route = parseRoute();
render();
loadState();

