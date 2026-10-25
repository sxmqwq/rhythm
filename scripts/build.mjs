import { mkdir, cp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
const assets = ['index.html', 'styles.css', 'favicon.svg', 'app.mjs', 'core.mjs', 'storage.mjs', 'api.mjs', 'config.mjs', 'vendor'];
if (resolve(output) !== resolve(root, 'dist')) throw new Error('Invalid build destination');
await mkdir(output, { recursive: true });
for (const entry of await readdir(output)) await rm(join(output, entry), { recursive: true, force: true });
for (const asset of assets) await cp(join(root, asset), join(output, asset), { recursive: true });
async function filesIn(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    result.push(...(entry.isDirectory() ? await filesIn(path) : [path]));
  }
  return result;
}
const files = (await filesIn(output)).sort();
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile(file));
const revision = hash.digest('hex').slice(0, 12);
for (const file of files) {
  if (!/\.(?:mjs|html)$/u.test(file)) continue;
  const source = await readFile(file, 'utf8');
  const versioned = source.replace(/(['"])(\.\.?\/[^'"\s]+\.(?:mjs|css))\1/gu, (_match, quote, path) => `${quote}${path}?v=${revision}${quote}`);
  await writeFile(file, versioned);
}
await writeFile(join(output, '.nojekyll'), '');
console.log(`Built rhythm ${revision} (${files.length} files) into dist/`);
