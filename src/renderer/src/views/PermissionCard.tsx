import { animate, motion, useMotionValue } from 'motion/react';
import { useEffect } from 'react';
import { BUILTIN_TOOLS, isBuiltin } from '@shared/tools';
import type { PermissionRequest } from '@shared/types';
import { SimTag } from '../components/ui';
import { Mascot } from '../mascot/Mascot';

/** Allow / deny an agent's request right from the island (Y / N). */
export function PermissionCard({ request, compact = false }: { request: PermissionRequest; compact?: boolean }) {
  const tool = isBuiltin(request.tool) ? BUILTIN_TOOLS[request.tool] : { name: 'Ferramenta', color: '#91aa9b' };
  const left = useMotionValue(1);

  useEffect(() => {
    const total = request.expiresAt - request.createdAt;
    const remaining = Math.max(0, request.expiresAt - Date.now());
    left.set(remaining / total);
    const ctl = animate(left, 0, { duration: remaining / 1000, ease: 'linear' });
    return () => ctl.stop();
  }, [request, left]);

  const respond = (d: 'allow' | 'deny' | 'pass') => window.orbi.respondPermission(request.id, d);

  return (
    <div className="hero" style={{ minHeight: compact ? 0 : 132, background: compact ? 'transparent' : undefined, padding: compact ? '4px 4px 4px 0' : undefined }}>
      <div className="hero__glow" style={{ ['--glow' as string]: 'rgba(242, 184, 75, 0.30)' }} />
      <Mascot size={compact ? 78 : 92} flat />
      <div className="perm">
        <div className="hero__top">
          <span className="dot" style={{ background: tool.color }} />
          <span className="hero__project">{tool.name}</span>
          <span>precisa de permissão</span>
          {request.simulated ? <SimTag /> : null}
        </div>
        <div className="perm__code" title={request.summary}>
          {request.summary}
        </div>
        <div className="hero__step" style={{ marginTop: -2 }}>
          <span>
            {request.description ? `${request.description} (${request.toolName})` : request.toolName}
            {request.project ? `, em ${request.project}` : ''}
          </span>
        </div>
        <div className="hero__actions">
          <button className="btn" onClick={() => respond('deny')}>
            Negar <span className="kbd">N</span>
          </button>
          <button className="btn btn--light" onClick={() => respond('allow')} autoFocus>
            Permitir <span className="kbd">Y</span>
          </button>
          <button className="btn btn--ghost" onClick={() => respond('pass')} title="Fecha o cartão e deixa a decisão no terminal">
            Decidir no terminal
          </button>
        </div>
        <div className="perm__timer" title="Sem resposta, a decisão volta para o terminal">
          <motion.div style={{ scaleX: left }} />
        </div>
      </div>
    </div>
  );
}
