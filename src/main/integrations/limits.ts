import type { ModelQuota, UsageWindow } from '../../shared/types';

/**
 * Pure parsers for every plan-limit source (no I/O, unit-tested). Each one
 * returns nothing rather than a guess when a field is missing.
 */

// ---------- Claude (account usage endpoint, same data as /usage) ----------

interface ClaudeWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

export function parseClaudeUsage(j: unknown): { fiveHour?: UsageWindow; week?: UsageWindow } {
  const o = (j ?? {}) as { five_hour?: ClaudeWindow | null; seven_day?: ClaudeWindow | null };
  const win = (w: ClaudeWindow | null | undefined, minutes: number): UsageWindow | undefined =>
    w && typeof w.utilization === 'number' && Number.isFinite(w.utilization)
      ? { usedPercent: w.utilization, resetsAt: w.resets_at ? Date.parse(w.resets_at) || undefined : undefined, windowMinutes: minutes }
      : undefined;
  return { fiveHour: win(o.five_hour, 300), week: win(o.seven_day, 10080) };
}

// ---------- Codex (rate_limits in ~/.codex/sessions token_count events) ----------

export interface CodexWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

export interface CodexRateLimits {
  limit_id?: string | null;
  primary?: CodexWindow | null;
  secondary?: CodexWindow | null;
  plan_type?: string | null;
}

/** Codex also logs other limit ids (e.g. an always-empty "premium"); the plan windows live under "codex". */
export function isPlanLimit(rl: CodexRateLimits): boolean {
  return !rl.limit_id || rl.limit_id === 'codex';
}

export function codexWindows(rl: CodexRateLimits): { fiveHour?: UsageWindow; week?: UsageWindow; plan?: string } | null {
  const win = (w?: CodexWindow | null): UsageWindow | undefined =>
    w && typeof w.used_percent === 'number'
      ? { usedPercent: w.used_percent, windowMinutes: w.window_minutes, resetsAt: w.resets_at ? w.resets_at * 1000 : undefined }
      : undefined;
  const windows = [win(rl.primary), win(rl.secondary)].filter((w): w is UsageWindow => Boolean(w));
  if (windows.length === 0) return null;
  // Classify by the window length Codex reports instead of trusting primary/secondary order.
  return {
    fiveHour: windows.find((w) => (w.windowMinutes ?? 0) <= 600),
    week: windows.find((w) => (w.windowMinutes ?? 0) > 600),
    plan: rl.plan_type ?? undefined,
  };
}

// ---------- Antigravity (language server GetUserStatus) ----------

export interface AntigravityStatus {
  userStatus?: {
    planStatus?: { planInfo?: { planName?: string } };
    cascadeModelConfigData?: {
      clientModelConfigs?: { label?: string; quotaInfo?: { remainingFraction?: number; resetTime?: string } }[];
    };
  };
}

/** "Claude Opus 5.5 (High)" and "(Low)" share one quota: group them by model. */
export function antigravityQuotas(r: AntigravityStatus): ModelQuota[] {
  const groups = new Map<string, ModelQuota>();
  for (const c of r.userStatus?.cascadeModelConfigData?.clientModelConfigs ?? []) {
    if (!c.label || !c.quotaInfo) continue;
    const label = c.label.replace(/\s*\([^)]*\)\s*$/, '').trim();
    // Protobuf JSON omits zero values: a quota with no remainingFraction is used up.
    const used = toUsed(c.quotaInfo.remainingFraction ?? 0);
    const resetsAt = c.quotaInfo.resetTime ? Date.parse(c.quotaInfo.resetTime) || undefined : undefined;
    const prev = groups.get(label);
    if (!prev || used > prev.usedPercent) groups.set(label, { label, usedPercent: used, resetsAt });
  }
  return [...groups.values()];
}

// ---------- Gemini CLI (Code Assist retrieveUserQuota) ----------

export interface GeminiQuotaResponse {
  buckets?: { modelId?: string; remainingFraction?: number; resetTime?: string; tokenType?: string }[];
}

/** "gemini-2.5-pro" → "Gemini 2.5 Pro". */
export function geminiModelLabel(id: string): string {
  return id
    .replace(/_vertex$/i, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => (/^\d/.test(p) ? p : p[0].toUpperCase() + p.slice(1)))
    .join(' ');
}

export function geminiQuotas(r: GeminiQuotaResponse): ModelQuota[] {
  const groups = new Map<string, ModelQuota>();
  for (const b of r.buckets ?? []) {
    if (!b.modelId) continue;
    const label = geminiModelLabel(b.modelId);
    const used = toUsed(b.remainingFraction ?? 0);
    const resetsAt = b.resetTime ? Date.parse(b.resetTime) || undefined : undefined;
    const prev = groups.get(label);
    if (!prev || used > prev.usedPercent) groups.set(label, { label, usedPercent: used, resetsAt });
  }
  return [...groups.values()];
}

// ---------- shared ----------

function toUsed(remainingFraction: number): number {
  const f = Math.max(0, Math.min(1, remainingFraction));
  return Math.round((1 - f) * 1000) / 10;
}

/** The model closest to its limit, used for the ring and the pill. */
export function busiest(models: ModelQuota[]): ModelQuota | undefined {
  return models.reduce<ModelQuota | undefined>((a, b) => (!a || b.usedPercent > a.usedPercent ? b : a), undefined);
}

/** chatgpt.com/backend-api/wham/usage (what the Codex app shows as usage). */
interface CodexUsageWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}

export interface CodexUsageResponse {
  plan_type?: string;
  rate_limit?: { primary_window?: CodexUsageWindow | null; secondary_window?: CodexUsageWindow | null } | null;
}

function codexUsageWindow(w: CodexUsageWindow | null | undefined): UsageWindow | undefined {
  if (!w || typeof w.used_percent !== 'number') return undefined;
  return {
    usedPercent: Math.min(100, Math.max(0, w.used_percent)),
    resetsAt: w.reset_at ? w.reset_at * 1000 : undefined,
    windowMinutes: w.limit_window_seconds ? Math.round(w.limit_window_seconds / 60) : undefined,
  };
}

export function parseCodexUsage(r: CodexUsageResponse) {
  return { plan: r.plan_type, fiveHour: codexUsageWindow(r.rate_limit?.primary_window), week: codexUsageWindow(r.rate_limit?.secondary_window) };
}
