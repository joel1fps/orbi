import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { handleAntigravityHook, type AntigravityHookPayload } from '../integrations/antigravity';
import { handleHook, handlePermissionHook, type HookPayload } from '../integrations/claude';
import { handleCodexPermission, type CodexPermissionPayload } from '../integrations/codexHooks';
import { hub } from '../hub';
import { isAgyHookEvent } from './antigravityHookSettings';

/**
 * Local endpoint the Claude Code and Antigravity hook bridges talk to. Bound to
 * 127.0.0.1 only and guarded by a random token, so web pages and other users
 * can't post fake events or answer permission prompts.
 */
const BASE_PORT = 47821;
let server: Server | null = null;

function tokenOk(got: string | undefined, want: string): boolean {
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function startBridgeServer(token: string): Promise<number> {
  return new Promise((resolve) => {
    let port = BASE_PORT;
    const s = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"app":"orbi"}');
        return;
      }
      if (req.method !== 'POST' || (req.url !== '/hook' && req.url !== '/agy-hook' && req.url !== '/codex-hook')) {
        res.writeHead(404).end();
        return;
      }
      if (!tokenOk(req.headers['x-orbi-token'] as string | undefined, token) || !String(req.headers['content-type']).includes('application/json')) {
        res.writeHead(403).end();
        return;
      }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => {
        body += c;
        if (body.length > 2_000_000) req.destroy();
      });
      req.on('end', async () => {
        if (req.url === '/agy-hook') {
          const eventHeader = String(req.headers['x-orbi-event'] ?? '');
          const reply = eventHeader === 'Stop' ? '{"decision":"stop"}' : '{}';
          let payload: AntigravityHookPayload;
          try {
            payload = (body.trim() ? JSON.parse(body) : {}) as AntigravityHookPayload;
          } catch {
            res.writeHead(400).end();
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(reply);
          if (isAgyHookEvent(eventHeader)) {
            void handleAntigravityHook(eventHeader, payload).catch((err) => console.error('[orbi] antigravity hook error', err));
          }
          return;
        }

        let payload: HookPayload;
        try {
          payload = JSON.parse(body) as HookPayload;
        } catch {
          res.writeHead(400).end();
          return;
        }
        const codex = req.url === '/codex-hook';
        if (payload.hook_event_name === 'PermissionRequest') {
          // If the agent gives up (hook timeout, session closed), forget the card.
          const gone = new AbortController();
          let answered = false;
          res.on('close', () => {
            if (!answered) gone.abort();
          });
          // Codex and Claude Code answer in the same hookSpecificOutput shape.
          const decision = codex
            ? await handleCodexPermission(payload as CodexPermissionPayload, gone.signal)
            : await handlePermissionHook(payload, gone.signal);
          answered = true;
          if (res.destroyed) return;
          const out =
            decision === 'pass'
              ? {}
              : {
                  hookSpecificOutput: {
                    hookEventName: 'PermissionRequest',
                    decision:
                      decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Negado pelo usuário no Orbi.' },
                  },
                };
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
        if (codex) return; // Codex activity comes from its session files
        try {
          handleHook(payload);
        } catch (err) {
          console.error('[orbi] hook error', err);
        }
      });
    });
    s.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && port < BASE_PORT + 20) {
        port++;
        s.listen(port, '127.0.0.1');
      } else {
        console.error('[orbi] bridge server failed', err);
        hub.setClaude({ serverOk: false });
        resolve(0);
      }
    });
    s.listen(port, '127.0.0.1', () => {
      server = s;
      hub.setClaude({ serverOk: true, serverPort: port });
      resolve(port);
    });
  });
}

export function stopBridgeServer() {
  server?.close();
  server = null;
}
