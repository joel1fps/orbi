# Integrações com IA: como funcionam e o que foi verificado

Revisão da lógica feita em 18/10/2026 pensando em produção: o que cada usuário precisa ter para ver seus limites e eventos, o que acontece quando algo falta, e o que foi testado de verdade.

Regra geral: o Orbi nunca inventa número. Sem fonte, a pílula mostra "—" e o cartão explica o motivo e o que fazer (campo `limitNotes` do hub). O último limite lido fica salvo e aparece ao abrir o app, com a idade ("há 2 h"); janelas cujo horário de renovação já passou aparecem como "renovado", sem porcentagem.

## Limites de plano

| Ferramenta | De onde vem | O que o usuário precisa | Windows | macOS | Linux | Testado aqui |
| --- | --- | --- | --- | --- | --- | --- |
| **Claude** | `GET api.anthropic.com/api/oauth/usage`, a mesma consulta do `/usage` do Claude Code, com o login local do Claude Code | Ter entrado no Claude Code com uma conta Pro ou Max (o app desktop também serve) | `~/.claude/.credentials.json` | Keychain, item "Claude Code-credentials" (o macOS pede permissão uma vez) | `~/.claude/.credentials.json` | Sim, Windows, conta Pro: 5 h e semana batem com a conta |
| **Codex** | `rate_limits` gravado nas sessões em `~/.codex/sessions` (ou `$CODEX_HOME`) | Ter usado o Codex (CLI, app ou extensão) ao menos uma vez | Sim | Sim | Sim | Sim, plano Plus, 5 h e semana |
| **Antigravity** | API local do language server do Antigravity (`GetUserStatus` em 127.0.0.1), a mesma que a janela dele usa. No 2.0, o endereço e o token vêm do daemon `agy --hub` (`~/.gemini/antigravity/daemon/hub_<porta>.json`) | Antigravity aberto | PowerShell + `Get-NetTCPConnection` | `ps` + `lsof` | `ps` + `lsof` ou `ss` | Sim, Windows, plano Pro, cota por modelo |
| **Gemini CLI** | Code Assist `loadCodeAssist` + `retrieveUserQuota`, com o login Google do CLI (`~/.gemini/oauth_creds.json`) | Gemini CLI com login pessoal do Google | Sim | Sim | Sim | **Não**: o Gemini CLI não está instalado nesta máquina. Implementado a partir da abordagem documentada pelo CodexBar; leitura coberta por teste unitário |

### O que acontece quando falta algo

| Situação | O que o usuário vê |
| --- | --- |
| Claude: sem login de conta (usa chave de API) | "Faça login no Claude Code com sua conta Claude (Pro ou Max). Quem usa chave de API não tem limites de plano." |
| Claude: login expirado (Claude Code fechado há horas) | Último valor salvo + "O login do Claude Code expirou. Abra o Claude Code uma vez para renová-lo." O Orbi nunca usa o refresh token da Anthropic (ele é rotativo e usá-lo poderia deslogar o Claude Code). |
| Claude: 401/403, 429, sem internet | Mensagem específica; em 429 o Orbi espera 10 minutos antes de tentar de novo. |
| Claude: usuário desligou a leitura pela conta | "Leitura pela conta desligada em Ferramentas." |
| Codex: nunca usado | "Use o Codex uma vez: os limites chegam junto com a primeira resposta." |
| Codex: registros `premium` vazios ou `plan_type: null` de versões antigas | Ignorados; o nome do plano vem do último registro que o tinha. |
| Antigravity fechado | Último valor salvo + "Abra o Antigravity…". Sem o Antigravity instalado, o Orbi nem procura o processo. |
| Antigravity com HTTPS local | O Orbi tenta HTTP e depois HTTPS (certificado local). |
| Gemini CLI com chave de API ou Vertex | "…a cota fica no console do Google." |
| Gemini CLI com token expirado | Renovado só em memória com o cliente OAuth que vem dentro do Gemini CLI instalado (o refresh token do Google não é rotativo, então o login do CLI continua valendo). Sem isso: "Abra o Gemini CLI uma vez…". |

## Eventos e permissões do Claude Code (hooks)

Antes (0.1): cada hook era `"node.exe" "orbi-hook.cjs"`. Isso quebrava para quem não tem Node.js, e no Windows sem Git Bash, onde o Claude Code roda hooks no PowerShell e uma string entre aspas não é executada.

Agora: os hooks usam a **forma sem shell** (`command` + `args`, Claude Code 2.1.139+) e executam **o próprio Orbi** em modo ponte, `Orbi --orbi-hook`, que não abre janela, encaminha o evento para o Orbi aberto e sai. Funciona igual com Git Bash, PowerShell, sh e zsh, com caminhos com espaço, e não precisa de Node.

| Ponto | Comportamento |
| --- | --- |
| Versão mínima | Ao conectar, o Orbi roda `claude --version`; abaixo de 2.1.139 ele pede `claude update` em vez de gravar hooks que falhariam. |
| Orbi fechado | O hook sai em silêncio com código 0; o Claude Code segue normal. |
| Permissão sem resposta | Volta para o terminal ao fim do tempo escolhido (30 s, 1 min ou 2 min). Nada é permitido sozinho. |
| Atualização do Orbi | Ao abrir, o Orbi reescreve só as próprias entradas se estiverem no formato antigo ou apontarem para um executável que não existe mais (com backup). A statusline antiga do Orbi é removida: o limite do Claude agora vem da conta. |
| Desinstalação | O desinstalador roda `Orbi --orbi-disconnect` antes de apagar os arquivos, removendo os hooks (com backup `settings.json.orbi-backup-uninstall`). Em atualizações, a conexão é mantida. |
| Windows: stdin | O processo principal do Electron no Windows é um app gráfico e não recebe `process.stdin`; a ponte lê o descritor 0 diretamente. |
| Ruído | O modo ponte usa uma pasta de sessão temporária, sem GPU e com log mínimo, para não disputar cache com o Orbi aberto nem escrever no stderr do Claude Code. |

### Verificado de ponta a ponta nesta máquina

- Claude Code 2.1.295 executou o hook novo (`electron.exe <app> --orbi-hook`) em todos os eventos; o Orbi recebeu SessionStart, UserPromptSubmit e Stop.
- Pedido de permissão real (`mkdir orbi-e2e-dir` no modo de permissão padrão): o cartão apareceu na ilha, "Permitir" foi respondido por lá, o Claude Code executou o comando e a pasta foi criada.
- Migração automática do formato 0.1 numa cópia do `settings.json` e depois no real: hooks reescritos, statusline do Orbi removida, demais chaves mantidas, backup criado.
- `--orbi-disconnect` numa cópia: removeu os 10 hooks e manteve o resto.
- 24 testes unitários: leitura de cada fonte de limite (formatos reais), edição do `settings.json` (adicionar, não duplicar, remover exatamente, migrar), versão mínima e o Tamagotchi.

### Ainda não verificado

- Claude no macOS (Keychain) e no Linux; Antigravity no macOS e no Linux; Gemini CLI em qualquer sistema. O código segue os formatos conhecidos, mas precisa de um teste em máquina real antes do lançamento.
- O passo do desinstalador foi compilado no instalador, mas não foi executado (exige instalar e desinstalar).
- Contas Team/Enterprise da Anthropic e planos pagos do Gemini podem trazer campos diferentes; nesses casos o Orbi mostra o aviso em vez de número.

## Privacidade

- Tokens são só lidos, nunca gravados, exibidos ou registrados em log, e vão apenas para o próprio emissor: Anthropic (Claude) e Google (Gemini). Antigravity e Codex não saem do computador.
- A leitura pela conta Claude pode ser desligada em Ferramentas.
- O servidor da ponte escuta só em 127.0.0.1 e exige um token aleatório por instalação.
