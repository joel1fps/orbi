import type { BuiltinToolId, ToolId } from './types';

export const BUILTIN_TOOLS: Record<BuiltinToolId, { name: string; short: string; color: string }> = {
  claude: { name: 'Claude Code', short: 'Claude', color: '#e8956b' },
  codex: { name: 'Codex', short: 'Codex', color: '#4fd1b5' },
  antigravity: { name: 'Antigravity', short: 'Antigravity', color: '#e38bd9' },
  gemini: { name: 'Gemini CLI', short: 'Gemini CLI', color: '#8ab4f8' },
  github: { name: 'GitHub', short: 'GitHub', color: '#f27479' },
};

export const CUSTOM_COLORS = ['#a3e635', '#facc15', '#5eead4', '#f472b6', '#91aa9b', '#fb923c'];

export function isBuiltin(id: ToolId): id is BuiltinToolId {
  return id in BUILTIN_TOOLS;
}

/** "agora", "há 4 min", "há 2 h", "há 3 dias". */
export function ago(ts: number | undefined, now = Date.now()): string {
  if (!ts) return '';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
}

/** "em 1h 52m", "em 12 min", "seg 09:00" for far resets. */
export function until(ts: number | undefined, now = Date.now()): string {
  if (!ts) return '';
  const ms = ts - now;
  if (ms <= 0) return 'renovado';
  const m = Math.round(ms / 60000);
  if (m < 60) return `em ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `em ${h}h ${String(m % 60).padStart(2, '0')}m`;
  const d = new Date(ts);
  const wd = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return `${wd} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function basename(p: string | undefined): string {
  if (!p) return '';
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}
