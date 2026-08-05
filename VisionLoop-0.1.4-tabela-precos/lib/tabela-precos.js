// lib/tabela-precos.js
// -----------------------------------------------------------------------
// Lê um arquivo "Txitens.txt" (exportado do PDV/balança, formato de largura
// fixa) e gera as 2 imagens da tabela de preços de carnes bovinas.
//
// IMPORTANTE: os NOMES dos cortes (e o "KG.") já vêm prontos, desenhados
// permanentemente nas imagens-base em assets/tabela-bovinos-1.png e
// assets/tabela-bovinos-2.png — essa função NUNCA redesenha nome nenhum,
// só entra em cima dessas 2 imagens-base e escreve: (1) o título "Bovinos"
// no espaço em branco de cima e (2) o preço de cada corte no espaço em
// branco reservado à direita de cada linha. Tudo o mais da imagem-base
// permanece exatamente como está.
//
// FORMATO DO TXT (mesma descoberta feita antes em Python):
//   - Cada linha tem um cabeçalho numérico de 20 caracteres + a descrição
//     do produto (resto da linha).
//   - O preço fica nos caracteres 14 a 17 (índice 13:17), como um número de
//     4 dígitos = centavos sem o último dígito (ex.: "6999" -> R$ 69,99).
//
// COMO O PREÇO DE CADA CORTE É ENCONTRADO:
//   Cada um dos 20 cortes fixos tem uma "chave exata" — o texto completo da
//   descrição no Txitens.txt que corresponde a ele (ex.: "Carne Bovina
//   Picanha"). A busca é por IGUALDADE exata (não só "contém"), porque no
//   arquivo real existem variações parecidas com preços diferentes (ex.:
//   "Carne Bovina Costela Gaucha" x "...Costela Gaucha Temperada") — usar
//   "contém" faria a tabela pegar o preço errado nesses casos.
//
//   Se a chave exata não aparecer no arquivo → item fica "não encontrado".
//   Se aparecer mais de uma vez com preços DIFERENTES (aconteceu de verdade
//   com "Carne Bovina Patinho" no arquivo de teste, com 2 linhas e preços
//   diferentes — cadastro duplicado no PDV, com 2 códigos de produto
//   distintos para a mesma descrição) → por decisão do usuário, o desempate
//   usa sempre o MAIOR preço entre os encontrados. O caso continua sendo
//   reportado separadamente (como "duplicado") para o controlador avisar
//   que aquele valor foi escolhido por desempate, não porque só existia uma
//   opção — assim dá pra conferir manualmente se o maior preço é mesmo o
//   correto no seu sistema de PDV.
// -----------------------------------------------------------------------

const path = require("path");
const fs = require("fs");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

const ASSETS_DIR = path.join(__dirname, "..", "assets");
const FONT_PATH = path.join(ASSETS_DIR, "fonts", "DejaVuSans-Bold.ttf");
const FONT_FAMILY = "VisionLoopTabelaFont";

let fontRegistrada = false;
function garantirFonte() {
  if (fontRegistrada) return;
  GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
  fontRegistrada = true;
}

// Geometria medida nas imagens-base (em pixels) — mesma medição de sempre.
const TITLE_X0 = 27, TITLE_X1 = 777, TITLE_Y0 = 24, TITLE_Y1 = 115; // espaço em branco de cima
const PRICE_X0 = 636, PRICE_X1 = 777;   // coluna do preço (espaço em branco à direita de cada linha)
const ROW_BANDS = [
  [128, 203], [209, 285], [291, 366], [372, 448], [454, 530],
  [536, 612], [618, 693], [699, 775], [782, 857], [864, 939],
];
const TITULO = "Bovinos";

// Os 20 cortes fixos das 2 tabelas (na mesma ordem em que já estão
// desenhados nas imagens-base, linha por linha), com a chave exata usada
// para achar o preço no Txitens.txt.
const CORTES_PAGINA_1 = [
  { nome: "Picanha", chave: "Carne Bovina Picanha" },
  { nome: "Alcatra", chave: "Carne Bovina Alcatra" },
  { nome: "Contra Filé", chave: "Carne Bovina Contra File" },
  { nome: "Coxão Mole", chave: "Carne Bovina Coxao Mole" },
  { nome: "Coxão Duro", chave: "Carne Bovina Coxao Duro" },
  { nome: "Patinho", chave: "Carne Bovina Patinho" },
  { nome: "Fraldinha", chave: "Carne Bovina Fraldinha" },
  { nome: "Maminha", chave: "Carne Bovina Maminha" },
  { nome: "Filé Mignon", chave: "Carne Bovina File Mignon" },
  { nome: "Cupim", chave: "Carne Bovina Cupim" },
];
const CORTES_PAGINA_2 = [
  { nome: "Acém", chave: "Carne Bovina Acem" },
  { nome: "Lagarto", chave: "Carne Bovina Lagarto" },
  { nome: "Músculo", chave: "Carne Bovina Musculo" },
  { nome: "Costela Gaúcha", chave: "Carne Bovina Costela Gaucha" },
  { nome: "Peixinho", chave: "Carne Bovina Peixinho" },
  { nome: "Rabada", chave: "Carne Bovina Rabada" },
  { nome: "Fígado", chave: "Figado Bovino" },
  { nome: "Peito", chave: "Peito De Vaca" },
  { nome: "Coração", chave: "Coracao Bovino" },
  { nome: "Chambari", chave: "Carne Bovina Chambari" },
];

const CODE_WIDTH = 20;
const PRICE_START = 13, PRICE_END = 17;

function normalizarTexto(s) {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

function extrairPreco(codigo) {
  const trecho = codigo.slice(PRICE_START, PRICE_END);
  if (!/^\d{4}$/.test(trecho)) return null;
  return parseInt(trecho, 10) / 100;
}

// Varre o txt inteiro e agrupa, por descrição normalizada, o conjunto de
// preços diferentes encontrados (normalmente só 1 — mais de 1 é o caso
// "ambíguo" tratado acima).
function indexarPrecos(txtContent) {
  const linhas = txtContent.split(/\r?\n/);
  const porDescricao = new Map();
  for (const linha of linhas) {
    if (linha.length < CODE_WIDTH) continue;
    const codigo = linha.slice(0, CODE_WIDTH);
    const descOriginal = linha.slice(CODE_WIDTH).trim();
    if (!descOriginal) continue;
    const preco = extrairPreco(codigo);
    if (preco == null) continue;
    const chave = normalizarTexto(descOriginal);
    if (!porDescricao.has(chave)) porDescricao.set(chave, new Set());
    porDescricao.get(chave).add(preco);
  }
  return porDescricao;
}

function buscarPrecos(txtContent) {
  const porDescricao = indexarPrecos(txtContent);
  const resultado = {}; // nome do corte -> { status, preco?, duplicado?, precosEncontrados? }
  for (const corte of [...CORTES_PAGINA_1, ...CORTES_PAGINA_2]) {
    const chave = normalizarTexto(corte.chave);
    const precos = porDescricao.get(chave);
    if (!precos || precos.size === 0) {
      resultado[corte.nome] = { status: "nao_encontrado" };
    } else if (precos.size === 1) {
      resultado[corte.nome] = { status: "ok", preco: [...precos][0] };
    } else {
      // Duplicidade no Txitens.txt: a mesma descrição aparece em mais de uma
      // linha com preços diferentes (cadastro duplicado no PDV). Por decisão
      // explícita do usuário, o desempate usa sempre o MAIOR preço entre os
      // encontrados — mas o resultado continua marcado (`duplicado: true`)
      // para o controlador avisar que aquele valor foi escolhido por
      // desempate automático, não porque só existia uma opção.
      const precosEncontrados = [...precos].sort((a, b) => a - b);
      resultado[corte.nome] = {
        status: "ok",
        preco: Math.max(...precosEncontrados),
        duplicado: true,
        precosEncontrados,
      };
    }
  }
  return resultado;
}

// Diminui o tamanho da fonte até o texto caber na largura disponível.
function fonteQueCabe(ctx, texto, larguraMax, tamanhoInicial) {
  let tamanho = tamanhoInicial;
  while (tamanho > 14) {
    ctx.font = `bold ${tamanho}px ${FONT_FAMILY}`;
    if (ctx.measureText(texto).width <= larguraMax) return tamanho;
    tamanho -= 2;
  }
  return 14;
}

async function desenharPagina(templatePath, cortes, precos, caminhoSaida) {
  garantirFonte();
  const template = await loadImage(templatePath);
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(template, 0, 0); // imagem-base já com os nomes prontos — nunca redesenhados
  ctx.fillStyle = "#141414";
  ctx.textBaseline = "middle";

  // Título "Bovinos" no espaço em branco de cima.
  const tituloLarguraMax = (TITLE_X1 - TITLE_X0) - 60;
  const tamTitulo = fonteQueCabe(ctx, TITULO, tituloLarguraMax, 56);
  ctx.font = `bold ${tamTitulo}px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.fillText(TITULO, (TITLE_X0 + TITLE_X1) / 2, (TITLE_Y0 + TITLE_Y1) / 2);

  // Preço de cada corte (desenha sempre que status = "ok", inclusive quando
  // o valor veio de um desempate por duplicidade — ver buscarPrecos acima).
  const precoLarguraMax = (PRICE_X1 - PRICE_X0) - 30;
  const precoCentroX = (PRICE_X0 + PRICE_X1) / 2;
  cortes.forEach((corte, i) => {
    const info = precos[corte.nome];
    if (!info || info.status !== "ok") return;
    const [top, bottom] = ROW_BANDS[i];
    const meioY = (top + bottom) / 2;
    const precoTexto = `R$ ${info.preco.toFixed(2).replace(".", ",")}`;
    const tamPreco = fonteQueCabe(ctx, precoTexto, precoLarguraMax, 38);
    ctx.font = `bold ${tamPreco}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.fillText(precoTexto, precoCentroX, meioY);
  });

  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(caminhoSaida, buffer);
}

// Ponto de entrada: recebe o conteúdo do Txitens.txt (string) e a pasta onde
// salvar as imagens finais (a pasta `videos/` do VisionLoop). Devolve os
// nomes dos arquivos gerados + um resumo do que foi encontrado, resolvido
// por duplicidade (maior preço) ou não encontrado, para mostrar no
// controlador.
async function gerarTabelasPrecos(txtContent, pastaDestino) {
  const precos = buscarPrecos(txtContent);

  const encontrados = [];
  const duplicados = []; // preenchidos, mas por desempate (maior preço entre duplicatas)
  const naoEncontrados = [];
  for (const [nome, info] of Object.entries(precos)) {
    if (info.status === "ok" && info.duplicado) {
      duplicados.push({ nome, precoUsado: info.preco, precosEncontrados: info.precosEncontrados });
    } else if (info.status === "ok") {
      encontrados.push(nome);
    } else {
      naoEncontrados.push(nome);
    }
  }

  const paginas = [
    { key: "Tabela de Precos - Carnes Bovinas 1.png", template: path.join(ASSETS_DIR, "tabela-bovinos-1.png"), cortes: CORTES_PAGINA_1 },
    { key: "Tabela de Precos - Carnes Bovinas 2.png", template: path.join(ASSETS_DIR, "tabela-bovinos-2.png"), cortes: CORTES_PAGINA_2 },
  ];

  const imagens = [];
  for (const pagina of paginas) {
    const caminhoSaida = path.join(pastaDestino, pagina.key);
    await desenharPagina(pagina.template, pagina.cortes, precos, caminhoSaida);
    imagens.push({ key: pagina.key, localPath: caminhoSaida });
  }

  return { imagens, encontrados, duplicados, naoEncontrados };
}

module.exports = { gerarTabelasPrecos, buscarPrecos, normalizarTexto };
