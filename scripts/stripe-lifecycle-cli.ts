import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export function stripeCliBinary(): string {
  const require = createRequire(import.meta.url);
  const wrapper = dirname(require.resolve('@stripe/cli/package.json'));
  const platforms = JSON.parse(readFileSync(join(wrapper, 'platforms.json'), 'utf8')) as Record<
    string,
    { pkg: string; bin: string }
  >;
  const platform = platforms[`${process.platform}-${process.arch}`];
  if (!platform) throw new Error('Stripe CLI does not support this test runner platform');
  // Use the installed official binary directly so a timeout terminates the CLI itself.
  return join(dirname(require.resolve(`${platform.pkg}/package.json`)), 'bin', platform.bin);
}

export function runBoundedCli(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 30_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1_048_576 },
      (error, stdout) => {
        // Never include the command, environment or payload-bearing CLI output in diagnostics.
        if (error) reject(new Error('Stripe CLI replay failed or timed out'));
        else resolve(stdout);
      },
    );
    child.stdin?.end();
  });
}

export function redactLifecycleMessage(message: string): string {
  return message
    .split('\n')[0]!
    .replace(/https?:[^\s"'<>]+/g, '[URL]')
    .replace(/\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_]+\b/g, '[credential]')
    .replace(/\b(?:acct|cus|pi|pm|cs|re|in|sub|price|prod|evt|we)_[A-Za-z0-9_]+\b/g, '[fixture ID]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[email]')
    .replace(/\b\d{12,19}\b/g, '[test number]')
    .slice(0, 600);
}

export function verifyReplayResponse(stdout: string, expectedEvent: string) {
  let response;
  try {
    response = JSON.parse(stdout);
  } catch {
    throw new Error('Stripe CLI replay returned a non-JSON response');
  }
  if (response?.error)
    throw new Error(
      `Stripe CLI replay was rejected: ${redactLifecycleMessage(String(response.error.message || 'unspecified API error'))}`,
    );
  if (response?.object !== 'event' || response.id !== expectedEvent || response.livemode !== false)
    throw new Error('Stripe CLI replay did not return the expected sandbox event');
  return {
    eventIdentityVerified: true,
    livemode: false,
    pendingWebhooks: Number.isSafeInteger(response.pending_webhooks)
      ? response.pending_webhooks
      : undefined,
  };
}
