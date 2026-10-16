/**
 * Supremacia 1942 — Motor de regras (autoritativo)
 *
 * TODO o estado do jogo vive aqui, no servidor. O cliente nunca calcula
 * producao, custo, combate ou vitoria: ele envia comandos e recebe estado.
 * Toda validacao acontece neste modulo. Um comando invalido e recusado com
 * um motivo, nunca silenciosamente corrigido.
 */

import {
  TIPOS_DE_CONSTRUCAO,
  TIPOS_DE_UNIDADE,
  TERRENOS,
  RECURSOS,
  NOME_DO_RECURSO,
  DIRECOES,
  BONUS_DE_DESEMBARQUE,
  gerarMundo,
} from "./world.mjs";

/**
 * Ritmo de referencia (velocidade 1x): 1 dia de jogo a cada 2 segundos.
 * A partida dura ~200 dias, ou seja ~7 minutos. O servidor multiplica este
 * valor pela velocidade escolhida (pausa, 1x, 2x ou 4x).
 */
export const DIAS_POR_SEGUNDO = 0.5;
export const ESTOQUE_INICIAL_POR_PROVINCIA = {
  dinheiro: 220,
  comida: 180,
  aco: 130,
  petroleo: 60,
  carvao: 90,
};

export const CUSTO_DE_GUERRA = 40; // custo em dinheiro para declarar guerra

/**
 * Ritmo do combate: quantos pontos de vida cada ponto de forca tira por dia.
 *
 * Estes dois numeros decidem a duracao das batalhas. Com valores baixos a
 * batalha vira um cerco eterno, porque o defensor recruta reposicoes mais
 * rapido do que perde soldados. Calibrados para uma batalha decisiva durar
 * de 3 a 5 dias.
 */
export const DANO_DO_ATACANTE = 1.8;  // por ponto de ataque
export const DANO_DO_DEFENSOR = 2.6;  // por ponto de defesa efetiva

/**
 * Fracao do mapa que garante a supremacia antes do prazo.
 * Baixo demais e o jogo acaba cedo; alto demais e vira arrastao.
 */
export const DOMINIO_PARA_VITORIA = 0.4;

/**
 * Prazo da campanha, em dias de jogo. No dia limite ha um armisticio e vence
 * quem controla mais territorio — assim a partida SEMPRE termina, o que e
 * essencial tanto para o jogador quanto para a IA nao ficar em impasse.
 */
export const LIMITE_DE_DIAS = 360;

// ─────────────────────────────────────────────────────────────────────────────
// Criacao do estado
// ─────────────────────────────────────────────────────────────────────────────

export function criarEstado(semente = 1942) {
  const mundo = gerarMundo(semente);
  const estado = {
    versao: 1,
    dia: 0,
    semente,
    provincias: mundo.provincias,
    nacoes: new Map(),
    jogadores: new Map(), // jogadorId -> nacaoId
    batalhas: [],
    eventos: [],
    vencedor: null,
    motivoDaVitoria: null,
    limiteDeDias: LIMITE_DE_DIAS,
    proximoIdDeBatalha: 1,
  };

  for (const nacao of mundo.nacoes) {
    const quantidade = nacao.provinciasIniciais;
    estado.nacoes.set(nacao.id, {
      id: nacao.id,
      nome: nacao.nome,
      cor: nacao.cor,
      capital: nacao.capital,
      estoques: {
        dinheiro: ESTOQUE_INICIAL_POR_PROVINCIA.dinheiro + quantidade * 60,
        comida: ESTOQUE_INICIAL_POR_PROVINCIA.comida + quantidade * 45,
        aco: ESTOQUE_INICIAL_POR_PROVINCIA.aco + quantidade * 30,
        petroleo: ESTOQUE_INICIAL_POR_PROVINCIA.petroleo + quantidade * 12,
        carvao: ESTOQUE_INICIAL_POR_PROVINCIA.carvao + quantidade * 20,
      },
      emGuerraCom: new Set(),
      tratadoDePaz: new Set(), // nacoes que nao podem ser atacadas por N dias
      ia: true,
      eliminada: false,
    });
  }

  semearEconomiaInicial(estado);
  semearForcasIniciais(estado);
  semearGuerrasHistoricas(estado);

  return estado;
}

/** Cada nacao comeca com uma economia minima montada nas suas provincias. */
function semearEconomiaInicial(estado) {
  for (const provincia of estado.provincias.values()) {
    const ehCapital = provincia.terreno === "cidade";
    if (ehCapital) {
      provincia.construcoes = { comercio: 2, fazenda: 1, quartel: 1, siderurgica: 1 };
    } else {
      provincia.construcoes = escolherConstrucoesIniciais(provincia);
    }
  }
}

function escolherConstrucoesIniciais(provincia) {
  const terreno = TERRENOS[provincia.terreno];
  const opcoes = [
    { id: "fazenda", peso: terreno.comida },
    { id: "siderurgica", peso: terreno.aco },
    { id: "pocoPetroleo", peso: terreno.petroleo * 0.7 },
    { id: "minaCarvao", peso: terreno.carvao },
    { id: "comercio", peso: terreno.dinheiro },
  ].sort((a, b) => b.peso - a.peso);
  const principal = opcoes[0].id;
  return { [principal]: 1 };
}

/** Guarnicao inicial: cada nacao defende as fronteiras e a capital. */
function semearForcasIniciais(estado) {
  for (const nacao of estado.nacoes.values()) {
    const minhas = [...estado.provincias.values()].filter((p) => p.dono === nacao.id);
    const capital = minhas.find((p) => p.terreno === "cidade") ?? minhas[0];
    if (capital !== undefined) {
      capital.unidades = { infantaria: 6, artilharia: 2, blindado: 1 };
    }
    for (const provincia of minhas) {
      if (provincia === capital) continue;
      const ehFronteira = provincia.vizinhos.some((id) => estado.provincias.get(id).dono !== nacao.id);
      if (ehFronteira) {
        provincia.unidades = { infantaria: 3 };
      }
    }
  }
}

/** Alguns conflitos ja em andamento, para o jogo comecar com movimento. */
function semearGuerrasHistoricas(estado) {
  const conflitos = [
    ["de", "gb"], ["de", "fr"], ["de", "ur"], ["de", "pl"],
    ["it", "gb"], ["it", "gr"],
  ];
  for (const [a, b] of conflitos) {
    if (!estado.nacoes.has(a) || !estado.nacoes.has(b)) continue;
    estado.nacoes.get(a).emGuerraCom.add(b);
    estado.nacoes.get(b).emGuerraCom.add(a);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Consultas de estado
// ─────────────────────────────────────────────────────────────────────────────

export function estaoEmGuerra(estado, a, b) {
  if (a === b) return false;
  const nacaoA = estado.nacoes.get(a);
  return nacaoA !== undefined && nacaoA.emGuerraCom.has(b);
}

export function provinciasDaNacao(estado, nacaoId) {
  return [...estado.provincias.values()].filter((p) => p.dono === nacaoId);
}

/**
 * Producao-base de qualquer provincia, antes das construcoes.
 *
 * Sem isso, paises sem deserto ficavam com petroleo zero e nunca podiam
 * construir blindados: o jogo travava. A base garante que conquistar
 * territorio sempre melhore a economia, e que nenhuma nacao fique
 * permanentemente sem um recurso.
 */
export const PRODUCAO_BASE_POR_PROVINCIA = Object.freeze({
  dinheiro: 2, comida: 2, aco: 1, petroleo: 0.6, carvao: 1,
});

/** Producao diaria de uma nacao: base do territorio + construcoes. */
export function calcularProducao(estado, nacaoId) {
  const producao = { dinheiro: 0, comida: 0, aco: 0, petroleo: 0, carvao: 0 };
  for (const provincia of estado.provincias.values()) {
    if (provincia.dono !== nacaoId) continue;
    const terreno = TERRENOS[provincia.terreno];
    for (const [recurso, valor] of Object.entries(PRODUCAO_BASE_POR_PROVINCIA)) {
      producao[recurso] += valor * (terreno[recurso] ?? 1);
    }
    for (const [idConstrucao, nivel] of Object.entries(provincia.construcoes)) {
      const tipo = TIPOS_DE_CONSTRUCAO[idConstrucao];
      if (tipo === undefined || tipo.recurso === null) continue;
      const fator = terreno[tipo.recurso] ?? 1;
      producao[tipo.recurso] += tipo.producaoBase * nivel * fator;
    }
  }
  // Arredonda para 2 casas para manter o estado estavel e comparavel
  for (const recurso of RECURSOS) producao[recurso] = Math.round(producao[recurso] * 100) / 100;
  return producao;
}

/** Consumo diario de alimento das unidades. */
export function calcularConsumoDeComida(estado, nacaoId) {
  let consumo = 0;
  for (const provincia of estado.provincias.values()) {
    if (provincia.dono !== nacaoId) continue;
    for (const [tipo, quantidade] of Object.entries(provincia.unidades)) {
      consumo += (TIPOS_DE_UNIDADE[tipo]?.consomeComida ?? 0) * quantidade;
    }
  }
  return Math.round(consumo * 100) / 100;
}

/** Custo total para construir o proximo nivel de uma construcao. */
export function custoDeConstrucao(construcaoId, nivelAtual) {
  const tipo = TIPOS_DE_CONSTRUCAO[construcaoId];
  const fator = Math.pow(tipo.custoPorNivel, nivelAtual);
  const custo = {};
  for (const [recurso, valor] of Object.entries(tipo.custo)) {
    custo[recurso] = Math.ceil(valor * fator);
  }
  return custo;
}

export function podePagar(estoques, custo) {
  return Object.entries(custo).every(([recurso, valor]) => (estoques[recurso] ?? 0) >= valor);
}

export function pagar(estoques, custo) {
  for (const [recurso, valor] of Object.entries(custo)) estoques[recurso] -= valor;
}

/**
 * Multiplicador de defesa vindo das fortificacoes.
 * O valor por nivel vive no catalogo de construcoes (world.mjs): assim existe
 * uma unica fonte de verdade, e o cliente pode exibi-lo sem repetir o numero.
 */
export function bonusDeFortificacao(provincia) {
  const porNivel = TIPOS_DE_CONSTRUCAO.fortificacao.bonusDeDefesaPorNivel;
  return 1 + porNivel * (provincia.fortificacao ?? 0);
}

/** Poder de fogo, defesa e vida totais de um conjunto de unidades. */
export function poderDasUnidades(unidades) {
  let ataque = 0;
  let defesa = 0;
  let vida = 0;
  let quantidade = 0;
  for (const [tipo, n] of Object.entries(unidades)) {
    const definicao = TIPOS_DE_UNIDADE[tipo];
    if (definicao === undefined || n <= 0) continue;
    ataque += definicao.ataque * n;
    defesa += definicao.defesa * n;
    vida += definicao.vida * n;
    quantidade += n;
  }
  return { ataque, defesa, vida, quantidade };
}

// ─────────────────────────────────────────────────────────────────────────────
// Comandos (validados aqui, no servidor)
// ─────────────────────────────────────────────────────────────────────────────

const recusar = (motivo) => ({ ok: false, motivo });

/**
 * Executa um comando em nome de um jogador.
 * @returns {{ok: true, evento: string}|{ok: false, motivo: string}}
 */
export function executarComando(estado, jogadorId, comando) {
  const nacaoId = estado.jogadores.get(jogadorId);
  if (nacaoId === undefined) return recusar("Voce ainda nao escolheu uma nacao.");
  if (estado.vencedor !== null) return recusar("A partida terminou.");

  switch (comando.tipo) {
    case "construir":
      return comandoConstruir(estado, nacaoId, comando);
    case "recrutar":
      return comandoRecrutar(estado, nacaoId, comando);
    case "mover":
      return comandoMover(estado, nacaoId, comando);
    case "declararGuerra":
      return comandoDeclararGuerra(estado, nacaoId, comando);
    case "proporPaz":
      return comandoProporPaz(estado, nacaoId, comando);
    case "cancelarRecrutamento":
      return comandoCancelarRecrutamento(estado, nacaoId, comando);
    default:
      return recusar(`Comando desconhecido: ${String(comando.tipo)}`);
  }
}

function exigirMinhaProvincia(estado, nacaoId, provinciaId) {
  const provincia = estado.provincias.get(provinciaId);
  if (provincia === undefined) return recusar("Provincia inexistente.");
  if (provincia.dono !== nacaoId) return recusar("Essa provincia nao e sua.");
  return provincia;
}

function comandoConstruir(estado, nacaoId, { provinciaId, construcaoId }) {
  const provincia = exigirMinhaProvincia(estado, nacaoId, provinciaId);
  if (provincia.ok === false) return provincia;
  const tipo = TIPOS_DE_CONSTRUCAO[construcaoId];
  if (tipo === undefined) return recusar("Construcao desconhecida.");

  const nivelAtual = provincia.construcoes[construcaoId] ?? 0;
  if (nivelAtual >= tipo.nivelMaximo) {
    return recusar(`${tipo.nome} ja esta no nivel maximo (${tipo.nivelMaximo}).`);
  }
  const ocupados = Object.keys(provincia.construcoes).length;
  if (nivelAtual === 0 && ocupados >= provincia.slots) {
    return recusar(`A provincia so tem ${provincia.slots} espacos de construcao.`);
  }

  const custo = custoDeConstrucao(construcaoId, nivelAtual);
  const nacao = estado.nacoes.get(nacaoId);
  if (!podePagar(nacao.estoques, custo)) {
    const faltando = Object.entries(custo)
      .filter(([recurso, valor]) => nacao.estoques[recurso] < valor)
      .map(([recurso, valor]) => `${NOME_DO_RECURSO[recurso]} (faltam ${Math.ceil(valor - nacao.estoques[recurso])})`)
      .join(", ");
    return recusar(`Recursos insuficientes: ${faltando}.`);
  }

  pagar(nacao.estoques, custo);
  provincia.construcoes[construcaoId] = nivelAtual + 1;
  if (construcaoId === "fortificacao") provincia.fortificacao = nivelAtual + 1;
  const evento = `${nacao.nome} elevou ${tipo.nome} para nivel ${nivelAtual + 1} em ${provincia.nome}.`;
  registrarEvento(estado, evento);
  return { ok: true, evento };
}

function comandoRecrutar(estado, nacaoId, { provinciaId, unidadeId, quantidade }) {
  const provincia = exigirMinhaProvincia(estado, nacaoId, provinciaId);
  if (provincia.ok === false) return provincia;
  const tipo = TIPOS_DE_UNIDADE[unidadeId];
  if (tipo === undefined) return recusar("Tipo de unidade desconhecido.");

  const n = Math.floor(Number(quantidade));
  if (!Number.isFinite(n) || n < 1 || n > 50) return recusar("Quantidade deve ser entre 1 e 50.");

  const semQuartel = (provincia.construcoes.quartel ?? 0) === 0;
  if (semQuartel) return recusar("Essa provincia precisa de um Quartel para recrutar.");

  if (estado.batalhas.some((b) => b.provinciaId === provincia.id)) {
    return recusar(`${provincia.nome} esta sob cerco: o quartel nao consegue recrutar.`);
  }

  const nivelQuartel = provincia.construcoes.quartel;
  const capacidade = 4 + nivelQuartel * 4;
  const jaEmTreino = Object.values(provincia.progressoDeRecrutamento)
    .reduce((soma, item) => soma + item.quantidade, 0);
  if (jaEmTreino + n > capacidade) {
    return recusar(`A fila de recrutamento suporta ${capacidade} unidades (ja ha ${jaEmTreino}).`);
  }

  // Custo: multiplicado por (1 - 0.06 * nivel do quartel), com piso de 60%
  const desconto = Math.max(0.6, 1 - 0.06 * (nivelQuartel - 1));
  const custo = {};
  for (const [recurso, valor] of Object.entries(tipo.custo)) {
    custo[recurso] = Math.ceil(valor * n * desconto);
  }
  const nacao = estado.nacoes.get(nacaoId);
  if (!podePagar(nacao.estoques, custo)) {
    const faltando = Object.entries(custo)
      .filter(([recurso, valor]) => nacao.estoques[recurso] < valor)
      .map(([recurso, valor]) => `${NOME_DO_RECURSO[recurso]} (faltam ${Math.ceil(valor - nacao.estoques[recurso])})`)
      .join(", ");
    return recusar(`Recursos insuficientes: ${faltando}.`);
  }

  pagar(nacao.estoques, custo);
  const existente = provincia.progressoDeRecrutamento[unidadeId];
  if (existente === undefined) {
    // Recrutamento mais rapido com quartel melhor
    const dias = Math.max(1, tipo.diasDeRecrutamento - (nivelQuartel - 1));
    provincia.progressoDeRecrutamento[unidadeId] = { diasRestantes: dias, quantidade: n, diasTotais: dias };
  } else {
    existente.quantidade += n;
  }
  const evento = `${nacao.nome} encomendou ${n}x ${tipo.nome} em ${provincia.nome}.`;
  registrarEvento(estado, evento);
  return { ok: true, evento };
}

function comandoCancelarRecrutamento(estado, nacaoId, { provinciaId, unidadeId }) {
  const provincia = exigirMinhaProvincia(estado, nacaoId, provinciaId);
  if (provincia.ok === false) return provincia;
  const item = provincia.progressoDeRecrutamento[unidadeId];
  if (item === undefined) return recusar("Nao ha recrutamento desse tipo em andamento.");
  const tipo = TIPOS_DE_UNIDADE[unidadeId];
  const nacao = estado.nacoes.get(nacaoId);
  // Reembolso de metade do custo, proporcional ao que falta
  const proporcao = item.diasRestantes / item.diasTotais;
  for (const [recurso, valor] of Object.entries(tipo.custo)) {
    nacao.estoques[recurso] += Math.floor(valor * item.quantidade * proporcao * 0.5);
  }
  delete provincia.progressoDeRecrutamento[unidadeId];
  return { ok: true, evento: `Recrutamento cancelado em ${provincia.nome}.` };
}

/**
 * Move unidades. O alcance e o menor `velocidade` do grupo, e o caminho so
 * pode atravessar territorio proprio ou aliado — nunca atravessa inimigo.
 */
function comandoMover(estado, nacaoId, { origemId, destinoId, unidades }) {
  const origem = exigirMinhaProvincia(estado, nacaoId, origemId);
  if (origem.ok === false) return origem;
  const destino = estado.provincias.get(destinoId);
  if (destino === undefined) return recusar("Provincia de destino inexistente.");
  if (destino.id === origem.id) return recusar("Origem e destino sao a mesma provincia.");

  const selecionadas = {};
  for (const [tipo, quantidade] of Object.entries(unidades ?? {})) {
    const n = Math.floor(Number(quantidade));
    if (!Number.isFinite(n) || n <= 0) continue;
    const disponivel = origem.unidades[tipo] ?? 0;
    if (n > disponivel) return recusar(`Voce nao tem ${n}x ${TIPOS_DE_UNIDADE[tipo]?.nome ?? tipo} em ${origem.nome}.`);
    selecionadas[tipo] = n;
  }
  if (Object.keys(selecionadas).length === 0) return recusar("Nenhuma unidade selecionada.");

  const alcance = Math.min(...Object.keys(selecionadas).map((tipo) => TIPOS_DE_UNIDADE[tipo].velocidade));
  const caminho = encontrarCaminho(estado, nacaoId, origem.id, destino.id, Math.max(1, alcance));
  if (caminho === null) {
    return recusar("Destino fora de alcance: o caminho passa por territorio inimigo ou e longo demais.");
  }

  const destinoFinal = estado.provincias.get(caminho[caminho.length - 1]);
  const nacao = estado.nacoes.get(nacaoId);
  const emGuerra = estaoEmGuerra(estado, nacaoId, destinoFinal.dono);

  // Cerco: uma provincia cercada nao recebe reforco. Sem esta regra, o
  // defensor bombeia tropas para dentro da batalha e nada nunca termina.
  //
  // Esta verificacao precisa vir ANTES de mexer nas unidades: um comando
  // recusado jamais pode deixar o estado do jogo alterado.
  if (destinoFinal.dono === nacaoId && estado.batalhas.some((b) => b.provinciaId === destinoFinal.id)) {
    return recusar(`${destinoFinal.nome} esta sob cerco: nao e possivel reforcar ate a batalha terminar.`);
  }

  // A partir daqui o comando e valido: agora sim as unidades saem da origem
  for (const [tipo, n] of Object.entries(selecionadas)) {
    origem.unidades[tipo] -= n;
    if (origem.unidades[tipo] <= 0) delete origem.unidades[tipo];
  }

  if (destinoFinal.dono === nacaoId || !emGuerra) {
    // Movimento pacifico (ou reforco de aliado sem combate)
    for (const [tipo, n] of Object.entries(selecionadas)) {
      destinoFinal.unidades[tipo] = (destinoFinal.unidades[tipo] ?? 0) + n;
    }
    if (!emGuerra && destinoFinal.dono !== nacaoId) {
      registrarEvento(estado, `${nacao.nome} posicionou tropas em territorio neutro (${destinoFinal.nome}).`);
    }
    return { ok: true, evento: `Tropas movidas para ${destinoFinal.nome}.` };
  }

  // Ataque: cria ou reforca uma batalha na provincia alvo
  const porMar = ehDesembarque(estado, origem.id, destinoFinal.id);
  iniciarOuReforcarBatalha(estado, destinoFinal, nacaoId, selecionadas, porMar);
  const evento = porMar
    ? `${nacao.nome} desembarcou em ${destinoFinal.nome}!`
    : `${nacao.nome} atacou ${destinoFinal.nome}!`;
  registrarEvento(estado, evento);
  return { ok: true, evento };
}

/** BFS limitado por passos, apenas por territorio proprio. */
/**
 * Caminho mais curto entre duas provincias, em "passos" de movimento.
 *
 * Regras:
 *   - passo terrestre custa 1 e so atravessa territorio proprio. A provincia
 *     de destino pode ser inimiga: e o caso do ataque.
 *   - travessia maritima custa o movimento INTEIRO do turno. Ou seja: ou a
 *     unidade marcha por terra, ou atravessa o mar — nunca as duas coisas.
 *     Unidades lentas tambem podem desembarcar, porque o custo e relativo a
 *     velocidade de cada uma.
 *
 * @returns {string[]|null} lista de ids da origem ao destino, ou null
 */
function encontrarCaminho(estado, nacaoId, origemId, destinoId, maxPassos) {
  if (origemId === destinoId) return [origemId];

  const custo = new Map([[origemId, 0]]);
  const anterior = new Map();
  const fila = [[0, origemId]];

  while (fila.length > 0) {
    fila.sort((a, b) => a[0] - b[0]);
    const [custoAtual, atualId] = fila.shift();
    if (custoAtual > (custo.get(atualId) ?? Infinity)) continue;
    if (atualId === destinoId) break;

    const atual = estado.provincias.get(atualId);
    const passos = [];
    for (const vizinhoId of atual.vizinhos) {
      passos.push({ id: vizinhoId, custo: 1, mar: false });
    }
    for (const vizinhoId of atual.vizinhosMaritimos ?? []) {
      passos.push({ id: vizinhoId, custo: maxPassos, mar: true });
    }

    for (const passo of passos) {
      const novoCusto = custoAtual + passo.custo;
      if (novoCusto > maxPassos) continue;
      const vizinho = estado.provincias.get(passo.id);
      // A travessia e sempre permitida, inclusive para desembarcar em
      // territorio inimigo. O passo terrestre so continua por terra propria.
      const ehDestino = passo.id === destinoId;
      if (!ehDestino && !passo.mar && vizinho.dono !== nacaoId) continue;
      if (novoCusto < (custo.get(passo.id) ?? Infinity)) {
        custo.set(passo.id, novoCusto);
        anterior.set(passo.id, atualId);
        fila.push([novoCusto, passo.id]);
      }
    }
  }

  if (!custo.has(destinoId)) return null;
  const caminho = [destinoId];
  while (caminho[0] !== origemId) {
    const predecessor = anterior.get(caminho[0]);
    if (predecessor === undefined) return null;
    caminho.unshift(predecessor);
  }
  return caminho;
}

/** A ultima perna do caminho e uma travessia maritima? */
function ehDesembarque(estado, origemId, destinoId) {
  const origem = estado.provincias.get(origemId);
  const destino = estado.provincias.get(destinoId);
  if (origem === undefined || destino === undefined) return false;
  if (origem.vizinhos.includes(destinoId)) return false;
  return (origem.vizinhosMaritimos ?? []).includes(destinoId);
}

/** Ha territorio seu encostado no alvo, por terra ou por travessia maritima? */
function temContatoCom(estado, nacaoId, alvoId) {
  for (const provincia of estado.provincias.values()) {
    if (provincia.dono !== nacaoId) continue;
    const vizinhos = [...provincia.vizinhos, ...(provincia.vizinhosMaritimos ?? [])];
    for (const vizinhoId of vizinhos) {
      if (estado.provincias.get(vizinhoId)?.dono === alvoId) return true;
    }
  }
  return false;
}

function comandoDeclararGuerra(estado, nacaoId, { nacaoId: alvoId }) {
  if (alvoId === nacaoId) return recusar("Voce nao pode declarar guerra a si mesmo.");
  const alvo = estado.nacoes.get(alvoId);
  if (alvo === undefined) return recusar("Nacao alvo invalida.");
  if (alvo.eliminada) return recusar(`${alvo.nome} ja foi eliminada da campanha.`);
  if (estaoEmGuerra(estado, nacaoId, alvoId)) return recusar("Voces ja estao em guerra.");

  const nacao = estado.nacoes.get(nacaoId);
  if (nacao.estoques.dinheiro < CUSTO_DE_GUERRA) {
    return recusar(`Declarar guerra custa ${CUSTO_DE_GUERRA} de dinheiro.`);
  }
  nacao.estoques.dinheiro -= CUSTO_DE_GUERRA;
  nacao.emGuerraCom.add(alvoId);
  alvo.emGuerraCom.add(nacaoId);
  alvo.tratadoDePaz.delete(nacaoId);
  nacao.tratadoDePaz.delete(alvoId);
  const evento = `${nacao.nome} declarou guerra a ${alvo.nome}!`;
  registrarEvento(estado, evento);
  return { ok: true, evento, destaque: true };
}

function comandoProporPaz(estado, nacaoId, { nacaoId: alvoId }) {
  const alvo = estado.nacoes.get(alvoId);
  if (alvo === undefined) return recusar("Nacao alvo invalida.");
  if (!estaoEmGuerra(estado, nacaoId, alvoId)) return recusar("Voces nao estao em guerra.");

  const nacao = estado.nacoes.get(nacaoId);
  const forcaMinha = forcaTotal(estado, nacaoId);
  const forcaDele = forcaTotal(estado, alvoId);
  // A IA aceita paz quando esta perdendo ou quando o conflito empatou por muito tempo
  const aceita = alvo.ia && forcaDele < forcaMinha * 1.05;

  if (!aceita) {
    registrarEvento(estado, `${alvo.nome} recusou a proposta de paz de ${nacao.nome}.`);
    return { ok: false, motivo: `${alvo.nome} recusou a paz. Voce precisa de vantagem militar.` };
  }

  nacao.emGuerraCom.delete(alvoId);
  alvo.emGuerraCom.delete(nacaoId);
  for (const lado of [nacao, alvo]) lado.tratadoDePaz.add(lado === nacao ? alvoId : nacaoId);
  const evento = `Paz assinada entre ${nacao.nome} e ${alvo.nome}.`;
  registrarEvento(estado, evento, true);
  return { ok: true, evento };
}

export function forcaTotal(estado, nacaoId) {
  let forca = 0;
  for (const provincia of estado.provincias.values()) {
    if (provincia.dono !== nacaoId) continue;
    forca += poderDasUnidades(provincia.unidades).ataque;
  }
  // Tropas em combate contam para a nacao, mas fora do laco das provincias:
  // dentro dele, cada batalha era somada uma vez por provincia conquistada.
  for (const batalha of estado.batalhas) {
    if (batalha.atacante === nacaoId) forca += poderDasUnidades(batalha.tropasAtacantes).ataque;
  }
  return forca;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batalhas
// ─────────────────────────────────────────────────────────────────────────────

function iniciarOuReforcarBatalha(estado, provincia, atacanteId, tropas, porMar = false) {
  const existente = estado.batalhas.find(
    (b) => b.provinciaId === provincia.id && b.atacante === atacanteId,
  );
  if (existente !== undefined) {
    for (const [tipo, n] of Object.entries(tropas)) {
      existente.tropasAtacantes[tipo] = (existente.tropasAtacantes[tipo] ?? 0) + n;
    }
    return existente;
  }
  const batalha = {
    id: `b${estado.proximoIdDeBatalha}`,
    provinciaId: provincia.id,
    atacante: atacanteId,
    defensor: provincia.dono,
    // As tropas atacantes ja sairam da provincia de origem: sao um destacamento.
    tropasAtacantes: { ...tropas },
    // A guarnicao defensora e a PROPRIA lista de unidades da provincia.
    // Se fosse uma copia, o defensor lutaria sem nunca perder soldados e a
    // guerra viraria um cerco eterno.
    tropasDefensoras: provincia.unidades,
    porMar,
    vidaAtacante: 0,
    vidaDefensora: 0,
    dias: 0,
  };
  batalha.vidaAtacante = poderDasUnidades(batalha.tropasAtacantes).vida;
  batalha.vidaDefensora = poderDasUnidades(batalha.tropasDefensoras).vida;
  estado.proximoIdDeBatalha += 1;
  estado.batalhas.push(batalha);
  return batalha;
}

/**
 * Resolve um dia de combate. A defesa recebe bonus de terreno e fortificacao.
 * O dano e proporcional a forca relativa, de forma estavel (sem sorteio), para
 * que a comparacao de partidas seja reproduzivel.
 */
function resolverBatalha(estado, batalha) {
  const provincia = estado.provincias.get(batalha.provinciaId);
  const terreno = TERRENOS[provincia.terreno];
  let bonusTerreno = provincia.terreno === "montanha" ? 1.35 : provincia.terreno === "cidade" ? 1.25 : provincia.terreno === "floresta" ? 1.15 : 1;
  // Quem desembarca luta em desvantagem: a praia e do defensor
  if (batalha.porMar) bonusTerreno *= BONUS_DE_DESEMBARQUE;
  const bonusFortificacao = bonusDeFortificacao(provincia);

  const atacante = poderDasUnidades(batalha.tropasAtacantes);
  const defensorBase = poderDasUnidades(batalha.tropasDefensoras);
  const defesaEfetiva = defensorBase.defesa * bonusTerreno * bonusFortificacao;

  if (atacante.quantidade === 0) {
    cancelarBatalha(estado, batalha);
    return;
  }
  if (defensorBase.quantidade === 0) {
    conquistar(estado, batalha);
    return;
  }

  // Dano mutuo proporcional
  const danoAoTerrenoDefensor = Math.max(1, atacante.ataque * DANO_DO_ATACANTE);
  const danoAoAtacante = Math.max(1, defesaEfetiva * DANO_DO_DEFENSOR);

  batalha.vidaDefensora -= danoAoTerrenoDefensor;
  batalha.vidaAtacante -= danoAoAtacante;
  batalha.dias += 1;

  aplicarPerdas(batalha.tropasDefensoras, batalha.vidaDefensora);
  aplicarPerdas(batalha.tropasAtacantes, batalha.vidaAtacante);

  batalha.vidaDefensora = Math.max(0, batalha.vidaDefensora);
  batalha.vidaAtacante = Math.max(0, batalha.vidaAtacante);

  if (poderDasUnidades(batalha.tropasAtacantes).quantidade === 0) {
    cancelarBatalha(estado, batalha);
    registrarEvento(estado, `Ataque repelido em ${provincia.nome}.`);
  } else if (poderDasUnidades(batalha.tropasDefensoras).quantidade === 0) {
    conquistar(estado, batalha);
  }
}

/** Redistribui perdas removendo unidades ate o total caber na vida restante. */
function aplicarPerdas(unidades, vidaDisponivel) {
  const tipos = Object.keys(unidades).filter((tipo) => TIPOS_DE_UNIDADE[tipo] !== undefined);
  // Ordem estavel: unidades mais caras morrem depois, para o resultado ser determinista
  tipos.sort((a, b) => TIPOS_DE_UNIDADE[b].vida - TIPOS_DE_UNIDADE[a].vida);
  let vidaUsada = 0;
  for (const tipo of tipos) {
    const definicao = TIPOS_DE_UNIDADE[tipo];
    const quantidade = unidades[tipo];
    const restante = vidaDisponivel - vidaUsada;
    if (restante <= 0) {
      delete unidades[tipo];
      continue;
    }
    const cabem = Math.floor(restante / definicao.vida);
    if (cabem >= quantidade) {
      vidaUsada += quantidade * definicao.vida;
    } else {
      if (cabem <= 0) delete unidades[tipo];
      else unidades[tipo] = cabem;
      vidaUsada = vidaDisponivel;
    }
  }
}

function cancelarBatalha(estado, batalha) {
  const provincia = estado.provincias.get(batalha.provinciaId);
  for (const [tipo, n] of Object.entries(batalha.tropasAtacantes)) {
    if (n <= 0) continue;
    // Sobreviventes recuam para a provincia amiga mais proxima
    const recuo = provincia.vizinhos
      .map((id) => estado.provincias.get(id))
      .find((p) => p.dono === batalha.atacante);
    if (recuo !== undefined) {
      recuo.unidades[tipo] = (recuo.unidades[tipo] ?? 0) + n;
    }
  }
  estado.batalhas = estado.batalhas.filter((b) => b.id !== batalha.id);
}

function conquistar(estado, batalha) {
  const provincia = estado.provincias.get(batalha.provinciaId);
  const antigoDono = provincia.dono;
  provincia.dono = batalha.atacante;
  provincia.unidades = { ...batalha.tropasAtacantes };
  provincia.fortificacao = 0;
  delete provincia.construcoes.fortificacao;
  estado.batalhas = estado.batalhas.filter((b) => b.id !== batalha.id);

  const nomeAtacante = estado.nacoes.get(batalha.atacante)?.nome ?? batalha.atacante;
  const nomeDefensor = estado.nacoes.get(antigoDono)?.nome ?? antigoDono;
  registrarEvento(estado, `${nomeAtacante} conquistou ${provincia.nome} de ${nomeDefensor}.`, true);

  verificarEliminacao(estado, antigoDono);
  verificarVitoria(estado);
}

function verificarEliminacao(estado, nacaoId) {
  const nacao = estado.nacoes.get(nacaoId);
  if (nacao === undefined || nacao.eliminada) return;
  const sobrou = provinciasDaNacao(estado, nacaoId).length;
  if (sobrou > 0) return;
  nacao.eliminada = true;
  nacao.emGuerraCom.clear();
  registrarEvento(estado, `${nacao.nome} foi eliminada do conflito.`, true);
}

function verificarVitoria(estado) {
  if (estado.vencedor !== null) return;
  const total = estado.provincias.size;
  const vivas = [...estado.nacoes.values()].filter((n) => !n.eliminada);

  if (vivas.length === 1) {
    estado.vencedor = vivas[0].id;
    estado.motivoDaVitoria = "aniquilacao";
    registrarEvento(estado, `${vivas[0].nome} domina a Europa. Vitoria total!`, true);
    return;
  }

  // Supremacia por dominio: nao e preciso eliminar todos
  const lider = [...vivas].sort((a, b) => provinciasDaNacao(estado, b.id).length - provinciasDaNacao(estado, a.id).length)[0];
  const fracao = provinciasDaNacao(estado, lider.id).length / total;
  if (fracao >= DOMINIO_PARA_VITORIA) {
    estado.vencedor = lider.id;
    estado.motivoDaVitoria = "supremacia";
    registrarEvento(estado, `${lider.nome} alcanca a supremacia no continente. Vitoria!`, true);
    return;
  }

  // Armisticio: a campanha tem prazo
  if (estado.dia >= LIMITE_DE_DIAS) {
    estado.vencedor = lider.id;
    estado.motivoDaVitoria = "armisticio";
    registrarEvento(estado, `Armisticio no dia ${estado.dia}. ${lider.nome} termina a campanha em vantagem.`, true);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Avanco do dia
// ─────────────────────────────────────────────────────────────────────────────

export function avancarDia(estado) {
  if (estado.vencedor !== null) return;
  estado.dia += 1;

  // 1. Producao e consumo
  for (const nacao of estado.nacoes.values()) {
    if (nacao.eliminada) continue;
    const producao = calcularProducao(estado, nacao.id);
    const consumo = calcularConsumoDeComida(estado, nacao.id);
    for (const recurso of RECURSOS) nacao.estoques[recurso] += producao[recurso];

    nacao.estoques.comida -= consumo;
    if (nacao.estoques.comida < 0) {
      // Fome: unidades desertam ate o consumo caber no estoque
      nacao.estoques.comida = 0;
      aplicarFome(estado, nacao);
    }
    for (const recurso of RECURSOS) {
      nacao.estoques[recurso] = Math.max(0, Math.round(nacao.estoques[recurso] * 100) / 100);
    }
  }

  // 2. Recrutamento (a fila nao anda em provincia sitiada)
  const sitiadas = new Set(estado.batalhas.map((b) => b.provinciaId));
  for (const provincia of estado.provincias.values()) {
    if (sitiadas.has(provincia.id)) continue;
    for (const [tipo, item] of Object.entries(provincia.progressoDeRecrutamento)) {
      item.diasRestantes -= 1;
      if (item.diasRestantes > 0) continue;
      provincia.unidades[tipo] = (provincia.unidades[tipo] ?? 0) + item.quantidade;
      delete provincia.progressoDeRecrutamento[tipo];
    }
  }

  // 3. Combate
  for (const batalha of [...estado.batalhas]) {
    if (estado.provincias.get(batalha.provinciaId).dono !== batalha.defensor
        && !estado.batalhas.includes(batalha)) continue;
    resolverBatalha(estado, batalha);
  }

  // 4. Tratados de paz expiram
  if (estado.dia % 30 === 0) {
    for (const nacao of estado.nacoes.values()) nacao.tratadoDePaz.clear();
  }

  // 5. Inteligencia artificial (nunca age pelas nacoes comandadas por gente)
  const nacoesHumanas = new Set([...estado.jogadores.values()].filter((id) => id !== null));
  for (const nacao of estado.nacoes.values()) {
    if (nacao.eliminada || !nacao.ia) continue;
    if (nacoesHumanas.has(nacao.id)) continue;
    jogarTurnoDaIA(estado, nacao);
  }

  verificarVitoria(estado);
}

function aplicarFome(estado, nacao) {
  for (const provincia of provinciasDaNacao(estado, nacao.id)) {
    for (const tipo of Object.keys(provincia.unidades)) {
      if (provincia.unidades[tipo] > 0) {
        provincia.unidades[tipo] -= 1;
        if (provincia.unidades[tipo] <= 0) delete provincia.unidades[tipo];
        return; // uma unidade deserta por dia por nacao, enquanto durar a fome
      }
    }
  }
  registrarEvento(estado, `Fome em ${nacao.nome}: unidades estao desertando.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// IA
// ─────────────────────────────────────────────────────────────────────────────

const INTERVALO_IA = 3; // a IA raciocina a cada 3 dias

/** Vantagem de forca global exigida para abrir uma nova guerra. */
const VANTAGEM_PARA_DECLARAR = 1.1;

/** Quanta superioridade local a IA exige para atacar. */
const MARGEM_DE_ATAQUE = 1.5;

/**
 * Fracao do ataque disponivel que a IA compromete quando decide atacar.
 * Baixa demais e ela manda destacamentos que sempre voltam derrotados;
 * alta demais e ela esvazia a propria fronteira.
 */
const FRACAO_DE_EMPENHO = 0.55;

/**
 * Quanto mais perto do prazo, menos a IA espera por uma vantagem confortavel.
 * Sem isso ela fica eternamente esperando o momento perfeito e o mapa congela.
 */
function urgenciaDaIA(estado) {
  const restante = Math.max(0, LIMITE_DE_DIAS - estado.dia);
  return 1 + 1.0 * (1 - restante / LIMITE_DE_DIAS);
}

function jogarTurnoDaIA(estado, nacao) {
  if (estado.dia % INTERVALO_IA !== 0) return;
  const minhas = provinciasDaNacao(estado, nacao.id);
  if (minhas.length === 0) return;

  construirComIA(estado, nacao, minhas);
  recrutarComIA(estado, nacao, minhas);
  atacarComIA(estado, nacao, minhas);
}

function construirComIA(estado, nacao, minhas) {
  // Prioriza o recurso mais escasso em relacao a producao atual
  const producao = calcularProducao(estado, nacao.id);
  const alvos = ["comida", "dinheiro", "aco", "carvao", "petroleo"];
  const recursoAlvo = alvos.reduce(
    (pior, recurso) => (producao[recurso] < producao[pior] ? recurso : pior),
    "comida",
  );
  const construcaoAlvo = Object.values(TIPOS_DE_CONSTRUCAO)
    .find((tipo) => tipo.recurso === recursoAlvo);
  if (construcaoAlvo === undefined) return;

  const ordenadas = [...minhas].sort((a, b) => {
    const pa = TERRENOS[a.terreno][recursoAlvo] ?? 1;
    const pb = TERRENOS[b.terreno][recursoAlvo] ?? 1;
    return pb - pa;
  });

  for (const provincia of ordenadas) {
    const nivel = provincia.construcoes[construcaoAlvo.id] ?? 0;
    if (nivel >= construcaoAlvo.nivelMaximo) continue;
    const ocupados = Object.keys(provincia.construcoes).length;
    if (nivel === 0 && ocupados >= provincia.slots) continue;
    const custo = custoDeConstrucao(construcaoAlvo.id, nivel);
    // A IA guarda uma reserva de dinheiro para a guerra
    const reserva = nacao.estoques.dinheiro < 70 && !podePagar({ dinheiro: nacao.estoques.dinheiro - 70 }, custo);
    if (reserva) continue;
    if (!podePagar(nacao.estoques, custo)) continue;
    pagar(nacao.estoques, custo);
    provincia.construcoes[construcaoAlvo.id] = nivel + 1;
    return; // uma construcao por vez
  }

  // Sem espaco para economia: constroi quartel para poder recrutar
  const alvoMilitar = minhas.find((p) => (p.construcoes.quartel ?? 0) === 0 && Object.keys(p.construcoes).length < p.slots);
  if (alvoMilitar !== undefined) {
    const custo = custoDeConstrucao("quartel", 0);
    if (podePagar(nacao.estoques, custo)) {
      pagar(nacao.estoques, custo);
      alvoMilitar.construcoes.quartel = 1;
    }
  }
}

function recrutarComIA(estado, nacao, minhas) {
  const comQuartel = minhas.filter((p) => (p.construcoes.quartel ?? 0) > 0);
  if (comQuartel.length === 0) return;
  const alvo = comQuartel[0];
  const nivel = alvo.construcoes.quartel;
  const capacidade = 4 + nivel * 4;
  const jaEmTreino = Object.values(alvo.progressoDeRecrutamento)
    .reduce((soma, item) => soma + item.quantidade, 0);
  if (jaEmTreino >= capacidade) return;

  // Escolhe o tipo mais forte que a IA pode pagar com folga
  const desejavel = nacao.estoques.petroleo > 60 ? "blindado" : "infantaria";
  const tipo = TIPOS_DE_UNIDADE[desejavel];
  const custo = {};
  for (const [recurso, valor] of Object.entries(tipo.custo)) custo[recurso] = valor * 2;
  if (!podePagar(nacao.estoques, custo)) return;
  pagar(nacao.estoques, custo);

  const existente = alvo.progressoDeRecrutamento[desejavel];
  if (existente === undefined) {
    const dias = Math.max(1, tipo.diasDeRecrutamento - (nivel - 1));
    alvo.progressoDeRecrutamento[desejavel] = { diasRestantes: dias, quantidade: 2, diasTotais: dias };
  } else {
    existente.quantidade += 2;
  }
}

/**
 * Ofensiva da IA.
 *
 * Tres decisoes, nesta ordem:
 *   1. declarar guerra a um vizinho, quando valer a pena;
 *   2. reforcar as provincias de fronteira com tropas do interior;
 *   3. atacar, mandando apenas a forca necessaria e mantendo guarnicao.
 *
 * O ponto 3 e o que evita o defeito classico de IA: esvaziar a propria
 * provincia para atacar e perde-la no dia seguinte.
 */
function atacarComIA(estado, nacao, minhas) {
  const alvosEmGuerra = [...nacao.emGuerraCom];

  // Abre novas frentes enquanto houver apetite — mas nao contra o mundo inteiro
  if (alvosEmGuerra.length < 3) declararGuerraComIA(estado, nacao, minhas);
  if (alvosEmGuerra.length === 0) return;

  reforcarFrente(estado, nacao, minhas);

  const limiteDeAtaques = Math.min(4, 1 + Math.floor(minhas.length / 10));
  for (let ataque = 0; ataque < limiteDeAtaques; ataque += 1) {
    if (!atacarUmaFrente(estado, nacao, minhas)) break;
  }
}

/** Procura um vizinho que valha a pena atacar e declara guerra, se convier. */
function declararGuerraComIA(estado, nacao, minhas) {
  const vizinhos = new Set();
  for (const provincia of minhas) {
    for (const id of [...provincia.vizinhos, ...(provincia.vizinhosMaritimos ?? [])]) {
      const vizinho = estado.provincias.get(id);
      if (vizinho !== undefined && vizinho.dono !== nacao.id) vizinhos.add(vizinho.dono);
    }
  }

  const minhaForca = forcaTotal(estado, nacao.id);
  const vantagemNecessaria = VANTAGEM_PARA_DECLARAR / urgenciaDaIA(estado);
  if (nacao.estoques.dinheiro < CUSTO_DE_GUERRA) return;

  // Entre os vizinhos, escolhe o mais fraco que ainda valha a pena
  const candidatos = [...vizinhos]
    .map((id) => estado.nacoes.get(id))
    .filter((outra) => outra !== undefined && !outra.eliminada)
    .filter((outra) => minhaForca > forcaTotal(estado, outra.id) * vantagemNecessaria)
    .sort((a, b) => forcaTotal(estado, a.id) - forcaTotal(estado, b.id));
  if (candidatos.length === 0) return;

  const alvo = candidatos[0];
  nacao.estoques.dinheiro -= CUSTO_DE_GUERRA;
  nacao.emGuerraCom.add(alvo.id);
  alvo.emGuerraCom.add(nacao.id);
  registrarEvento(estado, `${nacao.nome} declarou guerra a ${alvo.nome}!`, true);
}

const sitiada = (estado, provinciaId) => estado.batalhas.some((b) => b.provinciaId === provinciaId);

/**
 * Quanto esta frente merece receber tropas.
 *
 * Combina tres coisas: quantos inimigos ela encara, quanta tropa ja tem e —
 * o mais importante — se do outro lado existe um alvo fraco. E assim que
 * aparece um ponto de esforco principal, em vez de uma linha uniforme que
 * nunca rompe.
 */
function carenciaDaFrente(estado, nacao, frente) {
  let melhorOportunidade = 0;
  for (const id of [...frente.vizinhos, ...(frente.vizinhosMaritimos ?? [])]) {
    const vizinho = estado.provincias.get(id);
    if (!estaoEmGuerra(estado, nacao.id, vizinho.dono)) continue;
    const defesa = poderDasUnidades(vizinho.unidades).defesa * bonusDeFortificacao(vizinho);
    // Alvo fraco e indefeso vale muito; alvo entrincheirado vale pouco
    melhorOportunidade = Math.max(melhorOportunidade, 60 / (1 + defesa));
  }
  return melhorOportunidade * 30 - poderDasUnidades(frente.unidades).quantidade * 2.5;
}

/** Provincias minhas que fazem fronteira com alguem em guerra comigo. */
function frentesAtivas(estado, nacao, minhas) {
  return minhas.filter((provincia) =>
    [...provincia.vizinhos, ...(provincia.vizinhosMaritimos ?? [])]
      .some((id) => estaoEmGuerra(estado, nacao.id, estado.provincias.get(id).dono)));
}

/** Move tropas do interior para as provincias de fronteira. */
function reforcarFrente(estado, nacao, minhas) {
  const frentes = frentesAtivas(estado, nacao, minhas);
  if (frentes.length === 0) return;

  const interior = minhas.filter((provincia) =>
    poderDasUnidades(provincia.unidades).quantidade > 0 && !frentes.includes(provincia));

  for (const provincia of interior) {
    // Reforca a fronteira mais carente que esteja ao alcance: cada provincia
    // do interior vai para uma frente diferente, espalhando a linha de defesa.
    const candidatas = frentes
      .filter((frente) => !sitiada(estado, frente.id))
      .filter((frente) => encontrarCaminho(estado, nacao.id, provincia.id, frente.id, 3) !== null)
      .map((frente) => ({
        frente,
        carencia: carenciaDaFrente(estado, nacao, frente),
      }))
      .sort((a, b) => b.carencia - a.carencia);
    if (candidatas.length === 0) continue;

    const destino = candidatas[0].frente;
    for (const [tipo, n] of Object.entries(provincia.unidades)) {
      destino.unidades[tipo] = (destino.unidades[tipo] ?? 0) + n;
    }
    provincia.unidades = {};
  }
}

/**
 * Escolhe a melhor ofensiva disponivel e envia so a forca necessaria.
 * @returns {boolean} se um ataque foi de fato iniciado
 */
function atacarUmaFrente(estado, nacao, minhas) {
  const margem = MARGEM_DE_ATAQUE / urgenciaDaIA(estado);

  const opcoes = [];
  for (const origem of minhas) {
    const ataqueDisponivel = poderDasUnidades(origem.unidades).ataque;
    if (ataqueDisponivel <= 0) continue;
    for (const id of [...origem.vizinhos, ...(origem.vizinhosMaritimos ?? [])]) {
      const alvo = estado.provincias.get(id);
      if (alvo === undefined || !estaoEmGuerra(estado, nacao.id, alvo.dono)) continue;
      const defesa = poderDasUnidades(alvo.unidades).defesa * bonusDeFortificacao(alvo);
      // Um ataque que nao machuca o defensor nao vale a pena
      if (ataqueDisponivel < defesa * margem) continue;
      opcoes.push({ origem, alvo, defesa, excedente: ataqueDisponivel / Math.max(1, defesa) });
    }
  }
  if (opcoes.length === 0) return false;

  // Prefere o alvo mais fraco: e onde a guerra anda mais rapido
  opcoes.sort((a, b) => b.excedente - a.excedente || a.defesa - b.defesa);
  const { origem, alvo, defesa } = opcoes[0];

  // Ponto de esforco principal: quando a provincia ja esta bem guarnecida,
  // compromete a maior parte dela em vez de mandar um destacamento timido.
  const ataqueDaOrigem = poderDasUnidades(origem.unidades).ataque;
  const necessario = Math.max(defesa * margem, ataqueDaOrigem * FRACAO_DE_EMPENHO);
  const tropas = separarForca(origem, necessario);
  if (Object.keys(tropas).length === 0) return false;

  const porMar = ehDesembarque(estado, origem.id, alvo.id);
  iniciarOuReforcarBatalha(estado, alvo, nacao.id, tropas, porMar);
  registrarEvento(estado, porMar
    ? `${nacao.nome} desembarcou em ${alvo.nome}.`
    : `${nacao.nome} atacou ${alvo.nome}.`, true);
  return true;
}

/**
 * Tira da provincia apenas as unidades necessarias para vencer, deixando
 * guarnicao para tras. Unidades sao escolhidas das mais eficientes (ataque
 * por ponto de vida) para as menos, e a provincia nunca fica completamente vazia.
 */
function separarForca(origem, ataqueNecessario) {
  const disponiveis = Object.entries(origem.unidades)
    .filter(([tipo, n]) => n > 0 && TIPOS_DE_UNIDADE[tipo] !== undefined)
    .map(([tipo, n]) => ({ tipo, n, forca: TIPOS_DE_UNIDADE[tipo].ataque, vida: TIPOS_DE_UNIDADE[tipo].vida }))
    .sort((a, b) => (b.forca / b.vida) - (a.forca / a.vida));

  const total = disponiveis.reduce((soma, u) => soma + u.n, 0);
  // Guarnicao minima: pelo menos 1 unidade e 25% da tropa fica em casa
  const reservaMinima = Math.min(total - 1, Math.ceil(total * 0.25));

  const enviadas = {};
  let ataqueEnviado = 0;
  let enviadasNoTotal = 0;
  for (const unidade of disponiveis) {
    for (let i = 0; i < unidade.n; i += 1) {
      if (ataqueEnviado >= ataqueNecessario) break;
      if (total - enviadasNoTotal <= reservaMinima) break;
      enviadas[unidade.tipo] = (enviadas[unidade.tipo] ?? 0) + 1;
      ataqueEnviado += unidade.forca;
      enviadasNoTotal += 1;
    }
    if (ataqueEnviado >= ataqueNecessario && total - enviadasNoTotal <= reservaMinima) break;
  }

  for (const [tipo, n] of Object.entries(enviadas)) {
    origem.unidades[tipo] -= n;
    if (origem.unidades[tipo] <= 0) delete origem.unidades[tipo];
  }
  return enviadas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Eventos e vitoria
// ─────────────────────────────────────────────────────────────────────────────

function registrarEvento(estado, texto, destaque = false) {
  estado.eventos.push({ dia: estado.dia, texto, destaque });
  if (estado.eventos.length > 300) estado.eventos.splice(0, estado.eventos.length - 300);
}

export function definirJogador(estado, jogadorId, nacaoId) {
  if (nacaoId !== null && !estado.nacoes.has(nacaoId)) return recusar("Nacao inexistente.");
  estado.jogadores.set(jogadorId, nacaoId);
  const nacao = estado.nacoes.get(nacaoId);
  if (nacao !== undefined) {
    nacao.ia = false;
    registrarEvento(estado, `${nacao.nome} assumiu o comando.`, true);
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Projecao para o cliente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monta o retrato completo que o cliente desenha. O cliente nao deriva nada:
 * recebe tudo calculado. Isso mantem uma unica fonte de verdade.
 */
export function projetarEstado(estado, jogadorId) {
  const minhaNacao = estado.jogadores.get(jogadorId) ?? null;
  const nacoes = [...estado.nacoes.values()].map((nacao) => ({
    id: nacao.id,
    nome: nacao.nome,
    cor: nacao.cor,
    capital: nacao.capital,
    eliminada: nacao.eliminada,
    provincias: provinciasDaNacao(estado, nacao.id).length,
    forca: Math.round(forcaTotal(estado, nacao.id)),
    emGuerraCom: [...nacao.emGuerraCom],
    alcancavel: nacao.id !== minhaNacao && temContatoCom(estado, minhaNacao, nacao.id),
    estoques: nacao.id === minhaNacao ? nacao.estoques : null,
    producao: nacao.id === minhaNacao ? calcularProducao(estado, nacao.id) : null,
    consumoDeComida: nacao.id === minhaNacao ? calcularConsumoDeComida(estado, nacao.id) : null,
    ehVoce: nacao.id === minhaNacao,
  }));

  const provincias = [...estado.provincias.values()].map((provincia) => ({
    id: provincia.id,
    q: provincia.q,
    r: provincia.r,
    x: Math.round(provincia.x * 1000) / 1000,
    y: Math.round(provincia.y * 1000) / 1000,
    nome: provincia.nome,
    terreno: provincia.terreno,
    dono: provincia.dono,
    vizinhos: provincia.vizinhos,
    vizinhosMaritimos: provincia.vizinhosMaritimos ?? [],
    slots: provincia.slots,
    construcoes: provincia.construcoes,
    fortificacao: provincia.fortificacao ?? 0,
    unidades: provincia.unidades,
    recrutando: provincia.progressoDeRecrutamento,
    poder: Math.round(poderDasUnidades(provincia.unidades).ataque),
    ehCapital: provincia.dono !== null && estado.nacoes.get(provincia.dono)?.capital === provincia.nome,
    emBatalha: estado.batalhas.some((b) => b.provinciaId === provincia.id),
    // Custos efetivos calculados AQUI, pelo servidor. Nas provincias do jogador
    // o cliente recebe o preco pronto (inclusive o desconto do quartel) e nunca
    // precisa conhecer a formula — se ela mudar, o cliente nao muda.
    ...(provincia.dono === minhaNacao
      ? {
          custosDeConstrucao: Object.fromEntries(
            Object.keys(TIPOS_DE_CONSTRUCAO).map((idConstrucao) => {
              const nivel = provincia.construcoes[idConstrucao] ?? 0;
              const tipo = TIPOS_DE_CONSTRUCAO[idConstrucao];
              const custo = custoDeConstrucao(idConstrucao, nivel);
              return [
                idConstrucao,
                {
                  nivelAtual: nivel,
                  nivelMaximo: tipo.nivelMaximo,
                  maximo: nivel >= tipo.nivelMaximo,
                  custo,
                  podePagar: podePagar(estado.nacoes.get(minhaNacao).estoques, custo),
                  producaoAtual: tipo.recurso === null ? null : tipo.producaoBase * nivel * (TERRENOS[provincia.terreno][tipo.recurso] ?? 1),
                  producaoProximoNivel: tipo.recurso === null ? null : tipo.producaoBase * (nivel + 1) * (TERRENOS[provincia.terreno][tipo.recurso] ?? 1),
                },
              ];
            }).filter(() => true),
          ),
          custosDeRecrutamento: custosDeRecrutamentoDaProvincia(estado, minhaNacao, provincia),
          // O servidor tambem calcula o alcance: assim o cliente so precisa
          // pintar de verde o que ja foi validado aqui.
          alcancePorUnidade: alcancePorUnidade(estado, minhaNacao, provincia),
          alcanceMaritimoPorUnidade: alcanceMaritimoPorUnidade(estado, minhaNacao, provincia),
          vizinhosInimigos: provincia.vizinhos.filter((vizinhoId) => {
            const vizinho = estado.provincias.get(vizinhoId);
            return vizinho !== undefined && vizinho.dono !== null && vizinho.dono !== minhaNacao;
          }),
        }
      : {}),
  }));

  const batalhas = estado.batalhas.map((b) => ({
    id: b.id,
    provinciaId: b.provinciaId,
    provinciaNome: estado.provincias.get(b.provinciaId)?.nome ?? "?",
    atacante: b.atacante,
    atacanteNome: estado.nacoes.get(b.atacante)?.nome ?? "?",
    defensor: b.defensor,
    defensorNome: estado.nacoes.get(b.defensor)?.nome ?? "?",
    dias: b.dias,
    vidaAtacante: Math.round(b.vidaAtacante),
    vidaDefensora: Math.round(b.vidaDefensora),
    atacanteEhVoce: b.atacante === minhaNacao,
    porMar: b.porMar === true,
  }));

  return {
    dia: estado.dia,
    vencedor: estado.vencedor,
    vencedorNome: estado.vencedor === null ? null : estado.nacoes.get(estado.vencedor)?.nome ?? null,
    motivoDaVitoria: estado.motivoDaVitoria ?? null,
    limiteDeDias: LIMITE_DE_DIAS,
    minhaNacao,
    nacoes,
    provincias,
    batalhas,
    eventos: estado.eventos.slice(-60).reverse(),
    totalDeProvincias: estado.provincias.size,
    probabilidadeDeVitoria: calcularPlacar(estado),
    // Catalogo de regras: vai junto para o cliente poder exibir nomes, icones e
    // descricoes sem ter nenhum numero do jogo embutido no codigo dele.
    regras: {
      recursos: RECURSOS,
      nomeDoRecurso: NOME_DO_RECURSO,
      construcoes: Object.values(TIPOS_DE_CONSTRUCAO),
      unidades: Object.values(TIPOS_DE_UNIDADE),
      terrenos: TERRENOS,
      diasPorSegundo: DIAS_POR_SEGUNDO,
      custoDeGuerra: CUSTO_DE_GUERRA,
      producaoBasePorProvincia: PRODUCAO_BASE_POR_PROVINCIA,
      bonusDeDesembarque: BONUS_DE_DESEMBARQUE,
      dominioParaVitoria: DOMINIO_PARA_VITORIA,
      limiteDeDias: LIMITE_DE_DIAS,
      // Geometria dos vizinhos, para o cliente saber desenhar as arestas dos hexagonos
      direcoes: DIRECOES,
    },
  };
}

/**
 * Onde cada tipo de unidade presente nesta provincia pode chegar.
 *
 * O caminho so atravessa territorio proprio e o numero de passos e a
 * velocidade da unidade. Como isto e regra, quem calcula e o servidor.
 */
function alcancePorUnidade(estado, nacaoId, provincia) {
  const resultado = {};
  for (const [tipo, quantidade] of Object.entries(provincia.unidades)) {
    if (quantidade <= 0) continue;
    const passos = Math.max(1, TIPOS_DE_UNIDADE[tipo]?.velocidade ?? 1);
    resultado[tipo] = alcancavelEmPassos(estado, nacaoId, provincia.id, passos).porTerra;
  }
  return resultado;
}

/** Destinos que exigem travessia maritima (desembarque ou transporte). */
function alcanceMaritimoPorUnidade(estado, nacaoId, provincia) {
  const resultado = {};
  for (const [tipo, quantidade] of Object.entries(provincia.unidades)) {
    if (quantidade <= 0) continue;
    const passos = Math.max(1, TIPOS_DE_UNIDADE[tipo]?.velocidade ?? 1);
    resultado[tipo] = alcancavelEmPassos(estado, nacaoId, provincia.id, passos).porMar;
  }
  return resultado;
}

/**
 * Onde as unidades desta provincia podem chegar.
 * @returns {{porTerra: string[], porMar: string[]}}
 */
function alcancavelEmPassos(estado, nacaoId, origemId, maxPassos) {
  const porTerra = new Set();
  const porMar = new Set();
  const visitados = new Set([origemId]);
  let fronteira = [origemId];

  for (let passo = 0; passo < maxPassos; passo += 1) {
    const proxima = [];
    for (const id of fronteira) {
      for (const vizinhoId of estado.provincias.get(id).vizinhos) {
        if (visitados.has(vizinhoId)) continue;
        visitados.add(vizinhoId);
        const vizinho = estado.provincias.get(vizinhoId);
        // Nao se reforca provincia sitiada, entao ela nao entra no alcance
        if (vizinho.dono === nacaoId) {
          if (!estado.batalhas.some((b) => b.provinciaId === vizinhoId)) porTerra.add(vizinhoId);
          proxima.push(vizinhoId);
        } else if (vizinho.dono !== null) {
          porTerra.add(vizinhoId);
        }
      }
    }
    fronteira = proxima;
    if (fronteira.length === 0) break;
  }

  // Travessia maritima consome o turno inteiro, entao sai direto da origem
  for (const vizinhoId of estado.provincias.get(origemId).vizinhosMaritimos ?? []) {
    const vizinho = estado.provincias.get(vizinhoId);
    if (vizinho === undefined) continue;
    if (vizinho.dono === nacaoId && estado.batalhas.some((b) => b.provinciaId === vizinhoId)) continue;
    porMar.add(vizinhoId);
  }

  return { porTerra: [...porTerra], porMar: [...porMar] };
}

/** Custo de cada unidade nesta provincia, ja com o desconto do quartel. */
function custosDeRecrutamentoDaProvincia(estado, nacaoId, provincia) {
  const nivelQuartel = provincia.construcoes.quartel ?? 0;
  const desconto = Math.max(0.6, 1 - 0.06 * Math.max(0, nivelQuartel - 1));
  const estoques = estado.nacoes.get(nacaoId).estoques;
  const emTreino = Object.values(provincia.progressoDeRecrutamento)
    .reduce((soma, item) => soma + item.quantidade, 0);
  return {
    temQuartel: nivelQuartel > 0,
    nivelQuartel,
    desconto: Math.round(desconto * 100) / 100,
    capacidade: nivelQuartel > 0 ? 4 + nivelQuartel * 4 : 0,
    emTreino,
    unidades: Object.fromEntries(
      Object.values(TIPOS_DE_UNIDADE).map((tipo) => {
        const custo = {};
        for (const [recurso, valor] of Object.entries(tipo.custo)) {
          custo[recurso] = Math.ceil(valor * desconto);
        }
        const dias = Math.max(1, tipo.diasDeRecrutamento - Math.max(0, nivelQuartel - 1));
        return [tipo.id, { custo, dias, podePagar: podePagar(estoques, custo) }];
      }),
    ),
  };
}

/** Placar simples: fracao de provincias controladas por nacao. */
function calcularPlacar(estado) {
  const total = estado.provincias.size;
  const placar = {};
  for (const nacao of estado.nacoes.values()) {
    placar[nacao.id] = Math.round((provinciasDaNacao(estado, nacao.id).length / total) * 1000) / 10;
  }
  return placar;
}
