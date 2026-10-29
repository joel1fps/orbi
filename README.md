# Orbi Desktop

O Orbi, mascote do projeto Orbit, como bichinho virtual (Tamagotchi) e central de agentes de IA no Windows. Ele mora numa ilha flutuante no topo da tela, reage ao que o Claude Code e o Codex estão fazendo e deixa você aprovar pedidos de permissão sem trocar de janela.

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

## As três visualizações

| Visualização | Como chegar | O que mostra |
| --- | --- | --- |
| **Compacta** (ilha) | Padrão ao abrir, `Esc` para voltar | Orbi pequeno e uma linha de status: o que o agente está fazendo agora ou como o Orbi está. Cresce sozinha para avisar início, conclusão, erro e pedidos de permissão. |
| **Painel** | Clique na ilha ou `Ctrl+Alt+O` | Sessão ativa (projeto, passo atual, último passo, contador), ferramentas, uso do plano Claude/Codex e GitHub. Abas: início, Tamagotchi, ferramentas e configurações. |
| **Tamagotchi** | Ícone da patinha no painel | Orbi grande em 2D ou 3D, fome, energia e humor, e os cuidados: alimentar, brincar, descansar e carinho. |

Arraste a ilha para qualquer lugar. Solte perto do topo da tela para ela encaixar de novo. Clicar fora do painel o recolhe.

## O Orbi vivo

- Pisca, respira, balança as antenas, e o satélite orbita de verdade (passa na frente e atrás dele).
- Segue o cursor com os olhos e o corpo em qualquer lugar da tela.
- Clique: susto ou "boop". Vários cliques rápidos: cócegas. Clique e esfregue o cursor nele: carinho (corações).
- Expressões: feliz, alegria, carinho, curioso, surpreso, apreensivo, concentrado, triste, sonolento, dormindo, comendo e recusando.
- Coisas espontâneas quando está à toa: acena, olha em volta, se espreguiça, boceja quando está cansado.
- Reage aos agentes: concentrado enquanto trabalham, brilho âmbar com "!" quando pedem permissão, verde com ✓ ao terminar, vermelho ao errar.

Fome, energia e humor mudam com o tempo real, inclusive com o app fechado (com limite para não punir um fim de semana fora). O progresso fica salvo em `%APPDATA%\Orbi\orbi-state.json`.

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
- as animações contínuas rodam num relógio único com limite de quadros (nenhuma na ilha compacta, 20 fps no painel, 30 fps no Tamagotchi; ações e o olhar ficam limitados a 60, mesmo em monitores de 144 Hz);
- o 3D (three.js) só é carregado quando você escolhe o 3D, e renderiza a 30 fps em repouso;
- "Reduzir animações" desliga todo o movimento contínuo.

Medido na versão de produção nesta máquina: ilha compacta com cerca de 3 a 8% de **um** núcleo (0,2–0,3% da CPU total), painel com 12% e Tamagotchi com 12 a 28%. A RAM fica em torno de 370–440 MB, somando os processos do Electron.

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
  views/             ilha, compacta, painel, permissão, Tamagotchi, ferramentas, configurações
src/shared/          tipos e lógica do Tamagotchi (testada)
resources/           orbi-original.svg (do Orbit), ícones, scripts da ponte e installer.nsh
electron-builder.json  configuração do instalador
```

Testes: `npm test`. Tipos: `npm run typecheck`.

Modo de depuração (só para desenvolvimento): `ORBI_DEBUG=1` abre em `127.0.0.1:47899` rotas para capturar a janela em PNG e trocar a visualização.
