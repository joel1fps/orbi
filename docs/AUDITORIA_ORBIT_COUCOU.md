# Orbit × Coucou: auditoria e plano

Data: 02/11/2026. Só leitura: nenhum arquivo de código foi alterado.

Legenda de evidência, usada em todo o documento:

- **[código]**: verificado lendo o código-fonte (Orbit em `src/`, Coucou em `windows/` do repositório clonado, commit atual da `main`).
- **[doc]**: documentado (README, docs oficiais), não verificado no código.
- **[máquina]**: observado nesta máquina (pastas e arquivos reais).
- **[proposta]**: ideia nova, não existe em nenhum dos dois projetos.

---

## 1. Diagnóstico do Orbit hoje

### 1.1 Arquitetura [código]

| Camada | O que existe |
| --- | --- |
| Stack | Electron 44, React 19, TypeScript 6, electron-vite, `motion` 14 (2D), three + R3F (3D, carregado sob demanda), Zustand 5. Testes com `node --test`. |
| Janela | Uma `BrowserWindow` transparente, sem borda, `sandbox: true`, `contextIsolation: true`, sem `nodeIntegration` (`src/main/widget.ts`). O tamanho da janela acompanha a ilha (`fitTo`: cresce na hora, encolhe 520 ms depois). Áreas vazias deixam o clique passar (`setIgnoreMouseEvents` + `[data-hit]`). |
| Processo principal | `index.ts` (bandeja, IPC, atalhos), `hub.ts` (estado central: sessões, uso, permissões, ferramentas; emite `hub:state` com debounce de 80 ms), `store.ts` (JSON único `%APPDATA%\Orbi\orbi-state.json`, escrita atômica com `.tmp` + `rename`, token do GitHub via `safeStorage`/DPAPI). |
| Ponte | Servidor HTTP em `127.0.0.1` com token aleatório (`bridge/server.ts`). Hooks do Claude Code executam o próprio Orbi em modo `--orbi-hook` (`bridge/cli.ts`). |
| Preload | `contextBridge` expõe uma API pequena e tipada (`src/preload/index.ts`). |
| Renderer | `App.tsx` → `Island.tsx`, que troca entre `Compact`, `Panel` (abas início, ferramentas, configurações), `PermissionCard` e `Pet` (Tamagotchi). |

### 1.2 O mascote e as animações [código]

- **Desenho**: `Orbi2D.tsx` reconstrói o SVG original peça por peça (corpo, olhos, pálpebras, boca, antenas, braços, anel e satélite que passa na frente e atrás). `Orbi3D.tsx` é a versão R3F.
- **Motor**: `motion` values escrevendo `transform` direto no DOM (`useTransformAttr`), sem re-render do React. Um relógio único de `requestAnimationFrame` com limite de quadros cuida da respiração, antenas, braço, brilho das pontas e satélite: nenhum loop na pílula, 20 fps no painel, 30 fps no Tamagotchi; ações e olhar limitados a 60 escritas/s. `document.hidden` pausa tudo.
- **Expressões** (13): neutral, happy, joy, love, curious, surprised, worried, focused, sad, sleepy, asleep, eating, refuse. Cada uma é uma tabela de olhos, pálpebra, inclinação, boca e rubor (`FACES`).
- **Ações únicas** (11): wave, hop, bounce, chomp, shake, yawn, wiggle, squash, stretch, look-around, celebrate.
- **Piscar**: intervalo aleatório de 2,2 a 6,4 s, 22% de chance de piscar duas vezes. Desligado com olhos fechados ou felizes.
- **Olhar**: o processo principal lê o cursor a cerca de 30 Hz e só envia quando ele se move (`startCursor`); o renderer converte em duas molas (`useLook.ts`). Depois de 6 s parado, o olhar volta ao centro.
- **Brilho, selo e partículas**: brilho âmbar/verde/vermelho/teal/violeta, selos `!` e `✓`, corações, brilhos, `zzz`, migalhas e `?` (`Mascot.tsx`).
- **"Cérebro"** (`brain.ts`): uma cadeia de `if/else` decide a expressão a cada render (reação ativa > permissão > dormindo > erro > trabalhando > energia baixa > fome/humor > hover > humor alto > neutro). Ações espontâneas a cada 7 a 16 s, sorteadas de um conjunto que depende de humor e energia.
- **Reações** (`store.ts`): um único slot `reaction` com prazo de validade (`REACTION_MS`).

### 1.3 Interações [código]

| Gesto | Onde funciona | Resultado |
| --- | --- | --- |
| Clique na pílula | Compacta | Abre o painel |
| Arrastar a ilha | Todas | Move; perto do topo, encaixa de novo |
| Clique no Orbi | **Só no Tamagotchi** | "boop" (squash); 5 cliques rápidos: cócegas; dormindo: susto |
| Esfregar o cursor | **Só no Tamagotchi** | Carinho (`petAct('pet')`, corações) |
| Hover | **Só no Tamagotchi** | Expressão curiosa |
| `Ctrl+Alt+O`, `Y`/`N`, `Ctrl+Alt+Y`/`N`, `Esc` | Global ou com foco | Painel, permissões, recolher |
| Perder o foco | Painel | Recolhe para a pílula (se não houver permissão) |

### 1.4 Sistema de fome e necessidades: onde está [código]

| Arquivo | Dependência |
| --- | --- |
| `src/shared/pet.ts` | Toda a lógica: `RATES`, `tick`, `act` (feed, play, rest, pet), `headline`, `needWord`, `ageLabel`. |
| `src/shared/types.ts` | `PetState`; `ViewMode` inclui `'pet'`; `InitialState.pet`. |
| `src/main/store.ts` | `pet` persistido, `tick` ao carregar, `createPet`, `setPet`. |
| `src/main/index.ts` | Item "Tamagotchi" na bandeja; `pet` no `orbi:initial`; IPC `pet:save`. |
| `src/preload/index.ts` | `savePet`. |
| `src/renderer/src/store.ts` | `pet`, `petAct`, `refreshPet` (intervalo de 30 s), `petNote`, reações `feed`, `play`, `refuse`, `tired`, `sleep`, `wake`, `pet`. |
| `src/renderer/src/mascot/brain.ts` | Expressões e ações espontâneas dependem de `pet.mood`, `pet.energy`, `pet.satiety`, `pet.sleeping`. **O sono do Orbi hoje só existe por causa do Tamagotchi.** |
| `src/renderer/src/mascot/Mascot.tsx` | `usePetting` chama `petAct('pet')`; susto quando `pet.sleeping`. |
| `src/renderer/src/views/Pet.tsx` | Tela inteira: barras Fome, Energia e Humor; botões Alimentar, Brincar, Descansar e Carinho. |
| `src/renderer/src/views/Compact.tsx` | Sem agente ativo, o título da pílula é `headline(pet)` e um ponto âmbar avisa necessidades baixas. |
| `src/renderer/src/views/Panel.tsx` | Aba da patinha (`PawPrint`) e o aviso "O Orbi também precisa de cuidados". |
| `src/renderer/src/views/Settings.tsx` | Rótulo "Estilo no Tamagotchi". |
| `src/renderer/src/styles/global.css` | Bloco `/* Tamagotchi */` (`.pet*`, `.need*`, `.care*`, aprox. linhas 760–890). |
| `test/pet.test.ts` | 8 testes da lógica de necessidades. |
| `README.md`, `docs/PESQUISA_E_PLANO.md`, `package.json` (descrição) | Textos que vendem o Tamagotchi. |

O que **não** pertence à fome e deve ficar: o desenho 2D/3D, as expressões, as ações, o brilho, as partículas, o "boop", o carinho como gesto (sem números) e a escolha 2D/3D.

### 1.5 Integrações com agentes [código]

| Agente | O que o Orbit faz |
| --- | --- |
| Claude Code | Hooks oficiais (forma sem shell, 2.1.139+) com **permissões respondidas na ilha**, transcrições em `~/.claude/projects`, uso do plano pela API de uso da conta. Backup e remoção exata das próprias entradas. |
| Codex | Só leitura de `~/.codex/sessions` (tarefas, comandos, limites). **Sem permissões.** |
| Antigravity | Detecção, cota pela API local do language server. **Hooks em `~/.gemini/config/hooks.json` em desenvolvimento agora** (ver 1.7). |
| Gemini CLI | Detecção e cota. Sem eventos. |
| Hermes | Só detecção. |
| GitHub | GraphQL com token (DPAPI) ou `gh`. |

### 1.6 Problemas e limitações encontrados

| # | Problema | Evidência | Impacto |
| --- | --- | --- | --- |
| P1 | **Reação de baixa prioridade apaga uma importante.** `react()` substitui o slot único sem comparar prioridade: um "boop" ou uma ação espontânea durante o "concluído" corta a comemoração e o brilho verde. | `store.ts` `react`, `brain.ts` | Contraria a regra "eventos importantes acima dos decorativos". |
| P2 | **Não há animação de entrada.** A janela aparece com `showInactive()` e o renderer dispara `react('hello')` em todo `boot()`, inclusive em recarga do renderer (HMR, crash/reload). | `widget.ts` `ready-to-show`, `store.ts` `boot` | Sem "chegada"; aceno repetido a cada recarga. |
| P3 | Hover, clique e carinho só funcionam no Tamagotchi. Ao remover essa tela, o Orbi perde toda a interatividade direta. | `Mascot.tsx` (`stage`) | Precisa ser redistribuído. |
| P4 | O sono e o cansaço dependem do Tamagotchi. Sem ele, não existe comportamento de inatividade longa. | `brain.ts` | Precisa de outra fonte: inatividade real do usuário. |
| P5 | "Pensando" e "trabalhando" são o mesmo estado; não há estado de limite de uso atingido. | `brain.ts`, `types.ts` `SessionState` | Menos expressividade que o pedido. |
| P6 | O cursor é lido a 30 Hz sempre que a janela está visível, mesmo com "Seguir o cursor" desligado ou o Orbi dormindo. | `widget.ts` `startCursor` | CPU desnecessária (pequena). |
| P7 | O relógio ambiente roda a 20 ou 30 fps continuamente no painel, mesmo dormindo. | `Orbi2D.tsx` | CPU/GPU; no Windows cada quadro transparente é copiado inteiro. |
| P8 | IPC `open:path` abre **qualquer** caminho enviado pelo renderer com `shell.openPath` (que executa `.exe`/`.bat`). Hoje o renderer é confiável, mas é a única porta sem validação. | `index.ts` | Segurança: restringir a caminhos conhecidos antes de o Arsenal abrir pastas. |
| P9 | `typecheck` falha hoje com 5 erros (`hub.antigravity`, `setAntigravity`). Os testes passam (25/25). | `npm run typecheck` | Efeito do trabalho em andamento de 1.7, não de um bug antigo. |
| P10 | `store.ts` grava `version: 1` sem migrações. Remover `pet` e acrescentar o registro de skills exige uma migração explícita. | `store.ts` | Risco baixo, mas precisa ser feito. |

### 1.7 Trabalho em andamento detectado [máquina]

Durante a auditoria, a árvore de trabalho mudou: `hub.ts`, `cli.ts` e `server.ts` passaram a constar como modificados, além de `antigravity.ts`, `describe.ts`, `detect.ts`, `types.ts` e dos novos `bridge/antigravitySetup.ts` e `bridge/antigravityHookSettings.ts`. Há uma integração de hooks do Antigravity sendo escrita agora, possivelmente em outra sessão. **Nada disso foi tocado.** As fases que mexem em `types.ts`, `hub.ts`, `store.ts` e `index.ts` devem começar depois que esse trabalho for commitado.

---

## 2. O que o Coucou faz de verdade

Repositório: `Louis-CFM/coucou`. O app de Mac é Swift (`NotchBuddy/`). **O de Windows é Tauri 2 (Rust + TypeScript + Canvas 2D)** em `windows/`, que é a referência direta para nós.

**Licença:** o código é MIT, mas `LICENSE-ASSETS.md` reserva os nomes "Coucou" e "Mochi", o **personagem Mochi (design, aparência, expressões e animações como personagem)**, os ícones e os 28 sons. Podemos estudar e adaptar técnicas (máquina de estados, curvas, temporização, padrões de instalação), mas não copiar o desenho, os sons nem as sequências de animação do Mochi.

### 2.1 Animações e comportamento [código]

| Arquivo do Coucou | O que faz | Leitura técnica |
| --- | --- | --- |
| `src/mochi/engine.ts` (1376 linhas) | `BotEngine`: um motor de tweens próprio (`anim(prop, [[alvo, ms, easing]…])`), "locks" por propriedade para um tween não brigar com o movimento contínuo, suavização exponencial (`k = 1 - pow(c, dt)`) para olhar, inclinação e escala. | Mesma ideia das molas do `motion` que o Orbit já usa. |
| `BOT_STATES` | **Tabela declarativa de estados**: idle, working, thinking, searching, approval, question, error, finished, ratelimit, sleeping, dizzy. Cada estado tem cor, tingimento, olho, selo, `bounces`, `scans`, `breathes`, `zz`, `sweat`, `look` fixo e inclinação. | É o principal ponto a adotar: estados como dados, não como `if/else`. |
| `setState` | Na transição, roda um gesto de entrada do estado: finished = giro + faíscas; error = tremida horizontal; approval = pulinho; question = piscada. | "Entrada de estado" separada do "estado em si". |
| Piscar | A cada 2,2 a 5,4 s, 22% de piscada dupla; não pisca dormindo nem tonto. | Equivalente ao do Orbit. |
| Cliques | `slap()`: 1 a 2 cliques = olhos "irritados"; 3 em 1,7 s = tonto (`dizzy`). Hover de 2 s = corações. | Reação a clique e hover em qualquer lugar, não numa tela especial. |
| `src/mochi/greeting.ts` | **Saudação de abertura**: uma sequência de 4,6 s com linha do tempo explícita (`T = { pop0, pop1, tuck0, down0, blink2, tint0, end }`), função pura `greetPose(t)` que devolve a pose a cada instante, easings out/in/inOut/back. Desenhada num canvas próprio. | Linha do tempo pura e testável; pode ser interrompida por hover. |
| `src/island/fsm.ts` | **FSM da ilha** `hidden → petit → home → coucou`: `launch()` entra em `coucou` (saudação) uma vez; ao fim, recolhe; `pinned` mantém aberto enquanto um alerta espera resposta; recolhimento automático com contagem regressiva; "abrir ao passar o mouse" opcional. | Separa a máquina da ilha da máquina do personagem. |
| `src/island/island.ts` `frame` | O loop de `requestAnimationFrame` **para sozinho** quando nada está animando (`busy` falso) e não roda com a ilha escondida. Comentário no código documenta um bug corrigido em que estados com loop (respiração, `zzz`) mantinham quadros com a ilha escondida. | Diretamente aplicável ao P7. |
| `src/core/state.ts` `effectiveState` | `stateOverride ?? focusTask.state ?? "idle"`; um pedido de aprovação traz a sessão dele para a frente e "fixa" a ilha. | Prioridade simples e explícita. |

### 2.2 Agentes e permissões [código]

- `src-tauri/src/agents.rs` instala hooks para **Gemini CLI** (`~/.gemini/settings.json`), **Antigravity** (`~/.gemini/config/hooks.json`), **Cursor** (`~/.cursor/hooks.json`), **Codex** (`~/.codex/hooks.json`), **Copilot CLI** (`~/.copilot/hooks/coucou.json`), **Muse** e um plugin para **Amp**. Claude Code fica em `hooks.rs`.
- **Permissões respondidas na ilha:** Claude Code, **Codex** (`PermissionRequest` com timeout de 120 s e `statusMessage`, respondido com o mesmo `hookSpecificOutput` do Claude), Copilot e Muse (`approvals()`). Observação do próprio código: o Codex só executa hooks depois que o usuário os aprova com `/hooks`.
- Um executável de ponte separado em Rust (`windows/hook/`) faz o papel do nosso `--orbi-hook`, com a citação de argumentos adequada a cada shell (Git Bash, PowerShell, cmd).
- **`config_file.rs`: o jeito cuidadoso de editar arquivo dos outros.** Leitura estrita (arquivo ilegível é erro, nunca "vazio"), plano com **diff mostrado ao usuário**, **impressão digital** dos bytes mostrados (recusa se o arquivo mudou desde então), recusa de tipos inesperados, backup datado obrigatório, escrita ao lado e `rename` atômico. É o modelo certo para o instalador do Arsenal.

### 2.3 Outros recursos [código, salvo indicação]

- **Chat**: `local_chat.rs` (Ollama, LM Studio e qualquer servidor compatível com OpenAI, com streaming e blocos `<think>` escondidos), `openai_compat.rs` (OpenAI, Google, OpenRouter por uma tabela de provedores), `claude.rs`. As chaves ficam no cofre do sistema. O chat não envia ferramentas, então o modelo responde mas nunca age na máquina.
- **Mochi na área de trabalho** (`desktop.rs`): janela própria, clique passa fora do corpo, o cursor é lido **só enquanto ele está acordado**.
- **Atalhos** [doc, README do Windows]: `Ctrl+Alt+Space` chat, `Ctrl+Alt+A` ir para a permissão, `Ctrl+Alt+T` trazer o terminal da sessão, `Ctrl+Alt+←/→` trocar sessão, `Ctrl+Alt+S` som, `Ctrl+Alt+G` guarda-roupa, `Ctrl+Alt+D` área de trabalho.
- Guarda-roupa sazonal, sons substituíveis, resumo semanal, diff ao vivo, soltar arquivo na ilha, atualização automática com "O que há de novo", link com celular, voz, e-mail, WhatsApp, Spotify, Stripe, Vercel e outros.
- **Gerenciador de skills: não existe.** A palavra "skill" só aparece num exemplo de teste (`agent_hooks.rs`) e num comentário (`claude_code.rs`). O Arsenal é uma proposta nova, sem referência no Coucou.

---

## 3. Arsenal de Skills

### 3.1 O que cada agente aceita [doc + máquina]

Todos os cinco usam o mesmo formato aberto, *Agent Skills*: **uma pasta por skill com um `SKILL.md`** (frontmatter YAML com `name` e `description`, corpo em Markdown) e, opcionalmente, `scripts/`, `references/` e `assets/`. O que muda é **onde** cada um procura.

| Agente | Usuário (global) | Projeto | Instalação nativa | Nesta máquina |
| --- | --- | --- | --- | --- |
| Claude Code | `~/.claude/skills/<nome>/` | `.claude/skills/` | Copiar a pasta; plugins via marketplace (fora do escopo inicial) | Existe, 9 skills |
| Codex | `~/.agents/skills/<nome>/` (doc oficial atual) | `.agents/skills/` (cwd, pais, raiz do repo) | `$skill-installer` dentro do Codex | `~/.agents/skills` com 8 skills; `~/.codex/skills` (local antigo) também existe, com 8 |
| Gemini CLI | `~/.gemini/skills/<nome>/` | `.gemini/skills/` | `gemini skills install <git>` | Não instalado |
| Antigravity 2.0 | `~/.gemini/config/skills/<nome>/` | `.agent/skills/` (**a confirmar**) | Copiar a pasta e reiniciar a sessão | `~/.gemini/config/skills` existe, com skills do Google; `~/.gemini/antigravity/skills` (citado em guias antigos) **não existe** |
| Cursor | `~/.cursor/skills/` ou `~/.agents/skills/` | `.cursor/skills/`, `.agents/skills/` | `/create-skill` | Não instalado |

Consequências para o projeto:

1. **Pastas compartilhadas.** O Cursor também lê `~/.claude/skills`, `~/.codex/skills` e `~/.agents/skills`; o Codex e o Cursor leem `~/.agents/skills`. Instalar a mesma skill para "Claude" e "Cursor" pode duplicá-la no Cursor. O instalador precisa mostrar "também visível para: …" e evitar cópias redundantes.
2. **Caminhos ainda em movimento.** Codex migrou de `~/.codex/skills` para `~/.agents/skills`; Antigravity tem fontes divergentes. Os destinos devem ficar numa **tabela de dados** (`skillTargets.ts`) com caminho principal, caminhos legados e como detectar, e não espalhados pelo código.
3. **Formato único**, então não há conversão no v1. Se um agente futuro exigir outro formato, cada destino pode ter um `adapt()` opcional.

### 3.2 Arquitetura proposta [proposta]

```
renderer (Arsenal UI)                    main (único que toca o disco e a rede)
───────────────────────                  ───────────────────────────────────────
catálogo, busca, filtros   ──invoke──▶   skills/catalog.ts   fontes plugáveis → SkillEntry[]
"Instalar em…"             ──invoke──▶   skills/plan.ts      baixa para staging, valida, monta o plano
tela de conferência (plano)              skills/validate.ts  frontmatter, tamanhos, caminhos, scripts
"Confirmar"                ──invoke──▶   skills/apply.ts     backup → escrita atômica → registro
instaladas / remover       ──invoke──▶   skills/ledger.ts    %APPDATA%\Orbi\skills-ledger.json
                                         skills/targets.ts   tabela dos agentes (3.1)
```

**Fontes de catálogo** (interface `SkillSource { id, list(), fetch(entry) }`, para acrescentar fontes sem mexer no resto):

- `curated`: um índice JSON versionado no repositório do Orbit, com cada skill apontando para **repositório + commit fixo + caminho + sha256** dos arquivos. É a fonte padrão e a única "confiável" de saída.
- `github`: um repositório que o usuário adiciona (ex.: `anthropics/skills`), lido pela API de árvores do GitHub num commit resolvido na hora e então fixado. Exibido como "fonte adicionada por você".
- `local`: uma pasta do disco (para quem escreve as próprias skills).

Sem dependências novas: `fetch` do Node para a API do GitHub e para os arquivos crus (sem zip/tar), um parser de frontmatter mínimo (só os campos que usamos) com teste.

**Fluxo:** Abrir Arsenal → escolher skill → escolher agente(s) e escopo (global ou um projeto escolhido numa caixa de diálogo do sistema) → **tela de conferência** → confirmar → resultado.

A tela de conferência mostra: origem (repositório, commit, link), lista de arquivos com tamanho, **aviso destacado se houver scripts executáveis** (`scripts/`, `.ps1`, `.sh`, `.py`, `.js`, `.exe`…), destino final de cada agente, conflitos e "também visível para".

**Segurança do instalador:**

| Regra | Como |
| --- | --- |
| Renderer não toca no disco | Toda operação de arquivo no processo principal; o renderer só manda IDs (`skillId`, `targetId`, `planId`), nunca caminhos. |
| Origem verificada | Commit fixo + sha256 por arquivo no índice curado; recusa se o conteúdo baixado não bater. Fontes do usuário ficam marcadas como não verificadas. |
| Inspeção | `SKILL.md` obrigatório; `name` com `^[a-z0-9-]{1,64}$` igual ao nome da pasta; `description` presente; limites de quantidade e tamanho (ex.: 200 arquivos, 5 MB); recusa `..`, caminhos absolutos, links simbólicos e nomes reservados do Windows (`CON`, `NUL`…). |
| Nada é executado | O Orbit **nunca roda** scripts da skill. Quem roda é o agente, que tem a própria confirmação. O aviso de scripts exige um segundo clique explícito. |
| Sem sobrescrita acidental | Pasta já existe e não foi o Orbit que instalou: **conflito**, com opções "manter a minha" (padrão) ou "substituir com backup". Instalada pelo Orbit, mas editada depois (hash diferente do registro): pede confirmação. |
| Escrita atômica | Baixa para uma pasta de staging em `%APPDATA%\Orbi\staging`, valida, renomeia para o destino; backup datado de qualquer coisa substituída. Mesmo modelo do `config_file.rs` do Coucou, incluindo a impressão digital do plano. |
| Registro | `skills-ledger.json`: skill, fonte, commit, hash de cada arquivo, destinos, data. Remover apaga **só** os arquivos cujo hash ainda bate; o resto é avisado. |
| `open:path` | Restringir o IPC existente (P8) a caminhos do registro ou de pastas conhecidas antes de o Arsenal ganhar "abrir pasta". |

**Gerenciamento:** busca por nome e descrição; filtro por categoria e por agente; aba "Instaladas", que junta as do registro **e** as encontradas nas pastas dos agentes (marcadas "instalada fora do Orbit", só leitura); por agente, onde cada skill está; atualizar quando o commit do índice mudar (com o diff dos arquivos); remover; ver origem e abrir a pasta.

**Detecção de agentes:** reaproveitar `integrations/detect.ts` (que já acha Claude, Codex, Antigravity e Gemini) e acrescentar Cursor. Um agente não detectado continua selecionável, com o aviso "não encontrado neste computador".

### 3.3 Onde o Arsenal fica na interface [proposta]

O Arsenal ocupa o lugar do Tamagotchi: a aba da patinha vira um ícone de mochila ou caixa de ferramentas, e a `ViewMode 'pet'` vira `'arsenal'`, com a mesma janela maior que o Tamagotchi já usa. O palco grande do Orbi some. A interatividade dele (hover, clique, carinho) passa a funcionar em todos os tamanhos (Fase 1), e a escolha 2D/3D continua em Configurações. Como o 3D hoje só aparece no palco, ele precisa de um lugar: proposta, o cartão de destaque do painel quando nenhum agente trabalha.

---

## 4. Comparação de funcionalidades

| Funcionalidade | Coucou | Orbit | Recomendação | Prioridade |
| --- | --- | --- | --- | --- |
| Animação de abertura | Saudação de 4,6 s, linha do tempo pura, uma vez por execução (`greeting.ts`, `fsm.launch`) [código] | Ausente; aceno em toda recarga do renderer (P2) | Entrada própria do Orbi, uma vez por processo | **Alta** |
| Estados do personagem | Tabela declarativa com 11 estados e gesto de entrada (`BOT_STATES`, `setState`) [código] | Parcial: 13 expressões, decididas por `if/else` | Máquina de estados em camadas com prioridade (seção 5) | **Alta** |
| Prioridade de eventos | `effectiveState`; aprovação fixa a ilha [código] | Parcial; reação decorativa apaga a importante (P1) | Prioridade por camada | **Alta** |
| Piscar natural | 2,2–5,4 s, piscada dupla [código] | Implementado, equivalente | Manter | — |
| Olhar o cursor | Suavização exponencial; leitura só quando acordado [código] | Implementado; leitura sempre ligada (P6) | Ligar e desligar a leitura conforme o estado | Média |
| Respiração e movimento sutil | `breathes` por estado [código] | Implementado (loop ambiente) | Manter; parar o loop quando dorme ou nada muda (P7) | Média |
| Clique e hover | Irritado, 3× tonto; hover de 2 s = corações [código] | Só no Tamagotchi (P3) | Em todos os tamanhos, com gestos próprios | **Alta** |
| Concluído, erro, atenção | Giro com faíscas, tremida, pulinho e "!" [código] | Implementado (celebrate, shake, worried, selo) | Manter; separar "pensando" e acrescentar "limite atingido" | Média |
| Processando | `working`, `thinking`, `searching` (varredura do olhar) [código] | Parcial (`focused`, satélite rápido) | Distinguir pensar, ler/buscar e executar pelo nome da ferramenta do hook | Média |
| Inatividade longa | `sleeping` com `zzz` [código] | Só via Tamagotchi (P4) | Sono pela inatividade real do usuário (`powerMonitor`) | **Alta** (consequência da Fase 2) |
| Loop que para sozinho | Sim, com o bug documentado e corrigido [código] | Não (P7) | Parar o relógio quando nada anima | Média |
| FSM da ilha | `hidden`, `petit`, `home`, `coucou`, `pinned`, contagem regressiva, abrir no hover [código] | Parcial: views + recolher ao perder o foco | Fixar com alerta já existe; contagem regressiva opcional | Baixa |
| Hooks de outros agentes | Gemini, Antigravity, Cursor, Codex, Copilot, Muse, Amp [código] | Claude; Antigravity em andamento | Codex primeiro, depois Gemini CLI, depois Cursor | **Alta** (Codex) |
| Permissões fora do Claude | Codex, Copilot, Muse [código] | Só Claude | Codex `PermissionRequest` respondido na ilha | **Alta** |
| Edição segura de arquivos de terceiros | Diff, impressão digital, backup, atômico, confirmação (`config_file.rs`) [código] | Backup e mesclagem, sem diff mostrado nem impressão digital | Adotar o mesmo módulo para hooks e Arsenal | **Alta** |
| Perguntas do agente (AskUserQuestion) | Estado `question` e fila de perguntas [código] | Ausente | Responder na ilha | Média |
| Chat multi-provedor e local | Ollama, LM Studio, compatível com OpenAI, OpenAI, Google, OpenRouter, Claude; sem ferramentas [código] | Ausente | Fase posterior: só `fetch` com streaming, chaves com `safeStorage` | Baixa/Média |
| Uso do plano | Claude e Codex [código] | Claude, Codex, Antigravity, Gemini [código] | O Orbit já está à frente; manter | — |
| GitHub | PRs, CI, contribuições [código] | Equivalente [código] | Manter | — |
| Atalhos globais | Muitos, configuráveis [doc] | `Ctrl+Alt+O`, `Y`/`N` | `Ctrl+Alt+A` (ir à permissão), `Ctrl+Alt+T` (terminal da sessão), atalhos configuráveis | Média |
| Arrastar, posição, sempre visível | Ilha + Mochi solto na área de trabalho [código] | Arrastar, encaixar, sempre visível, posição salva [código] | Manter; mascote solto fica para depois | Baixa |
| Sons | 28 sons proprietários [código] | Ausente | Sons próprios, desligados por padrão | Baixa |
| Personalização | Guarda-roupa sazonal [código] | 2D/3D, reduzir animações, seguir o cursor | Tamanho do Orbi e intensidade das animações; acessórios próprios depois | Baixa |
| Atualização automática | Sim, com "O que há de novo" [código] | Ausente | Avaliar `electron-updater` (dependência nova; precisa de justificativa) | Média |
| Resumo semanal, diff ao vivo, soltar arquivo | Sim [código] | Ausente | Depois do Arsenal | Baixa |
| Celular, voz, e-mail, WhatsApp, Spotify… | Sim [código] | Ausente | **Não recomendado**: fora da proposta de produtividade para desenvolvedores | — |
| Gerenciador de skills | **Ausente** [código] | Ausente | Arsenal (seção 3) | **Alta** |

### 4.1 Detalhe das recomendações de prioridade alta

**R1. Animação de abertura**
1. *O quê:* a ilha nasce como um ponto que cresce até a pílula; o Orbi cai com squash e estica, solta faíscas, acena com olhos felizes, pisca duas vezes, olha em volta e assenta no ocioso. Cerca de 2,2 s.
2. *Coucou:* `windows/src/mochi/greeting.ts`, `windows/src/island/fsm.ts` (`launch`, `greetComplete`).
3. *Orbit:* `widget.ts` (`ready-to-show`), `store.ts` (`boot`), `Island.tsx`, `Orbi2D.tsx`, `brain.ts`.
4. *Diferença técnica:* o Coucou desenha a saudação num canvas separado, com uma função `pose(t)`; o Orbit tem peças SVG animáveis e ações do `motion`. Basta uma ação `enter` composta das primitivas existentes (hop, squash, wave, blink, look-around), sem segundo desenho.
5. *Benefício:* primeira impressão; resolve P2.
6. *Complexidade:* baixa a média.
7. *Riscos:* o redimensionamento da janela transparente durante a entrada (o `fitTo` já cresce antes). Uma flag no processo principal (`introPlayed`, em memória) devolvida no `orbi:initial` evita repetir em recarga; "Reduzir animações" pula a entrada.
8. *Implementação:* `orbi:initial` ganha `intro: boolean`; o renderer toca a sequência e avisa `intro:done`.

**R2. Máquina de estados com prioridade** (seção 5).

**R3. Interações em todos os tamanhos:** reaproveitar `usePetting` sem `petAct`. Hover = curioso + antena; clique no Orbi dentro do painel = boop; 3 cliques rápidos = tonto (gesto próprio: o satélite gira solto, olhos em "x" ou espiral desenhados pelo Orbi); esfregar = corações. Na pílula, o clique continua abrindo o painel e ganha o squash como resposta visual.

**R4. Hooks do Codex com permissões:** novo `bridge/codexSetup.ts` + edição pura testada, no mesmo padrão do Claude e do Antigravity em andamento. Arquivo `~/.codex/hooks.json`; eventos SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest (120 s), PostToolUse e Stop; resposta no formato `hookSpecificOutput`. **Risco:** o formato foi verificado no código do Coucou, não na documentação oficial do Codex; confirmar antes. O Codex exige que o usuário aprove os hooks com `/hooks`, então a interface precisa dizer isso.

**R5. Edição segura compartilhada:** extrair um `safeEdit.ts` (plano com diff, impressão digital, backup, escrita atômica) usado pelos hooks e pelo Arsenal.

---

## 5. Máquina de estados do Orbi [proposta]

Três camadas, cada uma com sua prioridade, e um resolvedor puro e testável (`mascot/state.ts`) no lugar da cadeia de `if/else` do `brain.ts`:

```
Camada 1  CONDIÇÃO (persistente, derivada do hub)       prioridade
          permission ................................... 100
          error (até 60 s) ............................. 80
          ratelimit .................................... 70
          working: thinking / reading / running ........ 60
          idle → drowsy (5 min sem input) → asleep (15 min)   10 / 5 / 0

Camada 2  REAÇÃO (curta, com prazo)
          done, error, permission-start ................ 90
          intro (entrada) .............................. 85
          start ........................................ 50
          boop, hover, carinho, tonto .................. 30
          
Camada 3  ENFEITE (ações espontâneas, olhar em volta)
          só quando as camadas 1 e 2 estão em repouso ..  10
```

Regras:

- Uma reação nova só substitui a atual se a prioridade dela for **maior ou igual**. Caso contrário, é descartada (enfeites) ou entra numa fila de uma posição (eventos).
- A expressão final é a da reação ativa, se houver, ou a da condição. Selo e brilho vêm sempre da condição de maior prioridade, então o "!" âmbar nunca some durante um boop.
- Cada estado é uma linha de tabela: expressão, selo, brilho, partículas, ritmo do satélite, `ambientFps` e se o cursor é lido. Exemplo: dormindo = 6 fps e sem leitura do cursor.
- **Transições suaves:** expressões passam pela pálpebra (fechar 80 ms, trocar a forma, abrir), em vez de trocar o desenho no mesmo quadro; brilho e cor com transição CSS de 300 ms.
- **Sono pela inatividade real:** `powerMonitor.getSystemIdleTime()` consultado a cada 30 s no processo principal (custo desprezível). Ao acordar (input ou evento de agente): espreguiçar.
- **Desempenho:** o relógio ambiente para quando o estado não pede movimento contínuo e nenhuma ação está em curso, e volta no próximo evento (P7). A leitura do cursor no processo principal liga e desliga conforme o estado (P6).
- Testes unitários do resolvedor: dada condição + reação + tempo → expressão, selo e brilho. Mesmo estilo de `test/pet.test.ts`, que deixa de existir.

---

## 6. Recomendações adicionais

- Usar `bridge/` como lugar único de instaladores de hooks, com a mesma interface (`connect`, `disconnect`, `status`, `upgrade`), para que Codex, Gemini e Cursor entrem com o mínimo de código novo.
- O processo de desinstalação do Orbit (`installer.nsh` com `--orbi-disconnect`) também deve remover os hooks de Codex e Antigravity, **mas não as skills instaladas**: elas são do usuário, e o registro fica em `%APPDATA%\Orbi`.
- Migração do `orbi-state.json` para `version: 2`: descartar `pet` com segurança (sem apagar o arquivo) e manter configurações, janela, uso e token.
- Atualizar `README.md`, `docs/PESQUISA_E_PLANO.md` e a descrição do `package.json`, que ainda vendem o Tamagotchi.
- Registrar as decisões em `docs/decisions/` (um arquivo curto por decisão: estados, Arsenal, edição segura).

---

## 7. Plano por fases

Ordem recomendada: **2 → 1 → 3 → 4 → 5**. A remoção vem antes das animações porque o `brain.ts` depende do `pet` (sono, humor, ações espontâneas): refazer o cérebro enquanto o Tamagotchi ainda existe seria fazer o trabalho duas vezes. Cada fase começa com um spec curto e só segue com aprovação. As fases 2 e 3 tocam `types.ts`, `store.ts`, `index.ts` e `hub.ts`, então só começam **depois que o trabalho do Antigravity (1.7) for commitado**.

### Fase 2: remover o Tamagotchi (primeiro)

| Arquivos | Alteração |
| --- | --- |
| `src/shared/pet.ts`, `test/pet.test.ts`, `src/renderer/src/views/Pet.tsx` | Apagar. |
| `src/shared/types.ts` | Tirar `PetState`, `InitialState.pet`; `ViewMode` perde `'pet'`. A view `'arsenal'` entra só na Fase 3, já funcionando (sem tela "em breve"). Detalhes no [spec da Fase 2](superpowers/specs/2026-11-02-remocao-tamagotchi-design.md). |
| `src/main/store.ts` | `version: 2`, migração que descarta `pet`. |
| `src/main/index.ts`, `src/preload/index.ts` | Tirar `pet:save`, `savePet`, `pet` do `orbi:initial`; item da bandeja "Tamagotchi" → "Arsenal de Skills". |
| `src/renderer/src/store.ts` | Tirar `pet`, `petAct`, `refreshPet`, `petNote`, reações `feed`, `play`, `refuse`, `tired`; carinho vira só reação. |
| `brain.ts`, `Mascot.tsx` | Tirar as dependências de `pet` (sono temporariamente desligado até a Fase 1). |
| `Compact.tsx`, `Panel.tsx`, `Settings.tsx`, `global.css` | Título ocioso da pílula sem `headline(pet)` (ex.: "Orbi está de olho" + uso do plano); aba da patinha → Arsenal; "Estilo no Tamagotchi" → "Estilo do Orbi"; remover CSS `.pet*`, `.need*`, `.care*`. |
| `README.md`, `docs/PESQUISA_E_PLANO.md`, `package.json` | Textos. |

*Critérios de aceite:* `npm run typecheck` e `npm test` passam; um `orbi-state.json` antigo abre sem erro e sem perder configurações, posição, uso nem token; `grep -ri "satiety\|petAct\|Tamagotchi" src` não acha nada; o Orbi continua com 2D/3D, expressões, piscar, olhar e reações a agentes.

### Fase 1: animações e máquina de estados

| Arquivos | Alteração |
| --- | --- |
| `src/renderer/src/mascot/state.ts` (novo) + `test/mascotState.test.ts` | Resolvedor de camadas e prioridades (seção 5). |
| `brain.ts` | Passa a usar o resolvedor; ações espontâneas sem `pet`. |
| `store.ts` (renderer) | `react()` com prioridade; fila de um evento. |
| `Orbi2D.tsx` | Ação `enter`; troca de expressão pela pálpebra; `ambientFps` por estado; parar o relógio quando ocioso; gesto "tonto" próprio. |
| `Mascot.tsx` | Hover, clique e carinho em todos os tamanhos. |
| `widget.ts`, `index.ts` | Flag `introPlayed`; leitura do cursor liga e desliga; `powerMonitor` para inatividade. |
| `Island.tsx` | Entrada da ilha (ponto → pílula) e reação do Orbi ao abrir e fechar o painel. |
| `types.ts`, integrações do Claude | Subestado de trabalho (thinking/reading/running) pelo nome da ferramenta do hook; `ratelimit` quando o uso chegar a 100%. |

*Critérios de aceite:* a entrada toca uma vez por execução e não repete com `Ctrl+R` no renderer; com "Reduzir animações", não toca; um boop durante "concluído" não apaga o brilho verde nem o ✓; com permissão pendente, o "!" âmbar fica visível durante qualquer reação; 15 min sem input → dormindo; um evento de agente acorda; com o Orbi dormindo e o painel aberto, CPU do renderer abaixo de 2% de um núcleo (medido como no README); testes do resolvedor passam.

### Fase 3: Arsenal de Skills

| Arquivos | Alteração |
| --- | --- |
| `src/main/skills/{targets,catalog,sources/*,validate,plan,apply,ledger}.ts` (novos) | Seção 3.2. |
| `src/main/safeEdit.ts` (novo, R5) | Diff, impressão digital, backup, atômico. |
| `src/shared/types.ts`, `src/preload/index.ts`, `src/main/index.ts` | Tipos `SkillEntry`, `SkillTarget`, `InstallPlan`, `InstalledSkill`; IPC `skills:*` (só IDs). |
| `resources/skills-index.json` (novo) | Índice curado inicial, com commit e sha256. |
| `src/renderer/src/views/Arsenal.tsx` (novo) + CSS | Catálogo, busca, filtros, instaladas, conferência, resultado. |
| `integrations/detect.ts` | Detectar Cursor. |
| `index.ts` | Restringir `open:path` (P8). |
| `test/skills*.test.ts` | Validação (traversal, symlink, nomes reservados, frontmatter), plano (conflitos, "também visível para"), registro (remoção só do que bate o hash). |

*Critérios de aceite:* instalar uma skill do índice em Claude Code e Codex cria `~/.claude/skills/<nome>/SKILL.md` e `~/.agents/skills/<nome>/SKILL.md` com hash conferido; o Claude Code lista a skill numa sessão nova; tentar instalar por cima de uma pasta que não é do Orbit mostra o conflito e, por padrão, não escreve nada; uma skill com `scripts/` exige o segundo clique; remover apaga só o que o Orbit instalou; um arquivo com `..` no caminho é recusado; o renderer não consegue escrever fora das pastas de destino (nenhum IPC aceita caminho).

### Fase 4: integrações

Em ordem: hooks do Codex com permissões (R4) → `Ctrl+Alt+A` e `Ctrl+Alt+T` → perguntas do agente na ilha → hooks do Gemini CLI → hooks do Cursor → chat com modelos locais (Ollama, LM Studio) e provedores, só `fetch`, sem ferramentas → atualização automática (decidir a dependência).

*Critérios de aceite* por item, no mesmo estilo do `docs/INTEGRACOES.md`: verificado de ponta a ponta nesta máquina, ou marcado como "não verificado" com o motivo. Nada simulado se apresentando como real.

### Fase 5: qualidade

Medição de CPU e RAM por visualização (mesmo método do README) antes e depois; teste do instalador NSIS (instalar, conectar, desinstalar: hooks removidos, skills mantidas); monitores com escala de 125% e 150%; dois monitores; Windows 10 e 11; revisão de segurança dos IPCs novos; `npm run typecheck`, `npm test` e `npm run dist` limpos.

---

## 8. Decisões que dependem de você

1. **O palco grande do Orbi (2D/3D) some junto com o Tamagotchi?** Proposta: sim; o Arsenal ocupa a tela, as interações vão para todos os tamanhos e o 3D aparece no cartão de destaque do painel.
2. **Fontes do catálogo no v1:** só o índice curado (mais seguro), ou também repositórios do GitHub adicionados pelo usuário?
3. **Ordem das fases:** começar pela remoção (recomendado) ou pelas animações, como no pedido original?
4. **Escopo de projeto no Arsenal:** v1 só global (mais simples), ou global e projeto já no v1?
