import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json', '--long'], { encoding: 'utf8' }),
);
const directories = new Set();
function visit(dependencies = {}) {
  for (const dependency of Object.values(dependencies)) {
    if (
      dependency.extraneous ||
      dependency.dev ||
      !dependency.path ||
      directories.has(dependency.path)
    )
      continue;
    directories.add(dependency.path);
    visit(dependency.dependencies);
  }
}
visit(tree.dependencies);
const packages = [];
for (const directory of directories) {
  const meta = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const names = (await readdir(directory)).filter((name) =>
    /^(licen[cs]e|copying|notice)(\.|$)/i.test(name),
  );
  if (!meta.license) throw new Error(`Review license information for ${meta.name}`);
  if (!names.length) {
    const readme = (await readdir(directory)).find((name) => /^readme(\.|$)/i.test(name));
    if (
      readme &&
      /^##? licen[cs]e\s*$/im.test(await readFile(path.join(directory, readme), 'utf8'))
    )
      names.push(readme);
    else throw new Error(`Missing license notice for ${meta.name}`);
  }
  const notices = await Promise.all(
    names
      .sort()
      .map(
        async (name) =>
          `### ${name}\n\n~~~text\n${(await readFile(path.join(directory, name), 'utf8')).replace(/^.*?(?=^##? licen[cs]e\s*$)/ims, /^readme/i.test(name) ? '' : '$&').trim()}\n~~~`,
      ),
  );
  packages.push({ name: meta.name, version: meta.version, license: meta.license, notices });
}
packages.sort((a, b) => a.name.localeCompare(b.name));
const output =
  '# Third-party notices\n\nThis snapshot records installed runtime dependencies and optional peers from the lockfile. Dependencies are installed by npm and retain their own licenses. Development tools are not distributed in the package. Regenerate with `npm run licenses` after dependency changes.\n\n' +
  packages
    .map((p) => `## ${p.name} ${p.version}\n\nLicense: ${p.license}\n\n${p.notices.join('\n\n')}`)
    .join('\n\n');
await writeFile('THIRD_PARTY_NOTICES.md', output + '\n');
console.log(`Recorded notices for ${packages.length} dependencies.`);
