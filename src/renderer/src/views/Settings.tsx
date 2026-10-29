import type { SimulationKind } from '@shared/types';
import { Segmented, Switch } from '../components/ui';
import { useApp } from '../store';

const SIMS: { kind: SimulationKind; label: string }[] = [
  { kind: 'start', label: 'Início' },
  { kind: 'progress', label: 'Progresso' },
  { kind: 'done', label: 'Conclusão' },
  { kind: 'error', label: 'Erro' },
  { kind: 'permission', label: 'Permissão' },
];

export function SettingsSheet() {
  const s = useApp((x) => x.settings);
  const update = useApp((x) => x.updateSettings);
  const docked = useApp((x) => x.docked);

  return (
    <div className="sheet__body">
      <div className="group-title">Janela</div>
      <div className="rows">
        <div className="row">
          <div className="row__main">
            <div className="row__title">Sempre visível</div>
            <div className="row__sub">O Orbi fica acima das outras janelas</div>
          </div>
          <Switch label="Sempre visível" checked={s.alwaysOnTop} onChange={(v) => void update({ alwaysOnTop: v })} />
        </div>
        <div className="row">
          <div className="row__main">
            <div className="row__title">Posição</div>
            <div className="row__sub">{docked ? 'Encaixado no topo da tela' : 'Solto. Arraste até o topo para encaixar'}</div>
          </div>
          <button className="btn" disabled={docked} onClick={() => (window.orbi.dock(), useApp.setState({ docked: true }))}>
            Voltar ao topo
          </button>
          <button className="btn btn--ghost" onClick={() => window.orbi.hide()}>
            Esconder na bandeja
          </button>
        </div>
      </div>

      <div className="group-title">Orbi</div>
      <div className="rows">
        <div className="row">
          <div className="row__main">
            <div className="row__title">Estilo no Tamagotchi</div>
            <div className="row__sub">O 3D é carregado só quando escolhido</div>
          </div>
          <Segmented
            label="Estilo"
            value={s.mascotStyle}
            options={[
              { value: '2d', label: '2D' },
              { value: '3d', label: '3D' },
            ]}
            onChange={(v) => void update({ mascotStyle: v })}
          />
        </div>
        <div className="row">
          <div className="row__main">
            <div className="row__title">Seguir o cursor</div>
            <div className="row__sub">O Orbi olha para onde o mouse está</div>
          </div>
          <Switch label="Seguir o cursor" checked={s.followCursor} onChange={(v) => void update({ followCursor: v })} />
        </div>
        <div className="row">
          <div className="row__main">
            <div className="row__title">Reduzir animações</div>
            <div className="row__sub">Desliga movimentos contínuos e economiza energia</div>
          </div>
          <Switch label="Reduzir animações" checked={s.reduceMotion} onChange={(v) => void update({ reduceMotion: v })} />
        </div>
      </div>

      <div className="group-title">Pedidos de permissão</div>
      <div className="rows">
        <div className="row">
          <div className="row__main">
            <div className="row__title">Tempo para responder</div>
            <div className="row__sub row__sub--wrap">Sem resposta, a decisão volta para o terminal. Nada é permitido sozinho.</div>
          </div>
          <Segmented
            label="Tempo para responder"
            value={s.permissionTimeoutSec}
            options={[
              { value: 30, label: '30 s' },
              { value: 60, label: '1 min' },
              { value: 120, label: '2 min' },
            ]}
            onChange={(v) => void update({ permissionTimeoutSec: v })}
          />
        </div>
        <div className="row">
          <div className="row__main">
            <div className="row__note">
              Com a ilha em foco: <span className="kbd">Y</span> permite e <span className="kbd">N</span> nega. De qualquer lugar:{' '}
              <span className="kbd">Ctrl</span> <span className="kbd">Alt</span> <span className="kbd">Y</span> ou <span className="kbd">N</span>. Abrir o
              painel: <span className="kbd">Ctrl</span> <span className="kbd">Alt</span> <span className="kbd">O</span>.
            </div>
          </div>
        </div>
      </div>

      <div className="group-title">Simulador de eventos</div>
      <div className="rows">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="row__main" style={{ flexBasis: '100%' }}>
            <div className="row__sub">Para ver as reações do Orbi. Tudo que vem daqui aparece com a etiqueta Simulado e não afeta sessões reais.</div>
          </div>
          {SIMS.map((x) => (
            <button key={x.kind} className="btn" onClick={() => window.orbi.simulate(x.kind)}>
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="group-title">Aplicativo</div>
      <div className="rows">
        <div className="row">
          <div className="row__main">
            <div className="row__title">Orbi Desktop 0.1</div>
            <div className="row__sub">Os dados ficam neste computador. O Orbi só fala com o GitHub quando você conecta um token.</div>
          </div>
          <button className="btn btn--ghost" onClick={() => window.orbi.quit()}>
            Sair do Orbi
          </button>
        </div>
      </div>
    </div>
  );
}
