/**
 * Supremacia 1942 — Cliente
 *
 * Este arquivo NAO conhece nenhuma regra do jogo. Ele nao sabe quanto custa
 * um blindado, nao soma producao e nao resolve combate. Ele faz tres coisas:
 * desenhar o retrato que o servidor mandou, coletar cliques e enviar comandos.
 * Quando o servidor recusa um comando, o motivo aparece na tela.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Ligação com o servidor
// ─────────────────────────────────────────────────────────────────────────────

const INTERVALO_DE_ENVIO_MS = 200;

let socket = null;
let estado = null;              // ultimo retrato recebido
let velocidadeAtual = 1;
let instanteDoEstado = performance.now();
let jogadorId = localStorage.getItem("supremacia1942:jogador");
let jaRecebeuBemVindo = false;
let tentativasDeReconexao = 0;

function conectar() {
  const protocolo = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocolo}://${location.host}`);
  const indicador = document.getElementById("indicador");
  indicador.classList.remove("ligado");
  indicador.title = "Conectando…";

  socket.addEventListener("open", () => {
    tentativasDeReconexao = 0;
    indicador.classList.add("ligado");
    indicador.title = "Conectado ao servidor";
    enviar({ tipo: "entrar", jogadorId, nome: localStorage.getItem("supremacia1942:nome") ?? "" });
  });

  socket.addEventListener("message", (evento) => {
    let mensagem;
    try { mensagem = JSON.parse(evento.data); } catch { return; }
    tratarMensagem(mensagem);
  });

  const caiu = () => {
    indicador.classList.remove("ligado");
    indicador.title = "Desconectado — tentando reconectar";
    tentativasDeReconexao += 1;
    setTimeout(conectar, Math.min(6000, 700 * tentativasDeReconexao));
  };
  socket.addEventListener("close", caiu);
  socket.addEventListener("error", () => {});
}

function enviar(mensagem) {
  if (socket !== null && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(mensagem));
  } else {
    brindar("Sem conexão com o servidor.", true);
  }
}

/** Envia um comando. Toda a validação acontece do outro lado. */
function enviarComando(comando) {
  enviar({ tipo: "comando", comando, referencia: Date.now() });
}

function tratarMensagem(mensagem) {
  switch (mensagem.tipo) {
    case "bemVindo":
      jogadorId = mensagem.jogadorId;
      localStorage.setItem("supremacia1942:jogador", jogadorId);
      velocidadeAtual = mensagem.velocidade;
      jaRecebeuBemVindo = true;
      break;

    case "estado":
      estado = mensagem.estado;
      instanteDoEstado = performance.now();
      if (mensagem.velocidade !== undefined) velocidadeAtual = mensagem.velocidade;
      aoAtualizarEstado();
      break;

    case "velocidade":
      velocidadeAtual = mensagem.valor;
      pintarControlesDeTempo();
      break;

    case "resultado":
      brindar(mensagem.texto, mensagem.ok === false);
      if (mensagem.ok) {
        // Uma acao bem-sucedida muda o estado: o servidor ja mandara o novo
        // retrato, mas limpamos selecoes que deixaram de fazer sentido.
        if (mensagem.comando?.tipo === "mover") sairDoModoDeMovimento();
      }
      break;

    case "erro":
      brindar(mensagem.motivo, true);
      break;

    case "fimDeJogo":
      mostrarFimDeJogo(mensagem.nacaoId);
      break;

    case "nacaoEscolhida":
      fecharModal();
      brindar(`Você assumiu o comando da ${mensagem.nome}.`);
      break;

    case "campanhaReiniciada":
      fimDeJogoMostrado = false;
      jaEnquadrou = false;
      provinciaSelecionada = null;
      precisaEscolher = true;
      brindar(`Campanha ${mensagem.campanha} começou: mundo novo, todas as nações de volta ao mapa.`);
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function escaparHtml(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

const numero = (v) => {
  const n = Number(v ?? 0);
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1).replace(".0", "") + "k";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
};

const numeroCheio = (v) => Number(v ?? 0).toFixed(Math.abs(Number(v ?? 0)) < 10 && !Number.isInteger(Number(v ?? 0)) ? 1 : 0);

const ICONES = {
  dinheiro: "M4 9h16v9H4zM4 9l3-4h10l3 4M9 13h6",
  comida: "M7 20c0-6 2-9 5-9s5 3 5 9M9 12c-1-3-3-4-5-4M15 12c1-3 3-4 5-4",
  aco: "M4 17L17 4l3 3L7 20H4zM11 10l3 3",
  petroleo: "M6 20V6l5-3 5 3v14M9 20v-5h4v5M6 10h10",
  carvao: "M12 20l-6-4 2-6 6-2 4 5-2 6zM10 12l4 1",
};

const CORES_DOS_RECURSOS = {
  dinheiro: "#c9a227",
  comida: "#7cb342",
  aco: "#9fb3c0",
  petroleo: "#5b8fa8",
  carvao: "#8d6e63",
};

function svgDoRecurso(recurso, tamanho = 16) {
  return `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none"
    stroke="${CORES_DOS_RECURSOS[recurso] ?? "#fff"}" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round"><path d="${ICONES[recurso] ?? ""}"/></svg>`;
}

let relogioDoBrinde = null;
function brindar(texto, ruim = false) {
  const caixa = $("brinde");
  caixa.textContent = texto;
  caixa.classList.remove("escondido");
  caixa.classList.toggle("erro", Boolean(ruim));
  requestAnimationFrame(() => caixa.classList.add("visivel"));
  clearTimeout(relogioDoBrinde);
  relogioDoBrinde = setTimeout(() => {
    caixa.classList.remove("visivel");
    setTimeout(() => caixa.classList.add("escondido"), 240);
  }, ruim ? 4200 : 2600);
}

let relogioDoAviso = null;
function avisarNoMapa(texto, ruim = false) {
  const caixa = $("avisoDeDestino");
  caixa.textContent = texto;
  caixa.classList.add("visivel");
  caixa.classList.toggle("ruim", Boolean(ruim));
  clearTimeout(relogioDoAviso);
  if (texto !== "") relogioDoAviso = setTimeout(() => caixa.classList.remove("visivel"), 4000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometria dos hexagonos (flat-top, lado 1 — igual ao servidor)
// ─────────────────────────────────────────────────────────────────────────────

const CANTOS = Array.from({ length: 6 }, (_, k) => {
  const angulo = (Math.PI / 180) * (60 * k);
  return { x: Math.cos(angulo), y: Math.sin(angulo) };
});

/** Cada direcao toca duas arestas (os dois cantos daquele lado). */
const CANTOS_POR_DIRECAO = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];

/** Converte um ponto do mundo em coordenadas axiais fracionarias. */
function pixelParaAxial(x, y) {
  const q = (2 / 3) * x;
  const r = y / Math.sqrt(3) - q / 2;
  return { q, r };
}

/** Arredonda coordenadas axiais fracionarias para o hexagono mais proximo. */
function arredondarAxial(q, r) {
  const x = q;
  const z = r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

// ─────────────────────────────────────────────────────────────────────────────
// Câmera e canvas
// ─────────────────────────────────────────────────────────────────────────────

const canvas = $("mapa");
const ctx = canvas.getContext("2d");

const camera = { x: 20, y: 15, escala: 34, destinoEscala: 34 };
let ponteiro = { x: 0, y: 0, dentro: false };
let arrastando = false;
let arrastou = false;
let inicioDoArrasto = { x: 0, y: 0, cameraX: 0, cameraY: 0 };
let mostrarRotulos = true;

let larguraCss = 0;
let alturaCss = 0;

function dimensionarCanvas() {
  const retangulo = canvas.getBoundingClientRect();
  const densidade = Math.min(2, window.devicePixelRatio || 1);
  larguraCss = retangulo.width;
  alturaCss = retangulo.height;
  canvas.width = Math.round(retangulo.width * densidade);
  canvas.height = Math.round(retangulo.height * densidade);
  ctx.setTransform(densidade, 0, 0, densidade, 0, 0);
}

const mundoParaTela = (x, y) => ({
  x: (x - camera.x) * camera.escala + larguraCss / 2,
  y: (y - camera.y) * camera.escala + alturaCss / 2,
});

const telaParaMundo = (x, y) => ({
  x: (x - larguraCss / 2) / camera.escala + camera.x,
  y: (y - alturaCss / 2) / camera.escala + camera.y,
});

function centralizarEm(x, y) { camera.x = x; camera.y = y; }

function ajustarParaMeuTerritorio() {
  if (estado === null) return;
  const minhas = estado.provincias.filter((p) => p.dono === estado.minhaNacao);
  if (minhas.length === 0) return;
  const xs = minhas.map((p) => p.x);
  const ys = minhas.map((p) => p.y);
  const largura = Math.max(...xs) - Math.min(...xs) + 2;
  const altura = Math.max(...ys) - Math.min(...ys) + 2;
  camera.x = (Math.min(...xs) + Math.max(...xs)) / 2;
  camera.y = (Math.min(...ys) + Math.max(...ys)) / 2;
  camera.destinoEscala = Math.max(16, Math.min(52, Math.min(larguraCss / largura, alturaCss / altura)));
  camera.escala = camera.destinoEscala;
}

// ─────────────────────────────────────────────────────────────────────────────
// Índices (recalculados quando o estado chega)
// ─────────────────────────────────────────────────────────────────────────────

let porChaveAxial = new Map();
let porId = new Map();
let assinaturaDeDonos = "";

function reindexar() {
  porChaveAxial = new Map();
  porId = new Map();
  for (const provincia of estado.provincias) {
    porChaveAxial.set(`${provincia.q},${provincia.r}`, provincia);
    porId.set(provincia.id, provincia);
  }
  const assinatura = estado.provincias.map((p) => `${p.dono}`).join("");
  assinaturaDeDonos = assinatura;

  const nacaoPorId = new Map(estado.nacoes.map((n) => [n.id, n]));
  const terreno = {};
  for (const p of estado.provincias) terreno[p.id] = p.terreno;
  void terreno;
  return nacaoPorId;
}

function corDoDono(idNacao) {
  if (estado === null) return "#7b8b95";
  const nacao = estado.nacoes.find((n) => n.id === idNacao);
  return nacao === undefined ? "#7b8b95" : nacao.cor;
}

function nomeDaNacao(idNacao) {
  if (estado === null) return "—";
  const nacao = estado.nacoes.find((n) => n.id === idNacao);
  return nacao === undefined ? "Território livre" : nacao.nome;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seleção e estados de interação
// ─────────────────────────────────────────────────────────────────────────────

let provinciaSelecionada = null;
let provinciaSobOPonteiro = null;
let modoDeMovimento = null;     // { origemId, unidades: { tipo: n } }
let tiposDeMovimento = {};      // selecao atual de tipos no painel
let quantidadesParaRecrutar = {}; // memoria dos campos de recrutamento
let abaAtiva = "provincia";
let fimDeJogoMostrado = false;
let precisaEscolher = false; // a campanha reiniciou: é hora de escolher de novo

function sairDoModoDeMovimento() {
  modoDeMovimento = null;
  tiposDeMovimento = {};
  canvas.classList.remove("atacando");
  avisarNoMapa("");
  pintarPainelDeProvincia();
}

/**
 * O painel e reconstruido a cada retrato do servidor (5x por segundo). Sem
 * isto, o campo onde o jogador digita seria recriado no meio da digitacao.
 * Guardamos o valor e devolvemos o foco ao mesmo campo depois de repintar.
 */
function lembrar() {
  const ativo = document.activeElement;
  if (!(ativo instanceof HTMLInputElement)) return null;
  if (ativo.dataset.recrutar !== undefined) return { chave: `r:${ativo.dataset.recrutar}`, inicio: ativo.selectionStart };
  if (ativo.dataset.tipo !== undefined) return { chave: `t:${ativo.dataset.tipo}`, inicio: ativo.selectionStart };
  return null;
}

function restaurar(memoria) {
  if (memoria === null) return;
  const seletor = memoria.chave.startsWith("r:")
    ? `[data-recrutar="${CSS.escape(memoria.chave.slice(2))}"]`
    : `[data-tipo="${CSS.escape(memoria.chave.slice(2))}"]`;
  const campo = document.querySelector(seletor);
  if (campo === null) return;
  campo.focus();
  if (memoria.inicio !== null) { try { campo.setSelectionRange(memoria.inicio, memoria.inicio); } catch { /* numero nao aceita selecao */ } }
}

/**
 * Provincias que o servidor autorizou como destino, separadas por via.
 * Quem decide o alcance e o servidor; aqui so separamos terra de mar para
 * pintar as rotas com cores diferentes.
 */
function destinosPermitidos() {
  const vazio = { terra: new Set(), mar: new Set() };
  if (modoDeMovimento === null) return vazio;
  const origem = porId.get(modoDeMovimento.origemId);
  if (origem === undefined) return vazio;

  const terra = new Set();
  const mar = new Set();
  for (const [tipo, quantidade] of Object.entries(modoDeMovimento.unidades)) {
    if (quantidade <= 0) continue;
    for (const destino of origem.alcancePorUnidade?.[tipo] ?? []) terra.add(destino);
    for (const destino of origem.alcanceMaritimoPorUnidade?.[tipo] ?? []) mar.add(destino);
  }
  for (const destino of terra) mar.delete(destino);
  return { terra, mar };
}

/** Todas as provincias destacadas, independentemente da via. */
function todosOsDestinos() {
  const { terra, mar } = destinosPermitidos();
  return new Set([...terra, ...mar]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Desenho do mapa
// ─────────────────────────────────────────────────────────────────────────────

/** Manchas do papel, calculadas uma vez (dão o aspecto de mapa envelhecido). */
const manchas = Array.from({ length: 26 }, (_, i) => {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12345.6789;
  const c = Math.sin(i * 39.425) * 9876.5432;
  return {
    x: a - Math.floor(a),
    y: b - Math.floor(b),
    raio: 0.04 + (c - Math.floor(c)) * 0.16,
    forca: 0.03 + (b - Math.floor(b)) * 0.06,
  };
});

function desenharPapel() {
  const gradiente = ctx.createRadialGradient(
    larguraCss * 0.5, alturaCss * 0.42, 40,
    larguraCss * 0.5, alturaCss * 0.5, Math.max(larguraCss, alturaCss) * 0.78,
  );
  gradiente.addColorStop(0, "#e9e0c8");
  gradiente.addColorStop(0.62, "#ddd2b3");
  gradiente.addColorStop(1, "#c3b795");
  ctx.fillStyle = gradiente;
  ctx.fillRect(0, 0, larguraCss, alturaCss);

  ctx.save();
  for (const mancha of manchas) {
    const gradienteDaMancha = ctx.createRadialGradient(
      mancha.x * larguraCss, mancha.y * alturaCss, 0,
      mancha.x * larguraCss, mancha.y * alturaCss, mancha.raio * Math.max(larguraCss, alturaCss),
    );
    gradienteDaMancha.addColorStop(0, `rgba(120,96,58,${mancha.forca})`);
    gradienteDaMancha.addColorStop(1, "rgba(120,96,58,0)");
    ctx.fillStyle = gradienteDaMancha;
    ctx.fillRect(0, 0, larguraCss, alturaCss);
  }
  ctx.restore();
}

/** Mistura uma cor hex com o papel, para o mapa não ficar com cores chapadas. */
function misturarComPapel(cor, quantidade) {
  const hex = cor.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const pr = 230, pg = 222, pb = 198;
  const m = (a, p) => Math.round(a * quantidade + p * (1 - quantidade));
  return `rgb(${m(r, pr)},${m(g, pg)},${m(b, pb)})`;
}

function desenharHexagono(x, y, escala, deslocamento = 0) {
  const tela = mundoParaTela(x, y);
  const raio = escala * (1 + deslocamento);
  ctx.beginPath();
  for (let k = 0; k < 6; k += 1) {
    const px = tela.x + Math.cos((Math.PI / 180) * (60 * k)) * raio;
    const py = tela.y + Math.sin((Math.PI / 180) * (60 * k)) * raio;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

const GLIFOS = {
  planicie: [{ x: 0, y: -0.16 }, { x: -0.24, y: 0.18 }, { x: 0.24, y: 0.14 }],
  floresta: [{ x: 0, y: -0.2 }, { x: -0.26, y: 0.1 }, { x: 0.26, y: 0.12 }, { x: 0.02, y: 0.34 }],
  montanha: [{ x: 0, y: 0.1 }, { x: -0.3, y: 0.22 }, { x: 0.3, y: 0.2 }],
  deserto: [{ x: -0.16, y: -0.14 }, { x: 0.2, y: -0.02 }, { x: -0.24, y: 0.22 }, { x: 0.16, y: 0.26 }],
  cidade: [{ x: 0, y: 0 }, { x: -0.3, y: 0.24 }, { x: 0.3, y: 0.24 }],
};

function desenharGlifosDeTerreno(provincia, escala) {
  if (escala < 21) return;
  const tela = mundoParaTela(provincia.x, provincia.y);
  const lista = GLIFOS[provincia.terreno] ?? GLIFOS.planicie;
  const lado = Math.min(9, escala * 0.26);
  ctx.save();
  ctx.strokeStyle = "rgba(74,61,41,0.34)";
  ctx.fillStyle = "rgba(74,61,41,0.16)";
  ctx.lineWidth = 1;
  for (const deslocamento of lista) {
    const cx = tela.x + deslocamento.x * escala;
    const cy = tela.y + deslocamento.y * escala;
    ctx.beginPath();
    switch (provincia.terreno) {
      case "montanha":
        ctx.moveTo(cx - lado * 0.6, cy + lado * 0.42);
        ctx.lineTo(cx, cy - lado * 0.44);
        ctx.lineTo(cx + lado * 0.6, cy + lado * 0.42);
        break;
      case "floresta":
        ctx.moveTo(cx - lado * 0.42, cy + lado * 0.4);
        ctx.lineTo(cx, cy - lado * 0.48);
        ctx.lineTo(cx + lado * 0.42, cy + lado * 0.4);
        ctx.closePath();
        break;
      case "deserto":
        ctx.arc(cx, cy, lado * 0.11, 0, Math.PI * 2);
        break;
      case "cidade":
        ctx.rect(cx - lado * 0.36, cy - lado * 0.3, lado * 0.72, lado * 0.66);
        break;
      default: // planicie
        ctx.moveTo(cx - lado * 0.4, cy);
        ctx.lineTo(cx + lado * 0.4, cy);
    }
    if (provincia.terreno === "floresta" || provincia.terreno === "cidade") ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function desenharFronteiras(escala) {
  ctx.save();
  for (const provincia of estado.provincias) {
    for (let d = 0; d < 6; d += 1) {
      const direcao = estado.regras.direcoes[d];
      const vizinha = porChaveAxial.get(`${provincia.q + direcao.q},${provincia.r + direcao.r}`);
      const mudaDeDono = vizinha === undefined ? true : vizinha.dono !== provincia.dono;
      if (!mudaDeDono) continue;

      const [ca, cb] = CANTOS_POR_DIRECAO[d];
      const tela = mundoParaTela(provincia.x, provincia.y);
      const pa = { x: tela.x + CANTOS[ca].x * escala, y: tela.y + CANTOS[ca].y * escala };
      const pb = { x: tela.x + CANTOS[cb].x * escala, y: tela.y + CANTOS[cb].y * escala };

      if (vizinha === undefined) {
        // Costa: linha mais grossa e escura, como tinta sobre o litoral
        ctx.strokeStyle = "rgba(56,44,28,0.85)";
        ctx.lineWidth = 2.1;
      } else {
        ctx.strokeStyle = "rgba(48,38,24,0.62)";
        ctx.lineWidth = 1.5;
      }
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function desenharMalha(escala) {
  if (escala < 17) return;
  ctx.save();
  ctx.strokeStyle = "rgba(74,61,41,0.13)";
  ctx.lineWidth = 0.7;
  for (const provincia of estado.provincias) {
    desenharHexagono(provincia.x, provincia.y, escala);
    ctx.stroke();
  }
  ctx.restore();
}

function desenharUnidades(provincia, escala) {
  const tipos = Object.entries(provincia.unidades).filter(([, n]) => n > 0);
  if (tipos.length === 0) return;
  const tela = mundoParaTela(provincia.x, provincia.y);
  const total = tipos.reduce((soma, [, n]) => soma + n, 0);
  const cor = corDoDono(provincia.dono);

  const detalhado = escala >= 27;
  const conteudos = detalhado
    ? tipos.slice(0, 3).map(([tipo, n]) => {
        const definicao = estado.regras.unidades.find((u) => u.id === tipo);
        return `${definicao?.abrev ?? tipo} ${n}`;
      })
    : [`⚔ ${total}`];

  ctx.save();
  ctx.font = `600 ${detalhado ? 9 : 10}px ui-monospace, Menlo, monospace`;
  const larguras = conteudos.map((texto) => ctx.measureText(texto).width + 10);
  const larguraTotal = larguras.reduce((a, b) => a + b, 0) + (conteudos.length - 1) * 3;
  const altura = detalhado ? 15 : 16;
  let x = tela.x - larguraTotal / 2;
  const y = tela.y + escala * 0.42;

  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;

  for (let i = 0; i < conteudos.length; i += 1) {
    const largura = larguras[i];
    ctx.fillStyle = "rgba(20,26,30,0.9)";
    arredondado(x, y, largura, altura, 7);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#f2f6f8";
    ctx.fillText(conteudos[i], x + 5, y + altura - 4.4);
    ctx.strokeStyle = cor;
    ctx.lineWidth = 1.2;
    arredondado(x, y, largura, altura, 7);
    ctx.stroke();
    x += largura + 3;
    ctx.shadowColor = "rgba(0,0,0,0.4)";
  }
  ctx.restore();
}

function arredondado(x, y, largura, altura, raio) {
  const r = Math.min(raio, largura / 2, altura / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + largura, y, x + largura, y + altura, r);
  ctx.arcTo(x + largura, y + altura, x, y + altura, r);
  ctx.arcTo(x, y + altura, x, y, r);
  ctx.arcTo(x, y, x + largura, y, r);
  ctx.closePath();
}

/** Pequenas marcas de latão: uma por tipo de construção, com o nível. */
function desenharConstrucoes(provincia, escala) {
  if (escala < 25) return;
  const entradas = Object.entries(provincia.construcoes).filter(([, nivel]) => nivel > 0);
  if (entradas.length === 0) return;
  const tela = mundoParaTela(provincia.x, provincia.y);
  const tamanho = 6;
  const espacamento = 9;
  const total = entradas.length * espacamento - (espacamento - tamanho);
  let x = tela.x - total / 2;
  const y = tela.y - escala * 0.52;

  ctx.save();
  ctx.font = "600 7px ui-monospace, monospace";
  for (const [idConstrucao, nivel] of entradas) {
    const definicao = estado.regras.construcoes.find((c) => c.id === idConstrucao);
    ctx.fillStyle = "rgba(20,26,30,0.82)";
    arredondado(x, y, tamanho, tamanho, 2);
    ctx.fill();
    ctx.fillStyle = CORES_DOS_RECURSOS[definicao?.recurso] ?? "#c9a227";
    ctx.fillRect(x + 1.4, y + 1.4, tamanho - 2.8, tamanho - 2.8);
    ctx.fillStyle = "#0d1114";
    ctx.fillText(String(nivel), x + tamanho / 2 - 1.8, y + tamanho - 1.4);
    x += espacamento;
  }
  ctx.restore();
}

function desenharCapital(provincia, escala) {
  if (escala < 15) return;
  const tela = mundoParaTela(provincia.x, provincia.y);
  const raio = Math.min(8, escala * 0.24);
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angulo = -Math.PI / 2 + (Math.PI / 5) * i;
    const r = i % 2 === 0 ? raio : raio * 0.44;
    const px = tela.x + Math.cos(angulo) * r;
    const py = tela.y - escala * 0.62 + Math.sin(angulo) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(201,162,39,0.95)";
  ctx.strokeStyle = "rgba(40,30,12,0.9)";
  ctx.lineWidth = 0.9;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function desenharFortificacao(provincia, escala) {
  const nivel = provincia.fortificacao ?? 0;
  if (nivel <= 0 || escala < 20) return;
  const tela = mundoParaTela(provincia.x, provincia.y);
  const x = tela.x + escala * 0.55;
  const y = tela.y + escala * 0.16;
  const r = Math.min(8, escala * 0.22);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.8, y - r * 0.8);
  ctx.lineTo(x + r * 0.8, y - r * 0.8);
  ctx.lineTo(x + r * 0.8, y + r * 0.2);
  ctx.lineTo(x, y + r * 0.95);
  ctx.lineTo(x - r * 0.8, y + r * 0.2);
  ctx.closePath();
  ctx.fillStyle = "rgba(40,50,58,0.9)";
  ctx.fill();
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#e2c157";
  ctx.font = "700 8px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(String(nivel), x, y + r * 0.36);
  ctx.textAlign = "left";
  ctx.restore();
}

function desenharBatalhas(agora) {
  ctx.save();
  for (const batalha of estado.batalhas) {
    const provincia = porId.get(batalha.provinciaId);
    if (provincia === undefined) continue;
    const tela = mundoParaTela(provincia.x, provincia.y);
    const pulso = 0.5 + 0.5 * Math.sin(agora / 300);

    ctx.beginPath();
    ctx.arc(tela.x, tela.y - 2, 15 + pulso * 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(207,91,74,${0.13 + pulso * 0.13})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(207,91,74,${0.5 + pulso * 0.4})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Duas laminas cruzadas
    const r = 7;
    ctx.strokeStyle = "#f4ece0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tela.x - r, tela.y - 2 - r);
    ctx.lineTo(tela.x + r, tela.y - 2 + r);
    ctx.moveTo(tela.x + r, tela.y - 2 - r);
    ctx.lineTo(tela.x - r, tela.y - 2 + r);
    ctx.stroke();
  }
  ctx.restore();
}

function desenharRotulos(provincia, escala) {
  if (!mostrarRotulos || escala < 24) return;
  const tela = mundoParaTela(provincia.x, provincia.y);
  ctx.save();
  ctx.font = "600 9px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillText(provincia.nome, tela.x + 0.6, tela.y - escala * 0.62 + 0.6);
  ctx.fillStyle = "#2b2416";
  ctx.fillText(provincia.nome, tela.x, tela.y - escala * 0.62);
  ctx.textAlign = "left";
  ctx.restore();
}

/**
 * Linha pontilhada azul sobre a agua ligando duas provincias.
 * So desenhamos as rotas relevantes (selecao e movimento), senao o mapa
 * fica coberto de linhas cruzadas.
 */
function desenharRotaMaritima(origem, destino, { cor, largura, comprimentoDoTraco = 6 }) {
  const a = mundoParaTela(origem.x, origem.y);
  const b = mundoParaTela(destino.x, destino.y);
  ctx.save();
  ctx.strokeStyle = cor;
  ctx.lineWidth = largura;
  ctx.setLineDash([comprimentoDoTraco, 5]);
  ctx.lineCap = "round";
  // Leve curva, para a rota nao se confundir com a malha dos hexagonos
  const meioX = (a.x + b.x) / 2;
  const meioY = (a.y + b.y) / 2;
  const normalX = -(b.y - a.y);
  const normalY = b.x - a.x;
  const tamanho = Math.hypot(normalX, normalY) || 1;
  const curva = 10;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(meioX + (normalX / tamanho) * curva, meioY + (normalY / tamanho) * curva, b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function desenharRealce(provincia, escala, { cor, largura, tracejado, pulso = 0 }) {
  ctx.save();
  desenharHexagono(provincia.x, provincia.y, escala, pulso);
  ctx.strokeStyle = cor;
  ctx.lineWidth = largura;
  if (tracejado === true) ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.restore();
}

function desenhar() {
  if (estado === null) {
    desenharPapel();
    return;
  }
  const agora = performance.now();

  // Suaviza o zoom
  const diferenca = camera.destinoEscala - camera.escala;
  if (Math.abs(diferenca) > 0.05) camera.escala += diferenca * 0.18;
  const escala = camera.escala;

  desenharPapel();

  // 1. Territórios
  for (const provincia of estado.provincias) {
    const cor = provincia.dono === null ? "#9aa08c" : corDoDono(provincia.dono);
    ctx.fillStyle = misturarComPapel(cor, 0.62);
    desenharHexagono(provincia.x, provincia.y, escala);
    ctx.fill();
  }

  // 2. Textura e malha
  for (const provincia of estado.provincias) desenharGlifosDeTerreno(provincia, escala);
  desenharMalha(escala);

  // 3. Fronteiras nacionais
  desenharFronteiras(escala);

  // 4. Realces de interação
  const selecionada = provinciaSelecionada === null ? null : porId.get(provinciaSelecionada);
  const { terra: permitidosTerra, mar: permitidosMar } = destinosPermitidos();
  if (modoDeMovimento !== null) {
    const origem = porId.get(modoDeMovimento.origemId);
    if (origem !== undefined) {
      // Primeiro as rotas maritimas, para ficarem por baixo dos realces
      for (const destino of permitidosMar) {
        const provincia = porId.get(destino);
        if (provincia === undefined) continue;
        const inimiga = provincia.dono !== null && provincia.dono !== estado.minhaNacao;
        desenharRotaMaritima(origem, provincia, {
          cor: inimiga ? "rgba(214,110,80,0.85)" : "rgba(74,134,190,0.8)",
          largura: 1.8,
        });
      }
      desenharRealce(origem, escala, { cor: "rgba(201,162,39,0.95)", largura: 2.6 });
    }

    const pintar = (destino, inimiga, porMar) => {
      const provincia = porId.get(destino);
      if (provincia === undefined) return;
      ctx.save();
      desenharHexagono(provincia.x, provincia.y, escala);
      if (porMar) ctx.fillStyle = inimiga ? "rgba(214,110,80,0.22)" : "rgba(74,134,190,0.2)";
      else ctx.fillStyle = inimiga ? "rgba(207,91,74,0.24)" : "rgba(90,164,105,0.2)";
      ctx.fill();
      ctx.restore();
      desenharRealce(provincia, escala, {
        cor: porMar
          ? (inimiga ? "rgba(214,110,80,0.9)" : "rgba(74,134,190,0.9)")
          : (inimiga ? "rgba(207,91,74,0.9)" : "rgba(70,140,90,0.85)"),
        largura: 1.8,
        tracejado: true,
      });
    };
    for (const destino of permitidosMar) {
      pintar(destino, porId.get(destino)?.dono !== estado.minhaNacao, true);
    }
    for (const destino of permitidosTerra) {
      pintar(destino, porId.get(destino)?.dono !== estado.minhaNacao, false);
    }
  }

  // Rotas maritimas da provincia selecionada (quando ela nao esta em modo de movimento)
  if (modoDeMovimento === null && selecionada !== null && selecionada.dono === estado.minhaNacao) {
    for (const destino of selecionada.vizinhosMaritimos ?? []) {
      const provincia = porId.get(destino);
      if (provincia === undefined) continue;
      desenharRotaMaritima(selecionada, provincia, { cor: "rgba(74,134,190,0.42)", largura: 1.4, comprimentoDoTraco: 4 });
    }
  }

  if (selecionada !== undefined && selecionada !== null) {
    const pulso = 0.5 + 0.5 * Math.sin(agora / 420);
    desenharRealce(selecionada, escala, {
      cor: "rgba(201,162,39,0.95)",
      largura: 2.4,
      tracejado: true,
      pulso: pulso * 0.012,
    });
  }

  // 5. Símbolos
  for (const provincia of estado.provincias) {
    if (provincia.dono !== null && estado.nacoes.find((n) => n.id === provincia.dono)?.capital === provincia.nome) {
      desenharCapital(provincia, escala);
    }
    desenharConstrucoes(provincia, escala);
    desenharFortificacao(provincia, escala);
  }

  // 6. Unidades e nomes
  for (const provincia of estado.provincias) {
    desenharRotulos(provincia, escala);
    desenharUnidades(provincia, escala);
  }

  // 7. Batalhas e ponteiro
  desenharBatalhas(agora);

  if (ponteiro.dentro && !arrastando) {
    const sobre = provinciaSobOPonteiro;
    if (sobre !== undefined && sobre !== null && sobre !== selecionada) {
      desenharHexagono(sobre.x, sobre.y, escala);
      ctx.save();
      ctx.strokeStyle = "rgba(30,24,14,0.55)";
      ctx.lineWidth = 1.7;
      ctx.stroke();
      ctx.restore();
    }
  }

  // 8. Vinheta: o mapa termina nas bordas da mesa
  const vinheta = ctx.createRadialGradient(
    larguraCss / 2, alturaCss / 2, Math.min(larguraCss, alturaCss) * 0.34,
    larguraCss / 2, alturaCss / 2, Math.max(larguraCss, alturaCss) * 0.78,
  );
  vinheta.addColorStop(0, "rgba(20,14,6,0)");
  vinheta.addColorStop(1, "rgba(16,10,4,0.5)");
  ctx.fillStyle = vinheta;
  ctx.fillRect(0, 0, larguraCss, alturaCss);
}

// ─────────────────────────────────────────────────────────────────────────────
// Laço de desenho + relógio suave
// ─────────────────────────────────────────────────────────────────────────────

function lacoDeDesenho() {
  desenhar();
  atualizarRelogio();
  requestAnimationFrame(lacoDeDesenho);
}

let ultimoDiaMostrado = -1;
function atualizarRelogio() {
  if (estado === null) return;
  const decorrido = (performance.now() - instanteDoEstado) / 1000;
  const diasPorSegundo = estado.regras?.diasPorSegundo ?? 0.5;
  const estimado = estado.dia + Math.min(1, decorrido * diasPorSegundo * velocidadeAtual);
  const dia = Math.floor(estimado);
  if (dia !== ultimoDiaMostrado) {
    ultimoDiaMostrado = dia;
    $("dia").textContent = dia;
    $("dataHistorica").textContent = dataHistorica(dia);
  }
}

/** Converte o dia de jogo em uma data plausível da Segunda Guerra. */
function dataHistorica(dia) {
  const inicio = Date.UTC(1942, 0, 1);
  const data = new Date(inicio + dia * 86400000);
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${String(data.getUTCDate()).padStart(2, "0")} ${meses[data.getUTCMonth()]} ${data.getUTCFullYear()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interação com o mapa
// ─────────────────────────────────────────────────────────────────────────────

function provinciaEm(x, y) {
  const mundo = telaParaMundo(x, y);
  const { q, r } = pixelParaAxial(mundo.x, mundo.y);
  const arredondado = arredondarAxial(q, r);
  const direta = porChaveAxial.get(`${arredondado.q},${arredondado.r}`);
  if (direta !== undefined) return direta;
  // Clique no mar: procura a provincia mais próxima num raio curto
  for (let dq = -1; dq <= 1; dq += 1) {
    for (let dr = -1; dr <= 1; dr += 1) {
      const vizinha = porChaveAxial.get(`${arredondado.q + dq},${arredondado.r + dr}`);
      if (vizinha !== undefined) {
        const dx = vizinha.x - mundo.x;
        const dy = vizinha.y - mundo.y;
        if (Math.hypot(dx, dy) < 1.16) return vizinha;
      }
    }
  }
  return null;
}

canvas.addEventListener("pointerdown", (evento) => {
  if (evento.button !== 0) return;
  arrastando = true;
  arrastou = false;
  inicioDoArrasto = { x: evento.clientX, y: evento.clientY, cameraX: camera.x, cameraY: camera.y };
  canvas.classList.add("arrastando");
  canvas.setPointerCapture(evento.pointerId);
});

canvas.addEventListener("pointermove", (evento) => {
  const retangulo = canvas.getBoundingClientRect();
  ponteiro = { x: evento.clientX - retangulo.left, y: evento.clientY - retangulo.top, dentro: true };

  if (arrastando) {
    const dx = evento.clientX - inicioDoArrasto.x;
    const dy = evento.clientY - inicioDoArrasto.y;
    if (Math.hypot(dx, dy) > 4) arrastou = true;
    camera.x = inicioDoArrasto.cameraX - dx / camera.escala;
    camera.y = inicioDoArrasto.cameraY - dy / camera.escala;
  }

  provinciaSobOPonteiro = provinciaEm(ponteiro.x, ponteiro.y);
  atualizarDicaDoMapa();
});

canvas.addEventListener("pointerup", (evento) => {
  arrastando = false;
  canvas.classList.remove("arrastando");
  if (arrastou) return;

  const retangulo = canvas.getBoundingClientRect();
  const provincia = provinciaEm(evento.clientX - retangulo.left, evento.clientY - retangulo.top);
  if (provincia !== null) clicarProvincia(provincia);
});

canvas.addEventListener("pointerleave", () => {
  ponteiro.dentro = false;
  provinciaSobOPonteiro = null;
  atualizarDicaDoMapa();
});

canvas.addEventListener("wheel", (evento) => {
  evento.preventDefault();
  const antes = telaParaMundo(evento.offsetX, evento.offsetY);
  const fator = evento.deltaY < 0 ? 1.16 : 1 / 1.16;
  camera.destinoEscala = Math.max(11, Math.min(96, camera.destinoEscala * fator));
  camera.escala = camera.destinoEscala;
  const depois = telaParaMundo(evento.offsetX, evento.offsetY);
  camera.x += antes.x - depois.x;
  camera.y += antes.y - depois.y;
}, { passive: false });

function clicarProvincia(provincia) {
  // Clique durante um movimento: este é o destino
  if (modoDeMovimento !== null) {
    const permitidos = todosOsDestinos();
    if (permitidos.has(provincia.id)) {
      enviarComando({
        tipo: "mover",
        origemId: modoDeMovimento.origemId,
        destinoId: provincia.id,
        unidades: filtroDeMovimento(),
      });
      return;
    }
    avisarNoMapa("Destino fora de alcance para as unidades escolhidas.", true);
    return;
  }
  if (provinciaSelecionada !== provincia.id) tiposDeMovimento = {};
  provinciaSelecionada = provincia.id;
  trocarAba("provincia");
  pintarPainelDeProvincia();
}

function filtroDeMovimento() {
  const selecionadas = {};
  for (const [tipo, quantidade] of Object.entries(tiposDeMovimento)) {
    if (quantidade > 0) selecionadas[tipo] = quantidade;
  }
  return selecionadas;
}

function atualizarDicaDoMapa() {
  const dica = $("dicaDoMapa");
  if (modoDeMovimento !== null) {
    dica.innerHTML = `<strong>Escolha o destino.</strong> As províncias destacadas foram
      validadas pelo servidor: <span style="color:#8ed09a">verde</span> marcha por terra,
      <span style="color:#e88a7c">vermelho</span> ataque, <span style="color:#7fb4e0">azul</span>
      desembarque por mar. <kbd>Esc</kbd> cancela.`;
    dica.classList.add("visivel");
    return;
  }
  const provincia = provinciaSobOPonteiro;
  if (provincia === undefined || provincia === null) {
    dica.classList.remove("visivel");
    return;
  }
  const dono = provincia.dono === null ? "Território livre" : nomeDaNacao(provincia.dono);
  const terreno = estado.regras.terrenos[provincia.terreno]?.nome ?? provincia.terreno;
  const unidades = Object.values(provincia.unidades).reduce((a, b) => a + b, 0);
  dica.innerHTML = `<strong>${escaparHtml(provincia.nome)}</strong> — ${escaparHtml(terreno)}<br>
    <span style="color:var(--texto-fraco)">${escaparHtml(dono)}${unidades > 0 ? ` · ${unidades} unidades` : ""}${provincia.emBatalha ? " · em batalha" : ""}</span><br>
    <span style="color:var(--texto-fraco);font-size:10px">Arraste para mover o mapa · roda do mouse aproxima</span>`;
  dica.classList.add("visivel");
}

// Ajustes rápidos pelo teclado
window.addEventListener("keydown", (evento) => {
  if (evento.target instanceof HTMLInputElement) return;
  switch (evento.key) {
    case "Escape":
      if (modoDeMovimento !== null) sairDoModoDeMovimento();
      else { provinciaSelecionada = null; pintarPainelDeProvincia(); }
      break;
    case " ":
      evento.preventDefault();
      enviar({ tipo: "velocidade", valor: velocidadeAtual === 0 ? 1 : 0 });
      break;
    case "h": case "H":
      mostrarManual();
      break;
    case "+": case "=":
      enviar({ tipo: "velocidade", valor: velocidadeAtual >= 4 ? 4 : velocidadeAtual <= 0 ? 1 : velocidadeAtual * 2 });
      break;
    case "-": case "_":
      enviar({ tipo: "velocidade", valor: velocidadeAtual <= 1 ? 0 : velocidadeAtual / 2 });
      break;
    default:
      return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Painéis
// ─────────────────────────────────────────────────────────────────────────────

function trocarAba(aba) {
  abaAtiva = aba;
  for (const botao of document.querySelectorAll(".abas button")) {
    botao.classList.toggle("ativo", botao.dataset.aba === aba);
  }
  for (const painel of document.querySelectorAll(".painel")) painel.classList.remove("ativo");
  const alvo = { provincia: "painelProvincia", nacao: "painelNacao", guerra: "painelGuerra" }[aba];
  $(alvo).classList.add("ativo");

  // O painel recém-aberto é pintado na hora, com o retrato mais recente. Sem
  // isto ele só apareceria atualizado no próximo envio do servidor — que pode
  // demorar (ou nunca chegar, se a partida estiver pausada).
  if (estado === null) return;
  if (aba === "provincia") pintarPainelDeProvincia();
  else if (aba === "nacao") pintarPainelDaNacao();
  else pintarPainelDeGuerra();
}

for (const botao of document.querySelectorAll(".abas button")) {
  botao.addEventListener("click", () => trocarAba(botao.dataset.aba));
}

function pintarControlesDeTempo() {
  for (const botao of document.querySelectorAll("#controlesDeTempo [data-velocidade]")) {
    botao.classList.toggle("ativo", Number(botao.dataset.velocidade) === velocidadeAtual);
  }
}

$("controlesDeTempo").addEventListener("click", (evento) => {
  const botao = evento.target.closest("[data-velocidade]");
  if (botao === null) return;
  enviar({ tipo: "velocidade", valor: Number(botao.dataset.velocidade) });
});
$("passoDia").addEventListener("click", () => enviar({ tipo: "passoDeUmDia" }));
$("abrirAjuda").addEventListener("click", mostrarManual);

// ─── Recursos (rodapé) ───

function pintarRecursos() {
  const minha = estado === null ? null : estado.nacoes.find((n) => n.ehVoce);
  const rodape = $("recursos");
  if (minha === null || minha === undefined || minha.estoques === null) {
    rodape.innerHTML = `<div class="recurso"><div class="numeros">
      <span class="rotulo">Aguardando</span><span class="valor">—</span></div>
      <div class="fluxo">escolha uma nação</div></div>`;
    return;
  }
  const consumo = minha.consumoDeComida ?? 0;
  rodape.innerHTML = estado.regras.recursos.map((recurso) => {
    const estoque = minha.estoques[recurso] ?? 0;
    const bruto = minha.producao?.[recurso] ?? 0;
    const liquido = recurso === "comida" ? bruto - consumo : bruto;
    const positivo = liquido >= 0;
    const critico = estoque < 25 && !positivo;
    return `<div class="recurso ${critico ? "depressa" : ""}">
      ${svgDoRecurso(recurso, 20)}
      <div class="numeros">
        <span class="rotulo">${escaparHtml(estado.regras.nomeDoRecurso[recurso])}</span>
        <span class="valor">${numero(estoque)}</span>
      </div>
      <div class="fluxo ${positivo ? "positivo" : "negativo"}">${positivo ? "+" : ""}${numeroCheio(liquido)}/dia</div>
    </div>`;
  }).join("");
}

// ─── Placar (coluna esquerda) ───

function pintarLegenda() {
  if (estado === null) return;
  const itens = [
    ["<svg viewBox='0 0 20 14'><path d='M10 1l1.9 5.2L17 7.5l-5.1 1.3L10 14l-1.9-5.2L3 7.5l5.1-1.3z' fill='#c9a227'/></svg>", "capital"],
    ["<svg viewBox='0 0 20 14'><rect x='2' y='3' width='7' height='7' rx='1' fill='#5b8fa8'/></svg>", "construção"],
    ["<svg viewBox='0 0 20 14'><path d='M10 1l6 3v4c0 3-2.6 4.6-6 6-3.4-1.4-6-3-6-6V4z' fill='#2b3540' stroke='#c9a227'/></svg>", "fortificação"],
    ["<svg viewBox='0 0 20 14'><rect x='1' y='4' width='18' height='7' rx='3.5' fill='#141a1e' stroke='#5b93c7'/><text x='10' y='10.2' font-size='6' font-family='monospace' fill='#fff' text-anchor='middle'>INF 4</text></svg>", "guarnição"],
    ["<svg viewBox='0 0 20 14'><circle cx='10' cy='7' r='5.4' fill='none' stroke='#cf5b4a'/><path d='M7 4l6 6M13 4l-6 6' stroke='#fff' stroke-width='1.4'/></svg>", "batalha"],
  ];
  $("legenda").innerHTML = itens.map(([icone, texto]) => `<span>${icone}${texto}</span>`).join("");
}

function pintarPlacar() {
  if (estado === null) return;
  const maximo = Math.max(1, ...estado.nacoes.map((n) => n.provincias));
  const ordenadas = [...estado.nacoes].sort((a, b) => b.provincias - a.provincias);
  $("placar").innerHTML = ordenadas.map((nacao, indice) => {
    const emGuerra = nacao.emGuerraCom.length;
    return `<div class="linha ${nacao.ehVoce ? "eu" : ""} ${nacao.eliminada ? "morta" : ""}"
         title="${escaparHtml(nacao.nome)} — ${nacao.provincias} províncias, força ${nacao.forca}${emGuerra > 0 ? `, em guerra com ${emGuerra} naç${emGuerra > 1 ? "ões" : "ão"}` : ""}">
      <span class="pos">${indice + 1}</span>
      <span class="amostra" style="background:${nacao.cor}"></span>
      <span class="nome">${escaparHtml(nacao.nome)}${nacao.ehVoce ? " <em>você</em>" : ""}</span>
      <span class="prov">${nacao.provincias}</span>
      <span class="barra"><i style="width:${(nacao.provincias / maximo) * 100}%;background:${nacao.cor}"></i></span>
    </div>`;
  }).join("");
}

// ─── Comunicados ───

let assinaturaDeEventos = "";
function pintarComunicados() {
  if (estado === null) return;
  const assinatura = `${estado.eventos.length}|${estado.eventos[0]?.texto ?? ""}`;
  if (assinatura === assinaturaDeEventos) return;
  assinaturaDeEventos = assinatura;
  const caixa = $("comunicados");
  if (estado.eventos.length === 0) {
    caixa.innerHTML = `<p class="vazio">Sem comunicados ainda.</p>`;
    return;
  }
  caixa.innerHTML = estado.eventos.slice(0, 40).map((evento) => `
    <div class="comunicado ${evento.importante ? "destaque" : ""}">
      <span class="quando">${String(evento.dia).padStart(3, "0")}</span>
      <span class="texto">${escaparHtml(evento.texto)}</span>
    </div>`).join("");
}

// ─── Painel da província ───

function custoHtml(custo, estoques) {
  return `<div class="custo">${Object.entries(custo).map(([recurso, valor]) => {
    const falta = estoques !== null && (estoques[recurso] ?? 0) < valor;
    return `<b class="${falta ? "falta" : ""}" title="${escaparHtml(estado.regras.nomeDoRecurso[recurso])}">
      <i style="background:${CORES_DOS_RECURSOS[recurso]}"></i>${numero(valor)}</b>`;
  }).join("")}</div>`;
}

let memoriaDoCampo = null;

function pintarPainelDeProvincia() {
  const painel = $("painelProvincia");
  if (estado === null) { painel.innerHTML = ""; return; }
  memoriaDoCampo = lembrar();

  const provincia = provinciaSelecionada === null ? null : porId.get(provinciaSelecionada);
  if (provincia === undefined || provincia === null) {
    painel.innerHTML = `<div class="bloco"><p class="vazio">
      Clique numa província do mapa para ver detalhes e dar ordens.<br><br>
      <kbd>Arraste</kbd> move o mapa &nbsp; <kbd>roda</kbd> aproxima.<br>
      <kbd>Espaço</kbd> pausa o jogo.
    </p></div>`;
    return;
  }

  const minha = provincia.dono === estado.minhaNacao;
  const nacao = estado.nacoes.find((n) => n.id === provincia.dono);
  const terreno = estado.regras.terrenos[provincia.terreno];
  const unidades = Object.entries(provincia.unidades).filter(([, n]) => n > 0);
  const total = unidades.reduce((soma, [, n]) => soma + n, 0);
  const contagemDeConstrucoes = Object.values(provincia.construcoes).reduce((a, b) => a + b, 0);
  let html = "";

  html += `<div class="bloco cabecalhoProvincia">
    <h2>${escaparHtml(provincia.nome)}</h2>
    <div class="subtitulo">
      <span class="amostra" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${nacao?.cor ?? "#8a8a8a"}"></span>
      ${escaparHtml(nacao?.nome ?? "Território livre")}
      ${nacao?.capital === provincia.nome ? '<span class="etiqueta dourada">Capital</span>' : ""}
      ${provincia.emBatalha ? '<span class="etiqueta ruim">⚔ Sob cerco</span>' : ""}
    </div>
    <div class="subtitulo" style="margin-top:8px">
      <span class="etiqueta">${escaparHtml(terreno?.nome ?? provincia.terreno)}</span>
      <span class="etiqueta">Ocupação ${contagemDeConstrucoes}/${provincia.slots}</span>
      ${minha ? '<span class="etiqueta bem">Sob seu comando</span>' : ""}
    </div>
    ${provincia.emBatalha ? `<p style="font-size:11px;color:#e88a7c;margin-top:9px;line-height:1.5">
      Esta província está cercada. Enquanto a batalha durar ela não recebe reforço e o
      quartel não consegue recrutar.</p>` : ""}
  </div>`;

  html += `<div class="bloco">
    <div class="gradeDeDados">
      <div><div class="rotulo">Guarnição</div><div class="numero">${total} <small>unid.</small></div></div>
      <div><div class="rotulo">Poder de ataque</div><div class="numero">${provincia.poder}</div></div>
      <div><div class="rotulo">Fortificação</div><div class="numero">nível ${provincia.fortificacao ?? 0}</div></div>
      <div><div class="rotulo">Vizinhos</div><div class="numero">${provincia.vizinhos.length}</div></div>
    </div>
  </div>`;

  if (unidades.length > 0) {
    html += `<div class="bloco unidades"><h3>Forças presentes</h3>${unidades.map(([tipo, n]) => {
      const definicao = estado.regras.unidades.find((u) => u.id === tipo);
      return `<div class="tipo">
        <span class="selo">${definicao?.abrev ?? "?"}</span>
        <span class="descricao">${escaparHtml(definicao?.nome ?? tipo)} · atq ${definicao?.ataque} / def ${definicao?.defesa}</span>
        <span class="quantos">${n}</span>
      </div>`;
    }).join("")}</div>`;
  }

  if (minha) {
    // ─── Mobilização: escolher unidades e destino ───
    if (unidades.length > 0) {
      if (modoDeMovimento !== null && modoDeMovimento.origemId === provincia.id) {
        html += `<div class="bloco">
          <h3>Mobilização em curso</h3>
          <p style="font-size:11px;color:var(--texto-fraco);margin-bottom:9px">
            Clique numa província destacada do mapa para enviar as tropas selecionadas.
          </p>
          <button class="acao secundaria" data-acao="cancelar-movimento">Cancelar (Esc)</button>
        </div>`;
      } else {
        const selecao = tiposDeMovimento;
        html += `<div class="bloco"><h3>Mobilizar tropas</h3>
          <p style="font-size:11px;color:var(--texto-fraco);margin-bottom:9px">
            Escolha quantas unidades enviar. Destinos válidos aparecem no mapa.
          </p>`;
        for (const [tipo, disponivel] of unidades) {
          const definicao = estado.regras.unidades.find((u) => u.id === tipo);
          const escolhido = selecao[tipo] ?? disponivel;
          html += `<div class="itemDeAcao">
            <div class="titulo"><span class="selo">${definicao?.abrev}</span> ${escaparHtml(definicao?.nome)}
              <span class="nivel">de ${disponivel}</span></div>
            <div class="seletorDeQuantidade">
              <button data-passo-tipo="${tipo}" data-passo="-1">−</button>
              <input type="number" min="0" max="${disponivel}" value="${escolhido}" data-tipo="${tipo}">
              <button data-passo-tipo="${tipo}" data-passo="1">+</button>
            </div>
            <div class="efeito">alcance ${definicao?.velocidade} província${(definicao?.velocidade ?? 1) > 1 ? "s" : ""} por turno</div>
          </div>`;
        }
        html += `<div class="rodape" style="margin-top:10px">
          <button class="acao" data-acao="iniciar-movimento">Escolher destino</button>
          <button class="acao secundaria" data-acao="mobilizar-tudo">Todas as tropas</button>
        </div></div>`;
      }
    }

    // ─── Recrutamento ───
    const recrutamento = provincia.custosDeRecrutamento;
    if (recrutamento !== undefined) {
      html += `<div class="bloco"><h3>Recrutamento</h3>`;
      if (!recrutamento.temQuartel) {
        html += `<p class="vazio">Construa um <strong>Quartel</strong> nesta província para recrutar.</p>`;
      } else {
        html += `<p style="font-size:10.5px;color:var(--texto-fraco);margin-bottom:8px">
          Capacidade ${recrutamento.capacidade} · em treino ${recrutamento.emTreino}
          ${recrutamento.desconto < 1 ? ` · desconto do quartel ${Math.round((1 - recrutamento.desconto) * 100)}%` : ""}
        </p>`;
        for (const [tipo, dados] of Object.entries(recrutamento.unidades)) {
          const definicao = estado.regras.unidades.find((u) => u.id === tipo);
          const caber = recrutamento.capacidade - recrutamento.emTreino;
          html += `<div class="itemDeAcao">
            <div class="titulo"><span class="selo">${definicao?.abrev}</span> ${escaparHtml(definicao?.nome)}
              <span class="nivel">${dados.dias} dia${dados.dias > 1 ? "s" : ""}</span></div>
            <div class="seletorDeQuantidade">
              <button data-recrutar-passo="${tipo}" data-passo="-1">−</button>
              <input type="number" min="1" max="${Math.max(1, Math.min(50, caber))}" value="${quantidadesParaRecrutar[tipo] ?? 1}" data-recrutar="${tipo}">
              <button data-recrutar-passo="${tipo}" data-passo="1">+</button>
            </div>
            <div class="efeito">atq ${definicao?.ataque} · def ${definicao?.defesa} · vida ${definicao?.vida}</div>
            <div class="rodape">${custoHtml(dados.custo, minhaNacao()?.estoques ?? null)}
              <button class="acao pequena" data-recrutar-acao="${tipo}"
                ${dados.podePagar && caber >= 1 ? "" : "disabled"}>Recrutar</button></div>
          </div>`;
        }
      }
      html += `</div>`;
    }

    // ─── Fila ───
    const fila = Object.entries(provincia.recrutando ?? {});
    if (fila.length > 0) {
      html += `<div class="bloco"><h3>Em treinamento</h3><div class="fila">${fila.map(([tipo, item]) => {
        const definicao = estado.regras.unidades.find((u) => u.id === tipo);
        const progresso = 100 - (item.diasRestantes / item.diasTotais) * 100;
        return `<div class="naFila">
          <span class="selo">${definicao?.abrev ?? "?"}</span>
          <span class="progresso"><i style="width:${progresso}%"></i></span>
          <span class="tempo">${item.quantidade}x · ${item.diasRestantes}d</span>
          <button class="acao secundaria pequena" data-cancelar="${tipo}">×</button>
        </div>`;
      }).join("")}</div></div>`;
    }

    // ─── Construções ───
    const custos = provincia.custosDeConstrucao ?? {};
    const disponiveis = Object.entries(custos).filter(([, dados]) => !dados.maximo);
    if (disponiveis.length > 0) {
      html += `<div class="bloco"><h3>Construções</h3>`;
      html += disponiveis.map(([idConstrucao, dados]) => {
        const definicao = estado.regras.construcoes.find((c) => c.id === idConstrucao);
        const cheio = contagemDeConstrucoes >= provincia.slots;
        const semEspaco = cheio && dados.nivelAtual === 0;
        let efeito;
        if (definicao.recurso === null) {
          efeito = idConstrucao === "quartel"
            ? `Habilita recrutamento · velocidade ${Math.max(1, 2 - dados.nivelAtual)} dia(s)`
            : `Defesa da província +${Math.round(100 * (definicao.bonusDeDefesaPorNivel ?? 0.12))}% por nível`;
        } else {
          efeito = `Produção ${numeroCheio(dados.producaoAtual)} → <span class="ganho">${numeroCheio(dados.producaoProximoNivel)}</span>
            ${escaparHtml(estado.regras.nomeDoRecurso[definicao.recurso]).toLowerCase()}/dia`;
        }
        return `<div class="itemDeAcao">
          <div class="titulo">${escaparHtml(definicao.nome)}
            <span class="nivel">nível ${dados.nivelAtual}/${dados.nivelMaximo}</span></div>
          <button class="acao pequena" data-construir="${idConstrucao}"
            ${dados.podePagar && !semEspaco ? "" : "disabled"}>${dados.nivelAtual === 0 ? "Construir" : "Elevar"}</button>
          <div class="efeito">${efeito}</div>
          <div class="rodape">${custoHtml(dados.custo, minhaNacao()?.estoques ?? null)}
            ${semEspaco ? '<span class="etiqueta ruim">sem espaço livre</span>' : ""}</div>
        </div>`;
      }).join("");
      html += `</div>`;
    }
  } else if (provincia.dono !== null) {
    html += `<div class="bloco">
      <p class="vazio">Território sob controle de <strong>${escaparHtml(nacao?.nome ?? "?")}</strong>.</p>
      ${provincia.vizinhosInimigos?.length ? "" : ""}
    </div>`;
  }

  painel.innerHTML = html;
  restaurar(memoriaDoCampo);
  memoriaDoCampo = null;
}

function minhaNacao() {
  return estado?.nacoes.find((n) => n.ehVoce) ?? null;
}

// ─── Painel da nação ───

function pintarPainelDaNacao() {
  const painel = $("painelNacao");
  if (estado === null) return;
  const minha = minhaNacao();
  if (minha === null || minha === undefined) {
    painel.innerHTML = `<div class="bloco"><p class="vazio">Você ainda não comanda uma nação.</p>
      <button class="acao" data-acao="abrir-escolha">Escolher nação</button></div>`;
    return;
  }

  const consumo = minha.consumoDeComida ?? 0;
  const producaoBruta = minha.producao ?? {};
  const minhasProvincias = estado.provincias.filter((p) => p.dono === minha.id);

  let html = `<div class="bloco cabecalhoProvincia">
    <h2>${escaparHtml(minha.nome)}</h2>
    <div class="subtitulo">
      <span class="etiqueta dourada">${minha.provincias} províncias</span>
      <span class="etiqueta">Força ${numero(minha.forca)}</span>
      ${minha.emGuerraCom.length > 0 ? `<span class="etiqueta ruim">${minha.emGuerraCom.length} guerra(s)</span>` : '<span class="etiqueta bem">em paz</span>'}
    </div>
  </div>`;

  html += `<div class="bloco"><h3>Balanço diário</h3>
    <div class="gradeDeDados">${estado.regras.recursos.map((recurso) => {
      const liquido = recurso === "comida" ? (producaoBruta[recurso] ?? 0) - consumo : (producaoBruta[recurso] ?? 0);
      return `<div><div class="rotulo">${escaparHtml(estado.regras.nomeDoRecurso[recurso])}</div>
        <div class="numero" style="color:${liquido >= 0 ? "var(--verde)" : "var(--vermelho)"}">
          ${liquido >= 0 ? "+" : ""}${numeroCheio(liquido)}<small>/dia</small></div></div>`;
    }).join("")}</div>
    ${consumo > 0 ? `<p style="font-size:10.5px;color:var(--texto-fraco);margin-top:8px">
      Suas tropas consomem ${numeroCheio(consumo)} de alimento por dia.</p>` : ""}
  </div>`;

  html += `<div class="bloco"><h3>Diplomacia</h3>`;
  for (const outra of [...estado.nacoes].sort((a, b) => (b.relacoes ?? 0) - (a.relacoes ?? 0))) {
    if (outra.id === minha.id || outra.eliminada) continue;
    const emGuerra = minha.emGuerraCom.includes(outra.id);
    const custo = estado.regras.custoDeGuerra;
    const dinheiro = minha.estoques?.dinheiro ?? 0;
    const relacoes = outra.relacoes ?? 0;
    const pacto = outra.pacto;
    const alcancavel = outra.alcancavel !== false;
    const corDasRelacoes = relacoes >= 40 ? "var(--verde)" : relacoes <= -30 ? "var(--vermelho)" : "var(--texto-fraco)";
    const estadoDiplomatico = emGuerra
      ? '<b style="color:var(--vermelho)">EM GUERRA</b>'
      : pacto === "alianca" ? '<b style="color:var(--verde)">ALIANÇA</b>'
      : pacto === "naoAgressao" ? '<b style="color:var(--latao-claro)">PACTO</b>' : "paz";

    const ajudaDisponivel = Math.floor(dinheiro * 0.2);
    html += `<div class="nacaoDiplo">
      <span class="amostra" style="background:${outra.cor}"></span>
      <div class="ident">
        <strong>${escaparHtml(outra.nome)}</strong>
        <small>${outra.provincias} prov. · força ${numero(outra.forca)} · ${estadoDiplomatico}</small>
        <small style="color:${corDasRelacoes}">relações ${relacoes > 0 ? "+" : ""}${Math.round(relacoes)} · moral ${outra.moral}${alcancavel ? "" : " · sem rota"}</small>
      </div>
      <div class="acoes">
        ${emGuerra
          ? `<button class="acao secundaria pequena" data-paz="${outra.id}">Propor paz</button>`
          : `<button class="acao perigo pequena" data-guerra="${outra.id}" ${dinheiro >= custo ? "" : "disabled"}
               title="${alcancavel ? "Declarar guerra custa " + custo + " de dinheiro" : "Sem fronteira nem rota marítima: esta guerra não teria frente"}">Guerra · ${custo}</button>`}
        ${pacto === null && !emGuerra
          ? `<button class="acao secundaria pequena" data-pacto="${outra.id}" ${dinheiro >= 30 ? "" : "disabled"}
               title="Pacto de não-agressão por 90 dias. Custa 30 de dinheiro e depende das relações.">Pacto</button>
             <button class="acao secundaria pequena" data-alianca="${outra.id}" ${dinheiro >= 60 ? "" : "disabled"}
               title="Aliança por 180 dias: acesso militar e chamado às armas. Exige boa relação.">Aliança</button>`
          : ""}
        ${pacto !== null
          ? `<button class="acao secundaria pequena" data-romper="${outra.id}"
               title="Romper o pacto custa moral e queima sua reputação com todos.">Romper</button>`
          : ""}
        ${!emGuerra && ajudaDisponivel >= 20
          ? `<button class="acao secundaria pequena" data-ajuda="${outra.id}"
               title="Enviar ${ajudaDisponivel} de dinheiro melhora as relações.">Ajuda ${ajudaDisponivel}$</button>`
          : ""}
      </div>
    </div>`;
  }
  html += `</div>`;

  if (minha.eliminada) {
    html += `<div class="bloco aviso"><p class="vazio">
      <strong>${escaparHtml(minha.nome)} foi eliminada da campanha.</strong><br>
      Você continua na sala como observador: o mapa, os comunicados e as
      batalhas seguem à vista.</p></div>`;
  }

  // ── Governo: o humor do povo e o que o governo faz com ele ──
  const moral = estado.moral ?? 0;
  const corDoMoral = moral >= 60 ? "var(--verde)" : moral >= 35 ? "var(--latao)" : "var(--vermelho)";
  const adotadas = estado.doutrinas ?? [];
  const limite = estado.regras.limiteDeDoutrinas ?? 3;
  html += `<div class="bloco"><h3>Governo</h3>
    <div class="moral">
      <div class="moralTopo"><span>Moral do povo</span>
        <strong style="color:${corDoMoral}">${Math.round(moral)}<small>/100</small></strong></div>
      <div class="barraMoral"><i style="width:${Math.max(0, Math.min(100, moral))}%;background:${corDoMoral}"></i></div>
      <small>${moral >= 60 ? "O povo acredita na guerra: produção e combate rendem mais."
        : moral >= 35 ? "Cansaço à vista. Uma guerra longa vai cobrar o preço."
        : "Risco de colapso: as tropas desertam em dobro e a produção cai."}</small>
    </div>
    <p class="subtitulo">Doutrinas em vigor (${adotadas.length}/${limite})</p>
    <div class="listaDeCartoes">
      ${(estado.regras.doutrinas ?? []).map((doutrina) => {
        const ativa = adotadas.includes(doutrina.id);
        const dinheiro = minha.estoques?.dinheiro ?? 0;
        const bloqueada = !ativa && (dinheiro < doutrina.custo || adotadas.length >= limite);
        const sinal = doutrina.moralPorDia >= 0 ? "+" : "";
        return `<button class="cartao ${ativa ? "ativo" : ""}" data-doutrina="${doutrina.id}"
          ${bloqueada ? "disabled" : ""}
          title="${escaparHtml(doutrina.descricao)} — moral ${sinal}${doutrina.moralPorDia}/dia">
          <strong>${escaparHtml(doutrina.nome)}</strong>
          <small>${escaparHtml(doutrina.descricao)}</small>
          <span class="preco">${ativa ? "em vigor — clique para revogar"
            : `${doutrina.custo} $ · moral ${sinal}${doutrina.moralPorDia}/dia`}</span>
        </button>`;
      }).join("")}
    </div>
  </div>`;

  // ── Pesquisa: o catálogo vem inteiro do servidor, com o preço já resolvido ──
  const pesquisa = estado.pesquisa;
  if (pesquisa !== null && pesquisa !== undefined) {
    html += `<div class="bloco"><h3>Pesquisa</h3>
      <div class="pesquisaTopo">
        <strong>${numeroCheio(pesquisa.pontos)}</strong>
        <span>pontos acumulados<br><b>+${pesquisa.porDia} por dia</b></span>
      </div>
      ${Object.entries(estado.regras.ramosDePesquisa ?? {}).map(([ramo, nomeDoRamo]) => {
        const avancos = pesquisa.avancos.filter((avanco) => avanco.ramo === ramo);
        if (avancos.length === 0) return "";
        return `<div class="ramo"><h4>${escaparHtml(nomeDoRamo)}</h4>
          ${avancos.map((avanco) => `
            <button class="cartaoAvancado ${avanco.concluido ? "concluido" : ""}"
              data-pesquisar="${avanco.id}" ${avanco.podePesquisar ? "" : "disabled"}
              title="${escaparHtml(avanco.descricao)}">
              <strong>${escaparHtml(avanco.nome)}</strong>
              <small>${escaparHtml(avanco.descricao)}</small>
              <span class="preco">${avanco.concluido ? "concluído"
                : !avanco.prerequisitosOk ? `requer ${escaparHtml(avanco.prerequisitosFaltando.join(", "))}`
                : avanco.faltam > 0 ? `faltam ${avanco.faltam} pontos`
                : `${avanco.custo} pontos`}</span>
            </button>`).join("")}
        </div>`;
      }).join("")}
    </div>`;
  }

  // ── Comandantes: quem mais está nesta campanha ──
  const comandantes = estado.comandantes ?? [];
  if (comandantes.length > 0) {
    html += `<div class="bloco"><h3>Comandantes (${comandantes.length})</h3>
      ${comandantes.map((comandante) => {
        const nacao = estado.nacoes.find((n) => n.id === comandante.nacaoId);
        return `<div class="comandante">
          <span class="pontoDeEstado ${comandante.conectado ? "ligado" : ""}"
            title="${comandante.conectado ? "Online" : "Offline"}"></span>
          <span class="amostra" style="background:${nacao?.cor ?? "#666"}"></span>
          <div class="ident">
            <strong>${escaparHtml(comandante.nome)}${comandante.ehVoce ? " — você" : ""}</strong>
            <small>${escaparHtml(nacao?.nome ?? "—")}${nacao?.eliminada ? " · eliminada" : ""}</small>
          </div>
        </div>`;
      }).join("")}
    </div>`;
  }

  html += `<div class="bloco"><h3>Suas províncias (${minhasProvincias.length})</h3>
    <div style="display:flex;flex-wrap:wrap;gap:4px">${minhasProvincias.map((p) => `
      <button class="acao secundaria pequena" data-ir-para="${p.id}"
        style="${p.emBatalha ? "border-color:var(--vermelho);color:#e88a7c" : ""}"
        title="${p.nome} — ${Object.values(p.unidades).reduce((a, b) => a + b, 0)} unidades">
        ${escaparHtml(p.nome)}${p.emBatalha ? " ⚔" : ""}</button>`).join("")}</div>
  </div>`;

  painel.innerHTML = html;
}

// ─── Painel de guerra ───

function pintarPainelDeGuerra() {
  const painel = $("painelGuerra");
  if (estado === null) return;
  const contador = $("contadorDeBatalhas");
  contador.textContent = estado.batalhas.length > 0 ? String(estado.batalhas.length) : "";

  if (estado.batalhas.length === 0) {
    painel.innerHTML = `<div class="bloco"><p class="vazio">
      Nenhuma batalha em andamento no continente.<br><br>
      Para atacar, selecione uma província sua com tropas, use
      <strong>Escolher destino</strong> e clique numa província inimiga vizinha —
      é preciso ter declarado guerra antes.</p></div>`;
    return;
  }

  painel.innerHTML = `<div class="bloco"><h3>Frentes ativas</h3>${estado.batalhas.map((batalha) => {
    const total = batalha.vidaAtacante + batalha.vidaDefensora;
    const fatia = total <= 0 ? 50 : (batalha.vidaAtacante / total) * 100;
    const cor = corDoDono(batalha.atacante);
    return `<div class="batalha" style="border-left-color:${batalha.atacanteEhVoce ? "var(--verde)" : cor}">
      <div class="local">${escaparHtml(batalha.provinciaNome)}</div>
      <div class="lados">
        <span>${batalha.atacanteEhVoce ? "<b>Você</b>" : `<b>${escaparHtml(batalha.atacanteNome)}</b>`}
          <br>${numero(batalha.vidaAtacante)} de vida</span>
        <span style="text-align:right">${batalha.defensorNome === minhaNacao()?.nome ? "<b>Você</b>" : `<b>${escaparHtml(batalha.defensorNome)}</b>`}
          <br>${numero(batalha.vidaDefensora)} de vida</span>
      </div>
      <div class="medidor"><i class="a" style="width:${fatia}%"></i><i class="d" style="width:${100 - fatia}%"></i></div>
      <div class="duracao">há ${batalha.dias} dia${batalha.dias > 1 ? "s" : ""}</div>
    </div>`;
  }).join("")}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delegação de cliques dos painéis
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener("click", (evento) => {
  const alvo = evento.target.closest("[data-acao],[data-construir],[data-recrutar-acao],[data-cancelar],[data-guerra],[data-paz],[data-ir-para],[data-passo-tipo],[data-recrutar-passo],[data-nacao],[data-pesquisar],[data-doutrina],[data-pacto],[data-alianca],[data-romper],[data-ajuda]");
  if (alvo === null || estado === null) return;

  // Comandos das telas de governo, pesquisa e diplomacia
  if (alvo.dataset.pesquisar !== undefined) {
    enviarComando({ tipo: "pesquisar", avancoId: alvo.dataset.pesquisar });
    return;
  }
  if (alvo.dataset.doutrina !== undefined) {
    const ativa = (estado.doutrinas ?? []).includes(alvo.dataset.doutrina);
    enviarComando(ativa
      ? { tipo: "revogarDoutrina", doutrinaId: alvo.dataset.doutrina }
      : { tipo: "adotarDoutrina", doutrinaId: alvo.dataset.doutrina });
    return;
  }
  if (alvo.dataset.pacto !== undefined) {
    enviarComando({ tipo: "proporPacto", nacaoId: alvo.dataset.pacto, tipoDePacto: "naoAgressao" });
    return;
  }
  if (alvo.dataset.alianca !== undefined) {
    enviarComando({ tipo: "proporPacto", nacaoId: alvo.dataset.alianca, tipoDePacto: "alianca" });
    return;
  }
  if (alvo.dataset.romper !== undefined) {
    enviarComando({ tipo: "romperPacto", nacaoId: alvo.dataset.romper });
    return;
  }
  if (alvo.dataset.ajuda !== undefined) {
    const enviado = Math.floor((minhaNacao()?.estoques?.dinheiro ?? 0) * 0.2);
    enviarComando({ tipo: "enviarAjuda", nacaoId: alvo.dataset.ajuda, recurso: "dinheiro", quantidade: enviado });
    return;
  }

  const provincia = provinciaSelecionada === null ? null : porId.get(provinciaSelecionada);

  // Escolher nação (modal)
  if (alvo.dataset.nacao !== undefined) {
    enviar({ tipo: "escolherNacao", nacaoId: alvo.dataset.nacao });
    return;
  }

  if (alvo.dataset.construir !== undefined && provincia !== null) {
    enviarComando({ tipo: "construir", provinciaId: provincia.id, construcaoId: alvo.dataset.construir });
    return;
  }

  if (alvo.dataset.recrutarAcao !== undefined && provincia !== null) {
    const tipo = alvo.dataset.recrutarAcao;
    const campo = document.querySelector(`[data-recrutar="${CSS.escape(tipo)}"]`);
    const quantidade = Math.max(1, Math.floor(Number(campo?.value ?? quantidadesParaRecrutar[tipo] ?? 1)));
    enviarComando({ tipo: "recrutar", provinciaId: provincia.id, unidadeId: alvo.dataset.recrutarAcao, quantidade });
    return;
  }

  if (alvo.dataset.cancelar !== undefined && provincia !== null) {
    enviarComando({ tipo: "cancelarRecrutamento", provinciaId: provincia.id, unidadeId: alvo.dataset.cancelar });
    return;
  }

  if (alvo.dataset.guerra !== undefined) {
    enviarComando({ tipo: "declararGuerra", nacaoId: alvo.dataset.guerra });
    return;
  }

  if (alvo.dataset.paz !== undefined) {
    enviarComando({ tipo: "proporPaz", nacaoId: alvo.dataset.paz });
    return;
  }

  if (alvo.dataset.irPara !== undefined) {
    provinciaSelecionada = alvo.dataset.irPara;
    trocarAba("provincia");
    pintarPainelDeProvincia();
    const destino = porId.get(alvo.dataset.irPara);
    if (destino !== undefined) {
      camera.x = destino.x;
      camera.y = destino.y;
      if (camera.destinoEscala < 30) camera.destinoEscala = 38;
    }
    return;
  }

  if (alvo.dataset.passoTipo !== undefined && provincia !== null) {
    const tipo = alvo.dataset.passoTipo;
    const disponivel = provincia.unidades[tipo] ?? 0;
    const passo = Number(alvo.dataset.passo);
    tiposDeMovimento[tipo] = Math.max(0, Math.min(disponivel, (tiposDeMovimento[tipo] ?? disponivel) + passo));
    pintarPainelDeProvincia();
    return;
  }

  if (alvo.dataset.recrutarPasso !== undefined) {
    const tipo = alvo.dataset.recrutarPasso;
    const campo = document.querySelector(`[data-recrutar="${CSS.escape(tipo)}"]`);
    if (campo !== null) {
      const novo = Math.max(Number(campo.min ?? 1), Math.min(Number(campo.max ?? 50), Number(campo.value) + Number(alvo.dataset.passo)));
      quantidadesParaRecrutar[tipo] = novo;
      campo.value = novo;
    }
    return;
  }

  switch (alvo.dataset.acao) {
    case "abrir-escolha":
      mostrarEscolhaDeNacao();
      break;
    case "fechar-modal":
      fecharModal();
      break;
    case "ajuda":
      mostrarManual();
      break;
    case "iniciar-movimento": {
      if (provincia === null) break;
      const selecionadas = {};
      for (const [tipo, disponivel] of Object.entries(provincia.unidades)) {
        const quantidade = tiposDeMovimento[tipo] ?? disponivel;
        if (quantidade > 0) selecionadas[tipo] = quantidade;
      }
      if (Object.keys(selecionadas).length === 0) { brindar("Selecione ao menos uma unidade.", true); break; }
      modoDeMovimento = { origemId: provincia.id, unidades: selecionadas };
      canvas.classList.add("atacando");
      avisarNoMapa("Escolha o destino no mapa. Esc cancela.");
      pintarPainelDeProvincia();
      break;
    }
    case "mobilizar-tudo":
      tiposDeMovimento = {};
      pintarPainelDeProvincia();
      break;
    case "cancelar-movimento":
      sairDoModoDeMovimento();
      break;
  }
});

// Mantém os valores digitados nos campos de quantidade
document.addEventListener("input", (evento) => {
  const campo = evento.target;
  if (!(campo instanceof HTMLInputElement)) return;
  if (campo.dataset.recrutar !== undefined) {
    quantidadesParaRecrutar[campo.dataset.recrutar] = Math.max(1, Math.floor(Number(campo.value) || 1));
    return;
  }
  if (campo.dataset.tipo !== undefined && provinciaSelecionada !== null) {
    const provincia = porId.get(provinciaSelecionada);
    const disponivel = provincia?.unidades[campo.dataset.tipo] ?? 0;
    const valor = Math.max(0, Math.min(disponivel, Math.floor(Number(campo.value) || 0)));
    tiposDeMovimento[campo.dataset.tipo] = valor;
  }
});

// Ferramentas do mapa
$("aproximar").addEventListener("click", () => { camera.destinoEscala = Math.min(96, camera.destinoEscala * 1.3); });
$("afastar").addEventListener("click", () => { camera.destinoEscala = Math.max(11, camera.destinoEscala / 1.3); });
$("centralizar").addEventListener("click", ajustarParaMeuTerritorio);
$("alternarRotulos").addEventListener("click", (evento) => {
  mostrarRotulos = !mostrarRotulos;
  evento.currentTarget.classList.toggle("ativo", mostrarRotulos);
});

// ─────────────────────────────────────────────────────────────────────────────
// Modais
// ─────────────────────────────────────────────────────────────────────────────

function abrirModal(html) {
  $("conteudoDoModal").innerHTML = html;
  $("modal").classList.remove("escondido");
}
function fecharModal() { $("modal").classList.add("escondido"); }

/**
 * O manual é montado a partir do catálogo que o SERVIDOR envia. Se amanhã o
 * preço de um blindado mudar, o manual muda junto, sem tocar neste arquivo.
 */
function mostrarManual() {
  const regras = estado?.regras;
  if (regras === undefined) return;

  const linhaDeUnidade = (unidade) => `<div class="tipo">
      <span class="selo">${unidade.abrev}</span>
      <span class="descricao">${escaparHtml(unidade.nome)}</span>
      <span class="quantos">${unidade.velocidade} passo${unidade.velocidade > 1 ? "s" : ""}</span>
    </div>`;

  abrirModal(`
    <h2>Como <span>jogar</span></h2>
    <p class="chamada">
      Supremacia 1942 é uma campanha de ${regras.limiteDeDias} dias. Você comanda uma nação
      numa Europa dividida; as outras são conduzidas pelo estado-maior adversário.
      Existem três finais: <strong>aniquilação</strong> (ficar sozinho no mapa),
      <strong>supremacia</strong> (passar de ${Math.round((regras.dominioParaVitoria ?? 0.4) * 100)}% das províncias a partir
      do dia ${regras.diaMinimoParaVitoria}) e <strong>armistício</strong> — quando o prazo acaba e quem
      tem mais território leva a campanha.
    </p>

    <div class="manual">
      <div class="manualSecao">
        <h3>O ciclo de um dia</h3>
        <ul>
          <li><strong>Produção</strong>: cada província sua gera recursos todo dia, e cada construção eleva esse valor.</li>
          <li><strong>Consumo</strong>: tropas comem <strong>alimento</strong> diariamente. Se o estoque acabar, elas desertam.</li>
          <li><strong>Recrutamento</strong>: a fila de cada província anda um passo por dia.</li>
          <li><strong>Combate</strong>: toda batalha em andamento troca um dia de baixas.</li>
          <li><strong>Inteligência artificial</strong>: as outras nações pensam a cada 3 dias.</li>
        </ul>
        <p style="margin-top:9px">
          O tempo corre sozinho: use <kbd>Espaço</kbd> para pausar, <kbd>+</kbd> e <kbd>−</kbd> para acelerar,
          ou <kbd>+1 dia</kbd> para jogar turno a turno. Nada acontece sem você: os comandos são seus.
        </p>
      </div>

      <div class="manualSecao">
        <h3>Governar</h3>
        <p>Clique numa província sua. Cada província tem um número limitado de <strong>espaços de construção</strong>,
        então escolher onde construir é uma decisão de verdade.</p>
        <div class="manualGrade">${regras.construcoes.map((c) => `
          <div class="manualCartao">
            <h4>${escaparHtml(c.nome)}${c.recurso === null ? "" : ` <span style="color:var(--texto-fraco)">→ ${escaparHtml(regras.nomeDoRecurso[c.recurso])}</span>`}</h4>
            <dl>
              <dt>custo</dt><dd>${Object.entries(c.custo).map(([r, v]) => `${v} ${escaparHtml(regras.nomeDoRecurso[r].toLowerCase())}`).join(" + ")}${c.recurso === null ? "" : ` · <span style="color:var(--texto-fraco)">+${Math.round(c.custoPorNivel * 100 - 100)}% por nível</span>`}</dd>
              <dt>limite</dt><dd>nível ${c.nivelMaximo}</dd>
              <dt>efeito</dt><dd>${escaparHtml(c.efeito ?? (c.recurso === null ? "—" : `+${c.producaoBase} por nível (× o terreno)`))}</dd>
            </dl>
          </div>`).join("")}</div>
      </div>

      <div class="manualSecao">
        <h3>Exércitos</h3>
        <p>Recrutar exige um <strong>Quartel</strong>. Cada quartel segura uma fila limitada e, quanto maior,
        mais barato e rápido sai cada soldado.</p>
        <div class="manualGrade">${regras.unidades.map((u) => `
          <div class="manualCartao">
            <h4><span class="selo">${u.abrev}</span> ${escaparHtml(u.nome)}</h4>
            <dl>
              <dt>custo</dt><dd>${Object.entries(u.custo).map(([r, v]) => `${v} ${escaparHtml(regras.nomeDoRecurso[r].toLowerCase())}`).join(" + ")}</dd>
              <dt>ataque</dt><dd>${u.ataque} · defesa ${u.defesa}</dd>
              <dt>vida</dt><dd>${u.vida} (aguenta ${u.vida} de dano)</dd>
              <dt>recruta em</dt><dd>${u.diasDeRecrutamento} dias</dd>
              <dt>alcance</dt><dd>${u.velocidade} província${u.velocidade > 1 ? "s" : ""} por dia</dd>
              <dt>alimento</dt><dd>${u.consomeComida}/dia por unidade</dd>
            </dl>
          </div>`).join("")}</div>
      </div>

      <div class="manualSecao">
        <h3>Guerra</h3>
        <ul>
          <li>Antes de atacar é preciso <strong>declarar guerra</strong> — custa ${regras.custoDeGuerra} de dinheiro.</li>
          <li>Para enviar tropas: selecione a província, escolha quantas unidades vão, clique em
            <strong>Escolher destino</strong> e clique numa província destacada.</li>
          <li><strong>Defesa leva vantagem.</strong> Terreno (montanha, metrópole, floresta) e fortificações
            (+${Math.round(regras.construcoes.find((c) => c.id === "fortificacao").bonusDeDefesaPorNivel * 100)}% por nível)
            multiplicam a defesa. Atacar exige superioridade real, não apenas números parecidos.</li>
          <li><strong>Cerco</strong>: enquanto uma província está em batalha, ela <em>não recebe reforço</em> e
            o quartel não recruta. Resolva a batalha ou perca a província.</li>
          <li><strong>Operação anfíbia</strong>: onde há uma travessia azul pontilhada, as tropas podem atravessar o
            mar — mas a travessia consome o movimento inteiro do dia e quem desembarca luta em desvantagem
            (a defesa vale ×${regras.bonusDeDesembarque}).</li>
        </ul>
      </div>

      <div class="manualSecao">
        <h3>Indústria e logística</h3>
        <ul>
          <li><strong>Dinheiro</strong> constrói e declara guerras. Vem de centros comerciais e metrópoles.</li>
          <li><strong>Aço</strong> constrói e forma blindados.</li>
          <li><strong>Petróleo</strong> só serve para blindados e caçadores — vale ouro no deserto.</li>
          <li><strong>Carvão</strong> alimenta minas e artilharia.</li>
          <li><strong>Alimento</strong> é o teto do seu exército. Um império sem fazendas não sustenta tropas:
            elas desertam todos os dias.</li>
        </ul>
      </div>

      <div class="manualSecao">
        <h3>Governo e pesquisa</h3>
        <p>Na aba <strong>Nação</strong> você governa: moral do povo, doutrinas e a árvore de pesquisa.
        O servidor manda o preço de cada avanço e diz o que já está ao seu alcance — o cliente não
        calcula nada.</p>
        <ul>
          <li><strong>Moral</strong>: começa em ${regras.moralInicial}. Cai a cada dia de guerra (mais rápido com
            várias frentes), ao perder províncias e ao perder a capital; sobe com conquistas, com
            propaganda e com o tempo de paz. Moral baixa reduz produção e combate até a nação parar de cooperar.</li>
          <li><strong>Doutrinas</strong>: no máximo ${regras.limiteDeDoutrinas} ao mesmo tempo. Cada uma custa dinheiro, dá um
            efeito permanente e mexe no moral todo dia — racionamento, propaganda, serviço civil, censura,
            economia de guerra, recrutamento geral, paz social, turnos extras.</li>
          <li><strong>Pesquisa</strong>: pontos por dia vindos de <strong>laboratórios</strong> e do esforço de guerra.
            São ${regras.avancos.length} avanços em ${Object.keys(regras.ramosDePesquisa ?? {}).length} ramos, com dependências entre eles.</li>
          <li><strong>Indústria</strong>: cada nação tira um tanto diferente de cada província. A Alemanha
            produz ${Math.round(((regras.eficienciaNacional?.de ?? 1) - 1) * 100)}% acima do normal por província e a União Soviética
            ${Math.round(((regras.eficienciaNacional?.ur ?? 1) - 1) * 100)}%: território enorme, fábrica atrasada. Leve isso em conta ao escolher.</li>
        </ul>
      </div>

      <div class="manualSecao">
        <h3>Diplomacia</h3>
        <ul>
          <li><strong>Relações</strong> vão de −100 a +100 e aparecem no painel. Guerra e invasão derrubam;
            inimigo comum e tempo de paz aproximam.</li>
          <li><strong>Pacto de não-agressão</strong> (90 dias, 30 de dinheiro): ninguém ataca o outro enquanto valer.</li>
          <li><strong>Aliança</strong> (180 dias, 60 de dinheiro, exige boa relação): vale <em>acesso militar</em> —
            suas tropas atravessam o território aliado, mas ainda não podem ocupá-lo. Se um aliado é
            atacado, ele chama você às armas.</li>
          <li><strong>Ajuda econômica</strong>: enviar dinheiro melhora as relações e pode salvar uma amizade.</li>
          <li><strong>Rompimento</strong>: quebrar a palavra custa −35 de relação com o traído, −8 com todos os
            outros e −6 de moral interna. Quem cresce demais perde simpatia sozinho: a partir de
            ${Math.round((regras.dominioQueAssista ?? 0.24) * 100)}% do mapa o resto do mundo vai se
            aproximando: quanto mais perto de ${Math.round((regras.dominioParaVitoria ?? 0.4) * 100)}% você chegar,
            mais fundo esse rancor fica — e ele alivia se você recuar.</li>
        </ul>
      </div>

      <div class="manualSecao">
        <h3>Comandantes</h3>
        <p>Esta campanha aceita mais de um jogador. Cada pessoa abre o mesmo endereço no próprio
        navegador, escolhe o seu nome e uma nação ainda livre — a nação escolhida por alguém não pode
        ser pega por outra pessoa. Se a conexão cair ou a página recarregar, o comando continua seu
        por cinco minutos. Todo o estado do jogo vive no servidor: os dois navegadores mandam ordens
        e recebem o mesmo retrato do mundo.</p>
      </div>

      <div style="text-align:center">
        <button class="acao" data-acao="fechar-modal">Entendido, ao combate</button>
      </div>
    </div>
  `);
}

function mostrarEscolhaDeNacao() {
  if (estado === null) return;
  const nacoes = [...estado.nacoes].sort((a, b) => b.provincias - a.provincias);
  const porId = new Map(estado.provincias.map((p) => [p.id, p]));
  const tomadas = new Map();
  for (const comandante of estado.comandantes ?? []) tomadas.set(comandante.nacaoId, comandante);
  const minhaAtual = minhaNacao();

  // Quantas nações cada uma alcança: ajuda a escolher sem precisar de tutorial
  const descricaoDeAlcance = (nacao) => {
    const minhas = estado.provincias.filter((p) => p.dono === nacao.id);
    const porMar = new Set();
    for (const provincia of minhas) {
      for (const id of provincia.vizinhosMaritimos ?? []) {
        const outra = porId.get(id);
        if (outra !== undefined && outra.dono !== nacao.id) porMar.add(outra.dono);
      }
    }
    const temFronteira = minhas.some((p) => p.vizinhos.some((id) => porId.get(id)?.dono !== nacao.id));
    if (temFronteira) return porMar.size > 0 ? "Fronteira terrestre e rotas marítimas" : "Só fronteira terrestre";
    return porMar.size > 0 ? "Potência insular: só se chega pelo mar" : "Sem contato com outras nações";
  };

  abrirModal(`
    <h2>Assuma o <span>comando</span></h2>
    <p class="chamada">
      Doze nações, 216 províncias e 360 dias. Cada comandante tem a sua nação:
      uma vez escolhida, ela não fica disponível para outra pessoa.
    </p>

    <div class="linhaDeNome">
      <label for="nomeDeGuerra">Seu nome de comandante</label>
      <input id="nomeDeGuerra" maxlength="24" placeholder="Comandante"
        value="${escaparHtml(localStorage.getItem("supremacia1942:nome") ?? "")}">
      <small>${(estado.comandantes ?? []).length === 0
        ? "Você é o primeiro nesta campanha."
        : `Nesta campanha: ${(estado.comandantes ?? []).map((c) => `${escaparHtml(c.nome)} (${escaparHtml(estado.nacoes.find((n) => n.id === c.nacaoId)?.nome ?? "?")}${c.conectado ? "" : ", offline"})`).join(" · ")}`}</small>
    </div>

    <div class="gradeDeNacoes">${nacoes.map((nacao) => {
      const tomada = tomadas.get(nacao.id);
      const bloqueada = tomada !== undefined && tomada.nacaoId !== minhaAtual;
      const eficiencia = estado.regras?.eficienciaNacional?.[nacao.id];
      const etiqueta = tomada !== undefined
        ? `<em class="ocupada">${escaparHtml(tomada.nome)}${tomada.conectado ? "" : " (offline)"}</em>`
        : nacao.provincias >= 20 ? "<em>Potência continental</em>"
        : nacao.provincias >= 10 ? "<em>Média potência</em>" : "<em>Desafio avançado</em>";
      return `
      <button class="opcaoDeNacao${bloqueada ? " tomada" : ""}" data-nacao="${nacao.id}" ${bloqueada ? "disabled" : ""}>
        <span class="amostra" style="background:${nacao.cor}"></span>
        <strong>${escaparHtml(nacao.nome)}</strong>
        <small>${nacao.provincias} províncias · força ${numero(nacao.forca)}<br>capital: ${escaparHtml(nacao.capital ?? "—")}<br>${escaparHtml(descricaoDeAlcance(nacao))}${eficiencia === undefined ? "" : `<br>indústria ${eficiencia >= 1 ? "+" : ""}${Math.round((eficiencia - 1) * 100)}% por província`}</small>
        ${etiqueta}
      </button>`;
    }).join("")}</div>

    <p class="notaDaSala">
      Para jogar com outra pessoa, abra este mesmo endereço em outro navegador ou
      em outra máquina: cada um escolhe uma nação e a campanha é a mesma. Se você
      recarregar a página, volta para o seu comando.
    </p>
  `);

  const campoDoNome = $("nomeDeGuerra");
  if (campoDoNome !== null) {
    campoDoNome.addEventListener("input", () => {
      localStorage.setItem("supremacia1942:nome", campoDoNome.value.trim());
      enviar({ tipo: "entrar", jogadorId, nome: campoDoNome.value.trim() });
    });
  }
}

function mostrarFimDeJogo(nacaoVencedora) {
  if (fimDeJogoMostrado) return;
  fimDeJogoMostrado = true;
  const venceu = nacaoVencedora === estado?.minhaNacao;
  const vencedora = estado?.nacoes.find((n) => n.id === nacaoVencedora);
  const minha = minhaNacao();

  // O motivo decide o texto: conquista total, supremacia no mapa ou a
  // vantagem no placar quando o prazo da campanha se esgota.
  const motivo = estado?.motivoDaVitoria;
  const comoTerminou = motivo === "aniquilacao"
    ? `A ${escaparHtml(vencedora?.nome ?? "última potência")} ficou sozinha no mapa: todas as outras nações foram eliminadas.`
    : motivo === "supremacia"
      ? `A ${escaparHtml(vencedora?.nome ?? "sua nação")} passou da fatia do mapa que garante a supremacia no dia ${estado?.dia}.`
      : `O prazo da campanha terminou no dia ${estado?.dia} e a ${escaparHtml(vencedora?.nome ?? "maior potência")} estava na frente.`;
  const placar = [...(estado?.nacoes ?? [])]
    .sort((a, b) => b.provincias - a.provincias)
    .slice(0, 4)
    .map((n) => `<div class="linhaDoPlacar">
      <span class="amostra" style="background:${n.cor}"></span>
      <strong>${escaparHtml(n.nome)}</strong>
      <span>${n.provincias} províncias · força ${numero(n.forca)}</span>
    </div>`).join("");
  abrirModal(`
    <div class="bandeiraFinal">
      <div class="${venceu ? "vitoria" : "derrota"}">
        <span class="amostra" style="background:${vencedora?.cor ?? "#666"}"></span>
        <div class="tituloFinal">${venceu ? "Vitória" : "Fim da campanha"}</div>
        <p class="chamada" style="margin-bottom:0">
          ${comoTerminou}
          ${minha !== null && !venceu ? ` A ${escaparHtml(minha.nome)} terminou com ${minha.provincias} províncias.` : ""}
        </p>
      </div>
    </div>
    <div class="tabelaFinal">
      <span>Dias de campanha</span><b>${estado?.dia}</b>
      <span>Províncias em disputa</span><b>${estado?.totalDeProvincias}</b>
      <span>Nações ainda de pé</span><b>${estado?.nacoes.filter((n) => !n.eliminada).length}</b>
      <span>Comandantes humanos</span><b>${(estado?.comandantes ?? []).length}</b>
    </div>
    <div class="placarFinal"><h4>Como terminou</h4>${placar}</div>
    <div style="text-align:center;margin-top:22px">
      <button class="acao" data-nova-campanha>Nova campanha</button>
    </div>
  `);
}

document.addEventListener("click", (evento) => {
  if (evento.target.dataset?.acao === "recarregar") location.reload();
  if (evento.target.closest("[data-nova-campanha]") !== null) {
    fecharModal();
    enviar({ tipo: "novaCampanha" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Atualização geral a cada retrato recebido do servidor
// ─────────────────────────────────────────────────────────────────────────────

let primeiraAtualizacao = true;
let jaEnquadrou = false;

function aoAtualizarEstado() {
  reindexar();
  pintarPlacar();
  if ($("legenda").childElementCount === 0) pintarLegenda();
  pintarComunicados();
  pintarRecursos();
  pintarControlesDeTempo();

  const minha = minhaNacao();
  $("nomeDaMinhaNacao").textContent = minha === null ? "— sem comando —" : minha.nome;
  $("resumoDaNacao").textContent = minha === null
    ? "escolha uma nação para começar"
    : `${minha.provincias} províncias · força ${numero(minha.forca)}`;
  $("bolhaCor").style.background = minha?.cor ?? "#333";

  if (painelDesatualizado()) {
    if (abaAtiva === "provincia") pintarPainelDeProvincia();
    else if (abaAtiva === "nacao") pintarPainelDaNacao();
    else pintarPainelDeGuerra();
  }

  if (estado.minhaNacao !== null && !jaEnquadrou) {
    jaEnquadrou = true;
    provinciaSelecionada = estado.nacoes.find((n) => n.ehVoce)?.capital ?? null;
    const capital = estado.provincias.find((p) => p.nome === provinciaSelecionada);
    provinciaSelecionada = capital?.id ?? null;
    ajustarParaMeuTerritorio();
    if (abaAtiva === "provincia") pintarPainelDeProvincia();
  }

  if (primeiraAtualizacao && estado.minhaNacao === null) {
    primeiraAtualizacao = false;
    mostrarEscolhaDeNacao();
  } else if (primeiraAtualizacao) {
    primeiraAtualizacao = false;
  } else if (estado.minhaNacao !== null && document.querySelector(".opcaoDeNacao") !== null) {
    // A nação foi escolhida em outra aba: fecha a escolha aqui também
    fecharModal();
  }

  if (estado.vencedor === null) fimDeJogoMostrado = false;
  if (estado.vencedor !== null && !fimDeJogoMostrado) mostrarFimDeJogo(estado.vencedor);

  // Campanha nova: ninguém tem nação até escolher outra vez
  if (precisaEscolher && estado.minhaNacao === null && document.querySelector(".opcaoDeNacao") === null) {
    precisaEscolher = false;
    mostrarEscolhaDeNacao();
  }
}

/**
 * Repinta os painéis a cada retrato. Barato o bastante para rodar 5x por
 * segundo e garante que o texto nunca fique desatualizado em relação ao
 * servidor — o painel é sempre um espelho fiel do estado oficial.
 */
function painelDesatualizado() { return true; }

// ─────────────────────────────────────────────────────────────────────────────
// Início
// ─────────────────────────────────────────────────────────────────────────────

function inicio() {
  dimensionarCanvas();
  ajustarParaMeuTerritorio();
  conectar();
  requestAnimationFrame(lacoDeDesenho);

  const observarRedimensionamento = new ResizeObserver(() => dimensionarCanvas());
  observarRedimensionamento.observe($("areaDoMapa"));
}

inicio();
