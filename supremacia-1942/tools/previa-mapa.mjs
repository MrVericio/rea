/**
 * Gerador de prévia do mapa, sem navegador.
 *
 * Reproduz o mesmo desenho que o cliente faz no canvas, mas escrevendo um
 * arquivo SVG. Serve para duas coisas:
 *
 *   1. conferir a geometria dos hexagonos e a paleta sem abrir o jogo;
 *   2. documentar visualmente a campanha (a imagem acompanha o relatorio).
 *
 * Uso:  node tools/previa-mapa.mjs [dias] [semente] [arquivo.svg]
 */

import { writeFileSync } from "node:fs";
import { TERRENOS, DIRECOES } from "../server/world.mjs";
import { criarEstado, avancarDia, provinciasDaNacao, projetarEstado, definirJogador } from "../server/simulation.mjs";

const dias = Number(process.argv[2] ?? 0);
const semente = Number(process.argv[3] ?? 1942);
const saida = process.argv[4] ?? "previa-do-mapa.svg";

// ── Geometria: iguais às do cliente (hexágono flat-top de lado 1) ──
const RAIO = 46;          // pixels por unidade do mapa
const MARGEM = 40;
const CANTOS = Array.from({ length: 6 }, (_, k) => {
  const angulo = (Math.PI / 180) * (60 * k);
  return { x: Math.cos(angulo), y: Math.sin(angulo) };
});
// Cada direção toca os dois cantos daquele lado — a mesma tabela do cliente
const CANTOS_POR_DIRECAO = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];

const estado = criarEstado(semente);
const retrato = projetarEstado(estado, "ninguem");
definirJogador(estado, "observador", null);
for (let i = 0; i < dias; i += 1) avancarDia(estado);
const final = projetarEstado(estado, "observador");

const provincias = final.provincias;
const porId = new Map(provincias.map((p) => [p.id, p]));
const porChave = new Map(provincias.map((p) => [`${p.q},${p.r}`, p]));
const nacaoPorId = new Map(final.nacoes.map((n) => [n.id, n]));

const minimoX = Math.min(...provincias.map((p) => p.x)) - 1.2;
const maximoX = Math.max(...provincias.map((p) => p.x)) + 1.2;
const minimoY = Math.min(...provincias.map((p) => p.y)) - 1.2;
const maximoY = Math.max(...provincias.map((p) => p.y)) + 1.2;
const largura = Math.round((maximoX - minimoX) * RAIO + MARGEM * 2);
const altura = Math.round((maximoY - minimoY) * RAIO + MARGEM * 2);
const paraTela = (x, y) => ({
  x: (x - minimoX) * RAIO + MARGEM,
  y: (y - minimoY) * RAIO + MARGEM,
});

const escapar = (texto) => String(texto).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const numero = (n) => Math.round(n * 100) / 100;

/** Mistura a cor da nação com o papel do mapa — igual ao cliente. */
function misturarComPapel(cor, quantidade) {
  const hex = cor.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const m = (a, p) => Math.round(a * quantidade + p * (1 - quantidade));
  return `rgb(${m(r, 230)},${m(g, 222)},${m(b, 198)})`;
}

const pontosDoHexagono = (provincia) => {
  const tela = paraTela(provincia.x, provincia.y);
  return CANTOS.map((canto) => `${numero(tela.x + canto.x * RAIO)},${numero(tela.y + canto.y * RAIO)}`).join(" ");
};

const pedacos = [];
// O SVG usa cores planas de propósito: aqui o objetivo é conferir geometria e
// paleta. No jogo de verdade o cliente pinta o mesmo mapa no canvas, com
// gradientes e manchas de papel envelhecido.
pedacos.push(`<rect width="${largura}" height="${altura}" fill="#dfd4b6"/>`);

for (let i = 0; i < 26; i += 1) {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12345.6789;
  const c = Math.sin(i * 39.425) * 9876.5432;
  const fx = a - Math.floor(a);
  const fy = b - Math.floor(b);
  const raio = (0.04 + (c - Math.floor(c)) * 0.16) * Math.max(largura, altura);
  const forca = (0.05 + (b - Math.floor(b)) * 0.09).toFixed(3);
  pedacos.push(`<circle cx="${numero(fx * largura)}" cy="${numero(fy * altura)}" r="${numero(raio)}" fill="#78603a" fill-opacity="${forca}"/>`);
}

// 1. Territórios
for (const provincia of provincias) {
  const cor = provincia.dono === null ? "#9aa08c" : nacaoPorId.get(provincia.dono)?.cor ?? "#9aa08c";
  pedacos.push(`<polygon points="${pontosDoHexagono(provincia)}" fill="${misturarComPapel(cor, 0.62)}"/>`);
}

// 2. Glifos de terreno (mesmas posições do cliente)
const GLIFOS = {
  planicie: [{ x: 0, y: -0.16 }, { x: -0.24, y: 0.18 }, { x: 0.24, y: 0.14 }],
  floresta: [{ x: 0, y: -0.2 }, { x: -0.26, y: 0.1 }, { x: 0.26, y: 0.12 }, { x: 0.02, y: 0.34 }],
  montanha: [{ x: 0, y: 0.1 }, { x: -0.3, y: 0.22 }, { x: 0.3, y: 0.2 }],
  deserto: [{ x: -0.16, y: -0.14 }, { x: 0.2, y: -0.02 }, { x: -0.24, y: 0.22 }, { x: 0.16, y: 0.26 }],
  cidade: [{ x: 0, y: 0 }, { x: -0.3, y: 0.24 }, { x: 0.3, y: 0.24 }],
};
const TRAÇO = "rgba(74,61,41,0.34)";
const lado = RAIO * 0.26;
for (const provincia of provincias) {
  const tela = paraTela(provincia.x, provincia.y);
  const glifos = GLIFOS[provincia.terreno] ?? GLIFOS.planicie;
  const marcas = glifos.map((d) => {
    const cx = tela.x + d.x * RAIO;
    const cy = tela.y + d.y * RAIO;
    switch (provincia.terreno) {
      case "montanha":
        return `<path d="M${numero(cx - lado * 0.6)},${numero(cy + lado * 0.42)} L${numero(cx)},${numero(cy - lado * 0.44)} L${numero(cx + lado * 0.6)},${numero(cy + lado * 0.42)}" fill="none" stroke="${TRAÇO}"/>`;
      case "floresta":
        return `<path d="M${numero(cx - lado * 0.42)},${numero(cy + lado * 0.4)} L${numero(cx)},${numero(cy - lado * 0.48)} L${numero(cx + lado * 0.42)},${numero(cy + lado * 0.4)} Z" fill="rgba(74,61,41,0.16)" stroke="${TRAÇO}"/>`;
      case "deserto":
        return `<circle cx="${numero(cx)}" cy="${numero(cy)}" r="${numero(lado * 0.11)}" fill="rgba(74,61,41,0.16)" stroke="${TRAÇO}"/>`;
      case "cidade":
        return `<rect x="${numero(cx - lado * 0.36)}" y="${numero(cy - lado * 0.3)}" width="${numero(lado * 0.72)}" height="${numero(lado * 0.66)}" fill="rgba(74,61,41,0.16)" stroke="${TRAÇO}"/>`;
      default:
        return `<path d="M${numero(cx - lado * 0.4)},${numero(cy)} L${numero(cx + lado * 0.4)},${numero(cy)}" stroke="${TRAÇO}"/>`;
    }
  }).join("");
  pedacos.push(marcas);
}

// 3. Malha e fronteiras (usa exatamente a tabela de cantos por direção)
for (const provincia of provincias) {
  pedacos.push(`<polygon points="${pontosDoHexagono(provincia)}" fill="none" stroke="rgba(74,61,41,0.13)" stroke-width="0.8"/>`);
}
for (const provincia of provincias) {
  for (let d = 0; d < 6; d += 1) {
    const direcao = DIRECOES[d];
    const vizinha = porChave.get(`${provincia.q + direcao.q},${provincia.r + direcao.r}`);
    const muda = vizinha === undefined ? true : vizinha.dono !== provincia.dono;
    if (!muda) continue;
    const tela = paraTela(provincia.x, provincia.y);
    const [ca, cb] = CANTOS_POR_DIRECAO[d];
    const pa = { x: tela.x + CANTOS[ca].x * RAIO, y: tela.y + CANTOS[ca].y * RAIO };
    const pb = { x: tela.x + CANTOS[cb].x * RAIO, y: tela.y + CANTOS[cb].y * RAIO };
    const costa = vizinha === undefined;
    pedacos.push(`<line x1="${numero(pa.x)}" y1="${numero(pa.y)}" x2="${numero(pb.x)}" y2="${numero(pb.y)}" stroke="${costa ? "rgba(56,44,28,0.85)" : "rgba(48,38,24,0.62)"}" stroke-width="${costa ? 2.4 : 1.7}"/>`);
  }
}

// 4. Rotas marítimas: linha pontilhada azul sobre a água
const rotasVistas = new Set();
for (const provincia of provincias) {
  for (const id of provincia.vizinhosMaritimos ?? []) {
    const chave = [provincia.id, id].sort().join("|");
    if (rotasVistas.has(chave)) continue;
    rotasVistas.add(chave);
    const outra = porId.get(id);
    const a = paraTela(provincia.x, provincia.y);
    const b = paraTela(outra.x, outra.y);
    const meioX = (a.x + b.x) / 2;
    const meioY = (a.y + b.y) / 2;
    let normalX = -(b.y - a.y);
    let normalY = b.x - a.x;
    const tamanho = Math.hypot(normalX, normalY) || 1;
    normalX = (normalX / tamanho) * 14;
    normalY = (normalY / tamanho) * 14;
    pedacos.push(`<path d="M${numero(a.x)},${numero(a.y)} Q${numero(meioX + normalX)},${numero(meioY + normalY)} ${numero(b.x)},${numero(b.y)}" fill="none" stroke="rgba(58,116,166,0.3)" stroke-width="1.6" stroke-dasharray="6 7"/>`);
  }
}

// 5. Símbolos: capital, fortificação, construções e guarnição
for (const provincia of provincias) {
  const tela = paraTela(provincia.x, provincia.y);
  const nacao = provincia.dono === null ? null : nacaoPorId.get(provincia.dono);

  if (nacao !== null && nacao?.capital === provincia.nome) {
    const raio = RAIO * 0.24;
    const pontos = Array.from({ length: 10 }, (_, i) => {
      const angulo = -Math.PI / 2 + (Math.PI / 5) * i;
      const r = i % 2 === 0 ? raio : raio * 0.44;
      return `${numero(tela.x + Math.cos(angulo) * r)},${numero(tela.y - RAIO * 0.62 + Math.sin(angulo) * r)}`;
    }).join(" ");
    pedacos.push(`<polygon points="${pontos}" fill="rgba(201,162,39,0.95)" stroke="rgba(40,30,12,0.9)" stroke-width="1"/>`);
  }

  const fortificacao = provincia.fortificacao ?? 0;
  if (fortificacao > 0) {
    const x = tela.x + RAIO * 0.55;
    const y = tela.y + RAIO * 0.16;
    const r = RAIO * 0.22;
    pedacos.push(`<path d="M${numero(x - r * 0.8)},${numero(y - r * 0.8)} L${numero(x + r * 0.8)},${numero(y - r * 0.8)} L${numero(x + r * 0.8)},${numero(y + r * 0.2)} L${numero(x)},${numero(y + r * 0.95)} L${numero(x - r * 0.8)},${numero(y + r * 0.2)} Z" fill="rgba(40,50,58,0.9)" stroke="#c9a227" stroke-width="1.2"/>`);
    pedacos.push(`<text x="${numero(x)}" y="${numero(y + r * 0.5)}" font-family="monospace" font-size="13" font-weight="bold" fill="#e2c157" text-anchor="middle">${fortificacao}</text>`);
  }

  const construcoes = Object.entries(provincia.construcoes).filter(([, nivel]) => nivel > 0);
  if (construcoes.length > 0) {
    const tamanho = 8;
    const espacamento = 12;
    const total = construcoes.length * espacamento - (espacamento - tamanho);
    let x = tela.x - total / 2;
    const y = tela.y - RAIO * 0.52;
    for (const [id, nivel] of construcoes) {
      const CORES = { dinheiro: "#c9a227", comida: "#7cb342", aco: "#9fb3c0", petroleo: "#5b8fa8", carvao: "#8d6e63" };
      const definicao = { fazenda: "comida", siderurgica: "aco", pocoPetroleo: "petroleo", minaCarvao: "carvao", comercio: "dinheiro" };
      pedacos.push(`<rect x="${numero(x)}" y="${numero(y)}" width="${tamanho}" height="${tamanho}" rx="2" fill="rgba(20,26,30,0.82)"/>`);
      pedacos.push(`<rect x="${numero(x + 1.6)}" y="${numero(y + 1.6)}" width="${tamanho - 3.2}" height="${tamanho - 3.2}" fill="${CORES[definicao[id]] ?? "#c9a227"}"/>`);
      pedacos.push(`<text x="${numero(x + tamanho / 2)}" y="${numero(y + tamanho - 1.6)}" font-family="monospace" font-size="7" font-weight="bold" fill="#0d1114" text-anchor="middle">${nivel}</text>`);
      x += espacamento;
    }
  }

  const unidades = Object.entries(provincia.unidades).filter(([, n]) => n > 0);
  if (unidades.length > 0) {
    const cor = nacao?.cor ?? "#666";
    const rotulos = unidades.map(([tipo, n]) => `${tipo.slice(0, 3).toUpperCase()} ${n}`);
    const larguraRotulo = Math.max(...rotulos.map((r) => r.length * 7.6 + 12));
    const x = tela.x - larguraRotulo / 2;
    const y = tela.y + RAIO * 0.42;
    pedacos.push(`<rect x="${numero(x)}" y="${numero(y)}" width="${numero(larguraRotulo)}" height="19" rx="9" fill="rgba(20,26,30,0.9)" stroke="${cor}" stroke-width="1.4"/>`);
    pedacos.push(`<text x="${numero(tela.x)}" y="${numero(y + 13.5)}" font-family="monospace" font-size="11" font-weight="bold" fill="#f2f6f8" text-anchor="middle">${escapar(rotulos.join("  "))}</text>`);
  }

  // Nome da província, sempre legível sobre o papel
  pedacos.push(`<text x="${numero(tela.x)}" y="${numero(tela.y - RAIO * 0.62)}" font-family="monospace" font-size="11" font-weight="bold" fill="rgba(255,255,255,0.72)" text-anchor="middle">${escapar(provincia.nome)}</text>`);
  pedacos.push(`<text x="${numero(tela.x - 0.6)}" y="${numero(tela.y - RAIO * 0.62 - 0.6)}" font-family="monospace" font-size="11" font-weight="bold" fill="#2b2416" text-anchor="middle">${escapar(provincia.nome)}</text>`);
}

// 6. Batalhas
for (const batalha of final.batalhas) {
  const provincia = porId.get(batalha.provinciaId);
  if (provincia === undefined) continue;
  const tela = paraTela(provincia.x, provincia.y);
  pedacos.push(`<circle cx="${numero(tela.x)}" cy="${numero(tela.y - 2)}" r="19" fill="rgba(207,91,74,0.22)" stroke="rgba(207,91,74,0.85)" stroke-width="2"/>`);
  pedacos.push(`<path d="M${numero(tela.x - 8)},${numero(tela.y - 10)} L${numero(tela.x + 8)},${numero(tela.y + 6)} M${numero(tela.x + 8)},${numero(tela.y - 10)} L${numero(tela.x - 8)},${numero(tela.y + 6)}" stroke="#f4ece0" stroke-width="2.4"/>`);
}

// 7. Vinheta + rodapé com a legenda das nações
pedacos.push(`<rect x="3" y="3" width="${largura - 6}" height="${altura - 6}" fill="none" stroke="#241a0c" stroke-opacity="0.5" stroke-width="7"/>`);

const faixa = 34;
const porNacao = new Map();
for (const provincia of provincias) {
  const atual = porNacao.get(provincia.dono) ?? { provincias: 0, forca: 0 };
  atual.provincias += 1;
  atual.forca += Object.values(provincia.unidades).reduce((a, b) => a + b, 0);
  porNacao.set(provincia.dono, atual);
}
const ordenadas = [...porNacao.entries()].sort((a, b) => b[1].provincias - a[1].provincias);
let x = 14;
pedacos.push(`<rect x="0" y="${altura - faixa}" width="${largura}" height="${faixa}" fill="#0c1114"/>`);
for (const [id, dados] of ordenadas) {
  const nacao = nacaoPorId.get(id);
  if (nacao === undefined) continue;
  pedacos.push(`<rect x="${x}" y="${altura - faixa + 10}" width="14" height="14" rx="3" fill="${nacao.cor}" stroke="rgba(0,0,0,0.5)"/>`);
  const texto = `${nacao.nome} ${dados.provincias}`;
  pedacos.push(`<text x="${x + 20}" y="${altura - faixa + 21}" font-family="monospace" font-size="12" fill="#c3ced6">${escapar(texto)}</text>`);
  x += 26 + texto.length * 7.4;
}
pedacos.push(`<text x="${largura - 14}" y="${altura - faixa + 21}" font-family="monospace" font-size="12" fill="#8ea1ad" text-anchor="end">dia ${final.dia}${final.vencedor === null ? "" : ` · venceu ${escapar(final.vencedorNome)}`}</text>`);

const alturaFinal = altura;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${alturaFinal}" viewBox="0 0 ${largura} ${alturaFinal}">
${pedacos.join("\n")}
</svg>`;
writeFileSync(saida, svg);
console.log(`Prévia escrita em ${saida} (${largura}x${alturaFinal}) — dia ${final.dia}`);
