/**
 * Supremacia 1942 — Servidor autoritativo
 *
 * Responsabilidades:
 *   1. servir os arquivos estaticos de ./public
 *   2. manter o relogio do jogo e avancar os dias
 *   3. receber comandos dos clientes e delegar ao motor de regras
 *   4. enviar a cada cliente apenas o retrato (ja calculado) do estado
 *
 * O cliente NAO decide nada. Ele nao sabe quanto custa um blindado, nao soma
 * producao e nao resolve combate: ele manda um comando e desenha a resposta.
 * Por isso um cliente modificado nao consegue trapacear — o pior que pode
 * fazer e mandar muitos comandos, e para isso existe limite de frequencia.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import {
  criarEstado,
  definirJogador,
  executarComando,
  avancarDia,
  projetarEstado,
  DIAS_POR_SEGUNDO,
} from "./simulation.mjs";

const PORTA = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0";
const RAIZ_PUBLICA = resolve(fileURLToPath(new URL("../public", import.meta.url)));
const INTERVALO_DE_ENVIO_MS = 200; // 5 retratos por segundo por cliente
const MAXIMO_DE_COMANDOS_POR_SEGUNDO = 12;
const VELOCIDADES = [0, 1, 2, 4];

// ─────────────────────────────────────────────────────────────────────────────
// Estado da partida (unico, no servidor)
// ─────────────────────────────────────────────────────────────────────────────

const SEMENTE_BASE = Number(process.env.SEMENTE ?? 1942);
let numeroDaCampanha = 0;
let estado = criarEstado(SEMENTE_BASE + numeroDaCampanha);
let velocidade = 1;
let acumuladorDeDias = 0;
let ultimoInstante = Date.now();

const conexoes = new Map(); // jogadorId -> WebSocket
const nomes = new Map(); // jogadorId -> como o jogador quer ser chamado
const ultimaConexao = new Map(); // jogadorId -> instante em que esteve online
const MINUTOS_DE_RESERVA = 5; // quanto tempo a nacao fica guardada para quem caiu

function registrar(estado, texto) {
  estado.eventos.push({ dia: estado.dia, texto, importante: false });
  if (estado.eventos.length > 400) estado.eventos.splice(0, estado.eventos.length - 400);
}

// ─────────────────────────────────────────────────────────────────────────────
// Servidor HTTP (estatico)
// ─────────────────────────────────────────────────────────────────────────────

const TIPOS_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function servirArquivo(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  let caminhoRelativo = decodeURIComponent(url.pathname);
  if (caminhoRelativo === "/") caminhoRelativo = "/index.html";

  // Defesa contra path traversal: o caminho resolvido tem de ficar dentro de
  // public/.
  //
  // A barra inicial precisa sair ANTES do resolve: resolve() trata um caminho
  // comecando em "/" como absoluto do sistema de arquivos e descartaria a
  // pasta public, transformando toda requisicao legitima em 403.
  const relativo = normalize(caminhoRelativo).replace(/^[/\\]+/, "");
  const destino = resolve(RAIZ_PUBLICA, relativo);
  if (destino !== RAIZ_PUBLICA && !destino.startsWith(RAIZ_PUBLICA + sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("403 — caminho fora da pasta publica");
    return;
  }

  try {
    const informacao = await stat(destino);
    if (!informacao.isFile()) throw new Error("nao e arquivo");
    const conteudo = await readFile(destino);
    res.writeHead(200, {
      "Content-Type": TIPOS_MIME[extname(destino).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": conteudo.length,
      "Cache-Control": "no-cache",
      // Sem X-Frame-Options nem frame-ancestors: a previa roda dentro de um
      // iframe e precisa poder carregar esta pagina.
      "Access-Control-Allow-Origin": "*",
    });
    res.end(conteudo);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 — arquivo nao encontrado");
  }
}

const servidorHttp = createServer((req, res) => {
  const caminho = (req.url ?? "/").split("?")[0];

  if (caminho === "/saude") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, dia: estado.dia, jogadores: conexoes.size, velocidade }));
    return;
  }

  // O retrato da campanha tambem sai por HTTP: e o que o cliente recebe pelo
  // WebSocket, em JSON puro. Serve para diagnostico, para ferramentas de fora e
  // para os testes conferirem o que o servidor esta mandando sem depender do
  // estado interno do navegador.
  if (caminho === "/api/estado") {
    const consulta = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const comoJogador = consulta.searchParams.get("jogadorId");
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(retratoDe(comoJogador)));
    return;
  }
  servirArquivo(req, res).catch(() => {
    res.writeHead(500).end("500");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: servidorHttp });

const enviar = (ws, mensagem) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(mensagem));
};

function nomeSugerido() {
  const nomes = ["Comando", "Frente", "Estado-Maior", "Quartel-General", "Diretoria"];
  return `${nomes[Math.floor(Math.random() * nomes.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
}

/**
 * Uma nacao esta tomada se outro jogador a escolheu e ainda tem direito a ela.
 * Quem cai da conexao mantem a nacao por alguns minutos: perder a partida
 * porque o wifi oscilou seria cruel.
 */
/** O comunicado avisa a todos quem assumiu qual nacao. */
function registrarEventoDeEntrada(comandante, nomeDaNacao) {
  const evento = `${comandante} assumiu o comando da ${nomeDaNacao}.`;
  estado.eventos.push({ dia: estado.dia, texto: evento });
  if (estado.eventos.length > 200) estado.eventos.shift();
}

function nacaoEstaTomada(nacaoId, exceto) {
  const agora = Date.now();
  for (const [outroJogador, nacao] of estado.jogadores) {
    if (outroJogador === exceto || nacao !== nacaoId) continue;
    if (conexoes.has(outroJogador)) return true;
    const visto = ultimaConexao.get(outroJogador) ?? 0;
    if (agora - visto < MINUTOS_DE_RESERVA * 60 * 1000) return true;
  }
  return false;
}

/**
 * Comeca uma campanha nova, com outro mundo.
 *
 * O botao de fim de jogo recarregava a pagina, o que nao adiantava de nada: a
 * partida ja tinha acabado no servidor. Agora ele pede uma campanha nova de
 * verdade — mundo novo, todas as nacoes de volta ao mapa e todo mundo
 * escolhendo de novo, sem reiniciar o servidor.
 */
function reiniciarCampanha() {
  numeroDaCampanha += 1;
  estado = criarEstado(SEMENTE_BASE + numeroDaCampanha);
  acumuladorDeDias = 0;
  velocidade = 1;
  for (const jogadorId of conexoes.keys()) estado.jogadores.set(jogadorId, null);
  console.log(`  campanha ${numeroDaCampanha + 1} no ar (semente ${estado.semente})`);
  return { semente: estado.semente, campanha: numeroDaCampanha + 1 };
}

/** Quem esta na sala: nome, nacao escolhida e se esta online agora. */
function listarComandantes(euMesmo) {
  const lista = [];
  for (const [jogadorId, nacaoId] of estado.jogadores) {
    if (nacaoId === null) continue;
    lista.push({
      jogadorId,
      nome: nomes.get(jogadorId) ?? "Comandante",
      nacaoId,
      conectado: conexoes.has(jogadorId),
      ehVoce: jogadorId === euMesmo,
    });
  }
  lista.sort((a, b) => a.nome.localeCompare(b.nome));
  return lista;
}

/** O retrato vai para o jogador com o que ele pode saber sobre os outros. */
function retratoDe(jogadorId) {
  const retrato = projetarEstado(estado, jogadorId);
  retrato.comandantes = listarComandantes(jogadorId);
  retrato.jogadoresConectados = [...conexoes.keys()].length;
  return retrato;
}

wss.on("connection", (ws) => {
  // O cliente sugere um id (guardado no localStorage). Assim, ao recarregar a
  // pagina, ele volta para a mesma nacao em vez de virar um jogador novo.
  let jogadorId = null;
  const comandosRecentes = [];

  ws.enviar = (mensagem) => enviar(ws, mensagem);

  ws.on("message", (bruto) => {
    let mensagem;
    try {
      mensagem = JSON.parse(bruto.toString());
    } catch {
      return enviar(ws, { tipo: "erro", motivo: "Mensagem malformada." });
    }
    if (mensagem === null || typeof mensagem !== "object") return;

    switch (mensagem.tipo) {
      case "entrar": {
        jogadorId = String(mensagem.jogadorId ?? nomeSugerido()).slice(0, 40);
        const anterior = conexoes.get(jogadorId);
        if (anterior !== undefined && anterior !== ws) anterior.close(4000, "Outra aba assumiu este comando.");
        conexoes.set(jogadorId, ws);
        ultimaConexao.set(jogadorId, Date.now());
        if (!estado.jogadores.has(jogadorId)) estado.jogadores.set(jogadorId, null);
        if (typeof mensagem.nome === "string" && mensagem.nome.trim() !== "") {
          nomes.set(jogadorId, mensagem.nome.trim().slice(0, 24));
        } else if (!nomes.has(jogadorId)) {
          nomes.set(jogadorId, `Comandante ${nomes.size + 1}`);
        }
        enviar(ws, {
          tipo: "bemVindo",
          jogadorId,
          nome: nomes.get(jogadorId),
          dia: estado.dia,
          velocidades: VELOCIDADES,
          velocidade,
          mensagem: estado.jogadores.get(jogadorId) === null
            ? "Conexao estabelecida. Escolha sua nacao."
            : "Bem-vindo de volta ao comando.",
        });
        break;
      }

      case "escolherNacao": {
        if (jogadorId === null) return enviar(ws, { tipo: "erro", motivo: "Envie 'entrar' primeiro." });
        const nacaoId = String(mensagem.nacaoId ?? "");
        if (!estado.nacoes.has(nacaoId)) {
          return enviar(ws, { tipo: "erro", motivo: "Nacao inexistente." });
        }
        if (nacaoEstaTomada(nacaoId, jogadorId)) {
          return enviar(ws, { tipo: "erro", motivo: "Essa nacao ja esta sob comando de outro jogador." });
        }
        const resultado = definirJogador(estado, jogadorId, nacaoId);
        if (resultado.ok === false) return enviar(ws, { tipo: "erro", motivo: resultado.motivo });
        const comandante = nomes.get(jogadorId) ?? "Comandante";
        registrarEventoDeEntrada(comandante, estado.nacoes.get(nacaoId).nome);
        enviar(ws, {
          tipo: "nacaoEscolhida",
          nacaoId,
          nome: estado.nacoes.get(nacaoId).nome,
        });
        break;
      }

      case "novaCampanha": {
        if (jogadorId === null) return;
        const campanha = reiniciarCampanha();
        for (const cliente of wss.clients) {
          enviar(cliente, {
            tipo: "campanhaReiniciada",
            semente: campanha.semente,
            campanha: campanha.campanha,
          });
        }
        break;
      }

      case "comando": {
        if (jogadorId === null) return;
        // Limite de frequencia: janela deslizante de 1 segundo
        const agora = Date.now();
        while (comandosRecentes.length > 0 && agora - comandosRecentes[0] > 1000) comandosRecentes.shift();
        if (comandosRecentes.length >= MAXIMO_DE_COMANDOS_POR_SEGUNDO) {
          return enviar(ws, { tipo: "erro", motivo: "Calma: comandos demais em um segundo." });
        }
        comandosRecentes.push(agora);

        // Um comando nunca derruba o servidor. Se o motor estourar, o cliente
        // recebe a recusa com o motivo e a partida continua para os outros.
        let resultado;
        try {
          resultado = executarComando(estado, jogadorId, mensagem.comando ?? {});
        } catch (erro) {
          console.error("comando falhou:", erro);
          resultado = { ok: false, motivo: "O servidor recusou o comando por erro interno." };
        }
        enviar(ws, {
          tipo: "resultado",
          ok: resultado.ok,
          texto: resultado.ok ? resultado.evento : resultado.motivo,
          comando: mensagem.comando ?? {},
          // eco para o cliente poder sequenciar/pintar a resposta certa
          referencia: mensagem.referencia ?? null,
        });
        break;
      }

      case "velocidade": {
        const pedida = Number(mensagem.valor);
        if (!VELOCIDADES.includes(pedida)) {
          return enviar(ws, { tipo: "erro", motivo: `Velocidade invalida. Use ${VELOCIDADES.join(", ")}.` });
        }
        velocidade = pedida;
        registrar(estado, pedida === 0 ? "Jogo pausado." : `Velocidade alterada para ${pedida}x.`);
        for (const outra of wss.clients) enviar(outra, { tipo: "velocidade", valor: velocidade });
        break;
      }

      case "passoDeUmDia": {
        // Avanca um dia manualmente, mesmo com o jogo pausado
        avancarDia(estado);
        enviar(ws, { tipo: "resultado", ok: true, texto: `Dia ${estado.dia} iniciado.`, comando: { tipo: "passo" } });
        if (estado.vencedor !== null) {
          for (const outra of wss.clients) enviar(outra, { tipo: "fimDeJogo", nacaoId: estado.vencedor });
        }
        break;
      }

      case "ping":
        enviar(ws, { tipo: "pong", agora: Date.now() });
        break;

      default:
        enviar(ws, { tipo: "erro", motivo: `Tipo de mensagem desconhecido: ${String(mensagem.tipo)}` });
    }
  });

  ws.on("close", () => {
    if (jogadorId !== null && conexoes.get(jogadorId) === ws) {
    conexoes.delete(jogadorId);
    ultimaConexao.set(jogadorId, Date.now());
  }
  });

  ws.on("error", () => {
    if (jogadorId !== null && conexoes.get(jogadorId) === ws) {
    conexoes.delete(jogadorId);
    ultimaConexao.set(jogadorId, Date.now());
  }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Relogio do jogo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ha alguem no comando? O relogio so corre entao.
 *
 * Sem isso a campanha anda sozinha: quem clonar o jogo e abrir o navegador no
 * dia seguinte encontra a partida decidida, sem ter jogado um dia. A partida
 * comeca quando alguem assume uma nacao.
 */
function alguemNoComando() {
  for (const jogadorId of conexoes.keys()) {
    if ((estado.jogadores.get(jogadorId) ?? null) !== null) return true;
  }
  return false;
}

setInterval(() => {
  const agora = Date.now();
  const segundosReais = (agora - ultimoInstante) / 1000;
  ultimoInstante = agora;

  if (velocidade > 0 && estado.vencedor === null && alguemNoComando()) {
    acumuladorDeDias += segundosReais * DIAS_POR_SEGUNDO * velocidade;
    let diasAvancados = 0;
    while (acumuladorDeDias >= 1 && diasAvancados < 4) {
      acumuladorDeDias -= 1;
      diasAvancados += 1;
      avancarDia(estado);
      if (estado.vencedor !== null) {
        for (const cliente of wss.clients) enviar(cliente, { tipo: "fimDeJogo", nacaoId: estado.vencedor });
        break;
      }
    }
  }

  for (const [jogadorId, ws] of conexoes) {
    if (ws.readyState !== ws.OPEN) continue;
    enviar(ws, { tipo: "estado", estado: retratoDe(jogadorId), velocidade });
  }
}, INTERVALO_DE_ENVIO_MS);

// Avisos de inatividade (heartbeat do WebSocket)
const batimento = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.vivo === false) {
      ws.terminate();
      continue;
    }
    ws.vivo = false;
    ws.ping();
  }
}, 30000);
wss.on("connection", (ws) => {
  ws.vivo = true;
  ws.on("pong", () => {
    ws.vivo = true;
  });
});

servidorHttp.listen(PORTA, HOST, () => {
  console.log(`Supremacia 1942 no ar em http://${HOST}:${PORTA}`);
  console.log(`  provincias: ${estado.provincias.size} | nacoes: ${estado.nacoes.size}`);
  console.log(`  ritmo: ${DIAS_POR_SEGUNDO} dias/s em 1x | velocidades: ${VELOCIDADES.join(", ")}`);
});

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    clearInterval(batimento);
    servidorHttp.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
