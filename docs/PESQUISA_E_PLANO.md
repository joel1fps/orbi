# Orbi Desktop — pesquisa e plano

## 1. O que o vídeo mostra (Coucou for Windows 0.2, 49 s)

Analisado quadro a quadro (0,5 s → 48 s), com zoom na interface.

| Momento | O que acontece | O que torna interessante |
| --- | --- | --- |
| 0–4 s | Uma pílula preta no topo da tela (estilo "Dynamic Island") cresce para baixo; o mascote aparece com brilhos, acena e pisca. | A interface nasce do mascote. Nada de janela tradicional. |
| 8–13 s | Grade de agentes: Codex, Cursor, Gemini CLI, Antigravity, Copilot CLI, Muse Code, OpenCode, Amp, Hermes. Cada um é o mascote tingido de outra cor. | Cada ferramenta tem rosto; status vira personagem. |
| 13–15 s | Ilha expandida: abas (início, chat, +), engrenagem e som à direita. Cartão da sessão ativa: projeto "korus", agente, contador de passos `3/4`, último passo com ✓ e o comando atual (`git push origin main`). À direita, chips dos agentes; o que precisa de atenção ganha um "!" âmbar. | Uma linha diz o que está acontecendo agora. |
| 15–17 s | "Codex needs permission": comando em bloco, botões **Deny (N)** e **Allow (Y)**, brilho âmbar atrás do mascote, que fica apreensivo com "!". | Aprovar sem trocar de janela, com atalho de teclado. |
| 17–19 s | "Codex finished — Pushed to main · 48 tests passed", botões "Open terminal" e "OK"; brilho verde, mascote com olhos felizes e selo ✓. | Conclusão é celebrada pelo personagem. |
| 20–25 s | Chat com vários provedores (Anthropic, Google, OpenAI, OpenRouter, Ollama, LM Studio); atalho Ctrl+Alt+Space. | — |
| 26–29 s | Pílulas "Claude 64%" e "Codex 22%" no cabeçalho; ao clicar, barras de 5 horas e semana com horário de renovação. | Uso do plano sempre à vista, com fonte real. |
| 29–35 s | GitHub: PRs (3 · running), revisões pendentes (2), CI do branch padrão, mapa de contribuições, lista de PRs. | — |
| 36–39 s | Guarda-roupa do mascote (Ctrl+Alt+G). | — |
| 41–44 s | "Live diff", "Weekly recap", mascote andando pela área de trabalho. | — |

**Animações observadas:** piscar, olhos felizes (^ ^), olhos fechados de sono, mãozinhas flutuantes acenando, partículas ao surgir, brilho colorido por estado (âmbar = atenção, verde = sucesso), selos "!" e "✓", transição pílula → painel por crescimento contínuo.

## 2. O Orbi original (projeto Orbit)

- Fonte: `Downloads/orbit-master/apps/web/public/orbi.svg` (o mesmo arquivo está dentro do ORBIT instalado). Componente: `apps/web/src/components/brand/OrbiMascot.tsx` (apenas exibe o SVG, sem animação).
- Não há modelo 3D, sprites nem animações prontas. Tudo será construído a partir do SVG.
- Anatomia: corpo arredondado verde-água `#4fb7a2` com contorno `#3d564e`, barriga `#7ed5c3`, antenas com pontas cósmicas (lima `#a3e635` e água `#5eead4`), olhos grandes `#171d1b` com dois brilhos, bochechas rosa `#f472b6`, anel orbital passando à frente da barriga, satélite amarelo `#facc15`, pés, um braço apoiado e outro acenando.
- Identidade Orbit: grafite `#121615 / #171D1B / #202724 / #2A332E`, borda `#354039`, texto `#E5EAE6 / #A0ADA4`, sage `#91AA9B`; fontes Sora (títulos) e Inter (interface); easing `cubic-bezier(0.65, 0, 0.35, 1)`.

## 3. Fontes de dados reais encontradas nesta máquina

| Ferramenta | Situação | Fonte real |
| --- | --- | --- |
| Claude Code 2.1.295 | Instalado | Hooks HTTP oficiais (eventos + **PermissionRequest** para Permitir/Negar), `rate_limits` 5 h/7 dias no JSON do statusline (Pro/Max), transcrições em `~/.claude/projects`. |
| Codex | Dados em `~/.codex/sessions` (118 sessões) | Eventos `task_started`/`task_complete`, comandos executados e `rate_limits` (5 h, semana, plano). |
| Gemini CLI | Não instalado | Detecção de `~/.gemini/tmp` quando instalado. |
| Hermes Agent | Não instalado | Detecção de `~/.hermes` quando instalado. |
| GitHub | `gh` não instalado | API do GitHub com token pessoal informado por você (guardado com criptografia do sistema). |

Nada de porcentagem inventada: sem fonte, o Orbi mostra "sem dados" ou "não conectado".

## 4. Skills

- Instaladas e relevantes: **img2threejs** (método de reconstrução 3D a partir da imagem — usado em forma enxuta: decomposição em componentes + comparação visual com o SVG; o pipeline completo em Python é desproporcional para um personagem de formas simples).
- Não instaladas: Superpowers, Frontend Design, React Best Practices, Remotion. As diretrizes de Frontend Design (um momento de movimento orquestrado, sem cartões idênticos, sem rótulos em caixa alta) e React Best Practices (carregar o 3D sob demanda, refs para valores transitórios, seletores no estado) foram lidas e aplicadas. Remotion não é necessário (sem vídeo demonstrativo).

## 5. Arquitetura

- **Electron 44 + React 19 + TypeScript + Vite (electron-vite)**, Motion para 2D, Three.js + React Three Fiber para 3D (carregado só quando o modo 3D é ativado), Zustand para estado, armazenamento JSON local.
- Uma janela transparente, sem bordas, que deixa o clique passar nas áreas vazias. A forma (pílula → painel → Tamagotchi) muda por animação de layout dentro dela, sem redimensionar a janela.
- Processo principal: bandeja, sempre visível, arrastar, posição salva, servidor local `127.0.0.1` para os hooks, leitores de sessões do Claude/Codex, GitHub.
- Simulador de eventos, sempre marcado como **SIMULADO**.

## 6. Escopo desta primeira versão

Incluído: mascote 2D/3D vivo, Tamagotchi (alimentar, brincar, descansar, carinho; fome, energia, humor), três visualizações, ilha com notificações, permissão Permitir/Negar para Claude Code, uso do plano Claude/Codex, cartões de ferramentas, GitHub por token, ferramentas personalizadas, bandeja.

Fora por enquanto (não pedidos ou complexos): chat multi-modelo, guarda-roupa, mascote andando pela tela, diff ao vivo, resumo semanal.
