import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ObjectStore } from './store.ts';
import { ensureConfig, loadConfig, configPath, metadataDirectory } from './config.ts';
import { vaultRoot, contentPath, readBody, writeBody, reconcileFiles, atomicWrite } from './files.ts';
import { createObject, startDashboard } from './server.ts';

const help = `2b v3 — local objects, linked knowledge, ordinary files

  2b start [--port 4423]                 Start dashboard and open it on this Mac
  2b dash [--port 4423] [--open]          Serve dashboard; --open starts in background
  2b config                             Show editable ~/.2b/config.json
  2b path                               Print the V3 vault path
  2b init                               Create the V3 object database
  2b ls [--type TYPE] [--search TEXT] [--status STATUS] [--tag TAG] [--json]
  2b show ID [--json]                    Object, properties, relationships and content
  2b object create TYPE NAME [--properties JSON] [--tags a,b] [--body TEXT]
  2b object set ID FIELD VALUE           Set a name, description, or typed property
  2b object edit ID --body TEXT          Edit ordinary Markdown content
  2b link FROM RELATION TO               Add a named relationship
  2b repo create NAME [--link ID] [--from PATH]
                                        Make a code repo in ~/2b/repos/NAME, not in the vault
  2b repo extract [--dry-run]            Move imported code repos out; remove secret files
  2b type ls                            Built-in and custom object schemas
  2b type create SLUG --name NAME --schema JSON [--description TEXT]
  2b capture TEXT [--type note]          Capture into Inbox and today's mixed page
  2b inbox                              Unprocessed objects across all dates
  2b today [yyyy-mm-dd]                  Mixed daily page, Asia/Kolkata
  2b process ID [--state processed]          Resolve an inbox item without moving files
  2b status ID STATE [--reason TEXT]     Update task/project status
  2b tag create NAME --description TEXT  Define a lightweight tag object
  2b tag add ID TAG                      Add an existing tag to an object
  2b job run ID                         Run an explicitly enabled agent job
  2b worker [--once]                    Process enabled jobs and reminders locally
  2b organize                           Apply the reviewed V3 backfill grouping
  2b migrate [--dry-run]                 Copy both original vaults into V3
  2b graph rebuild                      Refresh related links in Obsidian notes
  2b tidy [--dry-run]                    Plain page names; remove archive, migration, connections
  2b reconcile                          Check files and recover interrupted writes
  2b check                              Check objects, files, types and links
  2b export [--out FILE]                 Export portable metadata JSON

  --root PATH overrides V3 vault. Default: ~/obsidian/2b.
  Sources ~/obsidian/2bv2 and ~/obsidian/personal are protected read-only.
  No global CLI configuration or existing schedules are changed.
`;
const { positionals: args, values } = parseArgs({ args: process.argv.slice(2), strict: false, allowPositionals: true, options: {
  root: { type: 'string' }, json: { type: 'boolean' }, type: { type: 'string' }, search: { type: 'string' }, status: { type: 'string' }, tag: { type: 'string' }, tags: { type: 'string' }, body: { type: 'string' }, properties: { type: 'string' }, name: { type: 'string' }, schema: { type: 'string' }, description: { type: 'string' }, state: { type: 'string' }, reason: { type: 'string' }, port: { type: 'string' }, open: { type: 'boolean' }, inventory: { type: 'string' }, 'dry-run': { type: 'boolean' }, out: { type: 'string' }, once: { type: 'boolean' }, link: { type: 'string' }, from: { type: 'string' }, help: { type: 'boolean' }, version: { type: 'boolean' }, limit: { type: 'string' },
} });
const output = (value: unknown) => process.stdout.write(typeof value === 'string' && !values.json ? value + '\n' : JSON.stringify(value, null, 2) + '\n');
const needed = (value: string | undefined, label: string) => { if (!value) throw new Error(`${label} is required. Run 2b --help.`); return value; };
const parseValue = (value: string) => { try { return JSON.parse(value); } catch { return value; } };
const localDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: loadConfig().timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

async function main() {
  if (values.version || args[0] === 'version') return output('3.0.0');
  if (values.help || !args.length || args[0] === 'help') return output(help);
  const root = vaultRoot(typeof values.root === 'string' ? values.root : undefined);
  const command = args[0];
  if (command === 'config') return output({ path: configPath(), config: ensureConfig() });
  if (command === 'path') return output(root);
  if (command === 'migrate') {
    const { migrateVaults } = await import('./migrate.ts');
    return output(await migrateVaults({ root, dryRun: Boolean(values['dry-run']), inventoryPath: values.inventory as string | undefined }));
  }
  if (command === 'dash' || command === 'start' || command === 'serve') {
    const port = Number(values.port || ensureConfig().dashboardPort);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
    if (command === 'start' || values.open) {
      const url = `http://127.0.0.1:${port}`;
      let live = false;
      try {
        const health = await fetch(url + '/api/health');
        live = health.ok && (await health.json()).version === '3.0.0';
        if (live) {
          const state = await (await fetch(url + '/api/state')).json();
          if (state.root !== root) throw new Error('This port serves a different vault. Choose another --port.');
        } else throw new Error('This port is occupied by another service. Choose another --port.');
      } catch (error) { if (!(error instanceof TypeError)) throw error; }
      if (!live) {
        const metadata = metadataDirectory(root);
        const log = fs.openSync(path.join(metadata, 'dashboard.log'), 'a', 0o600);
        const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), 'serve', '--root', root, '--port', String(port)], { detached: true, stdio: ['ignore', log, log] });
        child.unref(); fs.closeSync(log);
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 150));
          try { const result = await fetch(url + '/api/health'); if (result.ok && (await result.json()).version === '3.0.0') { ready = true; break; } } catch {}
        }
        if (!ready) throw new Error(`Dashboard did not start. Read ${path.join(metadataDirectory(root), 'dashboard.log')}`);
      }
      if (process.platform === 'darwin') spawnSync('open', [url]);
      return output({ url, root, version: '3.0.0' });
    }
    const dashboard = await startDashboard(root, port);
    output(`2b v3: http://127.0.0.1:${dashboard.port}\nVault: ${root}`);
    const stop = () => dashboard.server.close(() => process.exit(0));
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    return;
  }
  if (command === 'organize') { const { organizeImportedVault } = await import('./organize.ts'); return output(await organizeImportedVault(root)); }
  if (command === 'worker' || command === 'job') {
    const { runWorker, runAgentJob } = await import('./worker.ts');
    if (command === 'job') {
      if (args[1] !== 'run') throw new Error('Use 2b job run ID');
      return output(await runAgentJob(root, needed(args[2], 'Job ID')));
    }
    return runWorker(root, Boolean(values.once));
  }
  const store = await ObjectStore.open(root);
  try {
    if (command === 'init') return output({ root, types: (await store.types()).length, version: '3.0.0' });
    if (command === 'ls' || command === 'find') return output(await store.list({ type: values.type as string, search: (values.search || (command === 'find' ? args.slice(1).join(' ') : undefined)) as string, status: values.status as string, tag: values.tag as string, limit: values.limit ? Number(values.limit) : undefined }));
    if (command === 'type') {
      if (args[1] === 'ls') return output(await store.types());
      if (args[1] === 'create') return output(await store.defineType({ id: needed(args[2], 'Type slug'), name: String(values.name || args[2]), description: String(values.description || ''), properties: JSON.parse(needed(values.schema as string, '--schema JSON')) }));
    }
    if (command === 'object' && args[1] === 'create') return output(await createObject(store, root, { type: needed(args[2], 'Object type'), name: needed(args.slice(3).join(' '), 'Name'), description: values.description || '', properties: values.properties ? JSON.parse(String(values.properties)) : {}, tags: String(values.tags || '').split(',').filter(Boolean), ...(values.body !== undefined ? { body: values.body } : {}) }));
    if (command === 'capture') return output(await createObject(store, root, { type: values.type || 'note', name: needed(args.slice(1).join(' '), 'Capture text'), body: values.body, properties: { processingState: 'inbox', contentDate: localDay(), capturedAt: new Date().toISOString() }, tags: String(values.tags || '').split(',').filter(Boolean) }));
    if (command === 'tag' && args[1] === 'create') return output(await createObject(store, root, { type: 'tag', name: needed(args[2], 'Tag name'), description: values.description || '', properties: {} }));
    if (command === 'inbox') return output((await store.list()).filter(object => object.properties.processingState === 'inbox'));
    if (command === 'today') {
      const day = args[1] || localDay();
      return output((await store.list()).filter(object => object.properties.contentDate === day || object.properties.plannedFor === day || object.properties.due === day || object.createdAt.startsWith(day) && !object.properties.sourceVault));
    }
    if (command === 'repo') {
      const { createRepo, extractRepos } = await import('./repos.ts');
      if (args[1] === 'create') return output(await createRepo(store, needed(args[2], 'Repo name'), { from: values.from as string | undefined, link: values.link as string | undefined }));
      if (args[1] === 'extract') return output(await extractRepos(root, store, Boolean(values['dry-run'])));
      throw new Error('Use 2b repo create NAME or 2b repo extract');
    }
    if (command === 'unlink') return output({ removed: await store.removeRelationship(needed(args[1], 'Relationship ID')) });
    if (command === 'link') return output(await store.relate(needed(args[1], 'From ID'), needed(args[2], 'Relation'), needed(args[3], 'To ID')));
    if (command === 'tidy') {
      const { tidyVault } = await import('./tidy.ts'); const { publishConnections } = await import('./graph.ts');
      const report = await tidyVault(root, store, Boolean(values['dry-run']));
      return output(values['dry-run'] ? report : { ...report, graph: await publishConnections(root, store) });
    }
    if (command === 'graph' && args[1] === 'rebuild') { const { publishConnections } = await import('./graph.ts'); return output(await publishConnections(root, store)); }
    if (command === 'reconcile') { const { publishConnections } = await import('./graph.ts'); return output({ ...await reconcileFiles(root, store), graph: await publishConnections(root, store) }); }
    if (command === 'export') {
      const data = { version: 3, exportedAt: new Date().toISOString(), objects: await store.list(), types: await store.types(), relationships: await store.relationships() };
      if (values.out) { const target = contentPath(root, String(values.out)); atomicWrite(target, JSON.stringify(data, null, 2)); return output(target); }
      return output(data);
    }
    if (command === 'check') {
      const report = await reconcileFiles(root, store);
      const records = await store.list(); const ids = new Set(records.map(object => object.id));
      const brokenRelationships = (await store.relationships()).filter(relation => !ids.has(relation.from) || !ids.has(relation.to));
      output({ ...report, brokenRelationships, ok: !report.missing.length && !brokenRelationships.length });
      if (report.missing.length || brokenRelationships.length) process.exitCode = 1;
      return;
    }
    const ref = command === 'object' ? args[2] : command === 'tag' ? args[2] : args[1];
    const object = await store.get(needed(ref, 'Object ID'));
    if (!object) throw new Error(`Object not found: ${ref}`);
    if (command === 'show') return output({ ...object, relationships: await store.relationships(object.id), body: readBody(root, object) });
    if (command === 'object' && args[1] === 'edit') return output(await writeBody(root, store, object, needed(values.body as string, '--body')));
    if (command === 'object' && args[1] === 'set') {
      const field = needed(args[3], 'Field'); const value = parseValue(needed(args[4], 'Value'));
      return output(await store.update(object.id, ['name', 'description', 'type'].includes(field) ? { [field]: value } : { properties: { [field]: value } }));
    }
    if (command === 'status') {
      const state = needed(args[2], 'State');
      if (['blocked', 'paused', 'on-hold', 'dropped'].includes(state) && !values.reason) throw new Error('This state needs --reason');
      return output(await store.update(object.id, { properties: { status: state, statusReason: values.reason || null } }));
    }
    if (command === 'process') return output(await store.update(object.id, { properties: { processingState: values.state || 'processed' } }));
    if (command === 'tag' && args[1] === 'add') {
      const tag = await store.get(needed(args[3], 'Tag ID or name'));
      if (!tag || tag.type !== 'tag') throw new Error('Create the tag first with 2b tag create');
      return output(await store.update(object.id, { tags: [...new Set([...object.tags, tag.name])] }));
    }
    throw new Error('Unknown command. Run 2b --help.');
  } finally { await store.close(); }
}
main().catch(error => { process.stderr.write(`2b v3: ${error.message}\n`); process.exitCode = 1; });
