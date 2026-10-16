/**
 * Teste de dois navegadores na mesma campanha.
 *
 * Duas paginas de verdade (jsdom) conectadas ao mesmo servidor, cada uma com o
 * seu jogador: uma escolhe uma nacao, a outra tenta a mesma e e recusada, e as
 * duas passam a se ver. E o caminho que a campanha multiplayer usa.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import pacoteWs from "ws";

// O pacote `ws` é CommonJS: o padrão já é a classe
const SocketDoNode = pacoteWs.WebSocket ?? pacoteWs;

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const PORTA = 3418;
const ENDERECO = `http://127.0.0.1:${PORTA}`;

let servidor = null;
const navegadores = [];

const esperar = (condicao, descricao, limite = 20000) => new Promise((resolver, rejeitar) => {
  const inicio = Date.now();
  const conferir = async () => {
    let resultado;
    try {
      resultado = await condicao();
    } catch (erro) {
      return rejeitar(new Error(`erro na espera: ${descricao} — ${erro.message}`));
    }
    if (resultado) return resolver(resultado);
    if (Date.now() - inicio > limite) return rejeitar(new Error(`tempo esgotado: ${descricao}`));
    setTimeout(conferir, 50);
  };
  conferir();
});

/** Um contexto 2D de mentira: o jsdom não desenha, só não pode explodir. */
function contextoDeMentira() {
  const gradiente = { addColorStop() {} };
  const alvo = {};
  return new Proxy(alvo, {
    get(objeto, propriedade) {
      if (typeof propriedade === "symbol") return undefined;
      if (propriedade in objeto) return objeto[propriedade];
      if (propriedade === "createRadialGradient" || propriedade === "createLinearGradient") return () => gradiente;
      if (propriedade === "createPattern") return () => ({ setTransform() {} });
      if (propriedade === "measureText") return (texto) => ({ width: String(texto).length * 6 });
      if (propriedade === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
      return () => undefined;
    },
    set(objeto, propriedade, valor) {
      objeto[propriedade] = valor;
      return true;
    },
  });
}

/** Abre o jogo como se fosse um navegador novo, com nome de comandante. */
async function abrirNavegador(nome, { jogadorId = null } = {}) {
  const erros = [];
  const consoleVirtual = new VirtualConsole();
  consoleVirtual.on("jsdomError", (erro) => erros.push(erro.message));
  consoleVirtual.on("error", (...argumentos) => erros.push(argumentos.join(" ")));

  const html = await (await fetch(`${ENDERECO}/`)).text();
  const dom = new JSDOM(html, {
    url: `${ENDERECO}/`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: consoleVirtual,
  });
  const janela = dom.window;
  janela.HTMLCanvasElement.prototype.getContext = () => contextoDeMentira();
  janela.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  janela.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.id === "mapa") return { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 };
    return { x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 };
  };
  janela.Element.prototype.setPointerCapture = () => {};

  if (nome !== null) janela.localStorage.setItem("supremacia1942:nome", nome);
  if (jogadorId !== null) janela.localStorage.setItem("supremacia1942:jogador", jogadorId);

  const codigoDoCliente = await (await fetch(`${ENDERECO}/jogo.js`)).text();
  janela.eval(codigoDoCliente);

  const navegador = { nome, dom, janela, erros, $: (id) => janela.document.getElementById(id) };
  navegadores.push(navegador);
  return navegador;
}

const clicar = (janela, elemento) =>
  elemento.dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));

before(async () => {
  servidor = spawn(process.execPath, ["server/index.mjs"], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(PORTA), SEMENTE: "1942" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let saidaDoServidor = "";
  servidor.stdout.on("data", (pedaco) => { saidaDoServidor += pedaco; });
  servidor.stderr.on("data", (pedaco) => { saidaDoServidor += pedaco; });
  await esperar(async () => {
    try {
      return (await fetch(`${ENDERECO}/saude`)).ok;
    } catch {
      return false;
    }
  }, "o servidor subir");
  assert.ok(!saidaDoServidor.includes("Error"), saidaDoServidor);
});

after(() => {
  for (const navegador of navegadores) navegador.dom.window.close();
  servidor?.kill("SIGTERM");
});

test("dois navegadores na mesma campanha, cada um com a sua nação", async () => {
  // ── A primeira comandante escolhe a Alemanha ──
  const ana = await abrirNavegador("Ana");
  const escolhasDaAna = await esperar(
    () => ana.janela.document.querySelectorAll(".opcaoDeNacao").length > 0 && ana.janela.document,
    "a tela de escolha de nação abrir para a Ana",
  );
  assert.ok(escolhasDaAna !== null);
  assert.equal(ana.$("nomeDaMinhaNacao").textContent, "— sem comando —");

  clicar(ana.janela, ana.janela.document.querySelector('[data-nacao="de"]'));
  await esperar(
    () => ana.$("nomeDaMinhaNacao").textContent === "Alemanha",
    "a Ana assumir a Alemanha",
  );

  // ── O segundo comandante vê a Alemanha ocupada ──
  const bia = await abrirNavegador("Bia");
  const opcaoOcupada = await esperar(() => {
    const opcao = bia.janela.document.querySelector('[data-nacao="de"]');
    return opcao !== null && opcao.classList.contains("tomada") ? opcao : null;
  }, "a Bia ver a Alemanha como ocupada");
  assert.ok(opcaoOcupada.disabled, "a nação ocupada não ficou desabilitada");
  assert.match(opcaoOcupada.textContent, /Ana/, "o nome do outro comandante não aparece na opção");

  // Se insistir, o servidor recusa
  clicar(bia.janela, opcaoOcupada);
  await esperar(
    () => /comando de outro jogador/i.test(bia.$("brinde").textContent),
    "o servidor recusar a nação ocupada",
  );
  assert.equal(bia.$("nomeDaMinhaNacao").textContent, "— sem comando —", "a Bia assumiu a nação da Ana");

  // ── A Bia pega outra nação e as duas aparecem na lista de comandantes ──
  clicar(bia.janela, bia.janela.document.querySelector('[data-nacao="fr"]'));
  await esperar(() => bia.$("nomeDaMinhaNacao").textContent === "França", "a Bia assumir a França");

  // O painel da nação só é pintado quando está na frente: abre a aba nele
  const abrirAbaDaNacao = (navegador) => clicar(
    navegador.janela,
    navegador.janela.document.querySelector('[data-aba="nacao"]'),
  );
  abrirAbaDaNacao(ana);
  abrirAbaDaNacao(bia);

  const listaDaAna = await esperar(() => {
    const texto = ana.$("painelNacao").textContent;
    return texto.includes("Ana") && texto.includes("Bia") ? texto : null;
  }, "as duas comandantes aparecerem no painel da Ana");
  assert.match(listaDaAna, /Alemanha/, "a nação da Ana não aparece na lista");
  assert.match(listaDaAna, /França/, "a nação da Bia não aparece na lista");

  // ── As duas veem o mesmo mundo, no mesmo dia ──
  const diaDaAna = await esperar(() => {
    const dia = ana.$("dia").textContent;
    return dia !== "" && dia !== "—" ? dia : null;
  }, "a Ana ver o dia");
  const diaDaBia = bia.$("dia").textContent;
  assert.equal(diaDaBia, diaDaAna, "as duas páginas mostram dias diferentes");

  // O servidor confirma: dois comandantes, duas nações diferentes
  const retrato = await (await fetch(`${ENDERECO}/api/estado`)).json();
  assert.equal(retrato.comandantes.length, 2, "o servidor não registrou dois comandantes");
  const nacoesTomadas = new Set(retrato.comandantes.map((c) => c.nacaoId));
  assert.equal(nacoesTomadas.size, 2, "as duas comandantes ficaram com a mesma nação");
  assert.equal(retrato.jogadoresConectados, 2);

  assert.deepEqual(ana.erros, [], `erros na página da Ana: ${ana.erros.join(" | ")}`);
  assert.deepEqual(bia.erros, [], `erros na página da Bia: ${bia.erros.join(" | ")}`);
});

test("recarregar a página devolve o comando em vez de virar outro jogador", async () => {
  const retrato = await (await fetch(`${ENDERECO}/api/estado`)).json();
  const ana = retrato.comandantes.find((c) => c.nome === "Ana");
  assert.ok(ana !== undefined, "a Ana sumiu da campanha");

  // A mesma página recarregada: mesmo jogador no localStorage, mesmo comando
  const anaDeNovo = await abrirNavegador("Ana", { jogadorId: ana.jogadorId });
  await esperar(
    () => anaDeNovo.$("nomeDaMinhaNacao").textContent === "Alemanha",
    "a Ana voltar para a Alemanha depois de recarregar",
  );

  // E não virou um terceiro comandante
  const depois = await (await fetch(`${ENDERECO}/api/estado`)).json();
  assert.equal(depois.comandantes.length, 2, "recarregar criou um comandante a mais");
  assert.equal(depois.comandantes.filter((c) => c.nacaoId === ana.nacaoId).length, 1);

  // O retrato entregue ao jogador marca a nação dele
  const meu = await (await fetch(`${ENDERECO}/api/estado?jogadorId=${encodeURIComponent(ana.jogadorId)}`)).json();
  const minha = meu.nacoes.find((n) => n.ehVoce);
  assert.equal(minha.nome, "Alemanha", "o servidor não reconheceu o jogador que voltou");
  assert.ok(meu.provincias.some((p) => p.dono === "de" && p.custosDeConstrucao !== undefined),
    "o retrato do dono não trouxe os custos das construções");
});

test("um observador sem nação não derruba o servidor", async () => {
  const socket = new SocketDoNode(`ws://127.0.0.1:${PORTA}`);
  const recebidas = [];
  socket.on("message", (bruto) => recebidas.push(JSON.parse(bruto.toString())));
  await new Promise((resolver) => socket.on("open", resolver));

  socket.send(JSON.stringify({ tipo: "entrar", jogadorId: `observador-${Date.now()}`, nome: "Curioso" }));
  // Comandos de governo sem nação escolhida: o motor precisa recusar, não estourar
  for (const comando of [
    { tipo: "adotarDoutrina", doutrinaId: "propaganda" },
    { tipo: "proporPacto", nacaoId: "es", tipoDePacto: "naoAgressao" },
    { tipo: "declararGuerra", nacaoId: "es" },
    { tipo: "enviarAjuda", nacaoId: "es", recurso: "dinheiro", quantidade: 10 },
  ]) {
    socket.send(JSON.stringify({ tipo: "comando", comando }));
  }

  const respostas = await esperar(
    () => recebidas.filter((m) => m.tipo === "resultado").length >= 4
      ? recebidas.filter((m) => m.tipo === "resultado") : null,
    "o servidor responder aos quatro comandos do observador",
  );
  for (const resposta of respostas) {
    assert.equal(resposta.ok, false, `o observador conseguiu executar ${resposta.comando.tipo}`);
    assert.match(resposta.texto, /escolheu uma nacao/i);
  }

  // O servidor continua de pé e a campanha continua servindo o retrato
  const saude = await (await fetch(`${ENDERECO}/saude`)).json();
  assert.equal(saude.ok, true, "o servidor caiu depois dos comandos do observador");
  assert.equal(saude.dia >= 0, true);
  socket.close();
});

test("a campanha nova devolve o mapa e todos escolhem de novo", async () => {
  const antes = await (await fetch(`${ENDERECO}/api/estado`)).json();
  assert.ok(antes.dia >= 0);

  // Um dos comandantes pede campanha nova
  const pedido = await new Promise((resolver) => {
    const socket = new SocketDoNode(`ws://127.0.0.1:${PORTA}`);
    socket.on("open", () => {
      socket.send(JSON.stringify({ tipo: "entrar", jogadorId: "quem-pediu", nome: "Quem pediu" }));
      socket.send(JSON.stringify({ tipo: "novaCampanha" }));
      resolver(socket);
    });
  });
  const reiniciada = await esperar(async () => {
    const agora = await (await fetch(`${ENDERECO}/api/estado`)).json();
    return agora.dia <= antes.dia && agora.vencedor === null ? agora : null;
  }, "a campanha nova começar do dia zero");
  assert.equal(reiniciada.dia, 0, `a campanha nova começou no dia ${reiniciada.dia}`);
  assert.equal(reiniciada.comandantes.length, 0, "a campanha nova já veio com nações ocupadas");

  // E o cliente volta para a tela de escolha
  const pagina = await abrirNavegador("Recém-chegado");
  const escolha = await esperar(
    () => pagina.janela.document.querySelectorAll(".opcaoDeNacao").length > 0
      ? pagina.janela.document.querySelectorAll(".opcaoDeNacao").length : null,
    "a tela de escolha abrir na campanha nova",
  );
  assert.ok(escolha >= 12, `só ${escolha} nações apareceram na campanha nova`);
  pedido.close();
});
