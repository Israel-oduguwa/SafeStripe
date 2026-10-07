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
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1_048_576 },
      (error) => {
        // Never include the command, environment or payload-bearing CLI output in diagnostics.
        if (error) reject(new Error('Stripe CLI replay failed or timed out'));
        else resolve();
      },
    );
    child.stdin?.end();
  });
}
