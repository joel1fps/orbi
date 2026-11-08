import { app } from 'electron';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hub } from './hub';
import { getWidget, send } from './widget';

/**
 * Development-only harness (ORBI_DEBUG=1): capture the widget to PNG and run
 * snippets in the renderer, so the UI can be checked without a human clicking.
 * Never started in normal use.
 */
export function startDebugServer() {
  if (process.env.ORBI_DEBUG !== '1') return;
  const dir = process.env.ORBI_SHOTS_DIR || join(process.cwd(), 'shots');
  mkdirSync(dir, { recursive: true });
  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const win = getWidget();
    if (!win) return void res.writeHead(503).end();
    try {
      if (url.pathname === '/shot') {
        const name = (url.searchParams.get('name') ?? 'shot').replace(/[^\w-]/g, '');
        const r = url.searchParams.get('rect')?.split(',').map(Number);
        const img = r && r.length === 4 ? await win.webContents.capturePage({ x: r[0], y: r[1], width: r[2], height: r[3] }) : await win.webContents.capturePage();
        const file = join(dir, `${name}.png`);
        writeFileSync(file, img.toPNG());
        res.writeHead(200).end(file);
        return;
      }
      if (url.pathname === '/eval' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const out = await win.webContents.executeJavaScript(body, true);
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out ?? null));
          } catch (err) {
            res.writeHead(500).end(String(err));
          }
        });
        return;
      }
      if (url.pathname === '/state') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(hub.snapshot()));
        return;
      }
      if (url.pathname === '/respond') {
        const p = hub.firstPermission();
        if (p) hub.resolvePermission(p.id, (url.searchParams.get('d') as 'allow' | 'deny' | 'pass') ?? 'pass');
        res.writeHead(200).end(p ? `${p.toolName}: ${p.summary}` : 'none');
        return;
      }
      if (url.pathname === '/view') {
        send('orbi:command', { type: 'set-view', view: url.searchParams.get('v') ?? 'compact' });
        res.writeHead(200).end('ok');
        return;
      }
      if (url.pathname === '/tab') {
        send('orbi:command', { type: 'open-tab', tab: url.searchParams.get('t') ?? 'home' });
        res.writeHead(200).end('ok');
        return;
      }
      if (url.pathname === '/gpu') {
        const info = await app.getGPUInfo('basic');
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: app.getGPUFeatureStatus(), info }));
        return;
      }
      if (url.pathname === '/bounds') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(win.getBounds()));
        return;
      }
      res.writeHead(404).end();
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  }).listen(47899, '127.0.0.1');
}
