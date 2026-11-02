import { basename, truncate } from '@shared/tools';
import type { PermissionDecision } from '@shared/types';
import { codexPermissionSummary } from '../bridge/codexHookSettings';
import { hub } from '../hub';

/** Codex PermissionRequest hook input (Codex hook schema). */
export interface CodexPermissionPayload {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
  turn_id?: string;
  permission_mode?: string;
}

/** A Codex permission prompt becomes the island's card; the answer goes back to that Codex. */
export async function handleCodexPermission(p: CodexPermissionPayload, signal?: AbortSignal): Promise<PermissionDecision> {
  hub.setCodex({ lastHookAt: Date.now() });
  const name = p.tool_name ?? 'Ferramenta';
  return hub.requestPermission(
    {
      tool: 'codex',
      sessionId: p.session_id,
      project: basename(p.cwd) || undefined,
      toolName: name,
      summary: truncate(codexPermissionSummary(name, p.tool_input), 200),
      description: p.permission_mode && p.permission_mode !== 'default' ? `Modo de permissão do Codex: ${p.permission_mode}` : undefined,
    },
    signal,
  );
}
