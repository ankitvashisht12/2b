import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ObjectStore } from './store.ts';
import { contentPath, vaultRoot, readBody, writeBody, reconcileFiles } from './files.ts';
import type { ObjectRecord } from './models.ts';
import { publishConnections } from './graph.ts';
import { metadataDirectory, loadConfig } from './config.ts';
import { ActivityReader, activityRange } from './activity.ts';

const UI_ROOT = fileURLToPath(new URL('../../dash-v3/', import.meta.url));
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

export const TOP_AREAS = { work: 'area:work', personal: 'area:personal' } as const;

/** Work/Personal is one in-area link to a top area. Sub-area links are left alone. */
export async function setScope(store: ObjectStore, id: string, scope: unknown) {
  if (scope === undefined || scope === 'both') return;
  if (scope !== 'work' && scope !== 'personal' && scope !== 'none') throw new Error('Scope must be work, personal, or none');
  const now = new Date().toISOString();
  for (const [key, areaId] of Object.entries(TOP_AREAS))
    if (!await store.get(areaId)) await store.upsert({ id: areaId, type: 'area', name: key === 'work' ? 'Work' : 'Personal', description: '', properties: {}, tags: [], path: null, createdAt: now, modifiedAt: now });
  const target = scope === 'none' ? null : TOP_AREAS[scope];
  for (const edge of await store.relationships(id))
    if (edge.from === id && edge.kind === 'in-area' && Object.values(TOP_AREAS).includes(edge.to as any) && edge.to !== target) await store.removeRelationship(edge.id);
  if (target) await store.relate(id, 'in-area', target);
}

export async function createObject(store: ObjectStore, root: string, input: any): Promise<ObjectRecord> {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || typeof input.type !== 'string') throw new Error('Type and name are required');
  if (input.scope !== undefined && !['work', 'personal', 'none', 'both'].includes(input.scope)) throw new Error('Scope must be work, personal, or none');
  const now = new Date().toISOString();
  const defaults: Record<string, Record<string, unknown>> = {
    project: { kind: 'ongoing', status: 'active', priority: 'P3' },
    task: { status: 'todo', priority: 'med' },
    note: { noteType: 'general' },
    book: { readingState: 'to-read' },
    reminder: { enabled: false, status: 'pending', timezone: loadConfig().timezone },
    'agent-job': { enabled: false, timezone: loadConfig().timezone, provider: loadConfig().agents.primary.provider, model: loadConfig().agents.primary.model },
  };
  let record = await store.upsert({ id: randomUUID(), type: input.type, name: input.name.trim(), description: input.description || '', properties: { ...defaults[input.type], ...input.properties }, tags: input.tags || [], path: null, createdAt: now, modifiedAt: now });
  if (input.type !== 'tag') record = await writeBody(root, store, record, input.body !== undefined ? String(input.body) : `# ${record.name}\n\n${record.description}\n`);
  await setScope(store, record.id, input.scope);
  return record;
}

export async function startDashboard(rootInput: string, port = 4423) {
  const root = vaultRoot(rootInput);
  const store = await ObjectStore.open(root);
  const activity = new ActivityReader();
  async function jsonBody(request: http.IncomingMessage) {
    let body = '';
    for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 2_000_000) throw new Error('Request is too large'); }
    return JSON.parse(body || '{}');
  }
  const server = http.createServer(async (request, response) => {
    const send = (value: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
    try {
      const host = request.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send({ error: 'Local requests only' }, 403);
      const url = new URL(request.url || '/', `http://${host}`);
      if (request.headers.origin && request.headers.origin !== url.origin) return send({ error: 'Cross-origin requests are not allowed' }, 403);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      if (url.pathname === '/api/health') return send({ ok: true, version: '3.0.0' });
      if (url.pathname === '/api/startup' && request.method === 'GET') {
        const objects = await store.summaries(true);
        const [relationships, types, totals] = await Promise.all([store.relationshipsAmong(objects.map(object => object.id)), store.types(), store.statistics()]);
        return send({ objects, relationships, types, stats: { ...totals, types: types.length }, root, partial: true });
      }
      if (url.pathname === '/api/state' && request.method === 'GET') {
        const [objects, relationships, types] = await Promise.all([store.summaries(), store.relationships(), store.types()]);
        const stats = { objects: objects.length, relationships: relationships.length, types: types.length, files: objects.filter(object => object.path).length };
        return send({ objects, relationships, types, stats, root });
      }
      if (url.pathname === '/api/activity' && request.method === 'GET') {
        const { from, to } = activityRange(url.searchParams.get('from') || '', url.searchParams.get('to') || '');
        const events = activity.read(root, await store.activitySources(), from, to);
        return send({ events });
      }
      if (url.pathname === '/api/object' && request.method === 'GET') {
        const object = await store.get(url.searchParams.get('id') || '');
        if (!object) return send({ error: 'Object not found' }, 404);
        return send({ object, relationships: await store.relationships(object.id), body: readBody(root, object) });
      }
      if (url.pathname === '/api/objects' && request.method === 'POST') return send(await createObject(store, root, await jsonBody(request)), 201);
      if (url.pathname.startsWith('/api/objects/') && request.method === 'PATCH') {
        const id = decodeURIComponent(url.pathname.slice('/api/objects/'.length));
        const object = await store.get(id);
        if (!object) return send({ error: 'Object not found' }, 404);
        const input = await jsonBody(request);
        const patch: Record<string, unknown> = {};
        for (const field of ['name', 'type', 'description', 'properties', 'tags']) if (field in input) patch[field] = input[field];
        let updated = await store.update(object.id, patch);
        await setScope(store, object.id, input.scope);
        if (input.body !== undefined) updated = await writeBody(root, store, updated, String(input.body));
        return send(updated);
      }
      if (url.pathname === '/api/relationships' && request.method === 'POST') {
        const input = await jsonBody(request);
        const relation = await store.relate(input.from, input.kind, input.to, input.properties);
        await publishConnections(root, store);
        return send(relation, 201);
      }
      if (url.pathname.startsWith('/api/relationships/') && request.method === 'DELETE') {
        const removed = await store.removeRelationship(decodeURIComponent(url.pathname.slice('/api/relationships/'.length)));
        if (removed) await publishConnections(root, store);
        return send({ removed });
      }
      if (url.pathname === '/api/types' && request.method === 'POST') return send(await store.defineType(await jsonBody(request)), 201);
      if (url.pathname === '/api/reconcile' && request.method === 'POST') return send({ ...await reconcileFiles(root, store), graph: await publishConnections(root, store) });
      const isSource = url.pathname === '/api/source';
      if ((url.pathname === '/api/file' || isSource) && request.method === 'GET') {
        // /api/source reads an artifact's original in a source vault, read-only, without symlinks out of it.
        let file: string | null;
        if (isSource) {
          const { sourceFile, sourceVaultRoots } = await import('./tidy.ts');
          file = sourceFile(url.searchParams.get('vault'), url.searchParams.get('path'));
          const sourceRoot = sourceVaultRoots()[String(url.searchParams.get('vault'))];
          if (!file || !fs.existsSync(file) || !fs.realpathSync(file).startsWith(fs.realpathSync(sourceRoot) + path.sep)) return send({ error: 'File not found' }, 404);
        } else file = contentPath(root, url.searchParams.get('path') || '');
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send({ error: 'File not found' }, 404);
        const extension = path.extname(file).toLowerCase();
        response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:");
        response.setHeader('Content-Type', mime[extension] || 'application/octet-stream');
        if (!mime[extension]) response.setHeader('Content-Disposition', 'attachment');
        fs.createReadStream(file).pipe(response); return;
      }
      if (url.pathname.startsWith('/api/')) return send({ error: 'Endpoint not found' }, 404);
      const staticRoot = fs.existsSync(path.join(UI_ROOT, 'dist/index.html')) ? path.join(UI_ROOT, 'dist') : UI_ROOT;
      const staticName = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.resolve(staticRoot, staticName);
      if (!file.startsWith(staticRoot + path.sep) || !/\.(html|js|css|svg|png|woff2?)$/.test(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send({ error: 'Not found' }, 404);
      response.setHeader('Content-Type', mime[path.extname(file)] || (file.endsWith('.woff2') ? 'font/woff2' : 'font/woff'));
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      fs.createReadStream(file).on('error', () => { response.statusCode = 503; response.end('Dashboard files are not ready'); }).pipe(response);
    } catch (error) { send({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  server.requestTimeout = 20_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reconciliation: Promise<void> | null = null;
  let stopping = false;
  const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
    if (stopping || !filename || filename.startsWith('.2b') || filename.startsWith('archive/') || filename.startsWith('connections/') || filename.startsWith('migration/')) return;
    clearTimeout(timer); timer = setTimeout(() => {
      if (reconciliation || stopping) return;
      reconciliation = (async () => {
        try { await reconcileFiles(root, store); await publishConnections(root, store); } catch (error: any) { console.error('File reconciliation:', error.message); } finally { reconciliation = null; }
      })();
    }, 900);
  });
  const closeHttpServer = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    stopping = true; watcher.close(); clearTimeout(timer);
    closeHttpServer(async error => { await reconciliation; await store.close(); callback?.(error); });
    return server;
  }) as typeof server.close;
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } catch (error) { watcher.close(); clearTimeout(timer); await store.close(); throw error; }
  return { server, store, root, port: (server.address() as { port: number }).port };
}
