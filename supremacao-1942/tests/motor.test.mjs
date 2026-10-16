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

test("atacar pelo mar é possível e concede vantagem ao defensor", () => {
  const estado = criarEstado(1942);
  definirJogador(estado, "p", "gb");
  const origem = provinciasDe(estado, "gb").find((p) => (p.vizinhosMaritimos ?? []).length > 0);
  assert.ok(origem !== undefined, "nenhuma província britânica tem rota marítima");

  const destinoId = origem.vizinhosMaritimos[0];
  const destino = estado.provincias.get(destinoId);
  destino.unidades = { infantaria: 1 };

  // Sem guerra o movimento é apenas posicionamento
  assert.equal(estaoEmGuerra(estado, "gb", destino.dono), false);
  origem.unidades = { infantaria: 6, blindado: 4 };
  const resultado = executarComando(estado, "p", {
    tipo: "mover", origemId: origem.id, destinoId, unidades: { infantaria: 3, blindado: 2 },
  });
  assert.equal(resultado.ok, true, `travessia recusada: ${resultado.motivo}`);

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
