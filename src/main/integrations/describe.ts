import { basename, truncate } from '@shared/tools';
export { cleanAntigravityArg, describeAntigravityTool } from './antigravityTranscript';

/** Human label + optional monospace payload for a Claude Code tool call. */
export function describeClaudeTool(name: string, input: unknown): { label: string; code?: string; file?: string; hint?: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return { label: s('description') ? truncate(s('description'), 60) : 'Executando comando', code: firstLine(s('command')) };
    case 'Edit':
    case 'MultiEdit': {
      const added = lines(s('new_string'));
      const removed = lines(s('old_string'));
      return {
        label: `Editando ${basename(s('file_path'))}`,
        code: added || removed ? `+${added} −${removed}` : undefined,
        file: s('file_path') || undefined,
        hint: s('new_string') || undefined,
      };
    }
    case 'Write':
      return { label: `Escrevendo ${basename(s('file_path'))}`, code: `+${lines(s('content'))}`, file: s('file_path') || undefined };
    case 'Read':
      return { label: `Lendo ${basename(s('file_path'))}`, file: s('file_path') || undefined };
    case 'NotebookEdit':
      return { label: `Editando ${basename(s('notebook_path'))}` };
    case 'Grep':
      return { label: 'Buscando no código', code: truncate(s('pattern'), 60) };
    case 'Glob':
      return { label: 'Procurando arquivos', code: truncate(s('pattern'), 60) };
    case 'WebFetch':
      return { label: `Lendo ${host(s('url'))}` };
    case 'WebSearch':
      return { label: 'Pesquisando na web', code: truncate(s('query'), 60) };
    case 'Task':
    case 'Agent':
      return { label: s('description') ? `Subagente: ${truncate(s('description'), 48)}` : 'Subagente trabalhando' };
    case 'TodoWrite':
      return { label: 'Organizando tarefas' };
    case 'Skill':
      return { label: `Usando a skill ${s('skill')}`.trim() };
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
      if (mcp) return { label: `${mcp[2].replace(/_/g, ' ')} (${mcp[1]})` };
      return { label: name };
    }
  }
}

/** What a permission card shows: the exact thing being approved. */
export function describePermission(name: string, input: unknown): { summary: string; description?: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return { summary: truncate(s('command'), 160) || name, description: s('description') || undefined };
    case 'Edit':
    case 'MultiEdit':
      return { summary: s('file_path') || name, description: 'Editar arquivo' };
    case 'Write':
      return { summary: s('file_path') || name, description: 'Criar ou substituir arquivo' };
    case 'NotebookEdit':
      return { summary: s('notebook_path') || name, description: 'Editar notebook' };
    case 'WebFetch':
      return { summary: s('url') || name, description: 'Abrir página' };
    case 'WebSearch':
      return { summary: s('query') || name, description: 'Pesquisar na web' };
    default: {
      const d = describeClaudeTool(name, input);
      const firstString = Object.values(i).find((v) => typeof v === 'string') as string | undefined;
      return { summary: d.code ?? (firstString ? truncate(firstString, 160) : d.label), description: d.code || firstString ? d.label : undefined };
    }
  }
}

/** Shell-ish command extracted from a Codex `exec` tool call (JS that calls tools.exec_command). */
export function describeCodexCall(name: string, rawInput: string | undefined): { label: string; code?: string } {
  switch (name) {
    case 'exec': {
      const m = /cmd\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(rawInput ?? '') ?? /cmd\s*:\s*'((?:[^'\\]|\\.)*)'/.exec(rawInput ?? '');
      const cmd = m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : undefined;
      return { label: 'Executando comando', code: cmd ? firstLine(cmd) : undefined };
    }
    case 'shell':
    case 'exec_command':
      return { label: 'Executando comando' };
    case 'apply_patch':
      return { label: 'Editando arquivos' };
    case 'js':
      return { label: 'Executando script' };
    case '_web_run':
    case 'web_search':
      return { label: 'Pesquisando na web' };
    case 'spawn_agent':
      return { label: 'Criando subagente' };
    case 'send_message':
      return { label: 'Conversando com subagente' };
    case 'wait_agent':
    case 'wait':
      return { label: 'Aguardando subagente' };
    case 'request_user_input_async':
      return { label: 'Pergunta para você' };
    case 'update_plan':
      return { label: 'Organizando tarefas' };
    default:
      return { label: name.replace(/_/g, ' ') };
  }
}

function firstLine(s: string): string | undefined {
  if (!s) return undefined;
  return truncate(s.split(/\r?\n/)[0], 120);
}

function lines(s: string): number {
  return s ? s.split(/\r?\n/).length : 0;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'página';
  }
}
