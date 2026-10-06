import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('release evidence refuses stale runs, failed providers and unverified sandbox proof', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'safestripe-release-gate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const repository = 'Israel-oduguwa/SafeStripe';
  const valid = {
    commit,
    conclusion: 'success',
    provider: 'success',
    report: {
      sourceCommit: commit,
      sourceDirty: false,
      passed: true,
      accountIdentityVerified: true,
      sdk: '22.6.2',
      apiVersion: '2026-08-26.dahlia',
      checks: ['Elements Checkout accepted by Stripe, client secret present and replay stable'],
    },
  };
  // This executable replaces only gh in the subprocess; no network or publication occurs.
  await writeFile(
    join(directory, 'gh'),
    `#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');
const f=JSON.parse(fs.readFileSync(process.env.RELEASE_GATE_FIXTURE,'utf8'));
const args=process.argv.slice(2);const endpoint=args[1]||'';
if(args[0]==='run') {
 const directory=args[args.indexOf('--dir')+1];
 fs.writeFileSync(path.join(directory,'stripe-e2e.json'),JSON.stringify(f.report));
} else if(endpoint.includes('/code-scanning/alerts')) {
 console.log(JSON.stringify(f.alerts||[]));
} else if(endpoint.includes('/jobs')) {
 console.log(JSON.stringify({jobs:[{name:'verify (22)',conclusion:'success'},
 {name:'verify (24)',conclusion:'success'},{name:'document-adapters',conclusion:f.provider},
 {name:'codeql',conclusion:'success'},{name:'service-tests',conclusion:'success'}]}));
} else {
 console.log(JSON.stringify({workflow_runs:[{id:1,head_sha:f.commit,
 head_repository:{full_name:'${repository}'},head_branch:'main',event:'push',
 status:'completed',conclusion:f.conclusion}]}));
}
`,
    { mode: 0o700 },
  );
  const fixture = join(directory, 'case.json');
  const cases = [
    {
      name: 'unresolved high CodeQL finding',
      data: {
        ...valid,
        alerts: [
          {
            most_recent_instance: { ref: 'refs/heads/main' },
            rule: { security_severity_level: 'high' },
          },
        ],
      },
      accepted: false,
    },
    { name: 'matching completed evidence', data: valid, accepted: true },
    { name: 'different commit', data: { ...valid, commit: '0'.repeat(40) }, accepted: false },
    { name: 'failed latest workflow', data: { ...valid, conclusion: 'failure' }, accepted: false },
    { name: 'skipped document adapters', data: { ...valid, provider: 'skipped' }, accepted: false },
    {
      name: 'temporary unclaimed account',
      data: { ...valid, report: { ...valid.report, accountIdentityVerified: false } },
      accepted: false,
    },
    {
      name: 'dirty service source',
      data: { ...valid, report: { ...valid.report, sourceDirty: true } },
      accepted: false,
    },
    {
      name: 'failed service report',
      data: { ...valid, report: { ...valid.report, passed: false } },
      accepted: false,
    },
  ];
  for (const row of cases)
    await t.test(row.name, async () => {
      await writeFile(fixture, JSON.stringify(row.data));
      const result = spawnSync(process.execPath, ['scripts/check-release-evidence.mjs'], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GITHUB_REPOSITORY: repository,
          RELEASE_GATE_FIXTURE: fixture,
        },
        encoding: 'utf8',
      });
      assert.equal(result.status === 0, row.accepted, result.stderr);
    });
});
