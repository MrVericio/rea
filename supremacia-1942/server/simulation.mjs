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
  EFICIENCIA_NACIONAL,
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
 * Ninguem e declarado vencedor por dominio antes deste dia.
 *
 * A campanha tem um periodo de disputa: sem este piso, uma potencia que
 * comeca maior (a Uniao Sovietica, com 45 provincias) vencia no primeiro
 * terco, muitas vezes antes de o jogador terminar a primeira guerra. Com o
 * piso, as coalizoes tem tempo de se formar e a partida vai ate o fim.
 */
export const DIA_MINIMO_PARA_VITORIA = 240;

/**
 * Prazo da campanha, em dias de jogo. No dia limite ha um armisticio e vence
 * quem controla mais territorio — assim a partida SEMPRE termina, o que e
 * essencial tanto para o jogador quanto para a IA nao ficar em impasse.
 */
export const LIMITE_DE_DIAS = 360;

// ─────────────────────────────────────────────────────────────────────────────
// Criacao do estado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pesquisa: nao e uma arvore de cliques. Os pontos se ACUMULAM nos
 * laboratorios e o jogador escolhe onde gastar. Um avanco so libera quando as
 * suas dependencias ja estao concluidas, e cada avanco vira um multiplicador
 * que o motor inteiro respeita.
 */
export const RAMOS_DE_PESQUISA = Object.freeze({
  doutrina: "Doutrina militar",
  industria: "Complexo industrial",
  ciencia: "Ciencia aplicada",
  naval: "Guerra naval",
});

export const AVANCOS = Object.freeze({
  instrucao_de_combate: {
    id: "instrucao_de_combate", nome: "Instrucao de Combate", ramo: "doutrina",
    custo: 120, prerequisitos: [], efeito: { ataque: 0.12 },
    descricao: "Poder de ataque +12%",
  },
  armas_combinadas: {
    id: "armas_combinadas", nome: "Armas Combinadas", ramo: "doutrina",
    custo: 285, prerequisitos: ["instrucao_de_combate"], efeito: { ataque: 0.18 },
    descricao: "Poder de ataque +18%",
  },
  guerra_de_movimento: {
    id: "guerra_de_movimento", nome: "Guerra de Movimento", ramo: "doutrina",
    custo: 225, prerequisitos: ["instrucao_de_combate"], efeito: { velocidade: 1 },
    descricao: "Todas as unidades avancam uma provincia a mais por dia",
  },
  linha_de_montagem: {
    id: "linha_de_montagem", nome: "Linha de Montagem", ramo: "industria",
    custo: 135, prerequisitos: [], efeito: { custoDeRecrutamento: -0.15 },
    descricao: "Formar unidades custa 15% menos",
  },
  producao_em_massa: {
    id: "producao_em_massa", nome: "Producao em Massa", ramo: "industria",
    custo: 255, prerequisitos: ["linha_de_montagem"], efeito: { producao: 0.12 },
    descricao: "Toda a producao +12%",
  },
  logistica_de_guerra: {
    id: "logistica_de_guerra", nome: "Logistica de Guerra", ramo: "industria",
    custo: 180, prerequisitos: [], efeito: { consumo: -0.2 },
    descricao: "As tropas comem 20% menos",
  },
  quimica_aplicada: {
    id: "quimica_aplicada", nome: "Quimica Aplicada", ramo: "ciencia",
    custo: 165, prerequisitos: [], efeito: { porRecurso: { aco: 0.15, petroleo: 0.15 } },
    descricao: "Aco e petroleo +15%",
  },
  medicina_de_campanha: {
    id: "medicina_de_campanha", nome: "Medicina de Campanha", ramo: "ciencia",
    custo: 195, prerequisitos: [], efeito: { baixas: -0.15 },
    descricao: "Suas tropas sofrem 15% menos baixas",
  },
  pesquisa_aplicada: {
    id: "pesquisa_aplicada", nome: "Pesquisa Aplicada", ramo: "ciencia",
    custo: 240, prerequisitos: ["quimica_aplicada"], efeito: { pesquisa: 0.3 },
    descricao: "Laboratorios rendem 30% mais pontos",
  },
  engenharia_naval: {
    id: "engenharia_naval", nome: "Engenharia Naval", ramo: "naval",
    custo: 210, prerequisitos: [], efeito: { desembarque: -0.6 },
    descricao: "Desembarcar deixa de ser quase suicidio",
  },
  artilharia_costeira: {
    id: "artilharia_costeira", nome: "Artilharia Costeira", ramo: "naval",
    custo: 165, prerequisitos: [], efeito: { defesaCosteira: 0.2 },
    descricao: "Defesa +20% em provincia de litoral",
  },
  esquadra_de_invasao: {
    id: "esquadra_de_invasao", nome: "Esquadra de Invasao", ramo: "naval",
    custo: 300, prerequisitos: ["engenharia_naval"], efeito: { ataqueAnfibio: 0.15 },
    descricao: "Ataque +15% em desembarque",
  },
});

/**
 * Doutrinas: a politica interna. Sao gratuitas de manter em recursos, mas
 * custam MORAL todo dia. O jogador so pode sustentar algumas ao mesmo tempo,
 * entao cada campanha tem um estilo — economia de guerra, ou paz social.
 */
export const DOUTRINAS = Object.freeze({
  racionamento: {
    id: "racionamento", nome: "Racionamento", custo: 120, moralPorDia: -1,
    efeito: { consumo: -0.25 }, descricao: "Consumo de alimento -25%",
  },
  turnos_extras: {
    id: "turnos_extras", nome: "Turnos Extras", custo: 150, moralPorDia: -1.5,
    efeito: { producao: 0.2 }, descricao: "Producao +20%",
  },
  propaganda: {
    id: "propaganda", nome: "Propaganda de Guerra", custo: 90, moralPorDia: 2,
    dinheiroPorDia: 12, efeito: {}, descricao: "Moral +2 por dia, custa 12 de dinheiro por dia",
  },
  servico_civil: {
    id: "servico_civil", nome: "Servico Civil", custo: 110, moralPorDia: -0.8,
    efeito: { porRecurso: { dinheiro: 0.25 } }, descricao: "Renda +25%",
  },
  recrutamento_geral: {
    id: "recrutamento_geral", nome: "Recrutamento Geral", custo: 160, moralPorDia: -2,
    efeito: { custoDeRecrutamento: -0.3 }, descricao: "Formar unidades custa 30% menos",
  },
  economia_de_guerra: {
    id: "economia_de_guerra", nome: "Economia de Guerra", custo: 130, moralPorDia: -0.5,
    efeito: { porRecurso: { aco: 0.2, petroleo: 0.2, comida: -0.15 } },
    descricao: "Aco e petroleo +20%, alimento -15%",
  },
  censura: {
    id: "censura", nome: "Censura", custo: 80, moralPorDia: 1.2,
    efeito: { pesquisa: -0.25 }, descricao: "Moral +1,2 por dia, pesquisa -25%",
  },
  paz_social: {
    id: "paz_social", nome: "Paz Social", custo: 100, moralPorDia: 1.5,
    efeito: { producao: -0.1 }, descricao: "Moral +1,5 por dia, producao -10%",
  },
});

export const LIMITE_DE_DOUTRINAS = 3;
export const MORAL_INICIAL = 70;
export const BASE_DE_PESQUISA = 0.5;   // pontos por dia mesmo sem laboratorio
export const PESQUISA_POR_NIVEL = 0.9; // pontos por nivel de laboratorio

/**
 * Junta num so lugar tudo o que muda os numeros de uma nacao: pesquisa
 * concluida, doutrinas adotadas e o moral do povo. Tudo vira MULTIPLICADOR
 * (1 = neutro), para nao existir soma de percentuais confusa espalhada pelo
 * motor. Quem precisar de um numero do jogo chama esta funcao.
 */
export function bonusNacional(estado, nacaoId) {
  const nacao = estado.nacoes.get(nacaoId);
  const bonus = {
    ataque: 1, defesa: 1, producao: 1, consumo: 1,
    custoDeRecrutamento: 1, pesquisa: 1, baixas: 1,
    velocidade: 0, dinheiroPorDia: 0, desembarque: 0,
    ataqueAnfibio: 1, defesaCosteira: 0, porRecurso: {},
  };
  if (nacao === undefined) return bonus;

  const aplicar = (efeito) => {
    for (const [chave, valor] of Object.entries(efeito ?? {})) {
      if (chave === "porRecurso") {
        for (const [recurso, fator] of Object.entries(valor)) {
          bonus.porRecurso[recurso] = (bonus.porRecurso[recurso] ?? 1) * (1 + fator);
        }
      } else if (chave === "velocidade") {
        bonus.velocidade += valor;
      } else if (chave === "desembarque" || chave === "defesaCosteira") {
        bonus[chave] += valor;
      } else {
        bonus[chave] *= 1 + valor;
      }
    }
  };

  for (const idAvanco of nacao.pesquisa.concluidas) aplicar(AVANCOS[idAvanco]?.efeito);
  for (const idDoutrina of nacao.doutrinas) {
    const doutrina = DOUTRINAS[idDoutrina];
    aplicar(doutrina?.efeito);
    bonus.dinheiroPorDia += doutrina?.dinheiroPorDia ?? 0;
  }

  // O moral do povo atravessa tudo: economia e combatividade
  const moral = nacao.moral ?? MORAL_INICIAL;
  bonus.producao *= 0.75 + 0.5 * (moral / 100);
  bonus.ataque *= 0.85 + 0.3 * (moral / 100);
  bonus.defesa *= 0.85 + 0.3 * (moral / 100);
  return bonus;
}

/** Pontos de pesquisa por dia: base + laboratorios, ajustados pelo bonus. */
export function pontosDePesquisa(estado, nacaoId) {
  const nacao = estado.nacoes.get(nacaoId);
  if (nacao === undefined) return 0;
  let niveis = 0;
  for (const provincia of estado.provincias.values()) {
    if (provincia.dono !== nacaoId) continue;
    niveis += provincia.construcoes.laboratorio ?? 0;
  }
  const bruto = (BASE_DE_PESQUISA + niveis * PESQUISA_POR_NIVEL) * bonusNacional(estado, nacaoId).pesquisa;
  return Math.round(bruto * 100) / 100;
}

/** Uma provincia de litoral tem alguma travessia maritima? */
function ehCosteira(provincia) {
  return (provincia.vizinhosMaritimos ?? []).length > 0;
}

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
      // Politica interna
      moral: MORAL_INICIAL,
      doutrinas: new Set(),
      // Pesquisa: pontos acumulados e avancos ja concluidos
      pesquisa: { pontos: 0, concluidas: new Set() },
      // Diplomacia: relacoes (-100..100) e pactos firmados
      relacoes: new Map(),
      pactos: new Map(), // nacaoId -> { tipo, desde, expira }
      // Contadores do dia, zerados a cada virada
      conquistasHoje: 0,
      perdasHoje: 0,
      passouFome: false,
    });
  }

  semearEconomiaInicial(estado);
  semearForcasIniciais(estado);
  semearGuerrasHistoricas(estado);
  semearDiplomacia(estado);

  return estado;
}

/**
 * Ponto de partida das relacoes: quem esta em guerra se odeia; quem apenas
 * divide fronteira desconfia; quem esta longe se ignora. Assim as propostas de
 * pacto ja nascem com contexto em vez de aparecerem do nada.
 */
function semearDiplomacia(estado) {
  for (const a of estado.nacoes.values()) {
    for (const b of estado.nacoes.values()) {
      if (a.id === b.id) continue;
      a.relacoes.set(b.id, estaoEmGuerra(estado, a.id, b.id) ? -60 : 5);
    }
  }
  // Fronteira terrestre gera atrito; travessia maritima, desconfianca menor
  for (const provincia of estado.provincias.values()) {
    if (provincia.dono === null) continue;
    for (const vizinhoId of provincia.vizinhos) {
      const vizinho = estado.provincias.get(vizinhoId);
      if (vizinho?.dono === null || vizinho?.dono === provincia.dono) continue;
      ajustarRelacoes(estado, provincia.dono, vizinho.dono, -0.4);
    }
  }
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
/** Quanto cada provincia produz por dia antes de terreno, obra e bonus. */
export const PRODUCAO_BASE_POR_PROVINCIA = Object.freeze({
  dinheiro: 3.4, comida: 2, aco: 1, petroleo: 0.6, carvao: 1,
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
  // O bonus nacional (pesquisa, doutrinas, moral) entra aqui, e nao no loop,
  // para que o numero mostrado na tela seja exatamente o numero creditado.
  const bonus = bonusNacional(estado, nacaoId);
  const eficiencia = EFICIENCIA_NACIONAL[nacaoId] ?? 1;
  for (const recurso of RECURSOS) {
    producao[recurso] *= bonus.producao * (bonus.porRecurso[recurso] ?? 1) * eficiencia;
    producao[recurso] = Math.round(producao[recurso] * 100) / 100;
  }
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
  return Math.round(consumo * bonusNacional(estado, nacaoId).consumo * 100) / 100;
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

/** Soma (ou subtrai) relacoes nos DOIS lados: a simpatia e sempre mutua. */
function ajustarRelacoes(estado, a, b, delta) {
  if (a === null || b === null || a === b) return;
  const na = estado.nacoes.get(a);
  const nb = estado.nacoes.get(b);
  if (na === undefined || nb === undefined) return;
  const limitar = (v) => Math.max(-100, Math.min(100, v));
  na.relacoes.set(b, limitar((na.relacoes.get(b) ?? 0) + delta));
  nb.relacoes.set(a, limitar((nb.relacoes.get(a) ?? 0) + delta));
}

/** O pacto vigente entre duas nacoes, ou null. Pacto vencido nao conta. */
export function pactoEntre(estado, a, b) {
  const nacao = estado.nacoes.get(a);
  const pacto = nacao?.pactos.get(b);
  if (pacto === undefined) return null;
  if (pacto.expira !== null && estado.dia >= pacto.expira) return null;
  return pacto;
}

export function ehAliado(estado, a, b) {
  return pactoEntre(estado, a, b)?.tipo === "alianca";
}

export function firmarPacto(estado, a, b, tipo, duracao) {
  const na = estado.nacoes.get(a);
  const nb = estado.nacoes.get(b);
  const registro = { tipo, desde: estado.dia, expira: estado.dia + duracao };
  na.pactos.set(b, { ...registro });
  nb.pactos.set(a, { ...registro });
}

function desfazerPacto(estado, a, b) {
  estado.nacoes.get(a)?.pactos.delete(b);
  estado.nacoes.get(b)?.pactos.delete(a);
}

/**
 * A politica externa tambem se move sozinha. Duas coisas aproximam as nacoes:
 * ter um inimigo comum (quem briga com o meu inimigo e meu amigo) e o simples
 * passar do tempo em paz. Sem isso as relacoes ficariam congeladas no valor
 * inicial e nenhum pacto seria assinado em 360 dias.
 */
function atualizarRelacoes(estado) {
  const vivas = [...estado.nacoes.values()].filter((n) => !n.eliminada);

  // Quem esta ficando com o mapa e o inimigo de todos: o medo e um sentimento
  // diplomatico mais forte que o tempo de paz.
  const total = estado.provincias.size;
  let ameaca = null;
  let maiorFatia = 0;
  for (const nacao of vivas) {
    const fatia = provinciasDaNacao(estado, nacao.id).length / total;
    if (fatia > maiorFatia) {
      maiorFatia = fatia;
      ameaca = nacao.id;
    }
  }
  const pressao = Math.max(0, Math.min(1,
    (maiorFatia - DOMINIO_QUE_ASSISTA) / (DOMINIO_DO_MEDO_PLENO - DOMINIO_QUE_ASSISTA)));
  if (pressao <= 0) ameaca = null;
  const pisoDoMedo = -100 * pressao;

  // O momento em que a ameaca aparece e um acontecimento diplomatico, nao uma
  // linha de codigo: as chancelarias reagem de uma vez.
  const lideranca = ameaca === null ? null : estado.nacoes.get(ameaca);
  if (lideranca !== null && lideranca !== undefined && lideranca.ameacaAnunciada !== true) {
    lideranca.ameacaAnunciada = true;
    const apoiadores = [];
    for (const outra of vivas) {
      if (outra.id === ameaca) continue;
      ajustarRelacoes(estado, ameaca, outra.id, -25);
      apoiadores.push(outra.nome);
    }
    registrarEvento(estado,
      `${lideranca.nome} ja controla um quinto do continente: as outras potencias se aproximam contra ela.`, true);
    void apoiadores;
  }

  for (let i = 0; i < vivas.length; i += 1) {
    for (let j = i + 1; j < vivas.length; j += 1) {
      const a = vivas[i];
      const b = vivas[j];
      if (estaoEmGuerra(estado, a.id, b.id)) continue;
      const temInimigoComum = [...b.emGuerraCom].some((id) => a.emGuerraCom.has(id));
      let delta = temInimigoComum ? 0.3 : 0.05;
      if (ameaca !== null) {
        if (a.id === ameaca || b.id === ameaca) {
          // Rancor com piso: puxa a relacao para baixo, mas nao para sempre. Se
          // o gigante recuar, o mundo esfria a cabeca na mesma proporcao.
          const atual = estado.nacoes.get(a.id).relacoes.get(b.id) ?? 0;
          delta = Math.max(-0.5, Math.min(0.12, (pisoDoMedo - atual) * 0.06));
        } else {
          delta += 0.15; // os visados pelo gigante se entendem entre si
        }
      }
      ajustarRelacoes(estado, a.id, b.id, delta);
    }
  }
}

/** Ajusta o moral no fim do dia, a partir do que aconteceu. */
function atualizarMoral(estado, nacao) {
  let delta = 0.1; // o povo se acalma devagar quando nada acontece
  const guerras = [...nacao.emGuerraCom]
    .filter((id) => estado.nacoes.get(id)?.eliminada !== true).length;
  // Cada frente alem da primeira desgasta; nenhuma nação sustenta uma guerra
  // continental indefinidamente sem propaganda ou paz
  if (guerras > 1) delta -= 0.15 * (guerras - 1);
  if (nacao.passouFome === true) delta -= 1.5;
  delta += 0.4 * nacao.conquistasHoje;
  delta -= 0.5 * nacao.perdasHoje;
  for (const idDoutrina of nacao.doutrinas) delta += DOUTRINAS[idDoutrina]?.moralPorDia ?? 0;
  // Moral no chao custa gente: o povo simplesmente para de cooperar
  nacao.moral = Math.round(Math.max(0, Math.min(100, nacao.moral + delta)) * 100) / 100;
  nacao.conquistasHoje = 0;
  nacao.perdasHoje = 0;
  nacao.passouFome = false;
}

/**
 * Como uma nacao da IA reage a uma proposta diplomatica. Nao ha sorteio: a
 * decisao sai de relacoes, poder relativo e ambicao — assim o jogador
 * consegue prever e aprender o sistema.
 */
function aceitaPropostaDaIA(estado, alvo, proponenteId, tipo) {
  const relacoes = alvo.relacoes.get(proponenteId) ?? 0;
  const proponente = estado.nacoes.get(proponenteId);
  const minhaForca = forcaTotal(estado, alvo.id);
  const forcaDele = forcaTotal(estado, proponenteId);
  // Ninguem assina com quem esta ganhando o mapa: seria virar vassalo
  const dominioDele = provinciasDaNacao(estado, proponenteId).length / estado.provincias.size;
  if (dominioDele >= DOMINIO_PARA_VITORIA * 0.8) return { aceita: false, motivo: "medo" };
  const limiar = tipo === "alianca" ? 50 : 15;
  if (relacoes < limiar) return { aceita: false, motivo: "relacoes" };
  // Alianca com quem esta muito mais forte vira protetorado: recusa
  if (tipo === "alianca" && forcaDele > minhaForca * 2.2) return { aceita: false, motivo: "desequilibrio" };
  return { aceita: true, motivo: "aceita" };
}

const recusar = (motivo) => ({ ok: false, motivo });

/**
 * Executa um comando em nome de um jogador.
 * @returns {{ok: true, evento: string}|{ok: false, motivo: string}}
 */
export function executarComando(estado, jogadorId, comando) {
  const nacaoId = estado.jogadores.get(jogadorId);
  // `null` e quem entrou na sala e ainda nao assumiu nacao (observador). Sem
  // esta guarda, um espectador derrubava o motor: os comandos de governo iam
  // procurar os estoques de uma nacao que nao existe.
  if (nacaoId === undefined || nacaoId === null) return recusar("Voce ainda nao escolheu uma nacao.");
  if (!estado.nacoes.has(nacaoId)) return recusar("Nacao inexistente.");
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
    case "pesquisar":
      return comandoPesquisar(estado, nacaoId, comando);
    case "adotarDoutrina":
      return comandoAdotarDoutrina(estado, nacaoId, comando);
    case "revogarDoutrina":
      return comandoRevogarDoutrina(estado, nacaoId, comando);
    case "proporPacto":
      return comandoProporPacto(estado, nacaoId, comando);
    case "romperPacto":
      return comandoRomperPacto(estado, nacaoId, comando);
    case "enviarAjuda":
      return comandoEnviarAjuda(estado, nacaoId, comando);
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
  const fatorNacional = bonusNacional(estado, nacaoId).custoDeRecrutamento;
  const custo = {};
  for (const [recurso, valor] of Object.entries(tipo.custo)) {
    custo[recurso] = Math.ceil(valor * n * desconto * fatorNacional);
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
function exigirNacaoValida(estado, nacaoId, alvoId) {
  if (alvoId === nacaoId) return recusar("Voce nao pode fazer isso consigo mesmo.");
  const alvo = estado.nacoes.get(alvoId);
  if (alvo === undefined) return recusar("Nacao alvo invalida.");
  if (alvo.eliminada) return recusar(`${alvo.nome} ja foi eliminada da campanha.`);
  return alvo;
}

function comandoPesquisar(estado, nacaoId, { avancoId }) {
  const nacao = estado.nacoes.get(nacaoId);
  const avanco = AVANCOS[avancoId];
  if (avanco === undefined) return recusar("Avanco desconhecido.");
  if (nacao.pesquisa.concluidas.has(avancoId)) return recusar(`${avanco.nome} ja foi concluido.`);
  for (const pre of avanco.prerequisitos) {
    if (!nacao.pesquisa.concluidas.has(pre)) {
      return recusar(`Requer ${AVANCOS[pre]?.nome ?? pre} antes.`);
    }
  }
  if (nacao.pesquisa.pontos < avanco.custo) {
    return recusar(`Faltam ${Math.ceil(avanco.custo - nacao.pesquisa.pontos)} pontos de pesquisa.`);
  }
  nacao.pesquisa.pontos = Math.round((nacao.pesquisa.pontos - avanco.custo) * 100) / 100;
  nacao.pesquisa.concluidas.add(avancoId);
  const evento = `${nacao.nome} concluiu a pesquisa ${avanco.nome} (${avanco.descricao}).`;
  registrarEvento(estado, evento, true);
  return { ok: true, evento };
}

function comandoAdotarDoutrina(estado, nacaoId, { doutrinaId }) {
  const nacao = estado.nacoes.get(nacaoId);
  const doutrina = DOUTRINAS[doutrinaId];
  if (doutrina === undefined) return recusar("Doutrina desconhecida.");
  if (nacao.doutrinas.has(doutrinaId)) return recusar(`${doutrina.nome} ja esta em vigor.`);
  if (nacao.doutrinas.size >= LIMITE_DE_DOUTRINAS) {
    return recusar(`O governo so sustenta ${LIMITE_DE_DOUTRINAS} doutrinas ao mesmo tempo.`);
  }
  if (!podePagar(nacao.estoques, { dinheiro: doutrina.custo })) {
    return recusar(`Adotar ${doutrina.nome} custa ${doutrina.custo} de dinheiro.`);
  }
  pagar(nacao.estoques, { dinheiro: doutrina.custo });
  nacao.doutrinas.add(doutrinaId);
  const evento = `${nacao.nome} adotou a doutrina ${doutrina.nome}.`;
  registrarEvento(estado, evento, true);
  return { ok: true, evento };
}

function comandoRevogarDoutrina(estado, nacaoId, { doutrinaId }) {
  const nacao = estado.nacoes.get(nacaoId);
  const doutrina = DOUTRINAS[doutrinaId];
  if (doutrina === undefined) return recusar("Doutrina desconhecida.");
  if (!nacao.doutrinas.has(doutrinaId)) return recusar(`${doutrina.nome} nao esta em vigor.`);
  nacao.doutrinas.delete(doutrinaId);
  // Voltar atras tem custo politico
  nacao.moral = Math.max(0, Math.round((nacao.moral - 4) * 100) / 100);
  const evento = `${nacao.nome} revogou ${doutrina.nome}.`;
  registrarEvento(estado, evento);
  return { ok: true, evento };
}

function comandoProporPacto(estado, nacaoId, { nacaoId: alvoId, tipoDePacto = "naoAgressao" }) {
  const nacao = estado.nacoes.get(nacaoId);
  const alvo = exigirNacaoValida(estado, nacaoId, alvoId);
  if (alvo.ok === false) return alvo;
  if (estaoEmGuerra(estado, nacaoId, alvoId)) {
    return recusar(`Voce esta em guerra com ${alvo.nome}. Proponha a paz primeiro.`);
  }
  const tipo = tipoDePacto;
  if (tipo !== "naoAgressao" && tipo !== "alianca") return recusar("Tipo de pacto desconhecido.");
  const existente = pactoEntre(estado, nacaoId, alvoId);
  if (existente !== null) {
    return recusar(`Ja existe ${existente.tipo === "alianca" ? "uma alianca" : "um pacto"} com ${alvo.nome}.`);
  }
  const custo = tipo === "alianca" ? 60 : 30;
  if (!podePagar(nacao.estoques, { dinheiro: custo })) {
    return recusar(`A proposta custa ${custo} de dinheiro.`);
  }
  const decisao = aceitaPropostaDaIA(estado, alvo, nacaoId, tipo);
  pagar(nacao.estoques, { dinheiro: custo });
  if (!decisao.aceita) {
    ajustarRelacoes(estado, nacaoId, alvoId, -2);
    const motivo = {
      medo: "nao quer se comprometer com quem esta dominando o mapa",
      relacoes: "nao confia o bastante em voce",
      desequilibrio: "nao quer virar seu protegido",
    }[decisao.motivo] ?? "recusou";
    const evento = `${alvo.nome} ${motivo}.`;
    registrarEvento(estado, evento);
    return { ok: true, evento };
  }
  firmarPacto(estado, nacaoId, alvoId, tipo, tipo === "alianca" ? 180 : 90);
  ajustarRelacoes(estado, nacaoId, alvoId, 12);
  const evento = tipo === "alianca"
    ? `${nacao.nome} e ${alvo.nome} firmaram uma ALIANCA.`
    : `${nacao.nome} e ${alvo.nome} assinaram um pacto de nao-agressao.`;
  registrarEvento(estado, evento, true);
  return { ok: true, evento };
}

function comandoEnviarAjuda(estado, nacaoId, { nacaoId: alvoId, recurso, quantidade }) {
  const nacao = estado.nacoes.get(nacaoId);
  const alvo = exigirNacaoValida(estado, nacaoId, alvoId);
  if (alvo.ok === false) return alvo;
  if (!RECURSOS.includes(recurso)) return recusar("Recurso desconhecido.");
  const quantia = Math.floor(Number(quantidade));
  if (!Number.isFinite(quantia) || quantia <= 0) return recusar("Quantidade invalida.");
  if (nacao.estoques[recurso] < quantia) {
    return recusar(`Voce nao tem ${quantia} de ${NOME_DO_RECURSO[recurso]}.`);
  }
  if (estaoEmGuerra(estado, nacaoId, alvoId)) {
    return recusar(`Voce esta em guerra com ${alvo.nome}.`);
  }
  nacao.estoques[recurso] -= quantia;
  alvo.estoques[recurso] += quantia;
  // Ajuda generosa compra boa vontade — mas com teto, senao vira compra de aliado
  const ganho = Math.min(15, 2 + quantia / 50);
  ajustarRelacoes(estado, nacaoId, alvoId, ganho);
  const evento = `${nacao.nome} enviou ${quantia} de ${NOME_DO_RECURSO[recurso]} a ${alvo.nome}.`;
  registrarEvento(estado, evento);
  return { ok: true, evento };
}

function comandoRomperPacto(estado, nacaoId, { nacaoId: alvoId }) {
  const nacao = estado.nacoes.get(nacaoId);
  const alvo = estado.nacoes.get(alvoId);
  if (alvo === undefined) return recusar("Nacao alvo invalida.");
  if (pactoEntre(estado, nacaoId, alvoId) === null) {
    return recusar(`Nao ha pacto com ${alvo.nome} para romper.`);
  }
  desfazerPacto(estado, nacaoId, alvoId);
  ajustarRelacoes(estado, nacaoId, alvoId, -35);
  // Quebrar a palavra custa caro diante de todo mundo, e o povo sente
  for (const outra of estado.nacoes.values()) {
    if (outra.id === nacaoId || outra.id === alvoId) continue;
    ajustarRelacoes(estado, nacaoId, outra.id, -8);
  }
  nacao.moral = Math.max(0, Math.round((nacao.moral - 6) * 100) / 100);
  const evento = `${nacao.nome} rompeu o pacto com ${alvo.nome}. Ninguem vai esquecer.`;
  registrarEvento(estado, evento, true);
  return { ok: true, evento };
}

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

  const bonusDeVelocidade = bonusNacional(estado, nacaoId).velocidade;
  const alcance = Math.min(...Object.keys(selecionadas)
    .map((tipo) => TIPOS_DE_UNIDADE[tipo].velocidade + bonusDeVelocidade));
  const caminho = encontrarCaminho(estado, nacaoId, origem.id, destino.id, Math.max(1, alcance));
  if (caminho === null) {
    return recusar("Destino fora de alcance: o caminho passa por territorio inimigo ou e longo demais.");
  }

  const destinoFinal = estado.provincias.get(caminho[caminho.length - 1]);
  const nacao = estado.nacoes.get(nacaoId);
  const emGuerra = estaoEmGuerra(estado, nacaoId, destinoFinal.dono);

  // Nao se entra em territorio de terceiros sem motivo: alianca permite
  // ATRAVESSAR, nunca ocupar. Para tomar, e preciso guerra declarada.
  if (destinoFinal.dono !== null && destinoFinal.dono !== nacaoId) {
    const dono = estado.nacoes.get(destinoFinal.dono);
    if (ehAliado(estado, nacaoId, destinoFinal.dono)) {
      return recusar(`${destinoFinal.nome} e territorio aliado de ${dono?.nome ?? "?"}: pode atravessar, mas nao ocupar.`);
    }
    if (!emGuerra) {
      return recusar(`Para entrar em ${destinoFinal.nome} e preciso declarar guerra a ${dono?.nome ?? "essa nacao"}.`);
    }
  }

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

  if (destinoFinal.dono === nacaoId || destinoFinal.dono === null) {
    for (const [tipo, n] of Object.entries(selecionadas)) {
      destinoFinal.unidades[tipo] = (destinoFinal.unidades[tipo] ?? 0) + n;
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
      // territorio inimigo. O passo terrestre continua por terra propria OU
      // de um aliado: alianca vale acesso militar, mas ninguem termina a
      // marcha dentro de casa alheia (isso e o `ehDestino`).
      const ehDestino = passo.id === destinoId;
      if (!ehDestino && !passo.mar) {
        const atravessavel = vizinho.dono === nacaoId || ehAliado(estado, nacaoId, vizinho.dono);
        if (!atravessavel) continue;
      }
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

  const pacto = pactoEntre(estado, nacaoId, alvoId);
  if (pacto !== null) {
    return recusar(`Voce tem ${pacto.tipo === "alianca" ? "uma alianca" : "um pacto"} com ${alvo.nome}. Rompa antes de declarar guerra.`);
  }

  const nacao = estado.nacoes.get(nacaoId);
  if (nacao.estoques.dinheiro < CUSTO_DE_GUERRA) {
    return recusar(`Declarar guerra custa ${CUSTO_DE_GUERRA} de dinheiro.`);
  }
  nacao.estoques.dinheiro -= CUSTO_DE_GUERRA;
  nacao.emGuerraCom.add(alvoId);
  alvo.emGuerraCom.add(nacaoId);
  alvo.tratadoDePaz.delete(nacaoId);
  nacao.tratadoDePaz.delete(alvoId);
  ajustarRelacoes(estado, nacaoId, alvoId, -40);
  nacao.moral = Math.max(0, Math.round((nacao.moral - 3) * 100) / 100);
  const evento = `${nacao.nome} declarou guerra a ${alvo.nome}!`;
  registrarEvento(estado, evento, true);

  // Chamado as armas: quem tem alianca com o agredido entra na guerra junto.
  // E o que transforma uma escaramunca local numa guerra continental.
  for (const [idAliado, registro] of [...alvo.pactos.entries()]) {
    if (registro.tipo !== "alianca") continue;
    if (estado.dia >= registro.expira) continue;
    const aliado = estado.nacoes.get(idAliado);
    if (aliado === undefined || aliado.eliminada) continue;
    if (aliado.id === nacaoId || estaoEmGuerra(estado, idAliado, nacaoId)) continue;
    aliado.emGuerraCom.add(nacaoId);
    nacao.emGuerraCom.add(aliado.id);
    ajustarRelacoes(estado, idAliado, nacaoId, -45);
    registrarEvento(estado, `${aliado.nome} honrou a alianca e entrou na guerra contra ${nacao.nome}.`, true);
  }
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
  const bonusAtacante = bonusNacional(estado, batalha.atacante);
  const bonusDefensor = bonusNacional(estado, batalha.defensor);
  // Quem desembarca luta em desvantagem: a praia e do defensor. Engenharia
  // naval corta essa desvantagem.
  if (batalha.porMar) {
    const sobraDaPenalidade = (BONUS_DE_DESEMBARQUE - 1) * (1 + bonusAtacante.desembarque);
    bonusTerreno *= 1 + Math.max(-0.9, sobraDaPenalidade);
  }
  // Artilharia costeira vale em provincia de litoral
  if (ehCosteira(provincia)) bonusTerreno *= 1 + bonusDefensor.defesaCosteira;
  const bonusFortificacao = bonusDeFortificacao(provincia);

  const atacante = poderDasUnidades(batalha.tropasAtacantes);
  const defensorBase = poderDasUnidades(batalha.tropasDefensoras);
  const ataqueEfetivo = atacante.ataque * bonusAtacante.ataque
    * (batalha.porMar ? bonusAtacante.ataqueAnfibio : 1);
  const defesaEfetiva = defensorBase.defesa * bonusTerreno * bonusFortificacao * bonusDefensor.defesa;

  if (atacante.quantidade === 0) {
    cancelarBatalha(estado, batalha);
    return;
  }
  if (defensorBase.quantidade === 0) {
    conquistar(estado, batalha);
    return;
  }

  // Dano mutuo proporcional. `baixas` e o quanto a medicina de campanha de
  // cada lado reduz o dano que ELE recebe.
  const danoAoTerrenoDefensor = Math.max(1, ataqueEfetivo * DANO_DO_ATACANTE * bonusDefensor.baixas);
  const danoAoAtacante = Math.max(1, defesaEfetiva * DANO_DO_DEFENSOR * bonusAtacante.baixas);

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

  const vencedor = estado.nacoes.get(batalha.atacante);
  const perdedor = estado.nacoes.get(antigoDono);
  const nomeAtacante = vencedor?.nome ?? batalha.atacante;
  const nomeDefensor = perdedor?.nome ?? antigoDono;
  registrarEvento(estado, `${nomeAtacante} conquistou ${provincia.nome} de ${nomeDefensor}.`, true);

  if (vencedor !== undefined) vencedor.conquistasHoje += 1;
  if (perdedor !== undefined) {
    perdedor.perdasHoje += 1;
    if (perdedor.capital === provincia.nome) {
      // Perder a capital e um choque politico, nao apenas mais uma provincia
      perdedor.moral = Math.max(0, Math.round((perdedor.moral - 8) * 100) / 100);
      registrarEvento(estado, `A capital de ${perdedor.nome} caiu: o governo perde o controle das ruas.`, true);
    }
  }
  // Quem invade fica mal visto; quem resiste ganha simpatia
  for (const outra of estado.nacoes.values()) {
    if (outra.id === batalha.atacante || outra.id === antigoDono) continue;
    ajustarRelacoes(estado, batalha.atacante, outra.id, -0.3);
  }

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
  nacao.doutrinas.clear();
  for (const outra of estado.nacoes.values()) outra.pactos.delete(nacaoId);
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
  if (fracao >= DOMINIO_PARA_VITORIA && estado.dia >= DIA_MINIMO_PARA_VITORIA) {
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

  // 1. Producao, pesquisa e consumo
  for (const nacao of estado.nacoes.values()) {
    if (nacao.eliminada) continue;
    nacao.pesquisa.pontos = Math.round(
      (nacao.pesquisa.pontos + pontosDePesquisa(estado, nacao.id)) * 100,
    ) / 100;
    // Doutrinas com custo diario: se o dinheiro acabar, a doutrina cai sozinha
    const bonus = bonusNacional(estado, nacao.id);
    if (bonus.dinheiroPorDia > 0) {
      if (nacao.estoques.dinheiro >= bonus.dinheiroPorDia) {
        nacao.estoques.dinheiro -= bonus.dinheiroPorDia;
      } else {
        for (const idDoutrina of [...nacao.doutrinas]) {
          const doutrina = DOUTRINAS[idDoutrina];
          if ((doutrina?.dinheiroPorDia ?? 0) <= 0) continue;
          nacao.doutrinas.delete(idDoutrina);
          registrarEvento(estado, `${nacao.nome} nao conseguiu sustentar ${doutrina.nome}.`);
        }
      }
    }
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

  // 4. Moral do povo, politica externa e expiracao de tratados
  atualizarRelacoes(estado);
  for (const nacao of estado.nacoes.values()) {
    if (nacao.eliminada) continue;
    atualizarMoral(estado, nacao);
  }
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
  nacao.passouFome = true;
  // Moral no chao piora tudo: com o povo contra, deserta o dobro
  const quantas = (nacao.moral ?? MORAL_INICIAL) <= 20 ? 2 : 1;
  let desertaram = 0;
  for (const provincia of provinciasDaNacao(estado, nacao.id)) {
    const tipos = Object.keys(provincia.unidades);
    if (tipos.length === 0) continue;
    const tipo = tipos[0];
    provincia.unidades[tipo] -= 1;
    if (provincia.unidades[tipo] <= 0) delete provincia.unidades[tipo];
    desertaram += 1;
    if (desertaram >= quantas) break;
  }
  if (desertaram > 0) registrarEvento(estado, `Fome em ${nacao.nome}: unidades estao desertando.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// IA
// ─────────────────────────────────────────────────────────────────────────────

const INTERVALO_IA = 3; // a IA raciocina a cada 3 dias

/** Vantagem de forca global exigida para abrir uma nova guerra. */
const VANTAGEM_PARA_DECLARAR = 1.1;

/** Quanta superioridade local a IA exige para atacar. */
const MARGEM_DE_ATAQUE = 1.55;

/**
 * Fracao do ataque disponivel que a IA compromete quando decide atacar.
 * Baixa demais e ela manda destacamentos que sempre voltam derrotados;
 * alta demais e ela esvazia a propria fronteira.
 */
const FRACAO_DE_EMPENHO = 0.75;

/**
 * Forca de ataque minima para abrir uma ofensiva.
 *
 * Sem este piso a IA abria dezenas de batalhas de uma unica unidade contra
 * provincias mal guarnecidas: o ataque vencia, a provincia era retomada no dia
 * seguinte e o mapa passava centenas de dias exatamente igual. Abaixo deste
 * valor a operacao e ruido, nao conquista.
 */
const FORCA_MINIMA_DE_ATAQUE = 45;

/**
 * Quantas vezes a defesa efetiva do alvo a ofensiva precisa ter para valer a
 * pena.
 *
 * A conta sai do proprio combate: o atacante tira 1.8 de vida por ponto de
 * ataque e o defensor 2.6 por ponto de defesa efetiva, entao a ofensiva so
 * ganha a corrida de atrito acima de 2.6/1.8 = 1.44. Com uma margem de
 * seguranca, 1.5. Exigir muito mais do que isso — como os 2.2 da primeira
 * versao — condenava a IA a nunca atacar e o mapa congelava depois do dia 90.
 *
 * Quando a conta nao fecha, o estado-maior nao ataca: ele acumula tropa naquela
 * frente ate fechar, e so entao rompe.
 */
const RAZAO_DE_ROMPIMENTO = 1.5;

/** Quanto vale, na conta do estado-maior, um ataque que chega pelo mar. */
const PESO_DO_DESEMBARQUE = 0.6;

/** Quantos tratados de paz uma nacao da IA mantem ao mesmo tempo. */
const MAXIMO_DE_PACTOS_DA_IA = 2;

/**
 * A partir de quanto do mapa uma potencia vira ameaca para todo mundo.
 *
 * E o equilibrio de poder: quem cresce demais perde simpatia, os outros se
 * aproximam entre si e as guerras contra ela ficam mais faceis de declarar.
 */
const DOMINIO_QUE_ASSISTA = 0.24;

/**
 * O dominio em que o rancor do mundo chega ao fundo do poco.
 *
 * O medo e proporcional: a partir de DOMINIO_QUE_ASSISTA ele comeca do zero e
 * so chega a -100 aqui. Isso importa mais do que parece. Com um degrau fixo
 * (-0,5 por dia para sempre), a Uniao Sovietica — que ja nasce com 21% do mapa —
 * ficava com todas as relacoes no fundo do poco por volta do dia 40 e passava a
 * campanha inteira como saco de pancada de onze paises: terminava seis sementes
 * com tres provincias. Com o piso proporcional, quem esta apenas grande convive;
 * quem esta a caminho da vitoria encontra o mundo unido — e se recuar, o rancor
 * recua junto.
 */
const DOMINIO_DO_MEDO_PLENO = 0.36;

/**
 * Quanta vantagem de forca justifica denunciar um tratado.
 *
 * Sem isso a politica externa da IA se voltava contra ela mesma: cada nacao
 * assinava com todos os vizinhos, os tratados venciam e eram reassinados, e a
 * partir do dia 90 nao havia mais nenhuma guerra possivel. Um pais muito mais
 * forte nao precisa da promessa do vizinho — e e assim que o mapa volta a se
 * mexer.
 */
const RAZAO_PARA_TRAIR = 1.8;

/**
 * Quanto mais perto do prazo, menos a IA espera por uma vantagem confortavel.
 * Sem isso ela fica eternamente esperando o momento perfeito e o mapa congela.
 */
function urgenciaDaIA(estado) {
  const restante = Math.max(0, LIMITE_DE_DIAS - estado.dia);
  return 1 + 1.5 * (1 - restante / LIMITE_DE_DIAS);
}

function jogarTurnoDaIA(estado, nacao) {
  if (estado.dia % INTERVALO_IA !== 0) return;
  const minhas = provinciasDaNacao(estado, nacao.id);
  if (minhas.length === 0) return;

  governarComIA(estado, nacao);
  construirComIA(estado, nacao, minhas);
  recrutarComIA(estado, nacao, minhas);
  atacarComIA(estado, nacao, minhas);
  negociarComIA(estado, nacao);
}

/**
 * O estado-maior adversario tambem pesquisa e tambem sofre com o humor do
 * povo. Sem isso a IA viraria um enxame de unidades sem economia, e o
 * jogador ganharia por decurso de prazo.
 */
function governarComIA(estado, nacao) {
  const pontos = nacao.pesquisa.pontos;
  const disponiveis = Object.values(AVANCOS)
    .filter((avanco) => !nacao.pesquisa.concluidas.has(avanco.id))
    .filter((avanco) => avanco.prerequisitos.every((p) => nacao.pesquisa.concluidas.has(p)))
    .filter((avanco) => avanco.custo <= pontos)
    .sort((a, b) => b.custo - a.custo); // o mais caro primeiro: vale mais
  if (disponiveis.length > 0) {
    const escolhido = disponiveis[0];
    nacao.pesquisa.pontos = Math.round((pontos - escolhido.custo) * 100) / 100;
    nacao.pesquisa.concluidas.add(escolhido.id);
    registrarEvento(estado, `${nacao.nome} concluiu a pesquisa ${escolhido.nome}.`);
  }

  const emGuerra = [...nacao.emGuerraCom]
    .filter((id) => estado.nacoes.get(id)?.eliminada !== true).length;
  // Com o povo contra, propaganda antes de qualquer outra coisa
  if (nacao.moral < 45 && !nacao.doutrinas.has("propaganda")
      && nacao.doutrinas.size < LIMITE_DE_DOUTRINAS
      && podePagar(nacao.estoques, { dinheiro: DOUTRINAS.propaganda.custo })) {
    pagar(nacao.estoques, { dinheiro: DOUTRINAS.propaganda.custo });
    nacao.doutrinas.add("propaganda");
    registrarEvento(estado, `${nacao.nome} adotou a doutrina Propaganda de Guerra.`);
  } else if (nacao.moral >= 50 && emGuerra > 0 && nacao.doutrinas.size < LIMITE_DE_DOUTRINAS) {
    // Em guerra e com o povo calmo, vale apertar o cinto: escolhe a doutrina
    // mais forte que ainda consegue sustentar
    const opcoes = Object.values(DOUTRINAS)
      .filter((d) => !nacao.doutrinas.has(d.id) && d.id !== "propaganda")
      .filter((d) => podePagar(nacao.estoques, { dinheiro: d.custo }))
      .filter((d) => nacao.moral + d.moralPorDia * 20 > 25)
      .sort((a, b) => a.moralPorDia - b.moralPorDia);
    const escolhida = opcoes[0];
    if (escolhida !== undefined) {
      pagar(nacao.estoques, { dinheiro: escolhida.custo });
      nacao.doutrinas.add(escolhida.id);
      registrarEvento(estado, `${nacao.nome} adotou a doutrina ${escolhida.nome}.`);
    }
  }
  // Povo no limite: revoga o que mais pesa
  if (nacao.moral < 22 && nacao.doutrinas.size > 0) {
    const pior = [...nacao.doutrinas]
      .filter((id) => (DOUTRINAS[id]?.moralPorDia ?? 0) < 0)
      .sort((a, b) => DOUTRINAS[a].moralPorDia - DOUTRINAS[b].moralPorDia)[0];
    if (pior !== undefined) {
      nacao.doutrinas.delete(pior);
      registrarEvento(estado, `${nacao.nome} revogou ${DOUTRINAS[pior].nome} para acalmar o povo.`);
    }
  }
}

/** A IA procura pactos com quem ja simpatiza e ainda nao esta na sua mira. */
function negociarComIA(estado, nacao) {
  // Um estado-maior nao promete paz ao mundo inteiro: se toda fronteira fica
  // coberta por tratado, ninguem mais declara guerra e o mapa congela. O teto
  // obriga a escolher quem vale a pena proteger.
  if (nacao.pactos.size >= MAXIMO_DE_PACTOS_DA_IA) return;
  const minhaForca = forcaTotal(estado, nacao.id);

  // Sempre sobra pelo menos uma fronteira descoberta. Cobrir todas com tratado
  // e o mesmo que sair do jogo: nenhuma guerra e mais possivel, nem para mim
  // nem para os vizinhos.
  const vizinhosLivres = new Set();
  for (const provincia of provinciasDaNacao(estado, nacao.id)) {
    for (const id of [...provincia.vizinhos, ...(provincia.vizinhosMaritimos ?? [])]) {
      const vizinho = estado.provincias.get(id);
      if (vizinho === undefined || vizinho.dono === null || vizinho.dono === nacao.id) continue;
      if (estaoEmGuerra(estado, nacao.id, vizinho.dono)) continue;
      if (pactoEntre(estado, nacao.id, vizinho.dono) !== null) continue;
      vizinhosLivres.add(vizinho.dono);
    }
  }
  if (vizinhosLivres.size <= 1) return;

  const candidatos = [...nacao.relacoes.entries()]
    .filter(([id]) => {
      const outra = estado.nacoes.get(id);
      if (outra === undefined || outra.eliminada) return false;
      if (estaoEmGuerra(estado, nacao.id, id)) return false;
      if (pactoEntre(estado, nacao.id, id) !== null) return false;
      // Com um vizinho fraco nao se assina nada: ele e o alvo natural, e a
      // promessa so serviria para tirar do jogo a unica guerra possivel.
      return forcaTotal(estado, id) >= minhaForca * 0.35;
    })
    .sort((a, b) => b[1] - a[1]);
  const melhor = candidatos[0];
  if (melhor === undefined || melhor[1] < 20) return;
  const alvo = estado.nacoes.get(melhor[0]);
  if (!podePagar(nacao.estoques, { dinheiro: 30 })) return;
  if (!aceitaPropostaDaIA(estado, alvo, nacao.id, "naoAgressao").aceita) return;
  nacao.estoques.dinheiro -= 30;
  firmarPacto(estado, nacao.id, alvo.id, "naoAgressao", 90);
  ajustarRelacoes(estado, nacao.id, alvo.id, 12);
  registrarEvento(estado, `${nacao.nome} e ${alvo.nome} assinaram um pacto de nao-agressao.`);
}

function construirComIA(estado, nacao, minhas) {
  // Ciencia primeiro: quem nao pesquisa fica para tras no meio da guerra
  let laboratorios = 0;
  for (const provincia of estado.provincias.values()) {
    if (provincia.dono === nacao.id) laboratorios += provincia.construcoes.laboratorio ?? 0;
  }
  const laboratoriosDesejados = Math.min(5, Math.max(1, Math.floor(minhas.length / 5)));
  if (laboratorios < laboratoriosDesejados) {
    const candidata = [...minhas]
      .filter((p) => (p.construcoes.laboratorio ?? 0) < TIPOS_DE_CONSTRUCAO.laboratorio.nivelMaximo)
      .filter((p) => (p.construcoes.laboratorio ?? 0) > 0 || Object.keys(p.construcoes).length < p.slots)
      .sort((a, b) => (b.construcoes.laboratorio ?? 0) - (a.construcoes.laboratorio ?? 0))[0];
    if (candidata !== undefined) {
      const numero = candidata.construcoes.laboratorio ?? 0;
      const custo = custoDeConstrucao("laboratorio", numero);
      if (nacao.estoques.dinheiro > 200 && podePagar(nacao.estoques, custo)) {
        pagar(nacao.estoques, custo);
        candidata.construcoes.laboratorio = numero + 1;
        return;
      }
    }
  }

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
    // Em guerra o dinheiro vai para tropa, nao para concreto: a obra espera
    // ter uma reserva confortavel. Sem isto a IA gastava tudo subindo fazenda
    // de nivel 5 e entrava na batalha com um punhado de unidades.
    const reservaEmGuerra = nacao.emGuerraCom.size > 0 ? 260 : 90;
    if ((custo.dinheiro ?? 0) + reservaEmGuerra > nacao.estoques.dinheiro) continue;
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

  // Reserva de recursos: a IA nao gasta o ultimo dinheiro em tropa, mas em
  // guerra ela recruta com o que tem — parque industrial ocioso perde campanha
  const reserva = { dinheiro: 20, aco: 10, petroleo: 5, carvao: 5, comida: 20 };
  const cabeComReserva = (custo) => {
    for (const [recurso, valor] of Object.entries(custo)) {
      if ((nacao.estoques[recurso] ?? 0) - valor < reserva[recurso]) return false;
    }
    return true;
  };

  // Escolhe o tipo mais forte que a economia sustenta
  const desejavel = nacao.estoques.petroleo > 90 && nacao.estoques.aco > 120
    ? "blindado"
    : nacao.estoques.aco > 70 ? "artilharia" : "infantaria";
  const tipo = TIPOS_DE_UNIDADE[desejavel];

  // Enche a fila de TODAS as provincias com quartel, nao so da primeira.
  // Recrutar de um quartel unico deixava o exercito em punhados de unidades:
  // o mapa trocava de dono sem resistencia porque quase ninguem defendia.
  for (const provincia of comQuartel) {
    const nivel = provincia.construcoes.quartel;
    const capacidade = 4 + nivel * 4;
    const jaEmTreino = Object.values(provincia.progressoDeRecrutamento)
      .reduce((soma, item) => soma + item.quantidade, 0);
    if (jaEmTreino >= capacidade) continue;

    // Treina o que couber de duas em duas unidades, sem estourar a reserva
    let emTreino = jaEmTreino;
    for (let tentativa = 0; tentativa < 3 && emTreino + 2 <= capacidade; tentativa += 1) {
      const custo = {};
      for (const [recurso, valor] of Object.entries(tipo.custo)) custo[recurso] = valor * 2;
      if (!cabeComReserva(custo)) break;
      pagar(nacao.estoques, custo);
      const existente = provincia.progressoDeRecrutamento[desejavel];
      if (existente === undefined) {
        const dias = Math.max(1, tipo.diasDeRecrutamento - (nivel - 1));
        provincia.progressoDeRecrutamento[desejavel] = { diasRestantes: dias, quantidade: 2, diasTotais: dias };
      } else {
        existente.quantidade += 2;
      }
      emTreino += 2;
    }
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
  // Abre novas frentes enquanto houver apetite — mas nao contra o mundo inteiro
  if (nacao.emGuerraCom.size < 3) declararGuerraComIA(estado, nacao, minhas);
  if (nacao.emGuerraCom.size === 0) return;

  // O esforco principal do turno. Se o alvo de antes ja e nosso (ou deixou de
  // fazer fronteira), o estado-maior escolhe outro.
  let esforco = nacao.esforco ?? null;
  const esforcoAindaVale = esforco !== null
    && estado.provincias.get(esforco) !== undefined
    && estaoEmGuerra(estado, nacao.id, estado.provincias.get(esforco).dono)
    && minhas.some((p) => p.vizinhos.includes(esforco) || (p.vizinhosMaritimos ?? []).includes(esforco));
  if (!esforcoAindaVale) esforco = escolherEsforco(estado, nacao, minhas);
  nacao.esforco = esforco;

  // Reforco vai para a frente do esforco; as outras seguram a linha. As
  // provincias que ficam longe da fronteira mandam colunas marchando.
  reforcarFrente(estado, nacao, minhas, esforco);
  conduzirReforcos(estado, nacao, minhas, esforco);

  // Quantas ofensivas a nacao mantem ao mesmo tempo. O teto e baixo de
  // proposito: uma potencia de quarenta e cinco provincias abrindo quatro
  // frentes por turno varria o mapa em setenta dias e a campanha acabava antes
  // de alguem conseguir jogar. Uma guerra de conquista anda em uma frente por
  // vez, no maximo duas.
  const limiteDeAtaques = Math.min(3, 1 + Math.floor(minhas.length / 40));

  // 1. O esforco principal. Batalha ja aberta sempre recebe reforco; abrir uma
  //    nova so quando a forca reunida justifica.
  const aberta = esforco !== null && estado.batalhas.some(
    (b) => b.provinciaId === esforco && b.atacante === nacao.id,
  );
  const balanco = esforco === null ? null : balancoDoEsforco(estado, nacao, minhas, esforco);
  const razaoNecessaria = RAZAO_DE_ROMPIMENTO / urgenciaDaIA(estado);
  let ataquesFeitos = 0;
  if (esforco !== null && balanco !== null && (aberta || balanco.razao >= razaoNecessaria)) {
    // Ofensiva de verdade: quando a conta fecha, TODAS as provincias que
    // encostam no alvo atacam no mesmo turno. Uma linha entrincheirada nao cai
    // com o empurrao de uma provincia so — cai quando o peso vem de varios
    // lados ao mesmo tempo.
    const origensDoEsforco = minhas.filter((p) =>
      p.vizinhos.includes(esforco) || (p.vizinhosMaritimos ?? []).includes(esforco)).length;
    for (let i = 0; i < origensDoEsforco; i += 1) {
      if (!atacarUmaFrente(estado, nacao, minhas, esforco)) break;
      ataquesFeitos += 1;
    }
  }

  // 2. Oportunidades nas outras frentes, com o resto do esforco do turno
  while (ataquesFeitos < limiteDeAtaques) {
    if (!atacarUmaFrente(estado, nacao, minhas, null)) break;
    ataquesFeitos += 1;
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

  // Entre os vizinhos, escolhe o mais fraco que ainda valha a pena — com uma
  // exceção: contra quem já domina o mapa, a coragem custa menos.
  const total = estado.provincias.size;
  const candidatos = [...vizinhos]
    .map((id) => estado.nacoes.get(id))
    .filter((outra) => outra !== undefined && !outra.eliminada)
    // Ninguem ataca quem assinou com ele: a palavra dada vale para os dois lados
    .filter((outra) => pactoEntre(estado, nacao.id, outra.id) === null)
    .filter((outra) => {
      const dominante = provinciasDaNacao(estado, outra.id).length / total >= DOMINIO_QUE_ASSISTA;
      const exigenciada = dominante ? vantagemNecessaria / 2 : vantagemNecessaria;
      return minhaForca > forcaTotal(estado, outra.id) * exigenciada;
    })
    // Contra o gigante vale mais a pena que contra o vizinho pequeno
    .sort((a, b) => {
      const fatiaA = provinciasDaNacao(estado, a.id).length / total >= DOMINIO_QUE_ASSISTA ? 1 : 0;
      const fatiaB = provinciasDaNacao(estado, b.id).length / total >= DOMINIO_QUE_ASSISTA ? 1 : 0;
      if (fatiaA !== fatiaB) return fatiaB - fatiaA;
      return forcaTotal(estado, a.id) - forcaTotal(estado, b.id);
    });
  if (candidatos.length > 0) {
    const alvo = candidatos[0];
    nacao.estoques.dinheiro -= CUSTO_DE_GUERRA;
    nacao.emGuerraCom.add(alvo.id);
    alvo.emGuerraCom.add(nacao.id);
    registrarEvento(estado, `${nacao.nome} declarou guerra a ${alvo.nome}!`, true);
    return;
  }

  // Nenhum vizinho livre e ao mesmo tempo ao alcance? Resta o tratado. Quem e
  // muito mais forte denuncia o proprio pacto e invade: e o que uma potencia
  // sem alvo faz quando o prazo da campanha se aproxima.
  const precoDaTraidoria = CUSTO_DE_GUERRA + 35;
  if (nacao.estoques.dinheiro < precoDaTraidoria) return;
  // Quanto mais perto do fim da campanha, menos um tratado vale: no fim do
  // prazo o estado-maior nao espera mais o momento perfeito.
  const razaoDaTraidoria = RAZAO_PARA_TRAIR / urgenciaDaIA(estado);
  const traiveis = [...nacao.pactos.keys()]
    .map((id) => estado.nacoes.get(id))
    .filter((outra) => outra !== undefined && !outra.eliminada && vizinhos.has(outra.id))
    .filter((outra) => minhaForca > forcaTotal(estado, outra.id) * razaoDaTraidoria)
    .sort((a, b) => forcaTotal(estado, a.id) - forcaTotal(estado, b.id));
  if (traiveis.length === 0) return;

  const traido = traiveis[0];
  nacao.estoques.dinheiro -= precoDaTraidoria;
  desfazerPacto(estado, nacao.id, traido.id);
  ajustarRelacoes(estado, nacao.id, traido.id, -35);
  for (const outra of estado.nacoes.values()) {
    if (outra.id === nacao.id || outra.id === traido.id) continue;
    ajustarRelacoes(estado, nacao.id, outra.id, -8);
  }
  nacao.moral = Math.max(0, Math.round((nacao.moral - 6) * 100) / 100);
  nacao.emGuerraCom.add(traido.id);
  traido.emGuerraCom.add(nacao.id);
  registrarEvento(estado,
    `${nacao.nome} rompeu o pacto com ${traido.nome} e invadiu o pais. Ninguem vai esquecer.`, true);
}

const sitiada = (estado, provinciaId) => estado.batalhas.some((b) => b.provinciaId === provinciaId);

/**
 * Ponto de esforco principal — o plano de guerra do turno.
 *
 * Sem isso o estado-maior espalhava as tropas por todas as frentes ao mesmo
 * tempo e a linha inimiga nunca rompia: cada lado empilha guarnicoes na
 * fronteira, o defensor leva vantagem de terreno e fortificacao e o mapa
 * congela. Escolher UM alvo e voltar nele todo turno e o que quebra a linha.
 *
 * O alvo vale pelo numero de provincias minhas que encostam nele (mais frentes
 * para atacar de uma vez) e pelo que ele custa a defender.
 */
function escolherEsforco(estado, nacao, minhas) {
  const candidatos = new Map();
  for (const origem of minhas) {
    for (const id of [...origem.vizinhos, ...(origem.vizinhosMaritimos ?? [])]) {
      const alvo = estado.provincias.get(id);
      if (alvo === undefined || !estaoEmGuerra(estado, nacao.id, alvo.dono)) continue;
      const atual = candidatos.get(id) ?? { id, frentes: 0, alvo };
      atual.frentes += 1;
      candidatos.set(id, atual);
    }
  }
  if (candidatos.size === 0) return null;

  let melhor = null;
  let melhorValor = -Infinity;
  for (const candidato of candidatos.values()) {
    const alvo = candidato.alvo;
    const defesa = poderDasUnidades(alvo.unidades).defesa
      * bonusDeFortificacao(alvo)
      * (alvo.terreno === "montanha" ? 1.35 : alvo.terreno === "cidade" ? 1.25 : alvo.terreno === "floresta" ? 1.15 : 1);
    // Muitas frentes contra uma defesa baixa: e aqui que a linha cede
    const valor = candidato.frentes * 45 - defesa;
    if (valor > melhorValor) {
      melhorValor = valor;
      melhor = candidato.id;
    }
  }
  return melhor;
}

/**
 * Quanto esta frente merece receber tropas.
 *
 * A frente que encosta no esforco principal recebe tudo o que sobra; as outras
 * recebem o minimo para segurar a linha. Concentrar e o que rompe; distribuir
 * igualmente e o que congela.
 */
function importanciaDaFrente(estado, nacao, frente, esforco) {
  let vizinhosDoEsforco = 0;
  for (const id of [...frente.vizinhos, ...(frente.vizinhosMaritimos ?? [])]) {
    if (id === esforco) vizinhosDoEsforco += 1;
  }
  let melhorOportunidade = 0;
  for (const id of [...frente.vizinhos, ...(frente.vizinhosMaritimos ?? [])]) {
    const vizinho = estado.provincias.get(id);
    if (!estaoEmGuerra(estado, nacao.id, vizinho.dono)) continue;
    const defesa = poderDasUnidades(vizinho.unidades).defesa * bonusDeFortificacao(vizinho);
    melhorOportunidade = Math.max(melhorOportunidade, 60 / (1 + defesa));
  }
  const base = melhorOportunidade * 30 - poderDasUnidades(frente.unidades).quantidade * 2.5;
  return (vizinhosDoEsforco > 0 ? 100000 : 0) + base;
}

/** Provincias minhas que fazem fronteira com alguem em guerra comigo. */
function frentesAtivas(estado, nacao, minhas) {
  return minhas.filter((provincia) =>
    [...provincia.vizinhos, ...(provincia.vizinhosMaritimos ?? [])]
      .some((id) => estaoEmGuerra(estado, nacao.id, estado.provincias.get(id).dono)));
}

/**
 * Marcha de aproximacao: o interior caminha em direcao a frente, um passo por
 * turno, seguindo um gradiente de distancia.
 *
 * O reforco antigo so saia do lugar se a frente estivesse a tres passos ou
 * menos. Num pais grande isso encalhava o exercito no interior enquanto a
 * fronteira era segurada por punhados de unidades — e a partida congelava,
 * porque o atacante nunca juntava forca para romper. A frente do esforco
 * principal entra no gradiente com distancia menor, entao as colunas convergem
 * para ela em vez de se espalharem.
 */
function conduzirReforcos(estado, nacao, minhas, esforco) {
  const frentes = frentesAtivas(estado, nacao, minhas).filter((f) => !sitiada(estado, f.id));
  if (frentes.length === 0) return;

  const distancia = new Map();
  const fila = [];
  const encostaNoEsforco = (frente) => esforco !== null
    && [...frente.vizinhos, ...(frente.vizinhosMaritimos ?? [])].includes(esforco);
  for (const frente of [...frentes].sort((a, b) => Number(encostaNoEsforco(b)) - Number(encostaNoEsforco(a)))) {
    if (distancia.has(frente.id)) continue;
    distancia.set(frente.id, encostaNoEsforco(frente) ? 0 : 1);
    fila.push(frente.id);
  }

  while (fila.length > 0) {
    const atualId = fila.shift();
    const atual = estado.provincias.get(atualId);
    for (const vizinhoId of atual.vizinhos) {
      if (distancia.has(vizinhoId)) continue;
      const vizinho = estado.provincias.get(vizinhoId);
      if (vizinho === undefined) continue;
      if (vizinho.dono !== nacao.id && !ehAliado(estado, nacao.id, vizinho.dono)) continue;
      distancia.set(vizinhoId, distancia.get(atualId) + 1);
      fila.push(vizinhoId);
    }
  }

  for (const provincia of minhas) {
    const aqui = distancia.get(provincia.id);
    if (aqui === undefined || aqui <= 1) continue; // ja e frente (ou encosta nela)
    if (poderDasUnidades(provincia.unidades).quantidade === 0) continue;
    let melhor = null;
    for (const vizinhoId of provincia.vizinhos) {
      const vizinho = estado.provincias.get(vizinhoId);
      if (vizinho === undefined || vizinho.dono !== nacao.id) continue;
      if (sitiada(estado, vizinhoId)) continue;
      const d = distancia.get(vizinhoId);
      if (d !== undefined && d < aqui && (melhor === null || d < distancia.get(melhor.id))) melhor = vizinho;
    }
    if (melhor === null) continue;
    for (const [tipo, n] of Object.entries(provincia.unidades)) {
      melhor.unidades[tipo] = (melhor.unidades[tipo] ?? 0) + n;
    }
    provincia.unidades = {};
  }
}

/** Move tropas do interior para as provincias de fronteira. */
function reforcarFrente(estado, nacao, minhas, esforco = null) {
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
        carencia: importanciaDaFrente(estado, nacao, frente, esforco),
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
 * Forca reunida contra o esforco principal, e o que o alvo tem para defender.
 * So entram as provincias que encostam nele por terra: travessia maritima tem
 * penalidade de desembarque e nao serve para medir um rompimento.
 */
function balancoDoEsforco(estado, nacao, minhas, esforco) {
  const alvo = estado.provincias.get(esforco);
  if (alvo === undefined) return null;
  const bonusDefensor = bonusNacional(estado, alvo.dono);
  const terreno = alvo.terreno === "montanha" ? 1.35 : alvo.terreno === "cidade" ? 1.25 : alvo.terreno === "floresta" ? 1.15 : 1;
  const defesa = poderDasUnidades(alvo.unidades).defesa
    * terreno * bonusDeFortificacao(alvo) * bonusDefensor.defesa
    * (ehCosteira(alvo) ? 1 + bonusDefensor.defesaCosteira : 1);

  let ataque = 0;
  let origens = 0;
  for (const provincia of minhas) {
    const porTerra = provincia.vizinhos.includes(esforco);
    const porMar = !porTerra && (provincia.vizinhosMaritimos ?? []).includes(esforco);
    if (!porTerra && !porMar) continue;
    const forca = poderDasUnidades(provincia.unidades).ataque;
    if (forca <= 0) continue;
    // Quem chega pelo mar luta em desvantagem: vale menos na conta
    ataque += porTerra ? forca : forca * PESO_DO_DESEMBARQUE;
    origens += 1;
  }
  return { defesa, ataque, origens, razao: ataque / Math.max(1, defesa) };
}

/**
 * Escolhe a melhor ofensiva disponivel e envia so a forca necessaria.
 * @returns {boolean} se um ataque foi de fato iniciado
 */
function atacarUmaFrente(estado, nacao, minhas, esforco = null) {
  const margem = MARGEM_DE_ATAQUE / urgenciaDaIA(estado);

  const opcoes = [];
  for (const origem of minhas) {
    const ataqueDisponivel = poderDasUnidades(origem.unidades).ataque;
    if (ataqueDisponivel < FORCA_MINIMA_DE_ATAQUE) continue;
    for (const id of [...origem.vizinhos, ...(origem.vizinhosMaritimos ?? [])]) {
      const alvo = estado.provincias.get(id);
      if (alvo === undefined || !estaoEmGuerra(estado, nacao.id, alvo.dono)) continue;
      const defesa = poderDasUnidades(alvo.unidades).defesa * bonusDeFortificacao(alvo);
      // Um ataque que nao machuca o defensor nao vale a pena
      if (ataqueDisponivel < defesa * margem) continue;
      // O esforco principal vale muito mais que qualquer outra oportunidade:
      // e a diferenca entre romper a linha e arranhar a fronteira para sempre.
      const peso = alvo.id === esforco ? 1000 : 0;
      opcoes.push({
        origem, alvo, defesa,
        excedente: peso + ataqueDisponivel / Math.max(1, defesa),
      });
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
/**
 * A pesquisa vista de fora: pontos, quanto rende por dia e, para cada avanco,
 * se ja esta concluido, se as dependencias estao prontas e se da para pagar.
 * O cliente nao recalcula nada disso — so decide o que pintar.
 */
function descreverPesquisa(estado, nacaoId) {
  const nacao = estado.nacoes.get(nacaoId);
  const pontos = nacao.pesquisa.pontos;
  return {
    pontos: Math.round(pontos * 10) / 10,
    porDia: pontosDePesquisa(estado, nacaoId),
    concluidas: [...nacao.pesquisa.concluidas],
    avancos: Object.values(AVANCOS).map((avanco) => {
      const concluido = nacao.pesquisa.concluidas.has(avanco.id);
      const prerequisitosOk = avanco.prerequisitos
        .every((pre) => nacao.pesquisa.concluidas.has(pre));
      const faltam = Math.max(0, Math.ceil(avanco.custo - pontos));
      return {
        ...avanco,
        concluido,
        prerequisitosOk,
        prerequisitosFaltando: avanco.prerequisitos
          .filter((pre) => !nacao.pesquisa.concluidas.has(pre))
          .map((pre) => AVANCOS[pre]?.nome ?? pre),
        faltam,
        podePesquisar: !concluido && prerequisitosOk && faltam === 0,
      };
    }),
  };
}

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
    // Moral e assunto publico; relacoes so o proprio jogador ve
    moral: Math.round(nacao.moral ?? MORAL_INICIAL),
    relacoes: minhaNacao === null ? null
      : Math.round(estado.nacoes.get(minhaNacao)?.relacoes.get(nacao.id) ?? 0),
    pacto: minhaNacao === null ? null : (pactoEntre(estado, minhaNacao, nacao.id)?.tipo ?? null),
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
    // Politica interna e ciencia: tudo calculado aqui, o cliente so pinta
    moral: minhaNacao === null ? null : Math.round(estado.nacoes.get(minhaNacao).moral),
    doutrinas: minhaNacao === null ? [] : [...estado.nacoes.get(minhaNacao).doutrinas],
    pesquisa: minhaNacao === null ? null : descreverPesquisa(estado, minhaNacao),
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
      avancos: Object.values(AVANCOS),
      doutrinas: Object.values(DOUTRINAS),
      limiteDeDoutrinas: LIMITE_DE_DOUTRINAS,
      ramosDePesquisa: RAMOS_DE_PESQUISA,
      moralInicial: MORAL_INICIAL,
      // Regras que o jogador precisa conhecer para escolher a nação e planejar:
      // a eficiência industrial de cada país e o dia a partir do qual uma
      // potência dominante pode ser declarada vencedora.
      eficienciaNacional: { ...EFICIENCIA_NACIONAL },
      diaMinimoParaVitoria: DIA_MINIMO_PARA_VITORIA,
      // A partir de que fatia do mapa o mundo comeca a se unir contra o maior,
      // e em que fatia esse rancor chega ao fundo do poco.
      dominioQueAssista: DOMINIO_QUE_ASSISTA,
      dominioDoMedoPleno: DOMINIO_DO_MEDO_PLENO,
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
  const bonus = bonusNacional(estado, nacaoId).velocidade;
  for (const [tipo, quantidade] of Object.entries(provincia.unidades)) {
    if (quantidade <= 0) continue;
    const passos = Math.max(1, (TIPOS_DE_UNIDADE[tipo]?.velocidade ?? 1) + bonus);
    resultado[tipo] = alcancavelEmPassos(estado, nacaoId, provincia.id, passos).porTerra;
  }
  return resultado;
}

/** Destinos que exigem travessia maritima (desembarque ou transporte). */
function alcanceMaritimoPorUnidade(estado, nacaoId, provincia) {
  const resultado = {};
  const bonus = bonusNacional(estado, nacaoId).velocidade;
  for (const [tipo, quantidade] of Object.entries(provincia.unidades)) {
    if (quantidade <= 0) continue;
    const passos = Math.max(1, (TIPOS_DE_UNIDADE[tipo]?.velocidade ?? 1) + bonus);
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
  const desconto = Math.max(0.6, 1 - 0.06 * Math.max(0, nivelQuartel - 1))
    * bonusNacional(estado, nacaoId).custoDeRecrutamento;
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
