/**
 * Supremacia 1942 — Geracao de mundo
 *
 * Mapa em hexagonos (flat-top, coordenadas axiais q/r). O continente e formado
 * pela uniao de elipses, o que da uma forma organica e facil de ajustar.
 *
 * IMPORTANTE: o mundo e gerado no SERVIDOR, de forma deterministica a partir de
 * uma semente. O cliente nunca gera nem recalcula o mapa — ele apenas desenha o
 * que o servidor envia. Essa e a regra de autoridade do projeto.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Geometria do hexagono
// ─────────────────────────────────────────────────────────────────────────────

/** Tamanho do hexagono em unidades de mapa. */
export const RAIO_HEX = 1;

/**
 * Distancia maxima, em unidades do mapa, para duas provincias costeiras
 * serem consideradas ligadas por mar. Um vizinho terrestre esta a 1,73;
 * portanto este valor liga exatamente as provincias separadas por cerca de
 * dois hexagonos de agua: Canal da Mancha, Skagerrak, Sicilia-Tunisia,
 * Adriatico, Bósforo. Sem estas ligacoes, potencias insulares como Reino
 * Unido e Suecia ficariam eternamente fora da guerra.
 */
export const RAIO_DE_PASSAGEM_MARITIMA = 4.7;

/**
 * Travessias longas (Reino Unido -> continente, por exemplo) sao permitidas
 * com um limite maior, mas continuam exigindo que NAO exista rota por terra:
 * e o que impede que um simples atalho entre provincias vizinhas vire mar.
 */
export const RAIO_DE_TRAVESSIA_LONGA = 7.2;

/**
 * Quantos vizinhos maritimos cada provincia costeira pode ter.
 * Baixo de proposito: com muitas ligacoes o mapa vira uma teia de linhas
 * cruzadas e a geografia deixa de significar alguma coisa.
 */
export const MAXIMO_DE_LIGACOES_MARITIMAS = 3;

/** Bonus de defesa de quem enfrenta um desembarque. */
export const BONUS_DE_DESEMBARQUE = 1.25;

/** Converte coordenadas axiais para pixels (hexagono flat-top). */
export function axialParaPixel(q, r) {
  const x = 1.5 * RAIO_HEX * q;
  const y = Math.sqrt(3) * RAIO_HEX * (r + q / 2);
  return { x, y };
}

/** Os 6 vizinhos de um hexagono em coordenadas axiais. */
export const DIRECOES = Object.freeze([
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]);

export const chaveDoHex = (q, r) => `${q},${r}`;

/** Distancia entre dois hexagonos em passos. */
export function distanciaHex(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gerador pseudoaleatorio deterministico (mulberry32)
// ─────────────────────────────────────────────────────────────────────────────

export function criarAleatorio(semente) {
  let estado = semente >>> 0;
  return function proximo() {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Forma do continente: uniao de elipses numa Europa estilizada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cada "massa" e uma elipse em unidades de pixel do mapa.
 * x cresce para leste, y cresce para sul.
 */
const MASSAS_DE_TERRA = Object.freeze([
  { nome: "ilhas-britanicas", x: 4.4, y: 6.6, rx: 2.4, ry: 3.0 },
  { nome: "irlanda", x: 1.2, y: 4.2, rx: 1.4, ry: 1.6 },
  { nome: "iberia", x: 2.6, y: 21.0, rx: 3.4, ry: 3.2 },
  { nome: "franca", x: 8.0, y: 14.5, rx: 3.2, ry: 3.0 },
  { nome: "europa-central", x: 14.5, y: 11.0, rx: 4.2, ry: 3.4 },
  { nome: "escandinavia", x: 14.0, y: 1.0, rx: 2.8, ry: 4.6 },
  { nome: "finlandia", x: 19.0, y: 1.0, rx: 2.6, ry: 3.2 },
  { nome: "italia", x: 13.0, y: 19.5, rx: 1.6, ry: 3.6 },
  { nome: "balcas", x: 19.0, y: 19.5, rx: 3.3, ry: 3.0 },
  { nome: "leste-europeu", x: 23.0, y: 12.5, rx: 4.6, ry: 3.6 },
  { nome: "russia", x: 31.0, y: 6.5, rx: 6.5, ry: 5.2 },
  { nome: "caucaso", x: 33.0, y: 19.0, rx: 4.0, ry: 2.2 },
  { nome: "anatomia", x: 26.0, y: 22.5, rx: 3.8, ry: 2.0 },
  { nome: "levante", x: 31.0, y: 25.0, rx: 3.0, ry: 2.0 },
  { nome: "africa-norte", x: 11.0, y: 28.5, rx: 6.5, ry: 2.2 },
  { nome: "africa-nordeste", x: 25.0, y: 28.0, rx: 4.5, ry: 2.4 },
]);

const dentroDeUmaMassa = (x, y) => {
  for (const m of MASSAS_DE_TERRA) {
    const dx = (x - m.x) / m.rx;
    const dy = (y - m.y) / m.ry;
    if (dx * dx + dy * dy <= 1) return m.nome;
  }
  return null;
};

/**
 * Quais nacoes podem ocupar cada massa de terra.
 *
 * Atribuir por distancia pura produzia territorios fragmentados (a Italia
 * capturava tiles da Europa central, a Grecia se espalhava). Restringir o
 * sorteio ao "pool" da regiao mantem cada nacao contigua e plausivel.
 */
const NACOES_POR_MASSA = Object.freeze({
  "ilhas-britanicas": ["gb"],
  irlanda: ["gb"],
  iberia: ["es", "pt"],
  franca: ["fr"],
  "europa-central": ["de", "pl"],
  escandinavia: ["su"],
  finlandia: ["su", "ur"],
  italia: ["it"],
  balcas: ["gr", "it", "tr"],
  "leste-europeu": ["ur", "pl"],
  russia: ["ur"],
  caucaso: ["ur", "tr"],
  anatomia: ["tr"],
  levante: ["tr", "gb"],
  "africa-norte": ["it", "eg"],
  "africa-nordeste": ["eg"],
});

// ─────────────────────────────────────────────────────────────────────────────
// Nacoes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sementes de nacao: cada hexagono de terra pertence a nacao cuja semente
 * estiver mais proxima. Nomes de epoca, mas o jogo e uma abstracao de
 * estrategia — nao uma simulacao historica.
 */
export const NACOES = Object.freeze([
  { id: "gb", nome: "Reino Unido", cor: "#41688c", x: 3.6, y: 4.0, capital: "Londres", jogavel: true },
  { id: "fr", nome: "França", cor: "#585aa6", x: 8.0, y: 14.0, capital: "Paris", jogavel: true },
  { id: "de", nome: "Alemanha", cor: "#87b847", x: 13.2, y: 10.4, capital: "Berlim", jogavel: true },
  { id: "it", nome: "Itália", cor: "#4b846e", x: 13.2, y: 19.0, capital: "Roma", jogavel: true },
  { id: "es", nome: "Espanha", cor: "#af7c5f", x: 2.6, y: 20.5, capital: "Madrid", jogavel: true },
  { id: "pt", nome: "Portugal", cor: "#3e9f5e", x: 0.4, y: 22.0, capital: "Lisboa", jogavel: true },
  { id: "su", nome: "Suécia", cor: "#8b47b8", x: 14.5, y: 1.5, capital: "Estocolmo", jogavel: true },
  { id: "ur", nome: "União Soviética", cor: "#953a3e", x: 30.0, y: 6.5, capital: "Moscou", jogavel: true },
  { id: "tr", nome: "Turquia", cor: "#8d4080", x: 26.0, y: 22.0, capital: "Ancara", jogavel: true },
  { id: "gr", nome: "Grécia", cor: "#61adc0", x: 19.5, y: 21.3, capital: "Atenas", jogavel: true },
  { id: "pl", nome: "Polônia", cor: "#b4748b", x: 18.5, y: 11.0, capital: "Varsóvia", jogavel: true },
  { id: "eg", nome: "Egito", cor: "#818847", x: 22.0, y: 28.5, capital: "Cairo", jogavel: true },
]);

// ─────────────────────────────────────────────────────────────────────────────
// Relevo
// ─────────────────────────────────────────────────────────────────────────────

export const TERRENOS = Object.freeze({
  planicie: { id: "planicie", nome: "Planície", comida: 1.15, aco: 0.9, petroleo: 0.9, carvao: 1.0, dinheiro: 1.0 },
  floresta: { id: "floresta", nome: "Floresta", comida: 1.0, aco: 1.1, petroleo: 0.7, carvao: 1.25, dinheiro: 0.95 },
  montanha: { id: "montanha", nome: "Montanha", comida: 0.6, aco: 1.45, petroleo: 0.6, carvao: 1.4, dinheiro: 0.85 },
  deserto: { id: "deserto", nome: "Deserto", comida: 0.5, aco: 0.8, petroleo: 1.45, carvao: 0.6, dinheiro: 0.9 },
  cidade: { id: "cidade", nome: "Metrópole", comida: 0.85, aco: 1.0, petroleo: 0.9, carvao: 0.9, dinheiro: 1.6 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Construcoes
// ─────────────────────────────────────────────────────────────────────────────

export const TIPOS_DE_CONSTRUCAO = Object.freeze({
  fazenda: {
    id: "fazenda", nome: "Fazenda", recurso: "comida", nivelMaximo: 5,
    producaoBase: 4, custo: { dinheiro: 60, aco: 20 }, custoPorNivel: 1.6,
  },
  siderurgica: {
    id: "siderurgica", nome: "Siderúrgica", recurso: "aco", nivelMaximo: 5,
    producaoBase: 3, custo: { dinheiro: 80, aco: 10 }, custoPorNivel: 1.65,
  },
  pocoPetroleo: {
    id: "pocoPetroleo", nome: "Poço de Petróleo", recurso: "petroleo", nivelMaximo: 5,
    producaoBase: 2, custo: { dinheiro: 100, aco: 35 }, custoPorNivel: 1.7,
  },
  minaCarvao: {
    id: "minaCarvao", nome: "Mina de Carvão", recurso: "carvao", nivelMaximo: 5,
    producaoBase: 3, custo: { dinheiro: 70, aco: 25 }, custoPorNivel: 1.6,
  },
  comercio: {
    id: "comercio", nome: "Centro Comercial", recurso: "dinheiro", nivelMaximo: 5,
    producaoBase: 5, custo: { dinheiro: 50, aco: 30 }, custoPorNivel: 1.55,
  },
  quartel: {
    id: "quartel", nome: "Quartel", recurso: null, nivelMaximo: 3,
    producaoBase: 0, custo: { dinheiro: 120, aco: 60 }, custoPorNivel: 1.8,
    efeito: "Recrutamento mais rapido e maior guarnicao",
  },
  laboratorio: {
    id: "laboratorio", nome: "Laboratório", recurso: null, nivelMaximo: 3,
    producaoBase: 0, custo: { dinheiro: 140, aco: 70 }, custoPorNivel: 1.85,
    efeito: "Gera pontos de pesquisa por dia",
    pesquisaPorNivel: 0.9,
  },
  fortificacao: {
    id: "fortificacao", nome: "Fortificacao", recurso: null, nivelMaximo: 3,
    producaoBase: 0, custo: { dinheiro: 90, aco: 90 }, custoPorNivel: 1.9,
    efeito: "Bonus de defesa na provincia",
    bonusDeDefesaPorNivel: 0.12,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Unidades
// ─────────────────────────────────────────────────────────────────────────────

export const TIPOS_DE_UNIDADE = Object.freeze({
  infantaria: {
    id: "infantaria", nome: "Infantaria", abrev: "INF",
    ataque: 10, defesa: 12, vida: 100, velocidade: 1,
    custo: { dinheiro: 40, comida: 20, aco: 15 },
    diasDeRecrutamento: 2, consomeComida: 0.5,
  },
  blindado: {
    id: "blindado", nome: "Blindado", abrev: "BLD",
    ataque: 26, defesa: 18, vida: 180, velocidade: 2,
    custo: { dinheiro: 90, aco: 70, petroleo: 30 },
    diasDeRecrutamento: 4, consomeComida: 0.3,
  },
  artilharia: {
    id: "artilharia", nome: "Artilharia", abrev: "ART",
    ataque: 22, defesa: 8, vida: 110, velocidade: 1,
    custo: { dinheiro: 70, aco: 55, carvao: 20 },
    diasDeRecrutamento: 3, consomeComida: 0.45,
  },
  cacador: {
    id: "cacador", nome: "Caçador", abrev: "CAC",
    ataque: 18, defesa: 14, vida: 90, velocidade: 3,
    custo: { dinheiro: 85, aco: 40, petroleo: 40 },
    diasDeRecrutamento: 3, consomeComida: 0.4,
  },
});

/**
 * Eficiencia industrial: quanto cada nacao tira de cada provincia.
 *
 * Sem isto, a nacao que comeca maior so cresce: a Uniao Sovietica entra na
 * campanha com 45 das 214 provincias e virava dona do mapa antes do dia 150 em
 * praticamente toda partida. Dar mais territorio e menos industria por
 * provincia resolve na raiz e ainda diz alguma coisa sobre 1942: a Uniao
 * Sovietica tem a maior extensao e a producao mais atrasada; a Alemanha tem
 * pouco territorio e a melhor fabrica.
 */
export const EFICIENCIA_NACIONAL = Object.freeze({
  de: 1.18,
  gb: 1.12,
  fr: 1.02,
  it: 0.98,
  su: 1.0,
  es: 0.94,
  pt: 0.9,
  pl: 0.92,
  tr: 0.88,
  gr: 0.9,
  eg: 0.94,
  ur: 0.45,
});

export const RECURSOS = Object.freeze(["dinheiro", "comida", "aco", "petroleo", "carvao"]);

export const NOME_DO_RECURSO = Object.freeze({
  dinheiro: "Dinheiro", comida: "Alimento", aco: "Aço",
  petroleo: "Petróleo", carvao: "Carvão",
});

// ─────────────────────────────────────────────────────────────────────────────
// Geracao do mundo
// ─────────────────────────────────────────────────────────────────────────────

/** Limites de varredura do hexagono em coordenadas axiais. */
const LIMITES = { qMin: -6, qMax: 40, rMin: -12, rMax: 22 };

/**
 * Gera o mundo completo.
 * @param {number} semente - semente deterministica
 * @returns {{provincias: Map<string, object>, hexagonos: object[], nacoes: object[]}}
 */
export function gerarMundo(semente = 1942) {
  const aleatorio = criarAleatorio(semente);

  // 1. Descobrir quais hexagonos sao terra
  const terras = [];
  for (let q = LIMITES.qMin; q <= LIMITES.qMax; q += 1) {
    for (let r = LIMITES.rMin; r <= LIMITES.rMax; r += 1) {
      const { x, y } = axialParaPixel(q, r);
      const massa = dentroDeUmaMassa(x, y);
      if (massa === null) continue;
      terras.push({ q, r, x, y, massa });
    }
  }

  // 2. Atribuir cada terra a nacao mais proxima, dentro do pool da regiao
  const provincias = new Map();
  const nacoesPorId = new Map(NACOES.map((n) => [n.id, n]));
  let indice = 0;

  for (const terra of terras) {
    const pool = NACOES_POR_MASSA[terra.massa] ?? ["de"];
    let melhor = null;
    let melhorDistancia = Infinity;
    for (const idNacao of pool) {
      const nacao = nacoesPorId.get(idNacao);
      const dx = terra.x - nacao.x;
      const dy = terra.y - nacao.y;
      const d = dx * dx + dy * dy;
      if (d < melhorDistancia) {
        melhorDistancia = d;
        melhor = nacao;
      }
    }
    if (melhor === null) continue;

    const id = `p${String(indice).padStart(3, "0")}`;
    indice += 1;

    // 3. Relevo: cidades nas capitais, depois por sorteio ponderado
    const distanciaCapital = Math.sqrt(melhorDistancia);
    let terreno;
    if (distanciaCapital < 1.6) {
      terreno = TERRENOS.cidade;
    } else {
      const sorteio = aleatorio();
      if (terra.massa === "africa-norte" || terra.massa === "africa-nordeste" || terra.massa === "levante") {
        terreno = sorteio < 0.7 ? TERRENOS.deserto : TERRENOS.planicie;
      } else if (sorteio < 0.16) {
        terreno = TERRENOS.montanha;
      } else if (sorteio < 0.42) {
        terreno = TERRENOS.floresta;
      } else {
        terreno = TERRENOS.planicie;
      }
    }

    // 4. Slots de construcao: metropoles tem mais espaco
    const slots = terreno.id === "cidade" ? 5 : 2 + Math.floor(aleatorio() * 2);

    provincias.set(id, {
      id,
      q: terra.q,
      r: terra.r,
      x: terra.x,
      y: terra.y,
      massa: terra.massa,
      terreno: terreno.id,
      dono: melhor.id,
      donoOriginal: melhor.id,
      nome: null, // preenchido depois
      slots,
      construcoes: {},   // id -> nivel
      unidades: {},      // tipo -> quantidade
      progressoDeRecrutamento: {}, // tipo -> { diasRestantes, quantidade }
      fortificacao: 0,
      producaoAcumulada: {}, // cache informativo do ultimo dia
      cerco: null,       // { nacao, diasRestantes } quando ocupada
    });
  }

  // 5. Adjacencia entre provincias de terra
  const porCoordenada = new Map();
  for (const provincia of provincias.values()) {
    porCoordenada.set(chaveDoHex(provincia.q, provincia.r), provincia);
  }
  for (const provincia of provincias.values()) {
    provincia.vizinhos = [];
    for (const direcao of DIRECOES) {
      const vizinho = porCoordenada.get(chaveDoHex(provincia.q + direcao.q, provincia.r + direcao.r));
      if (vizinho !== undefined) provincia.vizinhos.push(vizinho.id);
    }
  }

  // 5b. Ligacoes maritimas: provincias costeiras proximas, mas nao vizinhas
  //     por terra, podem alcancar uma a outra atravessando um estreito.
  for (const provincia of provincias.values()) {
    if (provincia.terreno === undefined) continue;
    provincia.vizinhosMaritimos = [];
  }
  const listaDeProvincias = [...provincias.values()];
  const candidatos = new Map(); // id -> [{ id, distancia }]
  for (const provincia of listaDeProvincias) candidatos.set(provincia.id, []);

  for (let a = 0; a < listaDeProvincias.length; a += 1) {
    const origem = listaDeProvincias[a];
    if (!temCosta(origem, porCoordenada)) continue;
    for (let b = a + 1; b < listaDeProvincias.length; b += 1) {
      const destino = listaDeProvincias[b];
      if (!temCosta(destino, porCoordenada)) continue;
      if (origem.vizinhos.includes(destino.id)) continue;

      const distancia = Math.hypot(destino.x - origem.x, destino.y - origem.y);
      if (distancia > RAIO_DE_TRAVESSIA_LONGA) continue;

      // Duas condicoes separam um estreito de um simples atalho entre
      // provincias do mesmo continente:
      //   1. o ponto medio entre elas tem de ser agua;
      //   2. nao pode existir caminho por terra razoavel entre as duas.
      const meio = { x: (origem.x + destino.x) / 2, y: (origem.y + destino.y) / 2 };
      if (!ehAgua(meio, porCoordenada)) continue;

      // A travessia so faz sentido quando o mar e mais curto que a volta por
      // terra. Uma provincia esta a 1,73 de distancia do vizinho: comparamos o
      // desvio terrestre com a distancia maritima.
      const passosEquivalentes = Math.ceil(distancia / 1.733);
      if (existeCaminhoTerrestre(origem, destino, porCoordenada, passosEquivalentes)) continue;

      candidatos.get(origem.id).push({ id: destino.id, distancia });
      candidatos.get(destino.id).push({ id: origem.id, distancia });
    }
  }

  // Cada provincia conserva apenas as passagens mais curtas: um mapa cheio de
  // linhas cruzadas deixa de significar alguma coisa.
  const escolhidas = new Map();
  for (const provincia of listaDeProvincias) {
    const ordenados = candidatos.get(provincia.id).sort((a, b) => a.distancia - b.distancia);
    escolhidas.set(provincia.id, new Set(ordenados.slice(0, MAXIMO_DE_LIGACOES_MARITIMAS).map((c) => c.id)));
  }
  // A travessia precisa ser a melhor escolha dos DOIS lados. Exigir apenas um
  // lado fazia cada provincia aparecer como destino preferido de muitas
  // outras, e o mapa ficava cheio de rotas.
  for (const provincia of listaDeProvincias) {
    for (const outroId of escolhidas.get(provincia.id)) {
      if (!escolhidas.get(outroId).has(provincia.id)) continue;
      const outro = provincias.get(outroId);
      if (!provincia.vizinhosMaritimos.includes(outroId)) provincia.vizinhosMaritimos.push(outroId);
      if (!outro.vizinhosMaritimos.includes(provincia.id)) outro.vizinhosMaritimos.push(provincia.id);
    }
  }

  // 6. Consolidar nacoes: so mantem as que receberam territorio
  const nacoes = NACOES.map((nacao) => {
    const territorios = [...provincias.values()].filter((p) => p.dono === nacao.id);
    return { ...nacao, provinciasIniciais: territorios.length };
  }).filter((nacao) => nacao.provinciasIniciais > 0);

  // 7. Renomear provincias com nomes de epoca plausiveis
  nomearProvincias(provincias, nacoes, aleatorio);

  return { provincias, nacoes, semente };
}

// ─────────────────────────────────────────────────────────────────────────────
// Nomes de provincia
// ─────────────────────────────────────────────────────────────────────────────

const NOMES_POR_MASSA = Object.freeze({
  "ilhas-britanicas": [
    "Kent", "Sussex", "Wessex", "Anglia", "Midlands", "Yorkshire", "Lancashire", "Escócia",
    "Gales", "Cornualha", "Devon", "Essex", "Norfolk", "Cumberland", "Northumberland",
    "Cambridge", "Oxford", "Surrey", "Dorset", "Chester",
  ],
  irlanda: ["Ulster", "Connacht", "Munster", "Leinster", "Donegal", "Cork"],
  iberia: [
    "Castela", "Aragão", "Andaluzia", "Galiza", "Catalunha", "Valência", "Alentejo",
    "Estremadura", "Navarra", "Biscaia", "Leão", "Múrcia", "Granada", "Sevilha", "Toledo",
    "Astúrias", "Algarve", "Beira", "Trás-os-Montes", "Minho",
  ],
  franca: [
    "Normandia", "Bretanha", "Picardia", "Alsácia", "Borgonha", "Auvérnia", "Provença",
    "Aquitânia", "Lionês", "Champanhe", "Lorena", "Touraine", "Poitou", "Berry",
    "Franco-Condado", "Delfinado", "Languedoc", "Flandres", "Artois", "Saboia",
  ],
  "europa-central": [
    "Baviera", "Silésia", "Saxônia", "Ruhr", "Prússia", "Boêmia", "Morávia", "Tirol",
    "Renânia", "Brandemburgo", "Vestfália", "Hesse", "Turíngia", "Wurtemberg",
    "Baden", "Pomerânia", "Posnânia", "Estíria", "Caríntia", "Hanôver", "Westfália Oriental",
  ],
  escandinavia: [
    "Norrland", "Svealand", "Gotland", "Finnmark", "Trøndelag", "Vestlandet", "Skåne",
    "Jutlândia", "Bergen", "Oslo", "Narvik", "Lapônia Nórdica", "Östergötland",
    "Dalarna", "Hälsingland", "Bohuslän",
  ],
  finlandia: ["Carélia", "Lapônia", "Savônia", "Tavácia", "Ostrobótnia", "Häme", "Kymi", "Satakunta"],
  italia: [
    "Lombardia", "Toscana", "Campânia", "Sicília", "Veneza", "Piemonte", "Lácio",
    "Úmbria", "Marcas", "Abruzzo", "Calábria", "Sardenha", "Ligúria", "Emília",
    "Puglia", "Basilicata", "Tirol do Sul", "Ístria",
  ],
  balcas: [
    "Sérvia", "Bósnia", "Macedônia", "Trácia", "Muntênia", "Transilvânia", "Croácia",
    "Épiro", "Valáquia", "Moldávia", "Dobruja", "Eslavônia", "Dalmácia", "Voivodina",
    "Montenegro", "Albânia", "Bucovina", "Oltenia",
  ],
  "leste-europeu": [
    "Volínia", "Podólia", "Galícia", "Mazóvia", "Silésia Oriental", "Bielorrússia",
    "Smolensk", "Kursk", "Cracóvia", "Lublin", "Pomerélia", "Cujávia", "Brest",
    "Vilnius", "Grodno", "Minsk", "Polésia", "Wielkopolska",
  ],
  russia: [
    "Moscóvia", "Urais", "Don", "Kuban", "Volga", "Arcangel", "Novgorod", "Tula",
    "Voronej", "Kiev", "Kharkov", "Odessa", "Crimeia", "Rostov", "Cáspio", "Perm",
    "Vologda", "Pskov", "Tver", "Yaroslavl", "Nizhny", "Saratov", "Orel", "Bryansk",
    "Kaluga", "Ryazan", "Tambov", "Penza", "Kostroma", "Múrmansk", "Viatka",
    "Simbirsk", "Saratov do Sul", "Astracã", "Orenburg", "Ekaterinburgo",
    "Tobolsk", "Tomsk", "Kazan", "Chuváchia", "Mari", "Udmúrtia",
  ],
  caucaso: [
    "Geórgia", "Armênia", "Azerbaijão", "Ciscaucásia", "Ossétia", "Chechênia",
    "Daguestão", "Batumi", "Baku", "Erevan", "Stavropol", "Krasnodar",
  ],
  anatomia: [
    "Anatólia", "Cilícia", "Capadócia", "Pôntico", "Bítinia", "Lídia", "Frígia",
    "Galácia", "Licaônia", "Pafagônia", "Trôade", "Mísia",
  ],
  levante: ["Síria", "Palestina", "Líbano", "Transjordânia", "Damasco", "Alepo", "Hauran", "Galileia"],
  "africa-norte": [
    "Tripolitânia", "Cirenaica", "Tunísia", "Argel", "Marrocos", "Saara",
    "Fezã", "Bengasi", "Trípoli", "Sfax", "Orã", "Constantina", "Casablanca",
    "Marraquexe", "Atlântico Norte", "Mauritânia", "Tunísia Ocidental", "Golfo de Sirte",
    "Cabília", "Rio Dra",
  ],
  "africa-nordeste": [
    "Alexandria", "Delta do Nilo", "Alto Egito", "Sinai", "Cairo", "Gizé",
    "Assiut", "Assuã", "Porto Said", "Suez", "Faium", "Tanta",
  ],
});

/** O ponto cai no mar? (nenhuma provincia de terra perto o bastante) */
function ehAgua(ponto, porCoordenada) {
  for (const provincia of porCoordenada.values()) {
    if (Math.hypot(provincia.x - ponto.x, provincia.y - ponto.y) < 0.98) return false;
  }
  return true;
}

/** Existe caminho somente por terra entre duas provincias dentro de N passos? */
function existeCaminhoTerrestre(origem, destino, porCoordenada, maxPassos) {
  const visitados = new Set([origem.id]);
  let fronteira = [origem];
  for (let passo = 0; passo < maxPassos; passo += 1) {
    const proxima = [];
    for (const provincia of fronteira) {
      for (const direcao of DIRECOES) {
        const vizinho = porCoordenada.get(chaveDoHex(provincia.q + direcao.q, provincia.r + direcao.r));
        if (vizinho === undefined || visitados.has(vizinho.id)) continue;
        if (vizinho.id === destino.id) return true;
        visitados.add(vizinho.id);
        proxima.push(vizinho);
      }
    }
    fronteira = proxima;
    if (fronteira.length === 0) break;
  }
  return false;
}

/** Uma provincia tem costa quando alguma das seis direcoes nao tem terra. */
function temCosta(provincia, porCoordenada) {
  for (const direcao of DIRECOES) {
    if (porCoordenada.get(chaveDoHex(provincia.q + direcao.q, provincia.r + direcao.r)) === undefined) return true;
  }
  return false;
}

function nomearProvincias(provincias, nacoes, aleatorio) {
  const usados = new Set();
  const contadorDeSetores = new Map();
  const porNacao = new Map();
  for (const provincia of provincias.values()) {
    if (!porNacao.has(provincia.dono)) porNacao.set(provincia.dono, []);
    porNacao.get(provincia.dono).push(provincia);
  }

  for (const nacao of nacoes) {
    const lista = porNacao.get(nacao.id) ?? [];
    // A provincia mais perto da capital recebe o nome da capital
    let maisPerto = null;
    let menorDistancia = Infinity;
    for (const provincia of lista) {
      const dx = provincia.x - nacao.x;
      const dy = provincia.y - nacao.y;
      const d = dx * dx + dy * dy;
      if (d < menorDistancia) {
        menorDistancia = d;
        maisPerto = provincia;
      }
    }
    if (maisPerto !== null) maisPerto.nome = nacao.capital;
    if (maisPerto !== null) usados.add(nacao.capital);

    for (const provincia of lista) {
      if (provincia.nome !== null) continue;
      const pool = NOMES_POR_MASSA[provincia.massa] ?? [];
      const disponiveis = pool.filter((n) => !usados.has(n));
      if (disponiveis.length > 0) {
        const escolhido = disponiveis[Math.floor(aleatorio() * disponiveis.length)];
        provincia.nome = escolhido;
        usados.add(escolhido);
      } else {
        // Esgotado o repertorio: usa variantes direcionais, que soam como
        // regiao de verdade, e so em ultimo caso cai no numeral romano.
        const base = pool[0] ?? "Setor";
        const variantes = [
          `Alto ${base}`, `Baixo ${base}`, `${base} do Norte`, `${base} do Sul`,
          `${base} Oriental`, `${base} Ocidental`, `Novo ${base}`, `${base} Velho`,
          `${base} Interior`, `${base} do Litoral`,
        ];
        const livre = variantes.find((nome) => !usados.has(nome));
        if (livre !== undefined) {
          provincia.nome = livre;
          usados.add(livre);
        } else {
          // Ultimo recurso, e sempre legivel: um setor numerado
          const setor = (contadorDeSetores.get(provincia.massa) ?? 0) + 1;
          contadorDeSetores.set(provincia.massa, setor);
          provincia.nome = `Setor ${base} ${numeroRomano(setor)}`;
        }
      }
    }
  }
}

const SIMBOLOS_ROMANOS = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

function numeroRomano(n) {
  let resto = Math.max(1, Math.min(3999, Math.floor(n)));
  let saida = "";
  for (const [valor, simbolo] of SIMBOLOS_ROMANOS) {
    while (resto >= valor) {
      saida += simbolo;
      resto -= valor;
    }
  }
  return saida;
}

// ─────────────────────────────────────────────────────────────────────────────
// Visualizacao ASCII (usada para conferir o mapa no terminal)
// ─────────────────────────────────────────────────────────────────────────────

export function desenharMapaAscii(provincias) {
  const lista = [...provincias.values()];
  if (lista.length === 0) return "(mundo vazio)";
  const qMin = Math.min(...lista.map((p) => p.q));
  const qMax = Math.max(...lista.map((p) => p.q));
  const rMin = Math.min(...lista.map((p) => p.r));
  const rMax = Math.max(...lista.map((p) => p.r));
  const porCoordenada = new Map(lista.map((p) => [chaveDoHex(p.q, p.r), p]));

  const simbolos = new Map();
  let contador = 0;
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const nacao of NACOES) {
    if (contador < alfabeto.length) simbolos.set(nacao.id, alfabeto[contador]);
    contador += 1;
  }

  const linhas = [];
  for (let r = rMin; r <= rMax; r += 1) {
    let prefixo = " ".repeat(Math.max(0, r - rMin));
    let linha = prefixo;
    for (let q = qMin; q <= qMax; q += 1) {
      const provincia = porCoordenada.get(chaveDoHex(q, r));
      linha += provincia === undefined ? "  " : `${simbolos.get(provincia.dono) ?? "?"} `;
    }
    linhas.push(linha.trimEnd());
  }
  return linhas.join("\n");
}

export function legendaNacoes(mundo) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return mundo.nacoes
    .map((nacao, indice) => `${alfabeto[indice]} = ${nacao.nome} (${nacao.provinciasIniciais} provincias)`)
    .join("\n");
}
