import { spawn } from 'child_process';

const PLAN_TIMEOUT_MS = 5 * 60 * 1000;    // 5 minutes
const IMPLEMENT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export async function runClaude(
  prompt: string,
  cwd: string,
  timeoutMs = PLAN_TIMEOUT_MS,
  signal?: AbortSignal,
  allowedTools = 'Edit,Write,Read,Bash,Glob,Grep',
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--print', '--allowedTools', allowedTools], {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdin.end(prompt);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Claude Code timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      proc.kill();
      reject(new Error('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    proc.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      console.log(`[claude] exited with code ${code}`);
      if (stdout) console.log(`[claude] stdout:\n${stdout.slice(-2000)}`);
      if (stderr) console.log(`[claude] stderr:\n${stderr.slice(-1000)}`);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude Code exited with code ${code}:\n${stderr.trim()}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`Failed to start Claude Code: ${err.message}`));
    });
  });
}

export { IMPLEMENT_TIMEOUT_MS };
