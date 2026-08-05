# VisionLoop 0.1.4 — Tabela de Preços (Carnes Bovinas)

Este pacote tem só os arquivos que mudaram (ou são novos) para adicionar o botão
que gera a tabela de preços direto no controlador. Substitua cada um no mesmo
caminho, dentro da pasta do seu projeto
(`2026-08_04_VisionLoop-0.1.3/` no seu repositório local):

| Arquivo neste pacote | Onde colocar (substituir/criar) | Situação |
|---|---|---|
| `server.js` | `server.js` | Alterado |
| `package.json` | `package.json` | Alterado (versão 0.1.3 → 0.1.4 + nova dependência) |
| `controller.html` | `controller.html` | Alterado |
| `js/controller.js` | `js/controller.js` | Alterado |
| `lib/tabela-precos.js` | `lib/tabela-precos.js` | **Novo** (pasta `lib/` também é nova) |
| `assets/tabela-bovinos-1.png` | `assets/tabela-bovinos-1.png` | **Novo** (imagem-base da página 1, com os nomes já prontos) |
| `assets/tabela-bovinos-2.png` | `assets/tabela-bovinos-2.png` | **Novo** (imagem-base da página 2, com os nomes já prontos) |
| `assets/fonts/DejaVuSans-Bold.ttf` | `assets/fonts/DejaVuSans-Bold.ttf` | **Novo** (pasta `assets/fonts/` também é nova) |
| `CHANGELOG.md` | `CHANGELOG.md` | Alterado |
| `README.md` | `README.md` | Alterado |

Nenhum outro arquivo do projeto foi tocado (assets antigos, `tv.html`, `index.html`,
`css/`, `playlists.json` etc. continuam exatamente como estavam).

## Passo a passo

1. Copie os arquivos da tabela acima para os caminhos indicados (sobrescrevendo
   os que já existem, criando as pastas novas `lib/` e `assets/fonts/`).
2. Rode `npm install` de novo dentro da pasta do projeto — isso baixa a nova
   dependência `@napi-rs/canvas`, usada para desenhar o texto nas imagens.
   Sem esse passo o botão aparece na tela, mas a geração falha com um aviso
   claro (dependência não instalada).
3. `git add`, `git commit`, `git push` do jeito que você já vem fazendo pela
   VS Code (pode usar o prefixo `feature/` para esse commit, já que é
   funcionalidade nova — ver o guia de Git que te mandei antes).
4. No Render, dê o redeploy do serviço de teste (ele já roda `npm install`
   sozinho a cada deploy, então o passo 2 é só necessário se você for testar
   local antes).

## Como testar

1. Abra o controlador, vá na aba **Vídeos** (sem selecionar nenhuma TV).
2. Role até o bloco **"🥩 Tabela de Preços — Carnes Bovinas"**.
3. Clique em **"📄 Gerar tabela a partir do Txitens.txt"** e escolha o arquivo.
4. Em alguns segundos aparece um aviso dizendo quantos preços foram
   preenchidos, e — se for o caso — quais cortes tiveram preço duplicado no
   Txitens.txt (preenchidos usando o maior valor, mas vale conferir) ou
   ficaram em branco por não terem sido encontrados.
5. As 2 imagens (`Tabela de Precos - Carnes Bovinas 1.png` e `...2.png`)
   aparecem na lista normal de vídeos/imagens, prontas para enviar a
   qualquer TV.

Gerar de novo (com o mesmo ou outro Txitens.txt) **substitui** essas 2
imagens — não acumula versões antigas na lista.

## O que exatamente é desenhado em cima da imagem

A função **nunca redesenha os nomes dos cortes nem o "KG."** — eles já vêm
prontos nas 2 imagens-base (`assets/tabela-bovinos-1.png` e
`assets/tabela-bovinos-2.png`, as mesmas que te mandei antes). A cada
geração, o servidor só escreve em cima delas:

1. O título **"Bovinos"**, no espaço em branco que fica acima da tabela.
2. O preço de cada corte, no espaço em branco reservado à direita de cada
   linha.

Se um dia você quiser mudar o layout, os cortes ou o visual, é só trocar
essas 2 imagens-base por outras (mantendo os mesmos espaços em branco) —
não precisa mexer em código nenhum.

## Cadastro duplicado no PDV: como a função decide o preço

Testei com o arquivo `Txitens.txt` que você me enviou antes, e 19 dos 20
cortes bateram certinho, exatos, sem ambiguidade. Só **"Patinho"** aparecia
duas vezes no arquivo, com códigos de produto diferentes e preços
diferentes (R$ 33,99 e R$ 39,99) — sinal de cadastro duplicado no PDV para
o mesmo corte.

Por decisão sua, o desempate nesses casos é automático: **a função sempre
usa o maior preço encontrado**. O aviso no controlador continua mostrando
quais cortes caíram nesse caso e quais foram os preços encontrados, pra
você conferir no seu sistema de PDV se o maior valor é mesmo o correto (ou
se um dos dois cadastros deveria ser apagado).

## Quando um preço fica em branco

Só quando a descrição exata esperada para aquele corte não aparece em
nenhuma linha do Txitens.txt — nesse caso a função não inventa um valor, o
espaço fica em branco e o corte entra na lista de "não encontrado" do
aviso.
