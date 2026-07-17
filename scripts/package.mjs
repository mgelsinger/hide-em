import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { zipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = join(root, `hide-em-${packageJson.version}.zip`);

async function collect(directory) {
  const archive = {};
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(archive, await collect(path));
    else archive[relative(dist, path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
  }
  return archive;
}

const archive = zipSync(await collect(dist), { level: 9 });
await writeFile(output, archive);
console.log(`Created ${output}`);
