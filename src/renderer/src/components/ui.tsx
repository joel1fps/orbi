import type { CSSProperties, ReactNode } from 'react';
import type { ToolStatus } from '@shared/types';

export function ToolFace({ color, size = 22, dim = false }: { color: string; size?: number; dim?: boolean }) {
  return <span className={`face${dim ? ' face--dim' : ''}`} style={{ width: size, height: size * 0.82, ['--tone' as string]: color } as CSSProperties} />;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`row ${className}`}>{children}</div>;
}

const STATE_COLOR: Record<ToolStatus['availability'], string> = {
  active: '#57c993',
  idle: '#91aa9b',
  'not-installed': '#4a5950',
  'not-connected': '#4a5950',
  shortcut: '#91aa9b',
  error: '#f27479',
};

const STATE_WORD: Record<ToolStatus['availability'], string> = {
  active: 'Ativo agora',
  idle: 'Disponível',
  'not-installed': 'Não instalado',
  'not-connected': 'Não conectado',
  shortcut: 'Atalho',
  error: 'Erro',
};

export function StatusDot({ state, live = false }: { state: ToolStatus['availability']; live?: boolean }) {
  return <span className={`dot${live ? ' dot--live' : ''}`} style={{ background: STATE_COLOR[state], color: STATE_COLOR[state] }} />;
}

export function stateWord(s: ToolStatus['availability']) {
  return STATE_WORD[s];
}

export function SimTag() {
  return <span className="sim-tag">Simulado</span>;
}
