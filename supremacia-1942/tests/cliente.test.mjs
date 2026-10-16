/**
 * Teste de integração do cliente.
 *
 * Sobe o servidor de verdade, carrega public/index.html num DOM (jsdom) e
 * verifica que a pagina se conecta, recebe o estado, desenha o mapa e responde
 * a cliques. E o mais perto de um navegador que da para chegar sem navegador —
 * e cobre justamente o caminho que o jogador vai usar.
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
const PORTA = 3417;
const ENDERECO = `http://127.0.0.1:${PORTA}`;

let servidor = null;
let dom = null;
let janela = null;
const errosDaPagina = [];
const chamadasDeDesenho = new Map();

/** Contexto 2D falso: registra o que o cliente tentou desenhar. */
function criarContexto2d() {
  const registro = (nome) => {
    chamadasDeDesenho.set(nome, (chamadasDeDesenho.get(nome) ?? 0) + 1);
  };
  const gradiente = { addColorStop() {} };
  const especiais = {
    createRadialGradient: () => gradiente,
    createLinearGradient: () => gradiente,
    createPattern: () => ({ setTransform() {} }),
    measureText: (texto) => ({ width: String(texto).length * 6 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  const alvo = {};
  return new Proxy(alvo, {
    get(objeto, propriedade) {
      if (typeof propriedade === "symbol") return undefined;
      if (propriedade in objeto) return objeto[propriedade];
      if (propriedade in especiais) return especiais[propriedade];
      return (...argumentos) => {
        registro(propriedade);
        void argumentos;
        return undefined;
      };
    },
    set(objeto, propriedade, valor) {
      objeto[propriedade] = valor;
      return true;
    },
  });
}

const esperar = (condicao, descricao, limite = 15000) => new Promise((resolver, rejeitar) => {
  const inicio = Date.now();
  const conferir = async () => {
    let resultado;
    try {
      resultado = await condicao();
    } catch (erro) {
      rejeitar(new Error(`${descricao} — exceção: ${erro.message}`));
      return;
    }
    if (resultado) resolver(resultado);
    else if (Date.now() - inicio > limite) rejeitar(new Error(`tempo esgotado esperando: ${descricao}`));
    else setTimeout(conferir, 40);
  };
  conferir();
});

before(async () => {
  servidor = spawn(process.execPath, ["server/index.mjs"], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(PORTA), SEMENTE: "1942" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  servidor.stderr.on("data", (pedaco) => errosDaPagina.push(`[servidor] ${pedaco}`));

  // Espera o servidor responder
  await esperar(async () => {
    try {
      const resposta = await fetch(`${ENDERECO}/saude`);
      return resposta.ok;
    } catch {
      return false;
    }
  }, "o servidor HTTP subir");

  const consoleVirtual = new VirtualConsole();
  consoleVirtual.on("jsdomError", (erro) => errosDaPagina.push(erro.message));
  consoleVirtual.on("error", (...argumentos) => errosDaPagina.push(argumentos.join(" ")));

  // O jsdom nao executa <script type="module">, entao a pagina e montada a
  // partir do HTML servido e o cliente e injetado depois, ja com os dubles.
  const html = await (await fetch(`${ENDERECO}/`)).text();
  dom = new JSDOM(html, {
    url: `${ENDERECO}/`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: consoleVirtual,
  });
  janela = dom.window;

  // O jsdom nao implementa canvas nem ResizeObserver: entram dublês
  janela.HTMLCanvasElement.prototype.getContext = () => criarContexto2d();
  janela.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Dá um tamanho ao canvas, já que o jsdom não faz layout
  janela.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.id === "mapa") return { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 };
    return { x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 };
  };
  janela.Element.prototype.setPointerCapture = () => {};

  // Agora sim: o cliente roda no contexto da janela, com os dublês no lugar
  const codigoDoCliente = await (await fetch(`${ENDERECO}/jogo.js`)).text();
  janela.eval(codigoDoCliente);
});

after(() => {
  janela?.close();
  servidor?.kill("SIGTERM");
});

test("a página é servida com os arquivos do jogo", async () => {
  for (const caminho of ["/", "/estilo.css", "/jogo.js"]) {
    const resposta = await fetch(`${ENDERECO}${caminho}`);
    assert.equal(resposta.status, 200, `${caminho} não respondeu 200`);
    const corpo = await resposta.text();
    assert.ok(corpo.length > 100, `${caminho} veio praticamente vazio`);
  }
});

test("o servidor se declara pronto em /saude", async () => {
  const resposta = await fetch(`${ENDERECO}/saude`);
  const dados = await resposta.json();
  assert.equal(dados.ok, true);
  assert.equal(typeof dados.dia, "number");
});

test("a página carrega os elementos da interface", () => {
  const documento = janela.document;
  for (const id of ["mapa", "dia", "placar", "comunicados", "recursos", "painelProvincia", "modal"]) {
    assert.ok(documento.getElementById(id) !== null, `faltou o elemento #${id}`);
  }
  assert.ok(documento.querySelector("#topo h1").textContent.includes("SUPREMACIA"));
});

test("o cliente se conecta sozinho e recebe o primeiro estado", async () => {
  await esperar(() => chamadasDeDesenho.size > 0, "o mapa começar a ser desenhado");
  // O placar so é preenchido quando um estado chega
  await esperar(
    () => janela.document.getElementById("placar").children.length === 12,
    "o placar receber as 12 nações vindas do servidor",
  );
});

test("antes de escolher, a barra de recursos convida a escolher uma nação", () => {
  const rodape = janela.document.getElementById("recursos");
  assert.match(rodape.textContent, /escolha uma nação|Aguardando/i);
});

test("o modal de escolha oferece as doze nações", async () => {
  await esperar(() => janela.document.querySelectorAll(".opcaoDeNacao").length === 12,
    "o modal listar as nações");
  const modal = janela.document.getElementById("modal");
  assert.equal(modal.classList.contains("escondido"), false, "o modal deveria estar visível");

  const nomes = [...janela.document.querySelectorAll(".opcaoDeNacao strong")].map((e) => e.textContent);
  assert.ok(nomes.includes("Alemanha"), `nações oferecidas: ${nomes.join(", ")}`);
  assert.ok(nomes.includes("Uniao Sovietica") || nomes.includes("União Soviética"));
});

test("escolher uma nação fecha o modal e o servidor confirma", async () => {
  const opcao = janela.document.querySelector('[data-nacao="de"]');
  assert.ok(opcao !== null, "não há botão para a Alemanha");
  opcao.dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));

  await esperar(() => janela.document.getElementById("modal").classList.contains("escondido"),
    "o modal fechar depois da escolha");
  await esperar(() => janela.document.getElementById("nomeDaMinhaNacao").textContent.includes("Alemanha"),
    "o cabeçalho mostrar a nação escolhida");
});

test("depois da escolha, a barra de recursos mostra os cinco recursos com estoque real", async () => {
  await esperar(() => {
    const valores = [...janela.document.querySelectorAll("#recursos .valor")].map((e) => e.textContent);
    return valores.length === 5 && valores.every((v) => v !== "—");
  }, "os cinco recursos aparecerem com estoque");

  // Os rótulos vêm do nome do recurso que o servidor manda, não de uma lista
  // escrita à mão no cliente.
  const rotulos = [...janela.document.querySelectorAll("#recursos .rotulo")].map((e) => e.textContent);
  const esperados = Object.values((await retratoDoServidor()).regras.nomeDoRecurso);
  assert.deepEqual(rotulos, esperados);
});

test("clicar no mapa seleciona uma província", async () => {
  const canvas = janela.document.getElementById("mapa");
  const evento = (tipo, x, y) => new janela.MouseEvent(tipo, {
    bubbles: true, clientX: x, clientY: y, button: 0,
  });
  canvas.dispatchEvent(evento("pointerdown", 500, 350));
  canvas.dispatchEvent(evento("pointerup", 500, 350));

  await esperar(() => janela.document.getElementById("painelProvincia").textContent.includes("Guarnição"),
    "o painel mostrar os dados de uma província");
});

test("o cliente nunca deixou escapar erro de JavaScript", () => {
  const graves = errosDaPagina.filter((mensagem) =>
    !mensagem.includes("Not implemented") && !mensagem.includes("Could not load"));
  assert.deepEqual(graves, [], `erros na página: ${graves.join(" | ")}`);
});

test("o botão de pausa chega de fato ao servidor", async () => {
  const botao = janela.document.querySelector('[data-velocidade="0"]');
  botao.dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
  await esperar(async () => {
    const resposta = await fetch(`${ENDERECO}/saude`);
    const dados = await resposta.json();
    return dados.velocidade === 0;
  }, "o servidor registrar a pausa");

  // Devolve o ritmo normal para os outros testes não ficarem parados
  janela.document.querySelector('[data-velocidade="1"]')
    .dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
});

test("ligar a velocidade 4x chega ao servidor", async () => {
  janela.document.querySelector('[data-velocidade="4"]')
    .dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
  await esperar(async () => {
    const dados = await (await fetch(`${ENDERECO}/saude`)).json();
    return dados.velocidade === 4;
  }, "o servidor registrar 4x");
  janela.document.querySelector('[data-velocidade="1"]')
    .dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
});

test("as abas trocam de painel", () => {
  const documento = janela.document;
  documento.querySelector('[data-aba="nacao"]').dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
  assert.ok(documento.getElementById("painelNacao").classList.contains("ativo"));
  assert.ok(!documento.getElementById("painelProvincia").classList.contains("ativo"));

  documento.querySelector('[data-aba="guerra"]').dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
  assert.ok(documento.getElementById("painelGuerra").classList.contains("ativo"));

  documento.querySelector('[data-aba="provincia"]').dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
  assert.ok(documento.getElementById("painelProvincia").classList.contains("ativo"));
});

test("o manual abre, descreve as unidades vindas do servidor e fecha", async () => {
  const documento = janela.document;
  documento.getElementById("abrirAjuda").dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));

  const conteudo = documento.getElementById("conteudoDoModal");
  assert.ok(conteudo.textContent.includes("Como"), "o manual não abriu");

  // Os números do manual têm de ser os do catálogo do servidor
  const catalogo = await (await fetch(`${ENDERECO}/saude`)).json();
  void catalogo;
  for (const nome of ["Infantaria", "Blindado", "Artilharia", "Quartel", "Fazenda", "Fortificacao"]) {
    assert.ok(conteudo.textContent.includes(nome), `o manual não fala de ${nome}`);
  }
  assert.ok(/Cerco|cerco/.test(conteudo.textContent), "o manual não explica a regra de cerco");
  assert.ok(/anfíbia|desembarc/i.test(conteudo.textContent), "o manual não explica a operação anfíbia");

  const fechar = conteudo.querySelector('[data-acao="fechar-modal"]');
  assert.ok(fechar !== null, "o manual não tem botão de fechar");
  fechar.dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
  await esperar(() => documento.getElementById("modal").classList.contains("escondido"),
    "o manual fechar");
});

test("a legenda do mapa é preenchida", () => {
  const itens = janela.document.querySelectorAll("#legenda span");
  assert.ok(itens.length >= 4, `a legenda tem apenas ${itens.length} itens`);
  const texto = janela.document.getElementById("legenda").textContent;
  for (const palavra of ["capital", "construção", "fortificação", "guarnição", "batalha"]) {
    assert.ok(texto.includes(palavra), `a legenda não explica "${palavra}"`);
  }
});

test("o botão de ajuda reabre o manual", async () => {
  janela.document.getElementById("abrirAjuda").dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
  assert.ok(janela.document.getElementById("conteudoDoModal").textContent.includes("Como"));
  janela.document.getElementById("conteudoDoModal")
    .querySelector('[data-acao="fechar-modal"]')
    .dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
});

test("o dia avança no relógio do jogo", async () => {
  await esperar(async () => {
    const dados = await (await fetch(`${ENDERECO}/saude`)).json();
    return dados.dia > 1;
  }, "o servidor avançar os dias");
});


// ─────────────────────────────────────────────────────────────────────────────
// Governo, pesquisa e diplomacia
// ─────────────────────────────────────────────────────────────────────────────

/** O retrato que o servidor está mandando agora, lido por HTTP. */
const retratoDoServidor = async () => await (await fetch(`${ENDERECO}/api/estado`)).json();

/** Abre a aba pedida e devolve o painel correspondente. */
async function abrirAba(nomeDaAba) {
  const botao = janela.document.querySelector(`[data-aba="${nomeDaAba}"]`);
  assert.ok(botao !== null, `a aba ${nomeDaAba} não existe`);
  botao.dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
  const painel = { nacao: "painelNacao", provincia: "painelProvincia", guerra: "painelGuerra" }[nomeDaAba];
  return janela.document.getElementById(painel);
}

test("o painel do governo mostra o moral e as doutrinas vindas do servidor", async () => {
  const painel = await abrirAba("nacao");
  const texto = painel.textContent;

  assert.ok(texto.includes("Moral do povo"), "faltou o moral");
  assert.ok(texto.includes("Governo"), "faltou o bloco de governo");
  assert.ok(painel.querySelector(".barraMoral") !== null, "faltou a barra de moral");

  // As doutrinas do catálogo do servidor (não escritas à mão no cliente)
  const catalogo = (await retratoDoServidor()).regras.doutrinas;
  assert.ok(catalogo.length >= 6, `o servidor enviou só ${catalogo.length} doutrinas`);
  const cartoes = painel.querySelectorAll("[data-doutrina]");
  assert.equal(cartoes.length, catalogo.length, "nem todas as doutrinas apareceram");
});

test("adotar uma doutrina chega ao servidor e muda o painel", async () => {
  const painel = await abrirAba("nacao");
  const botao = [...painel.querySelectorAll("[data-doutrina]")].find((b) => !b.disabled);
  assert.ok(botao !== undefined, "nenhuma doutrina podia ser adotada");
  const id = botao.dataset.doutrina;

  botao.dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
  await esperar(() => {
    const atualizado = janela.document.querySelector(`[data-doutrina="${id}"]`);
    return atualizado !== null && atualizado.classList.contains("ativo");
  }, `a doutrina ${id} entrar em vigor`);
});

test("a pesquisa lista os avanços com preço e progresso do servidor", async () => {
  const painel = await abrirAba("nacao");
  const texto = painel.textContent;
  assert.ok(texto.includes("Pesquisa"), "faltou o bloco de pesquisa");
  assert.match(texto, /pontos acumulados/, "faltou o rendimento por dia");

  const avancos = painel.querySelectorAll("[data-pesquisar]");
  const catalogo = (await retratoDoServidor()).regras.avancos;
  assert.equal(avancos.length, catalogo.length, "nem todos os avanços apareceram");

  // Cada cartão diz por que está bloqueado (pontos que faltam ou dependência)
  const rotulos = [...painel.querySelectorAll(".cartaoAvancado .preco")].map((e) => e.textContent);
  assert.ok(rotulos.some((r) => /faltam|pontos|concluído|requer/.test(r)),
    `nenhum cartão explicou o próprio estado: ${rotulos.join(" | ")}`);
});

test("a mesma nação não pode ter dois comandantes", async () => {
  const abrir = (nome, nacaoId = null) => new Promise((resolver) => {
    const socket = new SocketDoNode(`ws://127.0.0.1:${PORTA}`);
    const recebidas = [];
    socket.on("message", (bruto) => recebidas.push(JSON.parse(bruto.toString())));
    socket.on("open", () => {
      socket.send(JSON.stringify({ tipo: "entrar", jogadorId: `teste-${nome}`, nome }));
      if (nacaoId !== null) socket.send(JSON.stringify({ tipo: "escolherNacao", nacaoId }));
      resolver({ socket, recebidas });
    });
  });

  // Primeiro comandante: entra, olha o mundo e pega uma nação ainda livre
  const ana = await abrir("Ana");
  const primeiroEstado = await esperar(
    () => ana.recebidas.find((m) => m.tipo === "estado")?.estado ?? null,
    "o estado chegar para a Ana",
  );
  const tomadas = new Set((primeiroEstado.comandantes ?? []).map((c) => c.nacaoId));
  const livre = primeiroEstado.nacoes.find((n) => !tomadas.has(n.id) && !n.eliminada);
  assert.ok(livre !== undefined, "não sobrou nação livre para o teste");

  ana.socket.send(JSON.stringify({ tipo: "escolherNacao", nacaoId: livre.id }));
  await esperar(
    () => ana.recebidas.some((m) => m.tipo === "nacaoEscolhida" && m.nacaoId === livre.id),
    "a Ana assumir a nação",
  );

  // Segundo comandante: tenta a MESMA nação
  const bia = await abrir("Bia", livre.id);
  const recusa = await esperar(
    () => bia.recebidas.find((m) => m.tipo === "erro") ?? null,
    "a Bia ser recusada",
  );
  assert.match(recusa.motivo, /comando de outro jogador/i);

  // E a lista de comandantes tem os dois, cada um com a sua nação. Ela chega
  // no envio periódico do servidor, então esperamos em vez de ler na hora.
  const retrato = await esperar(() => {
    const ultimo = ana.recebidas.filter((m) => m.tipo === "estado").at(-1)?.estado;
    if (ultimo === undefined) return null;
    return (ultimo.comandantes ?? []).some((c) => c.nome === "Ana") ? ultimo : null;
  }, "a lista de comandantes chegar com a Ana");
  const nomes = (retrato.comandantes ?? []).map((c) => c.nome);
  assert.ok(nomes.includes("Ana"), `a Ana não apareceu na lista: ${nomes.join(", ")}`);
  assert.ok(retrato.comandantes.some((c) => c.nacaoId === livre.id && c.nome === "Ana"),
    "a nação escolhida não ficou registrada no comando da Ana");

  ana.socket.close();
  bia.socket.close();
});

test("a diplomacia mostra relações e oferece pacto e aliança", async () => {
  const painel = await abrirAba("nacao");
  const texto = painel.textContent;
  assert.ok(texto.includes("Diplomacia"), "faltou o bloco de diplomacia");
  assert.match(texto, /relações/, "faltou o valor das relações");

  const pacto = painel.querySelector("[data-pacto]");
  const alianca = painel.querySelector("[data-alianca]");
  const ajuda = painel.querySelector("[data-ajuda]");
  assert.ok(pacto !== null || alianca !== null, "nenhuma proposta diplomática disponível");
  assert.ok(ajuda !== null, "faltou o botão de ajuda econômica");

  // Clicar manda o comando e o servidor responde (aceitando ou recusando)
  const comunicadosAntes = janela.document.getElementById("comunicados").textContent;
  const brindeAntes = janela.document.getElementById("brinde").textContent;
  pacto.dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
  await esperar(() => {
    const brinde = janela.document.getElementById("brinde").textContent;
    const comunicados = janela.document.getElementById("comunicados").textContent;
    return brinde !== brindeAntes || comunicados !== comunicadosAntes;
  }, "o servidor responder à proposta de pacto");
});


/** Abre o manual do jogo e devolve o conteúdo do modal. */
async function abrirManual() {
  const documento = janela.document;
  documento.getElementById("abrirAjuda").dispatchEvent(new janela.MouseEvent("click", { bubbles: true }));
  await esperar(() => documento.getElementById("conteudoDoModal").textContent.includes("Como"),
    "o manual abrir");
  return documento.getElementById("conteudoDoModal");
}

test("o manual explica os sistemas novos, com os números do servidor", async () => {
  const manual = await abrirManual();
  const texto = manual.textContent;
  const regras = (await retratoDoServidor()).regras;

  for (const assunto of ["Pesquisa", "Doutrinas", "Diplomacia", "Comandantes", "Moral", "Indústria"]) {
    assert.ok(texto.includes(assunto), `o manual não fala de ${assunto}`);
  }

  // Os números vêm do servidor: se a regra mudar, o manual muda junto
  assert.ok(texto.includes(String(regras.limiteDeDias)), "o manual não diz o prazo da campanha");
  assert.ok(texto.includes(String(regras.diaMinimoParaVitoria)),
    "o manual não diz a partir de quando vale a vitória por domínio");
  assert.ok(texto.includes(String(regras.limiteDeDoutrinas)), "o manual não diz o limite de doutrinas");
  assert.ok(texto.includes(String(regras.moralInicial)), "o manual não diz o moral inicial");
  assert.ok(texto.includes(String(regras.avancos.length)), "o manual não diz quantos avanços existem");
});
