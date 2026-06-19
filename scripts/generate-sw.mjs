/**
 * Injects a unique build version into the service worker template.
 * Run before `astro build` so public/sw.js ships with the client bundle.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = `${pkg.version}-${Date.now()}`;
const template = readFileSync(join(root, 'src/pwa/sw.template.js'), 'utf8');
const output = template.replaceAll('__SW_VERSION__', version);

writeFileSync(join(root, 'public/sw.js'), output, 'utf8');
console.log(`[pwa] Generated public/sw.js (version ${version})`);