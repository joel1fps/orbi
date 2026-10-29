import { app } from 'electron';
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { request } from 'node:http';
import { join } from 'node:path';
import { DISCONNECT_FLAG, HOOK_FLAG, stripOrbi, type ClaudeSettings } from './hookSettings';

/**
 * Claude Code runs `Orbi --orbi-hook` for each hook event (exec form, no
 * shell, no Node.js needed). This mode never opens a window: it forwards the
 * event to the running Orbi over 127.0.0.1 and exits. If Orbi isn't running
 * it exits 0 silently, so Claude Code behaves exactly as without Orbi.
 */
export const isBridgeCli = () => process.argv.includes(HOOK_FLAG) || process.argv.includes(DISCONNECT_FLAG);

/** Where the running Orbi keeps the bridge port/token (resolved before we move userData). */
let bridgeConfigPath = '';

/**
 * Must run synchronously at startup: keep this short-lived process away from
 * the running Orbi's caches (no lock contention, no stderr noise) and from the GPU.
 */
export function prepareBridgeCli() {
  bridgeConfigPath = join(app.getPath('userData'), 'bridge', 'config.json');
  app.setPath('sessionData', join(tmpdir(), 'orbi-hook-session'));
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('log-level', '3');
}

/** ORBI_CLI_DEBUG=1 traces the bridge mode to %TEMP%/orbi-cli.log. */
const trace = (msg: string) => {
  if (process.env.ORBI_CLI_DEBUG) appendFileSync(join(tmpdir(), 'orbi-cli.log'), `${new Date().toISOString()} ${msg}\n`);
};

/**
 * Electron's main process is a GUI app on Windows: `process.stdin` stays
 * empty there, so read file descriptor 0 (the pipe Claude Code gives us)
 * directly, and fall back to the stream elsewhere.
 */
function readStdin(): Promise<string> {
  try {
    const text = readFileSync(0, 'utf8');
    if (text) return Promise.resolve(text);
  } catch (err) {
    trace(`fd0 read failed: ${String(err)}`);
  }
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function done(output?: string): never {
  if (output) process.stdout.write(output);
  // Flush stdout before leaving (Claude Code reads the permission decision from it).
  process.stdout.end(() => app.exit(0));
  setTimeout(() => app.exit(0), 300).unref();
  return undefined as never;
}

/** `Orbi --orbi-disconnect`: strip Orbi's hooks from Claude Code's settings (used on uninstall). */
function disconnect(): never {
  try {
    const path = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf8');
      const s = raw.trim() ? (JSON.parse(raw) as ClaudeSettings) : {};
      const clean = stripOrbi(s);
      if (JSON.stringify(clean) !== JSON.stringify(s)) {
        writeFileSync(`${path}.orbi-backup-uninstall`, raw);
        writeFileSync(`${path}.orbi-tmp`, JSON.stringify(clean, null, 2) + '\n');
        renameSync(`${path}.orbi-tmp`, path);
      }
    }
  } catch (err) {
    trace(`disconnect failed: ${String(err)}`);
  }
  return done();
}

export async function runBridgeCli(): Promise<void> {
  if (process.argv.includes(DISCONNECT_FLAG)) return disconnect();
  trace(`start argv=${JSON.stringify(process.argv)}`);
  const input = await readStdin();
  trace(`stdin ${input.length} bytes`);
  let event = '';
  try {
    event = (JSON.parse(input) as { hook_event_name?: string }).hook_event_name ?? '';
  } catch {
    return done();
  }
  let cfg: { port: number; token: string; permissionTimeoutSec: number };
  try {
    cfg = JSON.parse(readFileSync(bridgeConfigPath, 'utf8'));
  } catch (err) {
    trace(`no config: ${String(err)} at ${bridgeConfigPath}`);
    return done(); // Orbi never ran on this account yet
  }
  trace(`posting ${event} to ${cfg.port}`);
  const waitForAnswer = event === 'PermissionRequest';
  const req = request(
    {
      host: '127.0.0.1',
      port: cfg.port,
      path: '/hook',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-orbi-token': cfg.token },
      timeout: waitForAnswer ? (cfg.permissionTimeoutSec + 10) * 1000 : 4000,
    },
    (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const out = body.trim();
        // Only a PermissionRequest decision is printed; "{}" means "ask in the terminal".
        done(waitForAnswer && res.statusCode === 200 && out && out !== '{}' ? out : undefined);
      });
    },
  );
  req.on('error', (err) => {
    trace(`post error ${String(err)}`);
    done();
  });
  req.on('timeout', () => {
    req.destroy();
    done();
  });
  req.end(input);
}
