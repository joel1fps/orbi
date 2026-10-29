import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { handleHook, handlePermissionHook, type HookPayload } from '../integrations/claude';
import { hub } from '../hub';

/**
 * Local endpoint the Claude Code hook script talks to. Bound to 127.0.0.1
 * only and guarded by a random token, so web pages and other users can't
 * post fake events or answer permission prompts.
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
      if (req.method !== 'POST' || req.url !== '/hook') {
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
        let payload: HookPayload;
        try {
          payload = JSON.parse(body) as HookPayload;
        } catch {
          res.writeHead(400).end();
          return;
        }
        if (payload.hook_event_name === 'PermissionRequest') {
          // If Claude Code gives up (hook timeout, session closed), forget the card.
          const gone = new AbortController();
          let answered = false;
          res.on('close', () => {
            if (!answered) gone.abort();
          });
          const decision = await handlePermissionHook(payload, gone.signal);
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
