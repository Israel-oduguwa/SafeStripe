import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'artifacts', 'snippet-check');
const source = await readFile(path.join(root, 'docs/12-integration.md'), 'utf8');
const blocks = [...source.matchAll(/```(ts|js)\n([\s\S]*?)```/g)].map((match) => ({
  language: match[1],
  code: match[2],
}));
const base = `import type Stripe from 'stripe';
import type * as Core from '@safestripe/core';
declare const db: import('pg').Pool;
declare const stripe: Stripe;
declare const scope: Core.Scope;
`;
const fixtures = [
  [
    'const actor =',
    `declare const session: { organizationId: string; userId: string }; declare const order: { id: string };`,
  ],
  [
    'const safe = new SafeStripe',
    `import { SafeStripe, PostgresOperations } from '@safestripe/core'; declare const billingPolicy: { authorize: Core.Authorizer }; declare const actor: Core.Actor; declare const order: { id: string; stripeCustomerId: string; stripePriceId: string; quantity: number };`,
  ],
  ['const receiver = new WebhookReceiver', ''],
  ['const app = express()', 'declare const receiver: Core.WebhookReceiver;'],
  [
    'const worker = new WebhookWorker',
    `declare const jobs: Core.PostgresJobs; declare const safe: Core.SafeStripe; declare const handleCheckout: Core.EventHandler; declare const handleFailure: Core.EventHandler;`,
  ],
  ['const observer: Observer', 'declare const metrics: { record(...values: unknown[]): void };'],
];
await mkdir(directory, { recursive: true });
try {
  const files = [];
  for (const [index, [match, context]] of fixtures.entries()) {
    const block = blocks.find((block) => block.language === 'ts' && block.code.includes(match));
    if (!block) throw new Error(`Missing documented snippet: ${match}`);
    const file = path.join(directory, `snippet-${index}.ts`);
    await writeFile(file, base + context + '\n' + block.code + '\nexport {};');
    files.push(file);
  }
  const customer = blocks.find(
    (block) => block.language === 'js' && block.code.includes('Learning customer'),
  );
  if (!customer) throw new Error('Missing complete customer tutorial');
  const customerPath = path.join(directory, 'customer.mjs');
  await writeFile(customerPath, customer.code);
  execFileSync(process.execPath, ['--check', customerPath], { stdio: 'pipe' });
  execFileSync(
    process.execPath,
    [
      path.join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      ...files,
    ],
    { cwd: root, stdio: 'pipe' },
  );
  console.log(
    `Documentation examples verified: ${files.length} typed integration snippets and the customer script syntax.`,
  );
} catch (error) {
  if (error?.stdout) process.stderr.write(error.stdout);
  throw error;
} finally {
  await rm(directory, { recursive: true, force: true });
}
