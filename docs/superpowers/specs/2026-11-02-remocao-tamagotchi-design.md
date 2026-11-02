# Fase 2: remover o Tamagotchi

Status: spec para revisão. Origem: [auditoria](../../AUDITORIA_ORBIT_COUCOU.md), seção 7, aprovada em 02/11/2026 com a ordem "remoção primeiro".

## Objetivo

O Orbi deixa de ser um bichinho virtual com necessidades. Sai tudo o que é fome, energia, humor, alimentação e cuidados: interface, estado, IPC, persistência, testes e textos. Fica o mascote: desenho 2D e 3D, expressões, ações, piscar, olhar, brilho, partículas, reações aos agentes e os gestos de carinho e "boop", agora sem números por trás.

Sucesso: o app abre com o estado antigo do usuário sem perder configurações, posição, limites nem token; nada da tela de Tamagotchi sobra; o mascote reage aos agentes exatamente como antes.

## Pré-condição

O trabalho dos hooks do Antigravity em andamento na árvore (`hub.ts`, `index.ts`, `preload/index.ts`, `types.ts`, `Panel.tsx`, `Tools.tsx`, `bridge/antigravity*.ts`, `integrations/antigravity*.ts`) **precisa ser commitado antes**, com `npm run typecheck` e `npm test` passando. Esta fase edita quase todos esses arquivos. A implementação será num branch próprio (`refactor/remover-tamagotchi`) a partir desse commit.

## Decisões

| Decisão | Escolha | Por quê |
| --- | --- | --- |
| Tela do Tamagotchi (`ViewMode 'pet'`) | Removida. **Não** entra uma tela "em breve" no lugar. A aba do Arsenal nasce na Fase 3, já funcionando. | Nenhuma tela vazia ou simulada no meio do caminho. |
| Palco grande do Orbi | Some com a tela. | Decisão 1 da auditoria (proposta aceita). |
| Gestos (boop, cócegas, carinho) e hover curioso | Passam para o Orbi do cartão de destaque do painel (96 px), que vira o Orbi "interativo". | Sem isso, o mascote perde toda a interatividade direta até a Fase 1. |
| 3D | O Orbi do cartão de destaque respeita a escolha 2D/3D. A pílula continua sempre 2D. | O 3D só existia no palco; continua acessível. O padrão segue 2D, então o custo padrão não muda. |
| Arte ligada à comida (expressões `eating` e `refuse`, ação `chomp`, partículas `crumbs`) | **Mantida**, só deixa de ser disparada. | "Não remova o sistema visual." A Fase 3 pode reaproveitar `chomp` para o Orbi "engolir" uma skill instalada. |
| Sono (`asleep`, `sleepy`, `zzz`, `yawn`) | A arte fica; o gatilho sai (vinha de `pet.sleeping`). Volta na Fase 1, pela inatividade real do usuário. | Evita dois cérebros. Por uma fase, o Orbi não dorme. |
| Estado salvo | `orbi-state.json` passa para `version: 2`, sem `pet`. Antes da primeira gravação, uma cópia única `orbi-state.v1-backup.json`. | Remoção segura e reversível à mão. |

## Mudanças por arquivo

### Apagar

- `src/shared/pet.ts`
- `src/renderer/src/views/Pet.tsx`
- `test/pet.test.ts`

### `src/shared/types.ts`

- `ViewMode = 'compact' | 'panel'`.
- Remover `PetState` e `InitialState.pet`.

### `src/main/migrate.ts` (novo, puro, sem Electron)

```ts
export function migrateState(raw: unknown): { state: PersistedV2Input; hadPet: boolean } | null
```

- Objeto com `version` 1 ou sem versão: copia `settings`, `window`, `githubTokenEnc`, `bridgeToken` e `usage`; descarta `pet`; `hadPet` informa se havia `pet`.
- `version: 2`: devolve como está.
- Não objeto: `null`, e o chamador cai nos padrões, como hoje.

### `src/main/store.ts`

- `Persisted.version: 2`, sem `pet`.
- `loadStore` usa `migrateState`. Se `hadPet` e o backup ainda não existe, copia o arquivo original para `orbi-state.v1-backup.json` antes do `persistNow()`.
- Remover `createPet`, `tick`, o getter `pet` e `setPet`.

### `src/main/index.ts` e `src/preload/index.ts`

- Bandeja: remover o item "Tamagotchi".
- `orbi:initial` sem `pet`; remover o IPC `pet:save` e `savePet`.

### `src/main/widget.ts`

- Comentários que citam "Tamagotchi" passam a falar só de pílula e painel. Sem mudança de comportamento.

### `src/renderer/src/store.ts`

- Remover `pet`, `petAct`, `refreshPet`, `petNote`, `savePet`, o intervalo de 30 s e o import de `@shared/pet`.
- `ReactionKind` fica com `start | done | error | waiting | boop | pet | hello | tickle`. Saem `feed`, `play`, `refuse`, `tired`, `sleep`, `wake` e `startle`.

### `src/renderer/src/mascot/brain.ts`

- `useMascotMood(hovered)` sem o parâmetro `stage` e sem `pet`.
- Ordem da expressão: reação ativa → permissão (`worried`) → erro recente (`sad`) → trabalhando (`focused`, ou `curious` com hover) → hover (`curious`) → `neutral`.
- Ações espontâneas: mesmo intervalo de 7 a 16 s, conjunto fixo `look-around ×2, wiggle, wave, hop, stretch`; não disparam com permissão pendente nem com reação ativa.
- Brilho violeta só para a reação `pet`. `sleeping` fica sempre `false` nesta fase; a Fase 1 liga.
- As tabelas `REACTION_*` perdem as chaves removidas.

### `src/renderer/src/mascot/Mascot.tsx`

- A prop `stage` vira `interactive`: liga gestos e hover; permite o 3D quando `mascotStyle === '3d'` e não é `flat`.
- `ambient`: `'minimal'` abaixo de 70 px, senão `'calm'`. O modo `'full'` deixa de ser usado; o tipo fica para a Fase 1 decidir.
- `usePetting`: esfregar chama `react('pet')` em vez de `petAct('pet')`; remover o ramo do susto ao dormir.
- Passa `useMascotMood(interactive && hovered)`: só o Orbi interativo fica curioso com o hover, como hoje só o do palco ficava.

### `src/renderer/src/views/Island.tsx`

- Remover o import de `Pet`, o ramo `'pet'` e `RADIUS.pet`.

### `src/renderer/src/views/Panel.tsx`

- Remover a aba da patinha (`PawPrint`).
- Cartão de destaque (com e sem sessão): `<Mascot size={96} interactive />`.
- Sem sessão: remover o aviso "O Orbi também precisa de cuidados".

### `src/renderer/src/views/Compact.tsx`

- Sem agente ativo, o título deixa de ser `headline(pet)`:
  - título "Tudo tranquilo";
  - subtítulo `${nome} · ${ago(lastActivityAt)}` da ferramenta com a atividade real mais recente em `hub.tools` (exceto GitHub e atalhos `custom:`), por exemplo "Claude Code · há 12 min";
  - sem atividade registrada, sem subtítulo.
- Remover o ponto âmbar de necessidades baixas.

### `src/renderer/src/views/Settings.tsx`

- "Estilo no Tamagotchi" vira "Estilo do Orbi", com a descrição "O 3D aparece no cartão do painel e só é carregado quando escolhido".

### `src/renderer/src/styles/global.css`

- Remover o bloco `/* Tamagotchi */` (`.pet*`, `.needs`, `.need*`, `.care*`).
- `.crumb` e `.mascot--stage` ficam enquanto a arte que os usa existir; `.mascot--stage` é renomeada para `.mascot--interactive`.

### Textos

- `package.json`, `description`: "Orbi Desktop: o mascote do Orbit e central de agentes de IA para desenvolvedores".
- `README.md`:
  - abertura sem "Tamagotchi";
  - tabela de visualizações com duas linhas;
  - "O Orbi vivo" sem comer, recusar e dormir, e com o carinho no cartão do painel;
  - remover o parágrafo de fome, energia e humor;
  - em "Desempenho", remover a linha do Tamagotchi;
  - em "Estrutura", `src/shared/` como "tipos e utilitários".
- `docs/PESQUISA_E_PLANO.md`: é histórico, não se reescreve. Uma nota no topo aponta para a auditoria e diz que o Tamagotchi foi removido.

## Testes

- `test/migrate.test.ts` (novo):
  - v1 com `pet` → v2 sem `pet`, demais campos idênticos e `hadPet: true`;
  - v1 sem `pet` → `hadPet: false`;
  - v2 → inalterado;
  - `null`, número, array → `null`.
- Os demais testes continuam passando.

## Critérios de aceite

1. `npm run typecheck` e `npm test` passam.
2. Abrir o app com uma cópia do `orbi-state.json` v1 real desta máquina:
   - configurações, posição, limites salvos e token do GitHub continuam;
   - o arquivo vira `version: 2` sem `pet`;
   - `orbi-state.v1-backup.json` aparece uma vez e não é recriado em aberturas seguintes.
3. `git grep -niE "satiety|PetState|petAct|savePet|pet:save|tamagotchi|needWord|ageLabel|headline\(" -- src test README.md package.json` não acha nada.
4. Na bandeja não há "Tamagotchi"; no painel não há a patinha; `Ctrl+Alt+O`, `Esc`, `Y`/`N` e arrastar continuam iguais.
5. O Orbi do cartão do painel responde a clique (boop), 5 cliques (cócegas), esfregar (corações) e hover (curioso). Na pílula, o clique continua abrindo o painel.
6. Com 3D escolhido, o cartão do painel mostra o Orbi 3D; com 2D (padrão), a pílula e o painel se comportam e custam como antes.
7. O simulador (início, progresso, conclusão, erro, permissão) produz as mesmas expressões, selos e brilhos de antes.

## Fora do escopo

- Máquina de estados com prioridade, entrada animada, sono por inatividade e gestos em todos os tamanhos: Fase 1.
- Arsenal de Skills: Fase 3.
- Correção do `open:path`: Fase 3, antes do Arsenal abrir pastas.
