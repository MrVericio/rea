#!/usr/bin/env node
/**
 * Medidor de equilíbrio da campanha.
 *
 * Simula partidas inteiras sem interface e resume o que aconteceu: quem
 * lidera, quantas provincias mudaram de dono, quantas nacoes foram
 * eliminadas e como (e se) a partida terminou. Serve para calibrar a IA com
 * numeros em vez de impressoes.
 *
 *   node tools/equilibrio.mjs [quantidadeDeSementes]
 */

import { criarEstado, avancarDia, provinciasDaNacao } from "../server/simulation.mjs";

const quantas = Number(process.argv[2] ?? 3);
const TOTAL = 216;

function resumoDaPartida(semente) {
  const estado = criarEstado(semente);
  const donos = new Map([...estado.provincias].map(([id, p]) => [id, p.dono]));
  const conquistasPorFaixa = [0, 0, 0, 0];
  const marcha = [];
  let batalhas = 0;
  let maiorDuracao = 0;
  const inicioDasBatalhas = new Map();

  while (estado.vencedor == null && estado.dia < 460) {
    avancarDia(estado);
    for (const batalha of estado.batalhas) {
      if (!inicioDasBatalhas.has(batalha.id)) inicioDasBatalhas.set(batalha.id, estado.dia);
      batalhas += 1;
      maiorDuracao = Math.max(maiorDuracao, estado.dia - inicioDasBatalhas.get(batalha.id));
    }
    for (const [id, dono] of donos) {
      const agora = estado.provincias.get(id).dono;
      if (agora !== dono) {
        donos.set(id, agora);
        const faixa = Math.min(3, Math.floor(estado.dia / 90));
        conquistasPorFaixa[faixa] += 1;
      }
    }
    if (estado.dia % 60 === 0) {
      const naqueleDia = [...estado.nacoes.values()]
        .map((nacao) => ({ nome: nacao.nome, provincias: provinciasDaNacao(estado, nacao.id).length }))
        .sort((a, b) => b.provincias - a.provincias)[0];
      marcha.push(`d${estado.dia}: ${naqueleDia.nome} ${naqueleDia.provincias}`);
    }
  }

  const ranking = [...estado.nacoes.values()]
    .map((nacao) => ({ nome: nacao.nome, provincias: provinciasDaNacao(estado, nacao.id).length, eliminada: nacao.eliminada }))
    .sort((a, b) => b.provincias - a.provincias);

  return {
    semente,
    dia: estado.dia,
    motivo: estado.motivoDaVitoria ?? "prazo",
    lider: ranking[0],
    top3: ranking.slice(0, 3),
    eliminadas: ranking.filter((n) => n.eliminada).map((n) => n.nome),
    conquistas: conquistasPorFaixa.reduce((a, b) => a + b, 0),
    conquistasPorFaixa,
    batalhas,
    maiorDuracao,
    marcha,
    donosDistintos: new Set([...estado.provincias.values()].map((p) => p.dono)).size,
  };
}

for (let i = 1; i <= quantas; i += 1) {
  const r = resumoDaPartida(1941 + i);
  const fatia = (r.lider.provincias / TOTAL * 100).toFixed(1);
  console.log(`\n── semente ${r.semente} ─────────────────────────────────`);
  console.log(`  fim no dia ${r.dia} por ${r.motivo}`);
  console.log(`  lider: ${r.lider.nome} com ${r.lider.provincias} provincias (${fatia}% do mapa)`);
  console.log(`  top 3: ${r.top3.map((t) => `${t.nome} ${t.provincias}`).join(" · ")}`);
  console.log(`  eliminadas: ${r.eliminadas.join(", ") || "nenhuma"}`);
  console.log(`  conquistas: ${r.conquistas} (por faixa de 90 dias: ${r.conquistasPorFaixa.join(" / ")})`);
  console.log(`  evolução: ${r.marcha.join(" · ")}`);
  console.log(`  batalhas: ${r.batalhas} | duracao maxima: ${r.maiorDuracao} dias | donos vivos: ${r.donosDistintos}`);
}
