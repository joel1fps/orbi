# Orbi Desktop

O Orbi, mascote do projeto Orbit, como central de agentes de IA para desenvolvedores no Windows. Ele mora numa ilha flutuante no topo da tela, reage ao que o Claude Code e o Codex estão fazendo e deixa você aprovar pedidos de permissão sem trocar de janela.

A pesquisa (vídeo de referência e análise do Orbi original) está em [docs/PESQUISA_E_PLANO.md](docs/PESQUISA_E_PLANO.md).

## Como rodar

```bash
npm install
npm run dev        # desenvolvimento, com recarga automática
npm start          # compila e abre a versão de produção
```

Ou dê dois cliques em `Orbi.cmd` (compila na primeira vez e abre o app). O Orbi fica na bandeja do Windows; clique no ícone para mostrar ou esconder.

### Instalador

```bash
npm run dist       # gera dist/Orbi-Setup-<versão>.exe
```

O instalador (NSIS, um clique) instala só para o usuário atual em `%LOCALAPPDATA%\Programs\orbi-desktop`, sem pedir administrador, cria atalhos na área de trabalho e no menu Iniciar e abre o Orbi no fim. Desinstalar mantém o progresso em `%APPDATA%\Orbi`. Instalado, a bandeja ganha a opção **Iniciar com o Windows** (desligada por padrão; o desinstalador remove a entrada). O executável não é assinado, então o Windows SmartScreen pode avisar na primeira execução.

`npm run icons` regenera `icon.png`, os ícones da bandeja e o `icon.ico` (16 a 256 px) a partir de `resources/orbi-original.svg`.

## As visualizações

| Visualização | Como chegar | O que mostra |
| --- | --- | --- |
| **Compacta** (ilha) | Padrão ao abrir, `Esc` para voltar | Orbi pequeno e uma linha de status: o que o agente está fazendo agora ou a última atividade real de um agente. Cresce sozinha para avisar início, conclusão, erro e pedidos de permissão. |
| **Painel** | Clique na ilha ou `Ctrl+Alt+O` | Sessão ativa (projeto, passo atual, último passo, contador), ferramentas, uso do plano Claude/Codex e GitHub. Abas: início, ferramentas e configurações. |

Arraste a ilha para qualquer lugar. Solte perto do topo da tela para ela encaixar de novo. Clicar fora do painel o recolhe.

## O Orbi vivo

- Ao abrir: a ilha nasce de um ponto no topo, o Orbi cai dentro dela, acena, pisca duas vezes e olha em volta. Uma vez por execução; recarregar a interface não repete, e "Reduzir animações" pula.
- Pisca, respira, balança as antenas, e o satélite orbita de verdade (passa na frente e atrás dele). Troca de expressão sempre por trás de uma piscada, sem saltos.
- Segue o cursor com os olhos e o corpo em qualquer lugar da tela. O cursor em cima dele o deixa curioso.
- No cartão do painel: clique para um "boop", vários cliques rápidos para cócegas, clique e esfregue o cursor para carinho (corações). Abrir o painel faz ele dar um pulinho.
- Reage aos agentes: curioso enquanto pensam, concentrado enquanto executam, brilho âmbar com "!" quando pedem permissão, verde com ✓ ao terminar, vermelho ao errar, sonolento quando um limite do plano chega a 100%.
- Sem você no computador: sonolento e bocejando depois de 5 minutos, dormindo (com "zzz" e menos quadros por segundo) depois de 15. Se espreguiça quando você volta. Um agente trabalhando o mantém acordado.
- Prioridades: permissão > erro > limite > trabalho > ocioso, e uma reação decorativa (boop, carinho) nunca interrompe uma importante (concluído, erro); o "!" de uma permissão fica visível o tempo todo. As regras estão em `src/renderer/src/mascot/state.ts`, com testes.

As preferências ficam salvas em `%APPDATA%\Orbi\orbi-state.json`. A versão 0.1 tinha um Tamagotchi (fome, energia e humor); ao abrir a versão nova, esses dados são descartados e o arquivo antigo fica guardado uma vez em `orbi-state.v1-backup.json`.

## Arsenal de Skills

Aba com as espadas no painel (ou "Arsenal de Skills" na bandeja). Mostra um catálogo curado de skills no formato aberto *Agent Skills* (uma pasta com um `SKILL.md`), com busca, categorias, origem, licença e versão, e as skills já presentes nas pastas dos agentes, instaladas pelo Orbi ou não.

Instalar: escolher a skill → marcar os agentes → **Conferir** (o que será gravado, onde, e o que já existe) → **Confirmar** → resultado.

| Agente | Pasta (global) |
| --- | --- |
| Claude Code | `~/.claude/skills` |
| Codex | `~/.agents/skills` |
| Gemini CLI | `~/.gemini/skills` |
| Antigravity | `~/.gemini/config/skills` |
| Cursor | `~/.cursor/skills` (o Cursor também lê as pastas do Claude Code e do Codex; o Orbi avisa quando a skill ficaria duplicada) |

Segurança:

- O catálogo (`resources/skills-index.json`) fixa cada skill num commit e guarda o tamanho e o sha256 de cada arquivo. Um arquivo baixado que não bate não é gravado. Só entram skills Apache-2.0 ou MIT.
- Caminhos são validados (nada de `..`, caminhos absolutos, links ou nomes reservados do Windows), com limite de 200 arquivos e 5 MB.
- O Orbi nunca executa nada de uma skill. Skills com scripts exigem uma segunda confirmação explícita.
- Uma pasta que não foi o Orbi que instalou, ou que você editou depois, nunca é substituída sem você marcar "Substituir"; a versão anterior vai para `%APPDATA%\Orbi\skill-backups`.
- Cada instalação fica registrada em `%APPDATA%\Orbi\skills-ledger.json`. Remover apaga só os arquivos ainda idênticos ao que o Orbi gravou; o que você editou ou criou fica.
- Todo acesso a disco e rede acontece no processo principal; a interface só envia identificadores.

Para atualizar o catálogo (mantenedores): `node scripts/build-skills-index.mjs` fixa o commit atual de cada fonte e recalcula os hashes; revise o diff antes de publicar. Uma skill nova entra pela lista `SOURCES` do script.

## Integrações e de onde vêm os dados

Nada é estimado ou inventado. Sem fonte de dados, aparece "não instalado", "não conectado" ou nenhum número.

| Ferramenta | Status | Fonte |
| --- | --- | --- |
| **Claude Code** | Funciona sem configurar | Transcrições em `~/.claude/projects` (só leitura). |
| | Em tempo real, depois de **Conectar** (aba Ferramentas) | Hooks oficiais do Claude Code: início, cada ferramenta usada, conclusão, erros e **pedidos de permissão respondidos na ilha** (Permitir `Y`, Negar `N`, ou Decidir no terminal). |
| | Uso do plano (Pro/Max) | Campo `rate_limits` da statusline do Claude Code (5 horas e semana). |
| **Codex** | Funciona sem configurar | Sessões em `~/.codex/sessions`: tarefas, comandos com código de saída e limites de 5 horas e semana do plano. |
| **Gemini CLI** | Detecção | Comando `gemini` e `~/.gemini/tmp`. Não está instalado nesta máquina. |
| **Hermes Agent** | Detecção | Comando `hermes` e `~/.hermes`. Não está instalado nesta máquina. |
| **GitHub** | Depois de colar um token (ou com `gh auth login`) | API GraphQL oficial: seus PRs abertos com estado do CI, revisões pendentes, CI do branch padrão de um repositório escolhido e sequência de contribuições. O token fica criptografado pelo Windows (DPAPI). |
| **Seus atalhos** | Aba Ferramentas | Qualquer URL, programa ou comando, aberto pela ilha. Sem métricas. |

### Conectar o Claude Code

Aba Ferramentas → Claude Code → **Conectar**. O Orbi:

1. faz backup do `~/.claude/settings.json` (`settings.json.orbi-backup-<data>`);
2. adiciona hooks que chamam `%APPDATA%\Orbi\bridge\orbi-hook.cjs` (assíncronos, sem atrasar o Claude, exceto o de permissão) e uma statusline;
3. mantém todas as suas outras configurações.

**Desconectar** remove só o que o Orbi adicionou. Se o Orbi estiver fechado, os hooks saem em silêncio e o Claude Code funciona como sempre. Sem resposta na ilha dentro do tempo escolhido (padrão de 1 minuto), a decisão volta para o terminal: o Orbi nunca permite nada sozinho.

O servidor local escuta só em `127.0.0.1` e exige um token aleatório, então páginas da web e outros processos não conseguem forjar eventos nem responder permissões.

### Eventos simulados

Configurações → Simulador de eventos (ou o menu da bandeja). Servem para ver as reações. Tudo que vem dali aparece com a etiqueta **Simulado**, e o simulador nunca inventa números de uso.

## Atalhos

| Tecla | Ação |
| --- | --- |
| `Ctrl+Alt+O` | Abrir ou recolher o painel |
| `Y` / `N` | Permitir ou negar, com a ilha em foco |
| `Ctrl+Alt+Y` / `Ctrl+Alt+N` | Permitir ou negar de qualquer lugar, enquanto houver um pedido |
| `Esc` | Recolher |

## Desempenho

No Windows, cada quadro de uma janela transparente é copiado inteiro, por isso:

- a janela tem sempre o tamanho exato da ilha: cresce antes da transição e encolhe depois;
- as animações contínuas rodam num relógio único com limite de quadros (nenhuma na ilha compacta, 20 fps no painel; ações e o olhar ficam limitados a 60, mesmo em monitores de 144 Hz);
- o 3D (three.js) só é carregado quando você escolhe o 3D, e renderiza a 30 fps em repouso;
- "Reduzir animações" desliga todo o movimento contínuo.

Medido na versão de produção nesta máquina: ilha compacta com cerca de 3 a 8% de **um** núcleo (0,2–0,3% da CPU total), painel com 12% (medido antes da remoção do Tamagotchi). A RAM fica em torno de 370–440 MB, somando os processos do Electron.

## Estrutura

```
src/main/            processo principal (janela, bandeja, atalhos)
  hub.ts             estado central: sessões, uso, permissões, ferramentas
  integrations/      Claude (hooks + transcrições + statusline), Codex, GitHub, detecção
  bridge/            servidor local e instalador dos hooks do Claude Code
  simulator.ts       eventos simulados
src/preload/         API segura exposta ao renderer
src/renderer/src/
  mascot/            Orbi 2D (SVG animado), Orbi 3D (React Three Fiber), cérebro das expressões
  views/             ilha, compacta, painel, permissão, ferramentas, configurações
src/shared/          tipos e utilitários
resources/           orbi-original.svg (do Orbit), ícones, scripts da ponte e installer.nsh
electron-builder.json  configuração do instalador
```

Testes: `npm test`. Tipos: `npm run typecheck`.

Modo de depuração (só para desenvolvimento): `ORBI_DEBUG=1` abre em `127.0.0.1:47899` rotas para capturar a janela em PNG e trocar a visualização.
