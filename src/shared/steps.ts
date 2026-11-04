import type { SessionStep, StepKind } from './types';

/**
 * The live session window's step trail. Pure, unit-tested. Every integration
 * already reports what the agent is doing as a Portuguese label ("Lendo x",
 * "Editando y", "Executando comando"…), so the kind is read from it.
 */
export function stepKind(label: string, code?: string): StepKind {
  if (/^(Pensando|Analisando resultado|Escrevendo resposta)/.test(label)) return 'think';
  if (/^Lendo /.test(label)) return 'read';
  if (/^(Editando|Escrevendo|Criando arquivo)/.test(label)) return 'edit';
  if (/^Conclu/.test(label)) return 'done';
  if (/^(Parou com erro|Interrompido)/.test(label)) return 'error';
  if (/^(Buscando|Procurando|Listando)/.test(label)) return 'search';
  if (/^Pesquisando na web/.test(label)) return 'web';
  if (/^Executando/.test(label) || code) return 'bash';
  return 'other';
}

export const TRAIL_MAX = 12;

/** Adds a step unless it repeats the last one; keeps the newest TRAIL_MAX. */
export function appendStep(trail: SessionStep[], step: SessionStep): SessionStep[] {
  const last = trail[trail.length - 1];
  if (last && last.label === step.label && last.code === step.code) return trail;
  return [...trail, step].slice(-TRAIL_MAX);
}

/**
 * The slice of a file to show: centred on `hint` (the text the agent just
 * wrote) when it is found, otherwise the top. Line numbers are 1-based.
 */
export function focusLines(text: string, hint: string | undefined, context = 6): { start: number; lines: string[]; highlight: number[] } {
  const all = text.replace(/\r\n?/g, '\n').split('\n');
  let from = -1;
  let count = 0;
  const needle = hint?.replace(/\r\n?/g, '\n').trim();
  if (needle) {
    const idx = text.replace(/\r\n?/g, '\n').indexOf(needle);
    if (idx >= 0) {
      from = text.replace(/\r\n?/g, '\n').slice(0, idx).split('\n').length - 1;
      count = needle.split('\n').length;
    }
  }
  if (from < 0) return { start: 1, lines: all.slice(0, context * 2 + 2), highlight: [] };
  const begin = Math.max(0, from - context);
  const end = Math.min(all.length, from + count + context);
  return { start: begin + 1, lines: all.slice(begin, end), highlight: Array.from({ length: count }, (_, i) => from + 1 + i) };
}

const BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|svgz|avif|tiff?|pdf|zip|gz|tgz|7z|rar|exe|dll|so|dylib|bin|wasm|mp[34]|mov|wav|ogg|webm|woff2?|ttf|otf|psd|sqlite|db|pb)$/i;

/** Whether a touched file can be the live window's code view (images, PDFs and binaries cannot). */
export function isTextPath(path: string): boolean {
  return !BINARY.test(path);
}
