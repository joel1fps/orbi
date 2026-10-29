import { useEffect, useState } from 'react';
import type { PlanTool, PlanUsage, UsageWindow } from '@shared/types';

export type { PlanTool };
export const PLAN_TOOLS: readonly PlanTool[] = ['claude', 'codex', 'antigravity', 'gemini'];

export const PLAN_NAME: Record<PlanTool, string> = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity', gemini: 'Gemini' };
export const PLAN_TONE: Record<PlanTool, string> = { claude: '#e8956b', codex: '#4fd1b5', antigravity: '#e38bd9', gemini: '#8ab4f8' };

/** Re-render on a clock so countdowns tick ("↻ em 3h 05m"). */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** A window whose reset time has passed no longer says anything about current usage. */
export function liveWindow(w: UsageWindow | undefined, now: number): UsageWindow | undefined {
  if (!w) return undefined;
  if (w.resetsAt !== undefined && w.resetsAt <= now) return undefined;
  return w;
}

/** Past this age the numbers may no longer match the account (live sources refresh every few minutes). */
const STALE_MS = 30 * 60_000;
export const isStale = (u: PlanUsage | undefined, now: number) => Boolean(u && now - u.observedAt > STALE_MS);

/** The number that matters most right now: the 5-hour window, else the week. */
export function headlineWindow(u: PlanUsage | undefined, now: number): UsageWindow | undefined {
  return liveWindow(u?.fiveHour, now) ?? liveWindow(u?.week, now);
}

/** Tool colour while comfortable, amber near the limit, red at the limit. */
export function levelTone(pct: number, tone: string): string {
  if (pct >= 90) return '#f27479';
  if (pct >= 70) return '#f2b84b';
  return tone;
}

/** Small circular gauge for the 5-hour window. */
export function UsageRing({ pct, tone, size = 16 }: { pct: number; tone: string; size?: number }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  const used = Math.max(0, Math.min(100, pct)) / 100;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={2.2} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={tone}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeDasharray={`${c * used} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
