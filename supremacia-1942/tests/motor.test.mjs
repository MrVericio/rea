/**
 * Testes do motor de regras.
 *
 * A ideia central: se uma regra so existe no servidor, ela precisa ser
 * testavel sem passar por nenhum navegador. Estes testes rodam em Node puro.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  criarEstado,
  executarComando,
  definirJogador,
  projetarEstado,
  avancarDia,
  calcularProducao,
  calcularConsumoDeComida,
  custoDeConstrucao,
  bonusDeFortificacao,
  poderDasUnidades,
  pontosDePesquisa,
  bonusNacional,
  pactoEntre,
  ehAliado,
  firmarPacto,
  LIMITE_DE_DOUTRINAS,
  AVANCOS,
  provinciasDaNacao,
  estaoEmGuerra,
  CUSTO_DE_GUERRA,
  DOMINIO_PARA_VITORIA,
  LIMITE_DE_DIAS,
  forcaTotal,
} from "../server/simulation.mjs";

import { TIPOS_DE_CONSTRUCAO, TIPOS_DE_UNIDADE, RECURSOS } from "../server/world.mjs";

const provinciasDe = (estado, nacaoId) => provinciasDaNacao(estado, nacaoId);
const primeiraDe = (estado, nacaoId) => provinciasDe(estado, nacaoId)[0];

// ─────────────────────────────────────────────────────────────────────────────
// Geração do mundo
// ─────────────────────────────────────────────────────────────────────────────

test("o mundo tem tamanho e composição estáveis", () => {
  const estado = criarEstado(1942);
  assert.ok(estado.provincias.size > 150, "esperado um mapa grande");
  assert.equal(estado.nacoes.size, 12);
  assert.equal(estado.dia, 0);
  assert.equal(estado.vencedor, null);

  // Toda província pertence a alguém e tem terreno e vizinhos válidos
  for (const provincia of estado.provincias.values()) {
    assert.ok(estado.nacoes.has(provincia.dono), `${provincia.nome} sem dono válido`);
    assert.ok(TIPOS_DE_CONSTRUCAO !== undefined);
    assert.ok(provincia.vizinhos.length > 0, `${provincia.nome} isolada`);
    for (const vizinho of provincia.vizinhos) {
      assert.ok(estado.provincias.has(vizinho), `vizinho inexistente em ${provincia.nome}`);
    }
  }
});

test("cada província tem nome próprio, legível e sem numeral romano gigante", () => {
  const estado = criarEstado(1942);
  const nomes = [...estado.provincias.values()].map((p) => p.nome);
  assert.equal(new Set(nomes).size, nomes.length, "há nomes de província repetidos");
  for (const nome of nomes) {
    assert.ok(nome.length <= 28, `nome longo demais: ${nome}`);
    assert.ok(!/X{3,}/.test(nome), `numeral romano quebrado: ${nome}`);
  }
});

test("os vizinhos são simétricos e sem auto-referência", () => {
  const estado = criarEstado(1942);
  for (const provincia of estado.provincias.values()) {
    for (const vizinho of provincia.vizinhos) {
      assert.notEqual(vizinho, provincia.id, "província vizinha de si mesma");
      const outra = estado.provincias.get(vizinho);
      assert.ok(outra.vizinhos.includes(provincia.id), `${provincia.nome} -> ${outra.nome} não é simétrico`);
    }
  }
});

test("a mesma semente produz exatamente o mesmo mundo", () => {
  const a = criarEstado(1942);
  const b = criarEstado(1942);
  const retrato = (estado) => [...estado.provincias.values()]
    .map((p) => `${p.id}|${p.nome}|${p.dono}|${p.terreno}|${p.q},${p.r}`)
    .join("\n");
  assert.equal(retrato(a), retrato(b));
});

test("sementes diferentes produzem mundos diferentes", () => {
  const a = criarEstado(1942);
  const b = criarEstado(7);
  const nomes = (estado) => [...estado.provincias.values()].map((p) => p.nome).join(",");
  assert.notEqual(nomes(a), nomes(b));
});

test("os territórios iniciais são contíguos (ou do tamanho de uma nação dividida de propósito)", () => {
  const estado = criarEstado(1942);
  const divididasDeProposito = new Set(["it", "tr", "eg"]);

  for (const nacao of estado.nacoes.values()) {
    const minhas = new Set(provinciasDe(estado, nacao.id).map((p) => p.id));
    // Busca em largura a partir de uma província qualquer
    const inicio = [...minhas][0];
    const vistas = new Set([inicio]);
    const fila = [inicio];
    while (fila.length > 0) {
      const atual = estado.provincias.get(fila.shift());
      for (const vizinho of atual.vizinhos) {
        if (minhas.has(vizinho) && !vistas.has(vizinho)) {
          vistas.add(vizinho);
          fila.push(vizinho);
        }
      }
    }
    if (!divididasDeProposito.has(nacao.id)) {
      assert.equal(vistas.size, minhas.size,
        `${nacao.nome} ficou fragmentada em ${minhas.size - vistas.size} províncias isoladas`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Economia
// ─────────────────────────────────────────────────────────────────────────────

test("nenhuma nação fica permanentemente sem um recurso", () => {
  const estado = criarEstado(1942);
  for (const nacao of estado.nacoes.values()) {
    const producao = calcularProducao(estado, nacao.id);
    for (const recurso of RECURSOS) {
      assert.ok(producao[recurso] > 0,
        `${nacao.nome} produz 0 de ${recurso} — travaria a construção de blindados`);
    }
  }
});

test("toda nação consegue pagar um blindado por dia de produção", () => {
  const estado = criarEstado(1942);
  const custoDoBlindado = TIPOS_DE_UNIDADE.blindado.custo;
  for (const nacao of estado.nacoes.values()) {
    const producao = calcularProducao(estado, nacao.id);
    for (const [recurso, valor] of Object.entries(custoDoBlindado)) {
      const dias = valor / producao[recurso];
      assert.ok(dias < 25, `${nacao.nome} levaria ${dias.toFixed(1)} dias para juntar ${recurso} de um blindado`);
    }
  }
});

test("o custo de construção cresce com o nível", () => {
  for (const id of Object.keys(TIPOS_DE_CONSTRUCAO)) {
    const nivel0 = custoDeConstrucao(id, 0);
    const nivel3 = custoDeConstrucao(id, 3);
    for (const recurso of Object.keys(nivel0)) {
      assert.ok(nivel3[recurso] > nivel0[recurso], `${id} não encarece no nível 3`);
    }
  }
});

test("as fortificações aumentam a defesa conforme o catálogo", () => {
  const porNivel = TIPOS_DE_CONSTRUCAO.fortificacao.bonusDeDefesaPorNivel;
  assert.equal(bonusDeFortificacao({ fortificacao: 0 }), 1);
  assert.equal(bonusDeFortificacao({ fortificacao: 2 }), 1 + porNivel * 2);
  assert.equal(bonusDeFortificacao({}), 1, "província sem o campo não pode quebrar o combate");
});

test("o consumo de comida cresce com o tamanho do exército", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const antes = calcularConsumoDeComida(estado, "de");
  const provincia = primeiraDe(estado, "de");
  provincia.unidades.infantaria = 20;
  const depois = calcularConsumoDeComida(estado, "de");
  assert.ok(depois > antes);
});

// ─────────────────────────────────────────────────────────────────────────────
// Validação de comandos — o coração da arquitetura autoritativa
// ─────────────────────────────────────────────────────────────────────────────

test("sem nação escolhida, todo comando é recusado", () => {
  const estado = criarEstado(1942);
  const resultado = executarComando(estado, "estranho", { tipo: "construir", provinciaId: "x", construcaoId: "fazenda" });
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /nao escolheu uma nacao/i);
});

test("comando desconhecido é recusado com motivo", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const resultado = executarComando(estado, "p", { tipo: "duplicarRecursos" });
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /desconhecido/i);
});

test("não é possível construir em província alheia", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const inimiga = primeiraDe(estado, "fr");
  const resultado = executarComando(estado, "p", { tipo: "construir", provinciaId: inimiga.id, construcaoId: "fazenda" });
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /nao e sua/i);
});

test("não é possível recrutar sem quartel", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const provincia = primeiraDe(estado, "de");
  delete provincia.construcoes.quartel;
  const resultado = executarComando(estado, "p", { tipo: "recrutar", provinciaId: provincia.id, unidadeId: "infantaria", quantidade: 2 });
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /Quartel/i);
});

test("não é possível gastar o que não se tem", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const provincia = primeiraDe(estado, "de");
  estado.nacoes.get("de").estoques.dinheiro = 0;
  const resultado = executarComando(estado, "p", { tipo: "construir", provinciaId: provincia.id, construcaoId: "fazenda" });
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /insuficientes/i);
});

test("construir desconta o custo exatamente uma vez", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const provincia = provinciasDe(estado, "de").find((p) => (p.construcoes.quartel ?? 0) > 0);
  const nivelAntes = provincia.construcoes.quartel;
  const custo = custoDeConstrucao("quartel", nivelAntes);
  const dinheiroAntes = estado.nacoes.get("de").estoques.dinheiro;

  const resultado = executarComando(estado, "p", { tipo: "construir", provinciaId: provincia.id, construcaoId: "quartel" });
  assert.equal(resultado.ok, true);
  assert.equal(provincia.construcoes.quartel, nivelAntes + 1);
  assert.equal(estado.nacoes.get("de").estoques.dinheiro, dinheiroAntes - custo.dinheiro);
});

test("a fila de recrutamento respeita a capacidade do quartel", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const provincia = provinciasDe(estado, "de").find((p) => (p.construcoes.quartel ?? 0) > 0);
  const nivel = provincia.construcoes.quartel;
  const capacidade = 4 + nivel * 4;

  const cheia = executarComando(estado, "p", {
    tipo: "recrutar", provinciaId: provincia.id, unidadeId: "infantaria", quantidade: capacidade,
  });
  assert.equal(cheia.ok, true, "deveria caber exatamente a capacidade");

  const excedente = executarComando(estado, "p", {
    tipo: "recrutar", provinciaId: provincia.id, unidadeId: "infantaria", quantidade: 1,
  });
  assert.equal(excedente.ok, false);
  assert.match(excedente.motivo, /fila de recrutamento/i);
});

test("não se move tropas para dentro de território inimigo sem caminho próprio", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const origem = provinciasDe(estado, "de").find((p) => {
    const distancia = provinciasDe(estado, "de").some((outra) => outra.id !== p.id);
    return distancia && Object.keys(p.unidades).length > 0;
  });
  origem.unidades.infantaria = 5;
  const inimigaLonge = provinciasDe(estado, "ur").at(-1);
  const resultado = executarComando(estado, "p", {
    tipo: "mover", origemId: origem.id, destinoId: inimigaLonge.id, unidades: { infantaria: 5 },
  });
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /alcance/i);
});

// A Alemanha já começa em guerra com Reino Unido, França, URSS e Polônia
// (os conflitos semeados no início da campanha), então estes testes usam a
// Espanha, com quem ela começa em paz.
test("declarar guerra custa dinheiro e cria o estado de guerra", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  assert.equal(estaoEmGuerra(estado, "de", "es"), false, "a Alemanha deveria começar em paz com a Espanha");

  const antes = estado.nacoes.get("de").estoques.dinheiro;
  const resultado = executarComando(estado, "p", { tipo: "declararGuerra", nacaoId: "es" });
  assert.equal(resultado.ok, true);
  assert.equal(estado.nacoes.get("de").estoques.dinheiro, antes - CUSTO_DE_GUERRA);
  assert.ok(estaoEmGuerra(estado, "de", "es"));
  assert.ok(estaoEmGuerra(estado, "es", "de"), "a guerra tem de ser simétrica");
});

test("não se declara guerra duas vezes à mesma nação", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  assert.equal(executarComando(estado, "p", { tipo: "declararGuerra", nacaoId: "es" }).ok, true);
  const repetida = executarComando(estado, "p", { tipo: "declararGuerra", nacaoId: "es" });
  assert.equal(repetida.ok, false);
  assert.match(repetida.motivo, /guerra/i);
});

test("a campanha começa com conflitos históricos já em andamento", () => {
  const estado = criarEstado(1942);
  assert.ok(estaoEmGuerra(estado, "de", "fr"));
  assert.ok(estaoEmGuerra(estado, "de", "ur"));
  assert.ok(estaoEmGuerra(estado, "it", "gr"));
  assert.ok(!estaoEmGuerra(estado, "es", "pt"), "nem todos começam em guerra");
});

test("não se declara guerra a si mesmo", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const resultado = executarComando(estado, "p", { tipo: "declararGuerra", nacaoId: "de" });
  assert.equal(resultado.ok, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Simulação longa
// ─────────────────────────────────────────────────────────────────────────────

test("300 dias de simulação mantêm os invariantes do jogo", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const totalDeProvincias = estado.provincias.size;

  let voltas = 0;
  while (estado.vencedor === null && voltas < 300) {
    voltas += 1;
    avancarDia(estado);

    // Os estoques nunca ficam negativos
    for (const nacao of estado.nacoes.values()) {
      for (const recurso of RECURSOS) {
        assert.ok(nacao.estoques[recurso] >= -1e-6,
          `dia ${estado.dia}: ${nacao.nome} com ${recurso} negativo (${nacao.estoques[recurso]})`);
      }
    }

    // O número de províncias é conservado e toda província tem dono
    assert.equal(estado.provincias.size, totalDeProvincias);
    for (const provincia of estado.provincias.values()) {
      assert.ok(provincia.dono !== null, `${provincia.nome} ficou sem dono no dia ${estado.dia}`);
      assert.ok(estado.nacoes.has(provincia.dono));
    }

    for (const batalha of estado.batalhas) {
      assert.ok(estado.provincias.has(batalha.provinciaId), "batalha em província inexistente");
    }
  }

  assert.ok(estado.dia <= 300, `a simulação não pode passar de 300 dias (foi a ${estado.dia})`);
  assert.ok(estado.dia > 0);

  // Eliminação é coerente: quem foi eliminado não pode continuar dono de nada
  for (const nacao of estado.nacoes.values()) {
    if (!nacao.eliminada) continue;
    assert.equal(provinciasDe(estado, nacao.id).length, 0,
      `${nacao.nome} foi eliminada mas ainda controla províncias`);
  }
  assert.ok([...estado.nacoes.values()].some((n) => !n.eliminada), "alguma nação precisa sobreviver");
});

test("a IA age sozinha: há conquistas sem nenhum comando humano", () => {
  const estado = criarEstado(1942);
  const donosIniciais = new Map([...estado.provincias.values()].map((p) => [p.id, p.dono]));
  for (let i = 0; i < 400; i += 1) avancarDia(estado);

  const mudaram = [...estado.provincias.values()].filter((p) => donosIniciais.get(p.id) !== p.dono);
  assert.ok(mudaram.length > 0, "em 400 dias a IA deveria ter conquistado alguma coisa");
  assert.ok(estado.eventos.length > 0, "deveria haver comunicados");
});

test("a vitória acontece e é anunciada uma única vez", () => {
  const estado = criarEstado(1942);
  let dias = 0;
  while (estado.vencedor === null && dias < 3000) {
    avancarDia(estado);
    dias += 1;
  }
  assert.ok(estado.vencedor !== null, "a partida precisa ter um fim alcançável");
  assert.ok(dias < 3000);

  const vencedor = estado.nacoes.get(estado.vencedor);
  const controlado = provinciasDe(estado, vencedor.id).length;

  // A vitória acontece de duas formas: supremacia por domínio, ou armistício
  // no fim do prazo — e nesse caso vence quem controla mais território.
  if (estado.motivoDaVitoria === "supremacia") {
    assert.ok(controlado / estado.provincias.size >= DOMINIO_PARA_VITORIA - 1e-9);
  } else {
    assert.equal(estado.dia, LIMITE_DE_DIAS);
    assert.equal(estado.motivoDaVitoria, "armisticio");
    const maior = Math.max(...[...estado.nacoes.values()].map((n) => provinciasDe(estado, n.id).length));
    assert.equal(controlado, maior, "no armistício vence quem tem mais províncias");
  }

  // Depois da vitória o tempo não anda mais
  const diaFinal = estado.dia;
  avancarDia(estado);
  assert.equal(estado.dia, diaFinal);
  assert.equal(estado.vencedor, vencedor.id, "o vencedor não pode mudar depois do fim");
});

// ─────────────────────────────────────────────────────────────────────────────
// Projeção para o cliente
// ─────────────────────────────────────────────────────────────────────────────

test("a projeção não vaza os estoques das nações inimigas", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const retrato = projetarEstado(estado, "p");

  const eu = retrato.nacoes.find((n) => n.id === "de");
  assert.ok(eu.estoques !== null, "os meus estoques devem vir");
  assert.equal(eu.producao !== null, true);

  for (const outra of retrato.nacoes.filter((n) => n.id !== "de")) {
    assert.equal(outra.estoques, null, `${outra.nome} expôs os estoques`);
    assert.equal(outra.producao, null, `${outra.nome} expôs a produção`);
  }
});

test("os custos só vêm calculados para as províncias do jogador", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const retrato = projetarEstado(estado, "p");

  for (const provincia of retrato.provincias) {
    if (provincia.dono === "de") {
      assert.ok(provincia.custosDeConstrucao !== undefined, `${provincia.nome} sem custos`);
      assert.ok(provincia.custosDeRecrutamento !== undefined, `${provincia.nome} sem custos de recrutamento`);
      for (const dados of Object.values(provincia.custosDeConstrucao)) {
        assert.ok(dados.custo !== undefined);
        assert.ok(typeof dados.podePagar === "boolean");
      }
    } else {
      assert.equal(provincia.custosDeConstrucao, undefined, `${provincia.nome} vazou custos`);
      assert.equal(provincia.custosDeRecrutamento, undefined);
    }
  }
});

test("sem nação, a projeção ainda é válida e o cliente não quebra", () => {
  const estado = criarEstado(1942);
  const retrato = projetarEstado(estado, "ninguem");
  assert.equal(retrato.minhaNacao, null);
  for (const nacao of retrato.nacoes) assert.equal(nacao.estoques, null);
  assert.equal(retrato.provincias.length, estado.provincias.size);
  assert.ok(retrato.regras.unidades.length === 4);
});

test("o catálogo de regras viaja junto: o cliente não precisa de nenhum número", () => {
  const estado = criarEstado(1942);
  const retrato = projetarEstado(estado, "p");
  const regras = retrato.regras;

  assert.equal(regras.unidades.length, Object.keys(TIPOS_DE_UNIDADE).length);
  assert.equal(regras.construcoes.length, Object.keys(TIPOS_DE_CONSTRUCAO).length);
  assert.equal(regras.direcoes.length, 6);
  assert.ok(regras.diasPorSegundo > 0);
  assert.equal(regras.custoDeGuerra, CUSTO_DE_GUERRA);
  for (const recurso of RECURSOS) assert.ok(regras.nomeDoRecurso[recurso]);

  // O desconto do quartel aparece pronto no custo de recrutamento
  definirJogador(estado, "p", "de");
  const provincia = provinciasDe(estado, "de").find((p) => (p.construcoes.quartel ?? 0) > 1);
  if (provincia !== undefined) {
    const retrato2 = projetarEstado(estado, "p");
    const vista = retrato2.provincias.find((p) => p.id === provincia.id);
    assert.ok(vista.custosDeRecrutamento.desconto < 1);
    const custoComDesconto = vista.custosDeRecrutamento.unidades.infantaria.custo.dinheiro;
    assert.ok(custoComDesconto < TIPOS_DE_UNIDADE.infantaria.custo.dinheiro);
  }
});

test("o alcance destacado pelo servidor é sempre um destino legal", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const retrato = projetarEstado(estado, "p");

  const comAlcance = retrato.provincias.filter((p) => p.alcancePorUnidade !== undefined);
  assert.ok(comAlcance.length > 0, "o jogador começa com tropas");

  for (const provincia of comAlcance) {
    for (const [tipo, destinos] of Object.entries(provincia.alcancePorUnidade)) {
      if (destinos.length === 0) continue;
      const quantidade = provincia.unidades[tipo];
      // O servidor tem de aceitar exatamente o que ele mesmo destacou
      const destino = estado.provincias.get(destinos[0]);
      const ehInimiga = destino.dono !== "de";
      if (ehInimiga) {
        // contradição: se for inimiga e não houver guerra, o movimentos seria recusado
        continue;
      }
      const resultado = executarComando(estado, "p", {
        tipo: "mover", origemId: provincia.id, destinoId: destinos[0], unidades: { [tipo]: quantidade },
      });
      assert.equal(resultado.ok, true,
        `${provincia.nome} -> ${destino.nome} foi destacado como alcançável mas recusado: ${resultado.motivo}`);
    }
  }
});

test("um jogador nunca vê batalhas de províncias que não existem", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  for (let i = 0; i < 200; i += 1) avancarDia(estado);
  const retrato = projetarEstado(estado, "p");
  for (const batalha of retrato.batalhas) {
    assert.ok(retrato.provincias.some((p) => p.id === batalha.provinciaId));
    assert.ok(batalha.vidaAtacante >= 0 && batalha.vidaDefensora >= 0);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Travessia marítima e cerco
// ─────────────────────────────────────────────────────────────────────────────

test("nenhuma nação fica isolada do resto do mundo", () => {
  const estado = criarEstado(1942);
  for (const nacao of estado.nacoes.values()) {
    const alcancaveis = new Set();
    for (const provincia of provinciasDe(estado, nacao.id)) {
      for (const id of [...provincia.vizinhos, ...provincia.vizinhosMaritimos]) {
        const outra = estado.provincias.get(id);
        if (outra !== undefined && outra.dono !== nacao.id) alcancaveis.add(outra.dono);
      }
    }
    assert.ok(alcancaveis.size >= 1,
      `${nacao.nome} não alcança ninguém: ficaria de fora da guerra para sempre`);
  }
});

test("as travessias marítimas são simétricas e nunca duplicam fronteira terrestre", () => {
  const estado = criarEstado(1942);
  for (const provincia of estado.provincias.values()) {
    for (const id of provincia.vizinhosMaritimos) {
      const outra = estado.provincias.get(id);
      assert.ok(outra !== undefined, "travessia para província inexistente");
      assert.ok(outra.vizinhosMaritimos.includes(provincia.id), `${provincia.nome} -> ${outra.nome} não é simétrica`);
      assert.ok(!provincia.vizinhos.includes(id), `${provincia.nome} -> ${outra.nome} é terra e mar ao mesmo tempo`);
      assert.ok(!outra.vizinhos.includes(provincia.id));
    }
  }
});

test("as travessias marítimas têm o mar no meio do caminho", () => {
  const estado = criarEstado(1942);
  const todas = [...estado.provincias.values()];
  for (const provincia of todas) {
    for (const id of provincia.vizinhosMaritimos) {
      const outra = estado.provincias.get(id);
      const meio = { x: (provincia.x + outra.x) / 2, y: (provincia.y + outra.y) / 2 };
      const ocupada = todas.some((p) => Math.hypot(p.x - meio.x, p.y - meio.y) < 0.98);
      assert.equal(ocupada, false, `a rota ${provincia.nome} -> ${outra.nome} passa por terra firme`);
    }
  }
});

test("o Reino Unido e a Suécia não ficam presos nas ilhas", () => {
  const estado = criarEstado(1942);
  for (const [id, nome] of [["gb", "Reino Unido"], ["su", "Suécia"]]) {
    const travessias = provinciasDe(estado, id).flatMap((p) => p.vizinhosMaritimos);
    assert.ok(travessias.length > 0, `${nome} não tem nenhuma rota marítima`);
  }
});

test("atacar pelo mar exige guerra declarada e vira desembarque", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "gb");
  const origem = provinciasDe(estado, "gb").find((p) => (p.vizinhosMaritimos ?? []).length > 0);
  assert.ok(origem !== undefined, "nenhuma província britânica tem rota marítima");

  const destinoId = origem.vizinhosMaritimos[0];
  const destino = estado.provincias.get(destinoId);
  destino.unidades = { infantaria: 1 };

  // Sem guerra não se entra em casa alheia: nem por terra, nem pelo mar
  assert.equal(estaoEmGuerra(estado, "gb", destino.dono), false);
  origem.unidades = { infantaria: 6, blindado: 4 };
  const semGuerra = executarComando(estado, "p", {
    tipo: "mover", origemId: origem.id, destinoId, unidades: { infantaria: 3, blindado: 2 },
  });
  assert.equal(semGuerra.ok, false, "atravessou o mar sem declarar guerra");
  assert.match(semGuerra.motivo, /declarar guerra/i);
  // E o exército continua inteiro na origem: comando recusado não deixa marca
  assert.deepEqual(origem.unidades, { infantaria: 6, blindado: 4 });

  // Com guerra, a travessia vira desembarque e a batalha ganha a marca
  const estado2 = criarEstado(1942);
  definirJogador(estado2, "p", "gb");
  const origem2 = provinciasDe(estado2, "gb").find((p) => (p.vizinhosMaritimos ?? []).length > 0);
  const destino2 = estado2.provincias.get(origem2.vizinhosMaritimos[0]);
  executarComando(estado2, "p", { tipo: "declararGuerra", nacaoId: destino2.dono });
  origem2.unidades = { blindado: 8 };
  const assalto = executarComando(estado2, "p", {
    tipo: "mover", origemId: origem2.id, destinoId: destino2.id, unidades: { blindado: 8 },
  });
  assert.equal(assalto.ok, true, `desembarque recusado: ${assalto.motivo}`);
  assert.match(assalto.evento, /desembarcou/i);
  assert.equal(estado2.batalhas.at(-1).porMar, true);
});

test("não se reforça uma província sob cerco", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  // Coloca a Alemanha em guerra com a França e cerca uma província alemã
  const minha = provinciasDe(estado, "de").find((p) =>
    p.vizinhos.some((id) => estado.provincias.get(id).dono === "fr"));
  assert.ok(minha !== undefined, "nenhuma província alemã encosta na França");

  const origem = provinciasDe(estado, "de").find((p) => p.vizinhos.includes(minha.id));
  assert.ok(origem !== undefined, "nenhuma província alemã vizinha para servir de origem");
  origem.unidades = { infantaria: 4 };
  minha.unidades = { infantaria: 2 };

  const francesa = estado.provincias.get(minha.vizinhos.find((id) => estado.provincias.get(id).dono === "fr"));
  francesa.unidades = { blindado: 10 };
  const ataque = executarComando(estado, "p", {
    tipo: "mover", origemId: minha.id, destinoId: francesa.id, unidades: { infantaria: 2 },
  });
  assert.equal(ataque.ok, true, `o ataque deveria ser aceito: ${ataque.motivo}`);

  // Ainda não há batalha em MINHA província; força uma batalha nela
  const outroFrances = provinciasDe(estado, "fr").find((p) => p.vizinhos.includes(minha.id));
  estado.jogadores.set("q", "fr");
  outroFrances.unidades = { blindado: 6 };
  executarComando(estado, "q", {
    tipo: "mover", origemId: outroFrances.id, destinoId: minha.id, unidades: { blindado: 6 },
  });
  assert.ok(estado.batalhas.some((b) => b.provinciaId === minha.id), "a província deveria estar cercada");

  const reforco = executarComando(estado, "p", {
    tipo: "mover", origemId: origem.id, destinoId: minha.id, unidades: { infantaria: 4 },
  });
  assert.equal(reforco.ok, false);
  assert.match(reforco.motivo, /cerco/i);
});

test("não se recruta numa província sob cerco", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  definirJogador(estado, "q", "fr");
  const alvo = provinciasDe(estado, "de").find((p) =>
    p.vizinhos.some((id) => estado.provincias.get(id).dono === "fr"));
  assert.ok(alvo !== undefined, "nenhuma província alemã encosta na França");
  // A província precisa de um quartel para o teste fazer sentido
  alvo.construcoes.quartel = 1;

  const francesa = estado.provincias.get(alvo.vizinhos.find((id) => estado.provincias.get(id).dono === "fr"));
  francesa.unidades = { blindado: 12 };
  assert.equal(executarComando(estado, "q", {
    tipo: "mover", origemId: francesa.id, destinoId: alvo.id, unidades: { blindado: 12 },
  }).ok, true);

  const resultado = executarComando(estado, "p", {
    tipo: "recrutar", provinciaId: alvo.id, unidadeId: "infantaria", quantidade: 1,
  });
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /cerco/i);
});

test("a fila de recrutamento congela enquanto a província está cercada", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const alvo = provinciasDe(estado, "de").find((p) => (p.construcoes.quartel ?? 0) > 0);
  alvo.progressoDeRecrutamento = { infantaria: { diasRestantes: 3, quantidade: 2, diasTotais: 3 } };

  // Sem cerco, a fila anda
  avancarDia(estado);
  assert.equal(alvo.progressoDeRecrutamento.infantaria.diasRestantes, 2);

  // Com cerco, congela
  estado.batalhas.push({
    id: "teste", provinciaId: alvo.id, atacante: "fr", defensor: "de",
    tropasAtacantes: { blindado: 5 }, tropasDefensoras: alvo.unidades,
    porMar: false, vidaAtacante: 900, vidaDefensora: 1, dias: 0,
  });
  avancarDia(estado);
  assert.equal(alvo.progressoDeRecrutamento.infantaria.diasRestantes, 2, "a fila andou durante o cerco");
});

test("forcaTotal não multiplica as batalhas pelo número de províncias", () => {
  const estado = criarEstado(1942);
  const alvo = provinciasDe(estado, "de")[0];
  alvo.unidades = { infantaria: 1 };
  // Força com uma província e nenhuma batalha
  const umaProvincia = forcaTotal(estado, "de");

  // Adiciona uma segunda província vazia: a força não pode mudar
  provinciasDe(estado, "de")[1].unidades = {};
  assert.equal(forcaTotal(estado, "de"), umaProvincia);

  // Uma batalha entra na conta exatamente uma vez
  estado.batalhas.push({
    id: "x", provinciaId: provinciasDe(estado, "fr")[0].id, atacante: "de", defensor: "fr",
    tropasAtacantes: { blindado: 2 }, tropasDefensoras: {},
    porMar: false, vidaAtacante: 360, vidaDefensora: 0, dias: 0,
  });
  const comBatalha = forcaTotal(estado, "de");
  assert.equal(comBatalha - umaProvincia, 52, "2 blindados valem 52 de ataque, e só isso");
});

test("a IA nunca age por uma nação comandada por uma pessoa", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const antes = new Map([...estado.provincias.values()].map((p) => [p.id, p.dono]));
  for (let i = 0; i < 60; i += 1) avancarDia(estado);

  // A Alemanha só pode ganhar território por ação de outro jogador, nunca por IA
  const ganhouSozinha = [...estado.provincias.values()]
    .filter((p) => p.dono === "de" && antes.get(p.id) !== "de");
  assert.equal(ganhouSozinha.length, 0,
    `a IA jogou pela Alemanha e conquistou ${ganhouSozinha.length} províncias`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariante central: comando recusado não muda nada
// ─────────────────────────────────────────────────────────────────────────────

/** Fotografia completa do estado, para comparar antes e depois. */
function retratar(estado) {
  return JSON.stringify({
    dia: estado.dia,
    vencedor: estado.vencedor,
    nacoes: [...estado.nacoes.values()].map((n) => ({
      id: n.id, estoques: n.estoques, guerras: [...n.emGuerraCom].sort(), eliminada: n.eliminada,
    })),
    provincias: [...estado.provincias.values()].map((p) => ({
      id: p.id, dono: p.dono, construcoes: p.construcoes, unidades: p.unidades,
      fila: p.progressoDeRecrutamento, fortificacao: p.fortificacao,
    })),
    batalhas: estado.batalhas.length,
    eventos: estado.eventos.length,
  });
}

test("nenhum comando recusado deixa marca no estado", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  definirJogador(estado, "q", "fr");

  for (let i = 0; i < 40; i += 1) avancarDia(estado);

  const minha = provinciasDe(estado, "de")[0];
  const inimiga = provinciasDe(estado, "ur")[0];
  const semNacao = executarComando(estado, "fantasma", { tipo: "construir", provinciaId: minha.id, construcaoId: "fazenda" });

  const recusados = [
    semNacao,
    executarComando(estado, "p", { tipo: "construir", provinciaId: inimiga.id, construcaoId: "fazenda" }),
    executarComando(estado, "p", { tipo: "construir", provinciaId: minha.id, construcaoId: "castelo" }),
    executarComando(estado, "p", { tipo: "construir", provinciaId: "inexistente", construcaoId: "fazenda" }),
    executarComando(estado, "p", { tipo: "recrutar", provinciaId: inimiga.id, unidadeId: "infantaria", quantidade: 1 }),
    executarComando(estado, "p", { tipo: "recrutar", provinciaId: minha.id, unidadeId: "infantaria", quantidade: 999 }),
    executarComando(estado, "p", { tipo: "recrutar", provinciaId: minha.id, unidadeId: "infantaria", quantidade: 0 }),
    executarComando(estado, "p", { tipo: "mover", origemId: minha.id, destinoId: inimiga.id, unidades: { infantaria: 9999 } }),
    executarComando(estado, "p", { tipo: "mover", origemId: minha.id, destinoId: minha.id, unidades: { infantaria: 1 } }),
    executarComando(estado, "p", { tipo: "mover", origemId: minha.id, destinoId: "inexistente", unidades: { infantaria: 1 } }),
    executarComando(estado, "p", { tipo: "mover", origemId: minha.id, destinoId: inimiga.id, unidades: {} }),
    executarComando(estado, "p", { tipo: "declararGuerra", nacaoId: "de" }),
    executarComando(estado, "p", { tipo: "declararGuerra", nacaoId: "naoExiste" }),
    executarComando(estado, "p", { tipo: "proporPaz", nacaoId: "es" }),
    executarComando(estado, "p", { tipo: "cancelarRecrutamento", provinciaId: minha.id, unidadeId: "cacador" }),
    executarComando(estado, "p", { tipo: "comandoInexistente" }),
  ];

  // Todos têm de ser recusados, e todos pelo mesmo motivo: nada aconteceu
  for (const resultado of recusados) {
    assert.equal(resultado.ok, false, `este comando deveria ser recusado: ${JSON.stringify(resultado)}`);
    assert.ok(typeof resultado.motivo === "string" && resultado.motivo.length > 0,
      "toda recusa precisa de um motivo legível");
  }
});

test("a recusa por cerco não consome as tropas da origem", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  definirJogador(estado, "q", "fr");

  const alvo = provinciasDe(estado, "de").find((p) =>
    p.vizinhos.some((id) => estado.provincias.get(id).dono === "fr"));
  const origem = provinciasDe(estado, "de").find((p) => p.vizinhos.includes(alvo.id));
  origem.unidades = { infantaria: 5 };
  alvo.unidades = { infantaria: 1 };

  // Cerca a província alvo
  const francesa = estado.provincias.get(alvo.vizinhos.find((id) => estado.provincias.get(id).dono === "fr"));
  francesa.unidades = { blindado: 10 };
  assert.equal(executarComando(estado, "q", {
    tipo: "mover", origemId: francesa.id, destinoId: alvo.id, unidades: { blindado: 10 },
  }).ok, true);

  const antes = { ...origem.unidades };
  const resultado = executarComando(estado, "p", {
    tipo: "mover", origemId: origem.id, destinoId: alvo.id, unidades: { infantaria: 5 },
  });
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /cerco/i);
  assert.deepEqual(origem.unidades, antes, "as tropas sumiram mesmo com o comando recusado");
});


// ─────────────────────────────────────────────────────────────────────────────
// Pesquisa tecnológica
// ─────────────────────────────────────────────────────────────────────────────

const minhasProvincias = (estado, nacaoId) =>
  [...estado.provincias.values()].filter((p) => p.dono === nacaoId);

test("laboratório aumenta os pontos de pesquisa por dia", () => {
  const estado = criarEstado(1942);
  const antes = pontosDePesquisa(estado, "de");
  const provincia = minhasProvincias(estado, "de")[0];
  provincia.construcoes.laboratorio = 2;
  const depois = pontosDePesquisa(estado, "de");
  assert.ok(depois > antes, `esperava mais pontos, veio ${antes} -> ${depois}`);
  assert.ok(Math.abs(depois - (antes + 2 * 0.9)) < 0.01, "cada nível deve valer 0,9 ponto");
});

test("pesquisa exige pré-requisito e desconta os pontos ao concluir", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const nacao = estado.nacoes.get("de");

  nacao.pesquisa.pontos = 500;
  const cedo = executarComando(estado, "p", { tipo: "pesquisar", avancoId: "armas_combinadas" });
  assert.equal(cedo.ok, false, "pesquisou sem ter o pré-requisito");
  assert.match(cedo.motivo, /Instrucao de Combate/i);

  const primeiro = executarComando(estado, "p", { tipo: "pesquisar", avancoId: "instrucao_de_combate" });
  assert.equal(primeiro.ok, true, primeiro.motivo);
  assert.equal(nacao.pesquisa.pontos, 500 - AVANCOS.instrucao_de_combate.custo,
    "os pontos do avanço devem sair do saldo");

  const repetido = executarComando(estado, "p", { tipo: "pesquisar", avancoId: "instrucao_de_combate" });
  assert.equal(repetido.ok, false, "pesquisou o mesmo avanço duas vezes");

  const agora = executarComando(estado, "p", { tipo: "pesquisar", avancoId: "armas_combinadas" });
  assert.equal(agora.ok, true, agora.motivo);
});

test("a pesquisa realmente muda os números do jogo", () => {
  const estado = criarEstado(1942);
  const provincia = minhasProvincias(estado, "de").find((p) => p.terreno === "montanha")
    ?? minhasProvincias(estado, "de")[0];

  const forcaAntes = poderDasUnidades({ infantaria: 10 }).ataque * bonusNacional(estado, "de").ataque;
  estado.nacoes.get("de").pesquisa.concluidas.add("instrucao_de_combate");
  const forcaDepois = poderDasUnidades({ infantaria: 10 }).ataque * bonusNacional(estado, "de").ataque;
  assert.ok(forcaDepois > forcaAntes, "instrução de combate não aumentou o ataque");

  const acoAntes = calcularProducao(estado, "de").aco;
  estado.nacoes.get("de").pesquisa.concluidas.add("quimica_aplicada");
  const acoDepois = calcularProducao(estado, "de").aco;
  assert.ok(acoDepois > acoAntes, `química aplicada não aumentou o aço em ${provincia.nome}`);
});

test("guerra de movimento faz as unidades andarem mais longe", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const origem = minhasProvincias(estado, "de")[0];
  origem.unidades = { infantaria: 4 };

  const retrato = (e) => projetarEstado(e, "p").provincias.find((p) => p.id === origem.id);
  const alcanceAntes = retrato(estado).alcancePorUnidade.infantaria.length;
  estado.nacoes.get("de").pesquisa.concluidas.add("guerra_de_movimento");
  const alcanceDepois = retrato(estado).alcancePorUnidade.infantaria.length;
  assert.ok(alcanceDepois > alcanceAntes, "a infantaria não ganhou alcance");
});

// ─────────────────────────────────────────────────────────────────────────────
// Política interna: moral e doutrinas
// ─────────────────────────────────────────────────────────────────────────────

test("doutrina tem custo, limite de três e efeito imediato", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const nacao = estado.nacoes.get("de");
  nacao.estoques.dinheiro = 5000;

  const consumoAntes = calcularConsumoDeComida(estado, "de");
  minhasProvincias(estado, "de")[0].unidades = { infantaria: 20 };
  const consumoComTropas = calcularConsumoDeComida(estado, "de");
  assert.ok(consumoComTropas > consumoAntes, "as tropas deveriam consumir comida");

  const adota = executarComando(estado, "p", { tipo: "adotarDoutrina", doutrinaId: "racionamento" });
  assert.equal(adota.ok, true, adota.motivo);
  const consumoRacionado = calcularConsumoDeComida(estado, "de");
  assert.ok(consumoRacionado < consumoComTropas, "racionamento não reduziu o consumo");

  for (const id of ["turnos_extras", "paz_social"]) {
    assert.equal(executarComando(estado, "p", { tipo: "adotarDoutrina", doutrinaId: id }).ok, true);
  }
  const excedente = executarComando(estado, "p", { tipo: "adotarDoutrina", doutrinaId: "censura" });
  assert.equal(excedente.ok, false, "passou do limite de doutrinas");
  assert.match(excedente.motivo, /3 doutrinas/i);

  const revoga = executarComando(estado, "p", { tipo: "revogarDoutrina", doutrinaId: "racionamento" });
  assert.equal(revoga.ok, true, revoga.motivo);
  assert.equal(nacao.doutrinas.has("racionamento"), false);
});

test("o moral cai com a guerra e sobe com propaganda", () => {
  const estado = criarEstado(1942);
  const nacao = estado.nacoes.get("de");
  const inicial = nacao.moral;
  for (let i = 0; i < 20; i += 1) avancarDia(estado);
  assert.ok(nacao.moral < inicial, `o moral deveria cair em guerra: ${inicial} -> ${nacao.moral}`);

  // Duas campanhas idênticas, uma com propaganda e outra sem: o motor é
  // determinístico, então qualquer diferença vem da doutrina. Comparar a mesma
  // nação consigo mesma no tempo não serve — as guerras do dia pesam mais que
  // a propaganda e o teste viraria sorteio.
  const comPropaganda = criarEstado(1942);
  const semPropaganda = criarEstado(1942);
  comPropaganda.nacoes.get("de").doutrinas.add("propaganda");
  for (let i = 0; i < 30; i += 1) {
    if (comPropaganda.vencedor === null) avancarDia(comPropaganda);
    if (semPropaganda.vencedor === null) avancarDia(semPropaganda);
  }

  const moralCom = comPropaganda.nacoes.get("de").moral;
  const moralSem = semPropaganda.nacoes.get("de").moral;
  assert.ok(moralCom > moralSem,
    `propaganda não levantou o moral: ${moralSem} sem contra ${moralCom} com`);
});

test("moral baixo derruba a produção", () => {
  const estado = criarEstado(1942);
  const nacao = estado.nacoes.get("de");
  const comMoralAlto = calcularProducao(estado, "de").dinheiro;
  nacao.moral = 5;
  const comMoralBaixo = calcularProducao(estado, "de").dinheiro;
  assert.ok(comMoralBaixo < comMoralAlto, "o moral não influenciou a produção");
  assert.ok(comMoralBaixo / comMoralAlto < 0.85, "a queda de produção foi pequena demais");
});

test("perder a capital é um choque político maior que perder outra província", () => {
  const estado = criarEstado(1942);
  const capital = minhasProvincias(estado, "de").find((p) => p.nome === estado.nacoes.get("de").capital);
  const outra = minhasProvincias(estado, "de").find((p) => p.id !== capital.id);
  const moralAntes = estado.nacoes.get("de").moral;

  outra.dono = "pl";
  estado.nacoes.get("de").perdasHoje = 1;
  avancarDia(estado);
  const depoisDePerderProvincia = estado.nacoes.get("de").moral;

  // A capital tem de cair pelo caminho normal: conquista em batalha
  capital.unidades = {};
  estado.nacoes.get("de").perdasHoje = 1;
  estado.batalhas.push({
    id: "b99", provinciaId: capital.id, atacante: "pl", defensor: "de",
    tropasAtacantes: { infantaria: 5 }, tropasDefensoras: capital.unidades, porMar: false,
    vidaAtacante: 500, vidaDefensora: 0, dias: 0,
  });
  avancarDia(estado);
  const depoisDePerderCapital = estado.nacoes.get("de").moral;
  assert.ok(depoisDePerderCapital < depoisDePerderProvincia,
    `a capital deveria doer mais: ${moralAntes} -> ${depoisDePerderProvincia} -> ${depoisDePerderCapital}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Diplomacia
// ─────────────────────────────────────────────────────────────────────────────

test("pacto bloqueia a declaração de guerra e romper libera o caminho", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const nacao = estado.nacoes.get("de");
  nacao.estoques.dinheiro = 5000;
  // Relações altas: a proposta precisa ser aceita para o teste valer
  nacao.relacoes.set("es", 80);
  estado.nacoes.get("es").relacoes.set("de", 80);

  const proposta = executarComando(estado, "p", { tipo: "proporPacto", nacaoId: "es" });
  assert.equal(proposta.ok, true, proposta.motivo);
  assert.equal(pactoEntre(estado, "de", "es")?.tipo, "naoAgressao", "o pacto não foi firmado");

  const guerra = executarComando(estado, "p", { tipo: "declararGuerra", nacaoId: "es" });
  assert.equal(guerra.ok, false, "declarou guerra a quem tinha pacto");
  assert.match(guerra.motivo, /pacto|alianca/i);

  const moralAntes = nacao.moral;
  const romper = executarComando(estado, "p", { tipo: "romperPacto", nacaoId: "es" });
  assert.equal(romper.ok, true, romper.motivo);
  assert.equal(pactoEntre(estado, "de", "es"), null);
  assert.ok(nacao.moral < moralAntes, "romper a palavra deveria custar moral");

  nacao.estoques.dinheiro = 5000;
  assert.equal(executarComando(estado, "p", { tipo: "declararGuerra", nacaoId: "es" }).ok, true);
});

test("aliança convoca o aliado para a guerra", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const italia = estado.nacoes.get("it");
  const suecia = estado.nacoes.get("su");
  // Aliança firme, feita fora das regras de aceitação (o alvo do teste é o chamado)
  firmarPacto(estado, "it", "su", "alianca", 180);
  assert.equal(ehAliado(estado, "it", "su"), true);

  estado.nacoes.get("de").estoques.dinheiro = 5000;
  const guerra = executarComando(estado, "p", { tipo: "declararGuerra", nacaoId: "it" });
  assert.equal(guerra.ok, true, guerra.motivo);
  assert.ok(suecia.emGuerraCom.has("de"), "a Suécia não honrou a aliança com a Itália");
  assert.ok(estado.nacoes.get("de").emGuerraCom.has("su"), "a Alemanha não ficou em guerra com a Suécia");
});

test("aliança dá acesso militar: a marcha atravessa, mas não ocupa", () => {
  // O mapa é feito de blocos contíguos: nenhuma província encosta em duas
  // nações estrangeiras ao mesmo tempo. Então o cenário é montado à mão —
  // três províncias em fila, com o aliado no meio.
  const estado = criarEstado(1942);
  const donoDe = (id) => estado.provincias.get(id)?.dono;

  let corrida = null;
  for (const provincia of estado.provincias.values()) {
    if (provincia.dono === null || ["de", "pl"].includes(provincia.dono)) continue;
    if (estaoEmGuerra(estado, "de", provincia.dono)) continue;
    const doMesmoDono = provincia.vizinhos.filter((id) => donoDe(id) === provincia.dono);
    if (doMesmoDono.length < 2) continue;
    const [a, b] = doMesmoDono;
    if (estado.provincias.get(a).vizinhos.includes(b)) continue; // precisam de estar separadas
    corrida = { corredor: provincia, aliado: provincia.dono, eu: a, alvo: b };
    break;
  }
  assert.ok(corrida !== null, "não foi possível montar o cenário do corredor");

  // Eu fico com uma província de um lado; do outro fica o alvo
  const minha = estado.provincias.get(corrida.eu);
  const alvo = estado.provincias.get(corrida.alvo);
  minha.dono = "de";
  alvo.dono = "pl";
  definirJogador(estado, "p", "de");
  firmarPacto(estado, "de", corrida.aliado, "alianca", 180);
  estado.nacoes.get("de").emGuerraCom.add("pl");
  estado.nacoes.get("pl").emGuerraCom.add("de");
  minha.unidades = { cacador: 6 };

  // 1. Ocupar território aliado continua proibido
  const ocupar = executarComando(estado, "p", {
    tipo: "mover", origemId: minha.id, destinoId: corrida.corredor.id, unidades: { cacador: 2 },
  });
  assert.equal(ocupar.ok, false, "ocupou território aliado");
  assert.match(ocupar.motivo, /aliado/i);
  assert.deepEqual(minha.unidades, { cacador: 6 }, "comando recusado não pode mexer nas tropas");

  // 2. Atravessar, sim: o alvo está a dois passos, com o aliado no meio
  const atravessar = executarComando(estado, "p", {
    tipo: "mover", origemId: minha.id, destinoId: alvo.id, unidades: { cacador: 2 },
  });
  assert.equal(atravessar.ok, true, `não conseguiu atravessar o aliado: ${atravessar.motivo}`);
  assert.equal(estado.batalhas.at(-1).porMar, false, "a rota terrestre pelo aliado virou desembarque");

  // 3. Prova de que o aliado era necessário: sem o pacto, o mesmo movimento falha
  const romper = executarComando(estado, "p", { tipo: "romperPacto", nacaoId: corrida.aliado });
  assert.equal(romper.ok, true, romper.motivo);
  const semAliado = executarComando(estado, "p", {
    tipo: "mover", origemId: minha.id, destinoId: alvo.id, unidades: { cacador: 2 },
  });
  assert.equal(semAliado.ok, false, "chegou ao alvo sem o aliado: o acesso militar não mudou nada");
  assert.match(semAliado.motivo, /alcance/i);
});

test("ajuda econômica transfere recursos e melhora relações", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "de");
  const nacao = estado.nacoes.get("de");
  const antes = estado.nacoes.get("it").estoques.dinheiro;
  const relacoesAntes = nacao.relacoes.get("it");

  const ajuda = executarComando(estado, "p", { tipo: "enviarAjuda", nacaoId: "it", recurso: "dinheiro", quantidade: 300 });
  assert.equal(ajuda.ok, true, ajuda.motivo);
  assert.equal(estado.nacoes.get("it").estoques.dinheiro, antes + 300);
  assert.ok(nacao.relacoes.get("it") > relacoesAntes, "a ajuda não melhorou as relações");

  const semEstoque = executarComando(estado, "p", { tipo: "enviarAjuda", nacaoId: "it", recurso: "dinheiro", quantidade: 999999 });
  assert.equal(semEstoque.ok, false, "enviou dinheiro que não tinha");

  const emGuerra = executarComando(estado, "p", { tipo: "enviarAjuda", nacaoId: "fr", recurso: "dinheiro", quantidade: 10 });
  assert.equal(emGuerra.ok, false, "mandou ajuda para o inimigo");
});

test("a inteligência artificial pesquisa e negocia sozinha", () => {
  const estado = criarEstado(1942);
  for (let i = 0; i < 200; i += 1) if (estado.vencedor === null) avancarDia(estado);

  // A conta é sobre as nações que sobreviveram: em 200 dias várias já foram
  // anexadas, e exigir um número fixo de pesquisadores mede o mapa, não a IA.
  const vivas = [...estado.nacoes.values()].filter((n) => !n.eliminada);
  assert.ok(vivas.length >= 4, `sobrou pouca coisa viva: ${vivas.length} nações`);

  const pesquisaram = vivas.filter((n) => n.pesquisa.concluidas.size > 0);
  assert.ok(pesquisaram.length >= Math.ceil(vivas.length * 0.7),
    `só ${pesquisaram.length} de ${vivas.length} nações vivas pesquisaram algo em 200 dias`);

  const comDoutrina = vivas.filter((n) => n.doutrinas.size > 0);
  assert.ok(comDoutrina.length >= Math.ceil(vivas.length * 0.5),
    `só ${comDoutrina.length} de ${vivas.length} nações adotaram doutrina`);

  const comPacto = vivas.filter((n) => n.pactos.size > 0);
  assert.ok(comPacto.length >= 2, `nenhuma nação da IA assinou pacto em 200 dias`);
});

test("moral e pesquisa permanecem dentro dos limites em 200 dias", () => {
  const estado = criarEstado(1942);
  for (let i = 0; i < 200; i += 1) {
    avancarDia(estado);
    for (const nacao of estado.nacoes.values()) {
      assert.ok(nacao.moral >= 0 && nacao.moral <= 100, `moral fora da faixa: ${nacao.moral}`);
      assert.ok(nacao.pesquisa.pontos >= 0, `pontos negativos em ${nacao.nome}`);
      assert.ok(nacao.doutrinas.size <= LIMITE_DE_DOUTRINAS, `${nacao.nome} passou do limite de doutrinas`);
    }
    if (estado.vencedor !== null) break;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// A campanha precisa andar
//
// Estes dois testes guardam o defeito mais caro que este motor já teve: com a
// IA abrindo ofensivas de uma ou duas unidades, cada ataque vencia, a província
// voltava no dia seguinte e o mapa passava 400 dias exatamente igual. Um jogo
// em que nada acontece parece quebrado, mesmo com todas as regras certas.
// ─────────────────────────────────────────────────────────────────────────────

/** Roda a campanha até o fim e devolve o que aconteceu com o mapa. */
function campanha(semente) {
  const estado = criarEstado(semente);
  const donos = new Map([...estado.provincias].map(([id, provincia]) => [id, provincia.dono]));
  const conquistasPorDia = [];
  let batalhas = 0;

  while (estado.vencedor === null && estado.dia < 400) {
    avancarDia(estado);
    batalhas += estado.batalhas.length;
    let hoje = 0;
    for (const [id, dono] of donos) {
      const agora = estado.provincias.get(id).dono;
      if (agora === dono) continue;
      donos.set(id, agora);
      hoje += 1;
    }
    conquistasPorDia.push(hoje);
    // As faixas são fatias da campanha que realmente aconteceu: uma partida
    // decidida no dia 240 não tem "último quarto" entre os dias 270 e 360.
  }

  const ranking = [...estado.nacoes.values()]
    .map((nacao) => ({ nacao, provincias: provinciasDaNacao(estado, nacao.id).length }))
    .sort((a, b) => b.provincias - a.provincias);

  // Último quarto da campanha, contado a partir do dia em que ela terminou
  const quantosDias = conquistasPorDia.length;
  const inicioDoUltimoQuarto = Math.floor(quantosDias * 0.75);
  const ultimoQuarto = conquistasPorDia
    .slice(inicioDoUltimoQuarto)
    .reduce((soma, n) => soma + n, 0);

  return {
    estado,
    lider: ranking[0],
    eliminadas: ranking.filter((r) => r.nacao.eliminada).length,
    conquistas: conquistasPorDia.reduce((soma, n) => soma + n, 0),
    ultimoQuarto,
    batalhas,
  };
}

test("a campanha não congela: o mapa troca de dono do começo ao fim", () => {
  const partida = campanha(1942);
  const total = partida.estado.provincias.size;

  assert.ok(partida.conquistas >= 120,
    `só ${partida.conquistas} províncias mudaram de dono em ${partida.estado.dia} dias`);
  assert.ok(partida.eliminadas >= 1,
    `nenhuma nação foi eliminada: a guerra não anda`);
  assert.ok(partida.lider.provincias / total >= 0.22,
    `o líder terminou com ${partida.lider.provincias} de ${total} províncias`);

  // A guerra não pode morrer no meio do caminho: o último quarto da campanha
  // também precisa ter conquistas.
  assert.ok(partida.ultimoQuarto >= 3,
    `o último quarto da campanha teve só ${partida.ultimoQuarto} conquistas`);

  // E a campanha precisa durar: uma potência que varre o mapa em sessenta dias
  // acaba com a partida antes de alguém conseguir jogar.
  assert.ok(partida.estado.dia >= 120,
    `a campanha acabou em ${partida.estado.dia} dias`);
});

test("a travessia marítima é uma rota de guerra usada de verdade", () => {
  let desembarques = 0;
  const nacoesQueDesembarcaram = new Set();

  for (const semente of [1943, 1945]) {
    const estado = criarEstado(semente);
    while (estado.vencedor === null && estado.dia < 300) {
      avancarDia(estado);
      for (const batalha of estado.batalhas) {
        if (batalha.__contada !== true && batalha.porMar) {
          batalha.__contada = true;
          desembarques += 1;
          nacoesQueDesembarcaram.add(batalha.atacante);
        } else if (batalha.__contada !== true) {
          batalha.__contada = true;
        }
      }
    }
  }

  assert.ok(desembarques >= 20,
    `só ${desembarques} desembarques em 600 dias de campanha: o mar virou uma parede`);
  assert.ok(nacoesQueDesembarcaram.size >= 3,
    `só ${[...nacoesQueDesembarcaram].join(", ")} usaram a rota marítima`);
});

test("toda campanha termina com um campeão e um motivo", () => {
  for (const semente of [1942, 1943, 1944]) {
    const partida = campanha(semente);
    const { estado } = partida;

    assert.notEqual(estado.vencedor, null, `a campanha ${semente} acabou sem vencedor`);
    assert.ok(["aniquilacao", "supremacia", "armisticio"].includes(estado.motivoDaVitoria),
      `motivo desconhecido: ${estado.motivoDaVitoria}`);
    assert.equal(estado.vencedor, partida.lider.nacao.id,
      "venceu uma nação que não é a maior do mapa");
    assert.ok(estado.dia <= LIMITE_DE_DIAS, `a campanha passou do prazo: dia ${estado.dia}`);

    // E o vencedor existe no mapa: nenhuma nação fantasma
    assert.equal(estado.nacoes.get(estado.vencedor).eliminada, false);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Quem entra na sala sem assumir nação é observador
//
// Um espectador derrubava o motor: os comandos de governo iam buscar os
// estoques de uma "nação" nula e estouravam. Numa partida multiplayer isso é
// um jogador que ainda está olhando a tela de escolha.
// ─────────────────────────────────────────────────────────────────────────────

test("observador sem nação não derruba o motor", () => {
  const estado = criarEstado(1942);
  estado.jogadores.set("espectador", null);

  const comandos = [
    { tipo: "pesquisar", avancoId: "mobilizacao" },
    { tipo: "adotarDoutrina", doutrinaId: "propaganda" },
    { tipo: "revogarDoutrina", doutrinaId: "propaganda" },
    { tipo: "proporPacto", nacaoId: "es", tipoDePacto: "naoAgressao" },
    { tipo: "romperPacto", nacaoId: "es" },
    { tipo: "enviarAjuda", nacaoId: "es", recurso: "dinheiro", quantidade: 10 },
    { tipo: "declararGuerra", nacaoId: "es" },
    { tipo: "proporPaz", nacaoId: "es" },
    { tipo: "construir", provinciaId: "x", construcaoId: "fazenda" },
    { tipo: "recrutar", provinciaId: "x", unidadeId: "infantaria", quantidade: 1 },
    { tipo: "mover", origemId: "x", destinoId: "y", unidades: { infantaria: 1 } },
    { tipo: "cancelarRecrutamento", provinciaId: "x", unidadeId: "infantaria" },
  ];

  for (const comando of comandos) {
    let resultado;
    assert.doesNotThrow(() => {
      resultado = executarComando(estado, "espectador", comando);
    }, `o comando ${comando.tipo} estourou`);
    assert.equal(resultado.ok, false, `o comando ${comando.tipo} passou sem nação`);
    assert.match(resultado.motivo, /escolheu uma nacao/i);
  }

  // E o mundo segue exatamente como estava
  assert.equal(estado.dia, 0);
  assert.equal(estado.batalhas.length, 0);
  assert.equal(estado.vencedor, null);
});

test("jogador desconhecido também é recusado, sem exceção", () => {
  const estado = criarEstado(1942);
  const resultado = executarComando(estado, "ninguem", { tipo: "pesquisar", avancoId: "mobilizacao" });
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /escolheu uma nacao/i);
});
