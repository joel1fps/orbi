import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ago, CUSTOM_COLORS } from '@shared/tools';
import type { ToolStatus } from '@shared/types';
import { StatusDot, stateWord, Switch, ToolFace } from '../components/ui';
import { useApp } from '../store';

export function ToolsSheet() {
  const tools = useApp((s) => s.hub.tools);
  const agents = tools.filter((t) => ['claude', 'codex', 'antigravity', 'gemini'].includes(t.id));
  const custom = tools.filter((t) => t.id.startsWith('custom:'));

  return (
    <div className="sheet__body">
      <div className="group-title">Agentes de IA</div>
      <div className="rows">
        {agents.map((t) =>
          t.id === 'claude' ? (
            <ClaudeRow key={t.id} t={t} />
          ) : t.id === 'codex' ? (
            <CodexRow key={t.id} t={t} />
          ) : t.id === 'antigravity' ? (
            <AntigravityRow key={t.id} t={t} />
          ) : (
            <AgentRow key={t.id} t={t} />
          ),
        )}
      </div>

      <div className="group-title">GitHub</div>
      <GithubRows />

      <div className="group-title">Seus atalhos</div>
      <div className="rows">
        {custom.map((t) => (
          <CustomRow key={t.id} t={t} />
        ))}
        <AddCustom />
      </div>
    </div>
  );
}

function ToolTitle({ t }: { t: ToolStatus }) {
  return (
    <div className="row__title">
      {t.name}
      <span className="status">
        <StatusDot state={t.availability} live={t.availability === 'active'} />
        {stateWord(t.availability)}
      </span>
    </div>
  );
}

function AgentRow({ t }: { t: ToolStatus }) {
  return (
    <div className="row">
      <ToolFace color={t.color} size={26} dim={t.availability === 'not-installed'} />
      <div className="row__main">
        <ToolTitle t={t} />
        <div className="row__sub" title={t.source}>
          {t.detail}. Fonte: {t.source}
        </div>
      </div>
      {t.installHint ? (
        <button className="btn btn--ghost" onClick={() => window.orbi.openExternal(t.installHint!.url)}>
          {t.installHint.label} <ExternalLink size={12} />
        </button>
      ) : null}
    </div>
  );
}

function ClaudeRow({ t }: { t: ToolStatus }) {
  const claude = useApp((s) => s.hub.claude);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const connected = claude.hooksInstalled;

  const toggle = async () => {
    setBusy(true);
    const r = connected ? await window.orbi.claudeDisconnect() : await window.orbi.claudeConnect();
    setMsg(r.message);
    setBusy(false);
  };

  return (
    <>
      <div className="row">
        <ToolFace color={t.color} size={26} dim={t.availability === 'not-installed'} />
        <div className="row__main">
          <ToolTitle t={t} />
          <div className="row__sub" title={t.source}>
            {t.detail}
            {claude.lastHookAt ? `. Último evento ${ago(claude.lastHookAt)}` : ''}
          </div>
        </div>
        {t.availability !== 'not-installed' ? (
          <button className={`btn${connected ? ' btn--ghost' : ' btn--light'}`} disabled={busy || !claude.serverOk} onClick={() => void toggle()}>
            {connected ? 'Desconectar' : 'Conectar'}
          </button>
        ) : null}
      </div>
      <div className="row">
        <div className="row__main">
          <div className="row__note">
            {connected
              ? 'Conectado: o Orbi recebe os eventos do Claude Code em tempo real e responde pedidos de permissão na ilha. Funciona com Git Bash ou PowerShell e não precisa de Node.js.'
              : 'Sem conexão, o Orbi lê as transcrições locais do Claude Code (sem alterar nada). Conectar adiciona hooks ao ~/.claude/settings.json, com backup, para eventos em tempo real e pedidos de permissão na ilha. Requer Claude Code 2.1.139 ou mais novo. Desconectar remove só o que o Orbi adicionou.'}
          </div>
          {msg ? <div className="row__note" style={{ color: '#7ed5c3', marginTop: 4 }}>{msg}</div> : null}
        </div>
      </div>
      <AccountUsageRow />
    </>
  );
}

function CodexRow({ t }: { t: ToolStatus }) {
  const codex = useApp((s) => s.hub.codex);
  const serverOk = useApp((s) => s.hub.claude.serverOk);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const connected = codex.hooksInstalled;

  const toggle = async () => {
    setBusy(true);
    const r = await window.orbi.codexHooks(!connected);
    setMsg(r.message);
    setBusy(false);
  };

  return (
    <>
      <div className="row">
        <ToolFace color={t.color} size={26} dim={t.availability === 'not-installed'} />
        <div className="row__main">
          <ToolTitle t={t} />
          <div className="row__sub" title={t.source}>
            {t.detail}
            {codex.lastHookAt ? `. Último pedido ${ago(codex.lastHookAt)}` : ''}
          </div>
        </div>
        {t.availability !== 'not-installed' ? (
          <button className={`btn${connected ? ' btn--ghost' : ' btn--light'}`} disabled={busy || !serverOk} onClick={() => void toggle()}>
            {connected ? 'Desconectar' : 'Conectar permissões'}
          </button>
        ) : null}
      </div>
      <div className="row">
        <div className="row__main">
          <div className="row__note">
            {connected
              ? 'Conectado: pedidos de permissão do Codex aparecem na ilha (Permitir Y, Negar N). Sem resposta no tempo escolhido, o Codex pergunta no terminal. O Codex só usa o hook depois que você o aprova uma vez com /hooks.'
              : 'As tarefas do Codex já aparecem lendo ~/.codex/sessions. Conectar adiciona um hook de permissão ao ~/.codex/hooks.json, com backup, para responder pela ilha. Desconectar remove só o que o Orbi adicionou.'}
          </div>
          {msg ? <div className="row__note" style={{ color: '#7ed5c3', marginTop: 4 }}>{msg}</div> : null}
        </div>
      </div>
    </>
  );
}

function AntigravityRow({ t }: { t: ToolStatus }) {
  const agy = useApp((s) => s.hub.antigravity);
  const serverOk = useApp((s) => s.hub.claude.serverOk);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const connected = agy.hooksInstalled;

  const toggle = async () => {
    setBusy(true);
    const r = connected ? await window.orbi.antigravityDisconnect() : await window.orbi.antigravityConnect();
    setMsg(r.message);
    setBusy(false);
  };

  return (
    <>
      <div className="row">
        <ToolFace color={t.color} size={26} dim={t.availability === 'not-installed'} />
        <div className="row__main">
          <ToolTitle t={t} />
          <div className="row__sub" title={t.source}>
            {t.detail}
            {agy.lastHookAt ? `. Último evento ${ago(agy.lastHookAt)}` : ''}
          </div>
        </div>
        {t.availability !== 'not-installed' ? (
          <button className={`btn${connected ? ' btn--ghost' : ' btn--light'}`} disabled={busy || !serverOk} onClick={() => void toggle()}>
            {connected ? 'Desconectar' : 'Conectar'}
          </button>
        ) : t.installHint ? (
          <button className="btn btn--ghost" onClick={() => window.orbi.openExternal(t.installHint!.url)}>
            {t.installHint.label} <ExternalLink size={12} />
          </button>
        ) : null}
      </div>
      {t.availability !== 'not-installed' ? (
        <div className="row">
          <div className="row__main">
            <div className="row__note">
              {connected
                ? 'Conectado globalmente: o Orbi recebe início, pasta do projeto e conclusão de todos os workspaces do Antigravity (IDE, App 2.0 e CLI agy) e atualiza cada passo pelas transcrições locais.'
                : 'Sem conexão, o Orbi já acompanha e atualiza os passos pelas transcrições em ~/.gemini/antigravity. Conectar adiciona hooks globais em ~/.gemini/config/hooks.json (com backup) para início, projeto e conclusão instantâneos em qualquer pasta.'}
            </div>
            {msg ? <div className="row__note" style={{ color: '#7ed5c3', marginTop: 4 }}>{msg}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function AccountUsageRow() {
  const on = useApp((s) => s.settings.claudeAccountUsage);
  const updateSettings = useApp((s) => s.updateSettings);
  return (
    <div className="row">
      <div className="row__main">
        <div className="row__title" style={{ fontWeight: 500, fontSize: 12.5 }}>
          Limite do plano pela sua conta
        </div>
        <div className="row__sub row__sub--wrap">
          Usa o login do Claude Code deste computador para perguntar à Anthropic o uso de 5 horas e da semana, como o /usage. O token só é lido e só vai para api.anthropic.com.
        </div>
      </div>
      <Switch label="Limite do plano pela sua conta" checked={on} onChange={(v) => void updateSettings({ claudeAccountUsage: v })} />
    </div>
  );
}

function GithubRows() {
  const gh = useApp((s) => s.hub.github);
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState(settings.githubRepo);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    if (!token.trim()) return;
    const ok = await window.orbi.setGithubToken(token.trim());
    setToken('');
    setMsg(ok ? 'Token salvo com a criptografia do sistema.' : 'Não foi possível guardar o token com segurança neste computador.');
  };

  return (
    <div className="rows">
      <div className="row">
        <ToolFace color="#f27479" size={26} dim={!gh?.ok} />
        <div className="row__main">
          <div className="row__title">
            {gh?.ok ? gh.login : 'GitHub'}
            <span className="status">
              <StatusDot state={gh?.ok ? 'idle' : gh ? 'error' : 'not-connected'} />
              {gh?.ok ? `Atualizado ${ago(gh.fetchedAt)}` : gh ? gh.error : 'Não conectado'}
            </span>
          </div>
          <div className="row__sub row__sub--wrap">
            {gh?.ok
              ? `${gh.myOpenPRs.length} PRs abertos, ${gh.reviewRequests} revisões pendentes, sequência de ${gh.contributions?.streak ?? 0} dias`
              : 'Use um token pessoal (escopos: repo e read:user) ou faça login no GitHub CLI com gh auth login.'}
          </div>
        </div>
        {gh?.ok ? (
          <button className="btn btn--ghost" onClick={() => void window.orbi.refreshGithub()}>
            Atualizar
          </button>
        ) : null}
      </div>
      <div className="row">
        <input
          className="field"
          style={{ flex: 1 }}
          type="password"
          placeholder={settings.githubTokenSet ? 'Token salvo. Cole outro para trocar' : 'Cole aqui o token pessoal do GitHub'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn" disabled={!token.trim()} onClick={() => void save()}>
          Salvar
        </button>
        {settings.githubTokenSet ? (
          <button className="btn btn--ghost" onClick={() => void window.orbi.setGithubToken(null).then(() => setMsg('Token removido.'))}>
            Remover
          </button>
        ) : null}
        <button className="btn btn--ghost" onClick={() => window.orbi.openExternal('https://github.com/settings/tokens/new?scopes=repo,read:user&description=Orbi')}>
          Criar token <ExternalLink size={12} />
        </button>
      </div>
      {!settings.githubTokenSet ? (
        <div className="row">
          <div className="row__main">
            <div className="row__sub row__sub--wrap">Ou use o login do GitHub que o Git deste PC já guarda (o mesmo do git push). Ele fica salvo com a criptografia do sistema.</div>
          </div>
          <button className="btn" onClick={() => void window.orbi.githubFromGit().then((r) => setMsg(r.message))}>
            Usar o login do Git
          </button>
        </div>
      ) : null}
      <div className="row">
        <div className="row__main">
          <div className="row__title" style={{ fontWeight: 500, fontSize: 12.5 }}>
            Repositório para o CI do branch padrão
          </div>
          <div className="row__sub">Opcional, no formato dono/repositório</div>
        </div>
        <input
          className="field"
          style={{ width: 200 }}
          placeholder="dono/repositório"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          onBlur={() => repo !== settings.githubRepo && void updateSettings({ githubRepo: repo.trim() })}
          spellCheck={false}
        />
      </div>
      {msg ? (
        <div className="row">
          <div className="row__note">{msg}</div>
        </div>
      ) : null}
    </div>
  );
}

function CustomRow({ t }: { t: ToolStatus }) {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const remove = () => void updateSettings({ customTools: settings.customTools.filter((c) => `custom:${c.id}` !== t.id) });
  return (
    <div className="row">
      <ToolFace color={t.color} size={26} />
      <div className="row__main">
        <div className="row__title">{t.name}</div>
        <div className="row__sub" title={t.detail}>
          {t.detail}
        </div>
      </div>
      <button className="btn" onClick={() => window.orbi.launchTool(t.id)}>
        Abrir
      </button>
      <button className="icon-btn" aria-label={`Remover ${t.name}`} onClick={remove}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function AddCustom() {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const add = () => {
    if (!name.trim() || !target.trim()) return;
    const color = CUSTOM_COLORS[settings.customTools.length % CUSTOM_COLORS.length];
    void updateSettings({
      customTools: [...settings.customTools, { id: Math.random().toString(36).slice(2, 9), name: name.trim(), target: target.trim(), color }],
    });
    setName('');
    setTarget('');
  };
  return (
    <div className="row">
      <input className="field" style={{ width: 140 }} placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        className="field"
        style={{ flex: 1 }}
        placeholder="URL, programa ou comando (ex.: https://chatgpt.com ou code .)"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        spellCheck={false}
      />
      <button className="btn" disabled={!name.trim() || !target.trim()} onClick={add}>
        <Plus size={13} /> Adicionar
      </button>
    </div>
  );
}
