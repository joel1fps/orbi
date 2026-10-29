import type { SimulationKind } from '@shared/types';
import { hub } from './hub';

/**
 * Demo events to preview Orbi's reactions. Everything created here carries
 * `simulated: true` and the UI labels it "Simulado". It never touches real
 * sessions and never invents usage numbers.
 */
const ID = 'orbi-simulated-session';
const base = { tool: 'claude' as const, source: 'simulator' as const, project: 'demo', simulated: true };

export function simulate(kind: SimulationKind) {
  const s = hub.getSession(ID);
  switch (kind) {
    case 'start':
      hub.upsertSession(ID, { ...base, state: 'working', steps: 0, startedAt: Date.now(), current: 'Pensando…', currentCode: undefined, lastStep: undefined, summary: undefined });
      hub.event({ kind: 'start', tool: 'claude', title: 'Nova tarefa em demo', detail: 'Evento simulado', project: 'demo', sessionId: ID, simulated: true });
      break;
    case 'progress': {
      const steps = [
        { label: 'Lendo billing.ts', code: undefined },
        { label: 'Editando billing.ts', code: '+12 −3' },
        { label: 'Rodando os testes', code: 'npm test' },
      ];
      const n = s?.steps ?? 0;
      const step = steps[n % steps.length];
      hub.upsertSession(ID, {
        ...base,
        state: 'working',
        steps: n + 1,
        current: step.label,
        currentCode: step.code,
        lastStep: n > 0 ? { label: steps[(n - 1) % steps.length].label, ok: true } : undefined,
      });
      break;
    }
    case 'done':
      hub.upsertSession(ID, { ...base, state: 'done', current: 'Concluído', currentCode: undefined, summary: 'Testes passando e alterações prontas para revisão.' });
      hub.event({ kind: 'done', tool: 'claude', title: 'Claude Code terminou em demo', detail: 'Testes passando e alterações prontas para revisão.', project: 'demo', sessionId: ID, simulated: true });
      break;
    case 'error':
      hub.upsertSession(ID, { ...base, state: 'error', current: 'Parou com erro', summary: 'npm test falhou: 2 testes quebrados.' });
      hub.event({ kind: 'error', tool: 'claude', title: 'Claude Code parou com erro', detail: 'npm test falhou: 2 testes quebrados.', project: 'demo', sessionId: ID, simulated: true });
      break;
    case 'permission':
      hub.upsertSession(ID, { ...base, state: 'waiting', current: 'Precisa de permissão', currentCode: 'git push origin main' });
      void hub
        .requestPermission({
          tool: 'claude',
          sessionId: ID,
          project: 'demo',
          toolName: 'Bash',
          summary: 'git push origin main',
          description: 'Enviar commits para o GitHub',
          simulated: true,
        })
        .then((d) => {
          hub.upsertSession(ID, {
            ...base,
            state: d === 'deny' ? 'idle' : 'working',
            current: d === 'deny' ? 'Permissão negada' : d === 'allow' ? 'Enviando commits' : 'Decidir no terminal',
            currentCode: d === 'allow' ? 'git push origin main' : undefined,
          });
        });
      break;
  }
}
