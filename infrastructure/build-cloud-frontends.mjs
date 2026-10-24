import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const frontends = [['web', '/'], ['admin', '/tenant-admin/'], ['platform-admin', '/platform-admin/']];
const selected = process.argv[2] ?? 'all';
if (selected !== 'all' && !frontends.some(([name]) => name === selected)) {
  throw new Error(`Unknown frontend: ${selected}`);
}
for (const [frontend, base] of frontends.filter(([name]) => selected === 'all' || selected === name)) {
  // An already-open client can still lazy-load chunks from the preceding build.
  // Keep exactly that build's hashed assets; record current files before merging
  // so retained files don't accumulate across future releases.
  const assets=join('apps',frontend,'dist','assets');
  const manifests=join('var','cloud-frontend-assets');
  const manifest=join(manifests,frontend+'.json');
  const previousNames=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')):existsSync(assets)?readdirSync(assets):[];
  if(!Array.isArray(previousNames)||previousNames.some(name=>typeof name!=='string'||!/^[-\w.]+$/.test(name)))throw new Error('Invalid previous frontend asset manifest');
  const previous=new Map(previousNames.filter(name=>existsSync(join(assets,name))).map(name=>[name,readFileSync(join(assets,name))]));
  const result = spawnSync('pnpm', ['--filter', `@suite/${frontend}`, 'build'], { stdio: 'inherit', env: { ...process.env, SUITE_PUBLIC_BASE: base, VITE_TENANT_ADMIN_URL: '/tenant-admin', VITE_PLATFORM_ADMIN_URL: '/platform-admin', VITE_WORKSPACE_URL: '' } });
  if (result.status !== 0) process.exit(result.status ?? 1);
  mkdirSync(manifests,{recursive:true});
  writeFileSync(manifest,JSON.stringify(readdirSync(assets)));
  for(const [name,content] of previous)if(!existsSync(join(assets,name)))writeFileSync(join(assets,name),content);
}
process.stdout.write(`${selected === 'all' ? 'Three independent frontend builds are' : `${selected} build is`} ready for Cloudflare; no deployment performed.\n`);
