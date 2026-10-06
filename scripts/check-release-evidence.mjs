import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repository = process.env.GITHUB_REPOSITORY;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(repository ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const api = (path) => JSON.parse(gh('api', path));
const evidence = [];
const alerts = api(`repos/${repository}/code-scanning/alerts?state=open&per_page=100`);
assert.ok(Array.isArray(alerts), 'CodeQL alert evidence is unavailable');
assert.equal(
  alerts.filter(
    (alert) =>
      alert.most_recent_instance?.ref === 'refs/heads/main' &&
      ['high', 'critical'].includes(alert.rule?.security_severity_level),
  ).length,
  0,
  'Resolve high or critical CodeQL findings on main before publishing',
);
assert.ok(alerts.length < 100, 'CodeQL alert evidence needs pagination before release');
for (const workflow of ['ci.yml', 'security.yml', 'stripe-sandbox.yml']) {
  const response = api(
    `repos/${repository}/actions/workflows/${workflow}/runs?head_sha=${commit}&per_page=100`,
  );
  const runs = response.workflow_runs
    .filter(
      (run) =>
        run.head_sha === commit &&
        run.head_repository?.full_name === repository &&
        run.head_branch === 'main' &&
        ['push', 'workflow_dispatch'].includes(run.event),
    )
    .sort((a, b) => b.id - a.id);
  const run = runs[0];
  assert.ok(run, `Missing ${workflow} evidence on the tagged commit`);
  assert.equal(run.status, 'completed', `${workflow} has not finished`);
  assert.equal(run.conclusion, 'success', `${workflow} did not pass`);
  const jobs = api(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`).jobs;
  const required =
    workflow === 'ci.yml'
      ? ['verify (22)', 'verify (24)', 'document-adapters']
      : workflow === 'security.yml'
        ? ['codeql']
        : ['service-tests'];
  for (const name of required)
    assert.equal(
      jobs.find((job) => job.name === name)?.conclusion,
      'success',
      `Required job ${name} did not pass`,
    );
  if (workflow === 'stripe-sandbox.yml') {
    const directory = await mkdtemp(join(tmpdir(), 'safestripe-release-proof-'));
    try {
      gh(
        'run',
        'download',
        String(run.id),
        '--repo',
        repository,
        '--name',
        'stripe-sandbox-report',
        '--dir',
        directory,
      );
      const report = JSON.parse(await readFile(join(directory, 'stripe-e2e.json'), 'utf8'));
      const manifest = JSON.parse(await readFile('package.json', 'utf8'));
      assert.equal(report.sourceCommit, commit);
      assert.equal(report.sourceDirty, false);
      assert.equal(report.passed, true);
      assert.equal(
        report.accountIdentityVerified,
        true,
        'Temporary unclaimed sandbox evidence cannot authorize a release',
      );
      assert.equal(report.sdk, manifest.dependencies.stripe);
      const apiVersion = (await readFile('src/primitives.ts', 'utf8')).match(
        /API_VERSION = '([^']+)'/,
      )?.[1];
      assert.equal(report.apiVersion, apiVersion);
      assert.ok(report.checks.some((check) => check.startsWith('Elements Checkout accepted')));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  evidence.push({ workflow, run: run.id, commit });
}
console.log(JSON.stringify({ verifiedReleaseChecks: evidence }, null, 2));
