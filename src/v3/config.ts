import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export interface AgentChoice { provider: 'codex' | 'claude'; model: string | null }
export interface AppConfig { version: 3; vaultPath: string; dashboardPort: number; timezone: string; agents: { primary: AgentChoice; fallback: AgentChoice | null }; worker: { enabled: boolean; pollSeconds: number }; reposPath: string; migration: { inventoryPath: string | null } }
function canonicalLocation(input: string): string {
  const absolute = path.resolve(input); let parent = absolute;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  return path.join(fs.realpathSync(parent), path.relative(parent, absolute));
}
/** The read-only vaults the V3 import came from. V3 never writes in or around them. */
export function sourceVaults(): { legacy: string; personal: string } {
  return { legacy: path.join(os.homedir(), 'obsidian/2bv2'), personal: path.join(os.homedir(), 'obsidian/personal') };
}
export function appHome(): string {
  const home = canonicalLocation(process.env.TWOB_APP_HOME || path.join(os.homedir(), '.2b'));
  for (const vault of Object.values(sourceVaults())) {
    const source = canonicalLocation(vault);
    if (home === source || home.startsWith(source + path.sep) || source.startsWith(home + path.sep)) throw new Error('App data cannot overlap a protected source vault');
  }
  return home;
}
export function configPath(): string { return path.join(appHome(), 'config.json'); }
export function defaultConfig(): AppConfig { return { version: 3, vaultPath: path.join(os.homedir(), 'obsidian/2b'), dashboardPort: 4423, timezone: 'Asia/Kolkata', agents: { primary: { provider: 'codex', model: null }, fallback: null }, worker: { enabled: false, pollSeconds: 60 }, reposPath: path.join(os.homedir(), '2b/repos'), migration: { inventoryPath: null } }; }
export function loadConfig(): AppConfig {
  const defaults = defaultConfig();
  if (!fs.existsSync(configPath())) return defaults;
  const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  const config = { ...defaults, ...saved, agents: { ...defaults.agents, ...saved.agents }, worker: { ...defaults.worker, ...saved.worker }, migration: { ...defaults.migration, ...saved.migration } } as AppConfig;
  if (config.version !== 3 || typeof config.vaultPath !== 'string' || !config.vaultPath.trim()) throw new Error('Invalid ~/.2b/config.json: version 3 and vaultPath are required');
  if (!Number.isInteger(config.dashboardPort) || config.dashboardPort < 1 || config.dashboardPort > 65535) throw new Error('Invalid dashboardPort');
  new Intl.DateTimeFormat('en', { timeZone: config.timezone });
  for (const choice of [config.agents.primary, config.agents.fallback]) if (choice && (!['codex', 'claude'].includes(choice.provider) || choice.model !== null && typeof choice.model !== 'string')) throw new Error('Invalid agent configuration');
  if (typeof config.reposPath !== 'string' || !config.reposPath.trim()) throw new Error('Invalid reposPath');
  if (typeof config.worker.enabled !== 'boolean' || !Number.isInteger(config.worker.pollSeconds) || config.worker.pollSeconds < 10) throw new Error('Invalid worker configuration');
  return config;
}
export function ensureConfig(): AppConfig {
  const config = loadConfig();
  fs.mkdirSync(appHome(), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(configPath())) {
    try { fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); } catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  }
  return config;
}

export function metadataDirectory(rootInput: string): string {
  const root = canonicalLocation(rootInput);
  ensureConfig();
  const markerDirectory = path.join(root, '.2b');
  fs.mkdirSync(markerDirectory, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(markerDirectory) !== markerDirectory) throw new Error('Vault marker cannot be a symlink');
  const marker = path.join(markerDirectory, 'vault.json');
  if (!fs.existsSync(marker)) {
    try { fs.writeFileSync(marker, JSON.stringify({ version: 3, id: randomUUID() }) + '\n', { flag: 'wx', mode: 0o600 }); } catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  }
  const record = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (record.version !== 3 || !/^[a-f0-9-]{36}$/.test(record.id)) throw new Error('Invalid vault identity marker');
  const directory = path.join(appHome(), 'vaults', record.id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(directory) !== directory) throw new Error('App metadata cannot be a symlink');
  const location = path.join(directory, 'vault-location.json');
  let previous: any;
  try { previous = JSON.parse(fs.readFileSync(location, 'utf8')); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.root && previous.root !== root && fs.existsSync(path.join(previous.root, '.2b', 'vault.json'))) throw new Error('This vault ID is already active at another location. Use the original vault or assign the copy a new identity.');
  const temporary = location + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ root, updatedAt: new Date().toISOString() }), { mode: 0o600 }); fs.renameSync(temporary, location);
  return directory;
}
