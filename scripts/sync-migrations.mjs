import { readdir, readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
const directory = new URL('../migrations/', import.meta.url);
const names = (await readdir(directory))
  .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
  .sort();
const sources = await Promise.all(
  names.map(async (name) => ({ name, sql: await readFile(new URL(name, directory), 'utf8') })),
);
const source = await format(
  `// Generated from migrations/*.sql. Do not edit this registry by hand.\nexport const migrationSources = ${JSON.stringify(sources)} as const;\n`,
  { parser: 'typescript', singleQuote: true, printWidth: 100 },
);
await writeFile(new URL('../src/migration-sources.ts', import.meta.url), source);
