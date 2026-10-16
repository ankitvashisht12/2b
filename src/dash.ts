import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { NODE_COMMAND, UserError, listProjects, listTasks, localDate, resolve, reverseLinks, type Entry } from './store.ts';
import { isoWeek, weekEvents } from './week.ts';
import { formatRules, rulesFor } from './rules.ts';

export const DEFAULT_PORT = 4422;

const PAGE = path.join(import.meta.dirname, '..', 'dash', 'index.html');
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const flatten = (entry: Entry) => ({ id: entry.id, type: entry.kind, project: entry.project, ...entry.fields });

export function dashboardState(root: string, day: string) {
  const tasks = listTasks(root).map(flatten);
  return {
    today: localDate(),
    week: isoWeek(day),
    projects: listProjects(root).map(flatten),
    tasks,
    events: weekEvents(root, day),
    failed: tasks.filter(task => task.kind === 'recurring' && task['last-result'] === 'error'),
  };
}

export function entryDetail(root: string, id: string) {
  const entry = resolve(root, id);
  const logFile = path.join(entry.dir, 'log.md');
  return {
    id: entry.id,
    kind: entry.kind,
    fields: entry.fields,
    body: entry.body,
    relativeDir: path.relative(root, entry.dir),
    reverseLinks: reverseLinks(root, entry.id),
    rules: formatRules(rulesFor(root, entry)),
    log: fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '',
    tasks: entry.kind === 'project'
      ? listTasks(root, entry.id).map(task => ({ id: task.id, title: task.fields.title, status: task.fields.status }))
      : [],
  };
}

export function startDashboard(root: string, port: number): http.Server {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/file') {
      response.setHeader('Content-Security-Policy', 'sandbox');
      response.setHeader('X-Content-Type-Options', 'nosniff');
    }
    const sendJson = (data: unknown, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(data));
    };
    try {
      const address = server.address();
      const listeningPort = address && typeof address !== 'string' ? address.port : undefined;
      if (request.headers.host !== `127.0.0.1:${listeningPort}` && request.headers.host !== `localhost:${listeningPort}`) {
        sendJson({ error: 'forbidden host' }, 403);
        return;
      }
      if (url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(fs.readFileSync(PAGE));
      } else if (url.pathname === '/api/ping') {
        sendJson({ ok: true, root });
      } else if (url.pathname === '/api/state') {
        sendJson(dashboardState(root, url.searchParams.get('week') || localDate()));
      } else if (url.pathname === '/api/entry') {
        sendJson(entryDetail(root, url.searchParams.get('id') ?? ''));
      } else if (url.pathname === '/api/file') {
        const filePath = path.resolve(root, url.searchParams.get('path') ?? '');
        const isInsideStore = filePath.startsWith(root + path.sep);
        if (!isInsideStore || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          sendJson({ error: 'not found' }, 404);
          return;
        }
        const realRoot = fs.realpathSync(root);
        const realFilePath = fs.realpathSync(filePath);
        if (!realFilePath.startsWith(realRoot + path.sep)) {
          sendJson({ error: 'not found' }, 404);
          return;
        }
        response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'text/plain; charset=utf-8' });
        response.end(fs.readFileSync(filePath));
      } else {
        sendJson({ error: 'not found' }, 404);
      }
    } catch (error) {
      sendJson({ error: (error as Error).message }, error instanceof UserError ? 404 : 500);
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

export async function openDashboard(root: string, port: number): Promise<string> {
  const url = `http://127.0.0.1:${port}`;
  const isRunning = async () => {
    let response: Response;
    try {
      response = await fetch(`${url}/api/ping`);
    } catch {
      return false;
    }
    if (response.ok) {
      try {
        const ping = await response.json();
        if (ping.root === root) return true;
      } catch {
        // A non-JSON response belongs to another program.
      }
    }
    throw new UserError(`port ${port} is used by another 2b store or program`);
  };
  if (!(await isRunning())) {
    spawn(NODE_COMMAND[0], [...NODE_COMMAND.slice(1), 'dash', '--port', String(port)], {
      detached: true, stdio: 'ignore', env: { ...process.env, TWOB_HOME: root },
    }).unref();
    for (let attempt = 0; attempt < 50 && !(await isRunning()); attempt += 1) {
      await new Promise(wait => setTimeout(wait, 100));
    }
  }
  spawnSync('open', [url]);
  return url;
}
