import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  antigravityQuotas,
  busiest,
  codexWindows,
  geminiModelLabel,
  geminiQuotas,
  isPlanLimit,
  parseClaudeUsage,
  parseCodexUsage,
} from '../src/main/integrations/limits.ts';

// Shapes below are copied from real responses on this machine (values changed).

test('Claude: five_hour and seven_day become 5h and week windows', () => {
  const r = parseClaudeUsage({
    five_hour: { utilization: 70, resets_at: '2026-10-18T10:09:59.621626+00:00', limit_dollars: null },
    seven_day: { utilization: 24, resets_at: '2026-10-24T18:59:59.621655+00:00' },
    seven_day_opus: null,
  });
  assert.deepEqual(r.fiveHour, { usedPercent: 70, resetsAt: Date.parse('2026-10-18T10:09:59.621626+00:00'), windowMinutes: 300 });
  assert.equal(r.week?.usedPercent, 24);
  assert.equal(r.week?.windowMinutes, 10080);
});

test('Claude: missing or null utilization yields no window instead of 0%', () => {
  assert.deepEqual(parseClaudeUsage({ five_hour: null, seven_day: { utilization: null } }), { fiveHour: undefined, week: undefined });
  assert.deepEqual(parseClaudeUsage(null), { fiveHour: undefined, week: undefined });
});

test('Codex: windows are classified by length, not by primary/secondary order', () => {
  const w = codexWindows({
    limit_id: 'codex',
    primary: { used_percent: 16, window_minutes: 10080, resets_at: 1792901826 },
    secondary: { used_percent: 99, window_minutes: 300, resets_at: 1792315026 },
    plan_type: 'plus',
  });
  assert.equal(w?.fiveHour?.usedPercent, 99);
  assert.equal(w?.fiveHour?.resetsAt, 1792315026000);
  assert.equal(w?.week?.usedPercent, 16);
  assert.equal(w?.plan, 'plus');
});

test('Codex: the always-empty "premium" record is not the plan limit', () => {
  const premium = { limit_id: 'premium', primary: null, secondary: null, plan_type: 'plus' };
  assert.equal(isPlanLimit(premium), false);
  assert.equal(codexWindows(premium), null);
  assert.equal(isPlanLimit({ limit_id: 'codex' }), true);
  assert.equal(isPlanLimit({}), true); // older builds have no limit_id
});

test('Codex: plan_type null is reported as unknown, not as a plan', () => {
  const w = codexWindows({ limit_id: 'codex', primary: { used_percent: 1, window_minutes: 300 }, plan_type: null });
  assert.equal(w?.plan, undefined);
  assert.equal(w?.week, undefined);
});

test('Antigravity: variants of a model share one quota; the busiest variant wins', () => {
  const models = antigravityQuotas({
    userStatus: {
      planStatus: { planInfo: { planName: 'Pro' } },
      cascadeModelConfigData: {
        clientModelConfigs: [
          { label: 'Claude Opus 5.5 (Low)', quotaInfo: { remainingFraction: 0.8, resetTime: '2026-10-18T11:28:43Z' } },
          { label: 'Claude Opus 5.5 (High)', quotaInfo: { remainingFraction: 0.6, resetTime: '2026-10-18T11:28:43Z' } },
          { label: 'Gemini 3.8 Flash (Medium)', quotaInfo: { remainingFraction: 1, resetTime: '2026-10-18T11:28:43Z' } },
          { label: 'Model without quota' },
        ],
      },
    },
  });
  assert.deepEqual(
    models.map((m) => [m.label, m.usedPercent]),
    [
      ['Claude Opus 5.5', 40],
      ['Gemini 3.8 Flash', 0],
    ],
  );
  assert.equal(busiest(models)?.label, 'Claude Opus 5.5');
});

test('Antigravity: an omitted remainingFraction (protobuf zero) means the quota is used up', () => {
  const [m] = antigravityQuotas({
    userStatus: { cascadeModelConfigData: { clientModelConfigs: [{ label: 'GPT-OSS 120B (Medium)', quotaInfo: { resetTime: '2026-10-18T11:28:43Z' } }] } },
  });
  assert.equal(m.usedPercent, 100);
});

test('Gemini CLI: buckets per model, lowest remaining wins, ids become names', () => {
  const models = geminiQuotas({
    buckets: [
      { modelId: 'gemini-2.5-pro', remainingFraction: 0.75, resetTime: '2026-10-19T07:00:00Z', tokenType: 'REQUESTS' },
      { modelId: 'gemini-2.5-pro', remainingFraction: 0.5, resetTime: '2026-10-19T07:00:00Z', tokenType: 'TOKENS' },
      { modelId: 'gemini-2.5-flash', remainingFraction: 1 },
    ],
  });
  assert.deepEqual(
    models.map((m) => [m.label, m.usedPercent]),
    [
      ['Gemini 2.5 Pro', 50],
      ['Gemini 2.5 Flash', 0],
    ],
  );
  assert.equal(geminiModelLabel('gemini-2.0-flash_vertex'), 'Gemini 2.0 Flash');
});

test('every source: fractions are clamped to 0..100%', () => {
  const [m] = geminiQuotas({ buckets: [{ modelId: 'gemini-x', remainingFraction: 1.4 }] });
  assert.equal(m.usedPercent, 0);
  const [n] = geminiQuotas({ buckets: [{ modelId: 'gemini-y', remainingFraction: -0.2 }] });
  assert.equal(n.usedPercent, 100);
});

test('codex account usage maps primary/secondary windows to 5 hours and week', () => {
  const u = parseCodexUsage({
    plan_type: 'plus',
    rate_limit: {
      primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_at: 1792365543 },
      secondary_window: { used_percent: 49, limit_window_seconds: 604800, reset_at: 1792901826 },
    },
  });
  assert.equal(u.plan, 'plus');
  assert.deepEqual(u.fiveHour, { usedPercent: 100, resetsAt: 1792365543000, windowMinutes: 300 });
  assert.deepEqual(u.week, { usedPercent: 49, resetsAt: 1792901826000, windowMinutes: 10080 });
  assert.deepEqual(parseCodexUsage({ rate_limit: null }), { plan: undefined, fiveHour: undefined, week: undefined });
});
