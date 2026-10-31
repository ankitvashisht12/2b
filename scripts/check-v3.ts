import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const files = fs.readdirSync('src/v3').filter(name => name.endsWith('.ts')).map(name => path.join('src/v3', name));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--check', file], { encoding: 'utf8' });
  if (result.status) { process.stderr.write(result.stderr); process.exit(1); }
}
// The dashboard is a prebuilt bundle; `npm run build` writes it.
const html = 'dash-v3/dist/index.html';
if (!fs.existsSync(html)) throw new Error('Dashboard not built. Run npm run build.');
const assets = [...fs.readFileSync(html, 'utf8').matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map(match => match[1]);
if (!assets.some(asset => asset.endsWith('.js')) || !assets.some(asset => asset.endsWith('.css'))) throw new Error('Dashboard bundle has no script or stylesheet.');
for (const asset of assets) if (!fs.existsSync(path.join('dash-v3/dist', asset))) throw new Error(`Dashboard asset missing: ${asset}. Run npm run build.`);
console.log(`Syntax checks passed for ${files.length} TypeScript modules; dashboard bundle has ${assets.length} assets.`);
