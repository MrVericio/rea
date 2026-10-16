#!/usr/bin/env node
/**
 * Partida de teste — um jogador de verdade contra a IA.
 *
 * Conecta pelo mesmo caminho do navegador (WebSocket), assume uma nação, joga
 * a campanha dando comandos de todos os tipos e imprime o que aconteceu. Serve
 * para provar que a partida completa funciona de ponta a ponta, sem abrir o
 * navegador — e é o único jeito de ver a IA jogando contra alguém que decide.
 *
 *   node tools/partida-de-teste.mjs [nacaoId] [diasMaximos] [endereco]
 *
 * Ex.: node tools/partida-de-teste.mjs pl 240 ws://127.0.0.1:3000
 */

import pacoteWs from "ws";

// O pacote `ws` é CommonJS: o padrão já é a classe
const Socket = pacoteWs.WebSocket ?? pacoteWs;

const nacaoPedida = process.argv[2] ?? "de";
const diasMaximos = Number(process.argv[3] ?? 240);
const endereco = process.argv[4] ?? "ws://127.0.0.1:3000";

const jogadorId = `bot-${Math.random().toString(36).slice(2, 8)}`;
const balanco = { aceitos: 0, recusados: 0, recusas: [] };
const jaPedido = new Set();
let estado = null;
let minhaNacao = null;
let encerrado = false;

const socket = new Socket(endereco);
const enviar = (mensagem) => socket.send(JSON.stringify(mensagem));
const escolher = (lista) => lista[Math.floor(Math.random() * lista.length)];

const totalDe = (provincia) =>
  Object.values(provincia.unidades ?? {}).reduce((soma, n) => soma + n, 0);

/**
 * Decide e envia UM comando por retrato recebido, na ordem de prioridade:
 * pesquisa, doutrina, obra, recrutamento, diplomacia, guerra e ofensiva.
 */
function jogar() {
  if (estado === null || minhaNacao === null) return;
  const minha = estado.nacoes.find((n) => n.id === minhaNacao);
  if (minha === undefined || minha.eliminada) return;

  const dinheiro = minha.estoques?.dinheiro ?? 0;
  const minhas = estado.provincias.filter((p) => p.dono === minhaNacao);

  // 1. Pesquisa — o servidor já disse o que dá para comprar
  const avanco = (estado.pesquisa?.avancos ?? []).find((a) => a.podePesquisar && !a.concluido);
  if (avanco !== undefined) {
    return enviar({ tipo: "comando", comando: { tipo: "pesquisar", avancoId: avanco.id } });
  }

  // 2. Doutrina — a primeira que couber com folga
  const doutrina = estado.regras.doutrinas.find(
    (d) => !(estado.doutrinas ?? []).includes(d.id) && dinheiro > d.custo * 2.5,
  );
  if (doutrina !== undefined && Math.random() < 0.4) {
    return enviar({ tipo: "comando", comando: { tipo: "adotarDoutrina", doutrinaId: doutrina.id } });
  }

  // 3. Obra — sobe o que estiver ao alcance do bolso, sem repetir sempre a mesma
  const comObra = minhas
    .map((provincia) => ({
      provincia,
      opcoes: Object.entries(provincia.custosDeConstrucao ?? {})
        .filter(([, dados]) => dados.podePagar && !dados.maximo)
        .map(([idConstrucao]) => idConstrucao),
    }))
    .filter(({ opcoes }) => opcoes.length > 0);
  if (comObra.length > 0 && Math.random() < 0.55) {
    const { provincia, opcoes } = escolher(comObra);
    return enviar({
      tipo: "comando",
      comando: { tipo: "construir", provinciaId: provincia.id, construcaoId: escolher(opcoes) },
    });
  }

  // 4. Recrutamento — onde o quartel permite e o bolso aguenta
  const comQuartel = minhas
    .map((provincia) => {
      const recrutamento = provincia.custosDeRecrutamento ?? {};
      const opcoes = Object.entries(recrutamento.unidades ?? {})
        .filter(([, dados]) => dados.podePagar)
        .map(([unidadeId]) => unidadeId);
      return { provincia, opcoes, capacidade: recrutamento.capacidade ?? 0, emTreino: recrutamento.emTreino ?? 0 };
    })
    .filter(({ opcoes, capacidade, emTreino }) => opcoes.length > 0 && capacidade > emTreino);
  if (comQuartel.length > 0) {
    const { provincia, opcoes, capacidade, emTreino } = escolher(comQuartel);
    const quantidade = Math.max(1, Math.min(4, capacidade - emTreino));
    return enviar({
      tipo: "comando",
      comando: { tipo: "recrutar", provinciaId: provincia.id, unidadeId: escolher(opcoes), quantidade },
    });
  }

  // 5. Diplomacia — aliança com quem já gosta de nós
  const amigavel = estado.nacoes.find(
    (n) => n.id !== minhaNacao && !n.eliminada && (n.relacoes ?? 0) >= 25 && n.pacto === null
      && !minha.emGuerraCom.includes(n.id),
  );
  if (amigavel !== undefined && dinheiro > 150 && !jaPedido.has(amigavel.id)) {
    jaPedido.add(amigavel.id);
    return enviar({
      tipo: "comando",
      comando: { tipo: "proporPacto", nacaoId: amigavel.id, tipoDePacto: "alianca" },
    });
  }

  // 6. Guerra — contra quem está ao alcance e não é mais forte
  const alvo = [...estado.nacoes]
    .filter((n) => n.id !== minhaNacao && !n.eliminada && !minha.emGuerraCom.includes(n.id))
    .filter((n) => n.alcancavel !== false && n.forca < minha.forca * 1.4)
    .sort((a, b) => a.forca - b.forca)[0];
  if (alvo !== undefined && dinheiro > estado.regras.custoDeGuerra * 3) {
    return enviar({ tipo: "comando", comando: { tipo: "declararGuerra", nacaoId: alvo.id } });
  }

  // 7. Ofensiva — usa o alcance que o SERVIDOR calculou para achar os destinos
  const origens = minhas
    .filter((p) => totalDe(p) >= 6)
    .sort((a, b) => totalDe(b) - totalDe(a));
  for (const origem of origens) {
    const destinos = [];
    for (const [tipo, alcance] of Object.entries(origem.alcancePorUnidade ?? {})) {
      for (const destinoId of alcance) {
        const destino = estado.provincias.find((p) => p.id === destinoId);
        if (destino === undefined || destino.dono === null) continue;
        if (!minha.emGuerraCom.includes(destino.dono)) continue;
        destinos.push({ destinoId, tipo });
      }
    }
    for (const [tipo, alcance] of Object.entries(origem.alcanceMaritimoPorUnidade ?? {})) {
      for (const destinoId of alcance) {
        const destino = estado.provincias.find((p) => p.id === destinoId);
        if (destino === undefined || destino.dono === null) continue;
        if (!minha.emGuerraCom.includes(destino.dono)) continue;
        destinos.push({ destinoId, tipo });
      }
    }
    if (destinos.length === 0) continue;

    const { destinoId, tipo } = escolher(destinos);
    const disponivel = origem.unidades[tipo] ?? 0;
    const enviarTropas = Math.max(1, Math.floor(disponivel * 0.6));
    if (enviarTropas === 0) continue;
    return enviar({
      tipo: "comando",
      comando: { tipo: "mover", origemId: origem.id, destinoId, unidades: { [tipo]: enviarTropas } },
    });
  }

  // 8. Paz — sai das guerras que não vão bem
  const perdida = minha.emGuerraCom.find((id) => {
    if (jaPedido.has(`paz-${id}`)) return false;
    const outra = estado.nacoes.find((n) => n.id === id);
    return outra !== undefined && !outra.eliminada && outra.forca > minha.forca * 1.3;
  });
  if (perdida !== undefined) {
    jaPedido.add(`paz-${perdida}`);
    return enviar({ tipo: "comando", comando: { tipo: "proporPaz", nacaoId: perdida } });
  }
}

socket.addEventListener("open", () => {
  enviar({ tipo: "entrar", jogadorId, nome: "Bot de teste" });
  enviar({ tipo: "escolherNacao", nacaoId: nacaoPedida });
  enviar({ tipo: "velocidade", valor: 4 });
});

socket.addEventListener("message", (evento) => {
  const mensagem = JSON.parse(evento.data);

  if (mensagem.tipo === "nacaoEscolhida") {
    minhaNacao = mensagem.nacaoId;
    console.log(`assumiu ${mensagem.nome} — jogando no 4x`);
  }

  if (mensagem.tipo === "estado") {
    estado = mensagem.estado;
    if (estado.vencedor !== null && !encerrado) {
      encerrado = true;
      return encerrar(`fim de jogo no dia ${estado.dia}`);
    }
    if (estado.dia >= diasMaximos && !encerrado) {
      encerrado = true;
      return encerrar(`limite de ${diasMaximos} dias do teste`);
    }
    jogar();
  }

  if (mensagem.tipo === "resultado") {
    if (mensagem.ok) balanco.aceitos += 1;
    else {
      balanco.recusados += 1;
      balanco.recusas.push(`${mensagem.comando?.tipo}: ${mensagem.texto}`);
    }
  }

  if (mensagem.tipo === "erro") console.log(`servidor: ${mensagem.motivo}`);
});

function encerrar(motivo) {
  const minha = estado?.nacoes.find((n) => n.id === minhaNacao);
  const vencedora = estado?.nacoes.find((n) => n.id === estado.vencedor);
  const minhas = estado?.provincias.filter((p) => p.dono === minhaNacao).length ?? 0;

  console.log(`\n── fim: ${motivo} ──────────────────────────────`);
  console.log(`  dia ${estado?.dia} | ${minha?.nome ?? "?"} com ${minhas} províncias`);
  console.log(`  força ${minha?.forca ?? 0} | moral ${Math.round(minha?.moral ?? 0)} | dinheiro ${Math.round(minha?.estoques?.dinheiro ?? 0)}`);
  const concluidos = (estado?.pesquisa?.avancos ?? []).filter((a) => a.concluido).length;
  console.log(`  pesquisa: ${concluidos} avanços | doutrinas: ${(estado?.doutrinas ?? []).length} | ${estado?.pesquisa?.porDia ?? 0} pontos/dia`);
  console.log(`  comandos aceitos ${balanco.aceitos} | recusados ${balanco.recusados}`);
  const motivos = [...new Set(balanco.recusas.map((r) => r.split(": ").slice(1).join(": ")))].slice(0, 5);
  if (motivos.length > 0) console.log(`  motivos de recusa: ${motivos.join(" | ")}`);
  console.log(`  vencedor: ${vencedora?.nome ?? "ninguém"} (${estado?.motivoDaVitoria ?? "prazo"})`);
  console.log(`  nações de pé: ${estado?.nacoes.filter((n) => !n.eliminada).length} de ${estado?.nacoes.length}`);

  socket.close();
  process.exit(0);
}

setTimeout(() => {
  if (!encerrado) encerrar("tempo esgotado (8 min)");
}, 480000).unref();
