# Arquitetura

Este documento explica **como** o jogo é construído e **por que** cada peça está
onde está. Não é um manual de uso (esse está no `README.md`) nem um diário de
balanceamento. É a parte que interessa a quem quer entender ou modificar o
código.

---

## 1. A decisão que organiza todo o resto

O jogo é **autoritativo no servidor**.

O navegador recebe um *retrato* do mundo — nunca a verdade —, desenha esse
retrato e devolve *intenções* ("quero mover 4 infantarias da Renânia para
Flandres"). O servidor é quem decide se aquilo acontece.

```
   navegador                              servidor
   ─────────                              ────────
   desenha o retrato          ◀──────     projeta o estado (a cada 200 ms)
   lê o clique
   manda um comando           ──────▶     valida contra o estado oficial
                                          se ok  → muta o estado, responde "ok"
                                          se não → responde o motivo, NÃO muta
```

Três consequências práticas que valem a pena enunciar:

**(a) O cliente não contém nenhum número do jogo.** Ele não sabe quanto custa um
blindado. Quando o jogador clica numa província, o servidor manda junto o preço
já calculado (com o desconto do quartel aplicado), a lista de construções
possíveis, e o alcance exato de cada tipo de unidade. Mudar o preço do blindado
é editar uma linha em `simulation.mjs`; o cliente muda de comportamento sem ser
tocado.

**(b) Um cliente adulterado não ganha nada.** Ele pode pedir, mas não pode
decidir. O pior que consegue é mandar comandos rápido demais — e para isso
existe limite de frequência. Não há como fabricar recursos, teleportar tropas ou
ver províncias inimigas: o servidor simplesmente não envia o que é secreto.

**(c) Comando recusado não deixa marca.** O estado só é mutado depois de todas as
validações passarem. Isso é testado explicitamente: existe um teste que guarda
um retrato do estado, dispara dezesseis comandos inválidos de todos os tipos e
compara o estado antes e depois. Têm de ser idênticos.

Esse último ponto não é teórico. Ele foi escrito **depois** de um bug real: o
comando de mover tropas removia as unidades da província de origem e só então
checava se o caminho existia. Quando o caminho não existia, o comando era
recusado — mas as tropas já tinham sumido. O jogador via "não é possível chegar
lá" e perdia um exército.

---

## 2. Onde o estado mora (e por que isso encerra a outra conversa)

A conversa que deu origem a este projeto começou com a ideia de alterar o ouro
de um jogo online. A resposta foi não, e o motivo é exatamente o desenho deste
programa.

Naquele jogo, o dinheiro ficava no servidor. Modificar o cliente não daria ouro:
o servidor recusaria a compra, porque a decisão nunca esteve do lado de cá. Não
era uma questão de dificuldade técnica — era uma questão de **onde o estado
mora**.

Construir este jogo é a outra metade da mesma lição. Aqui dá para ver, no
código, por que o servidor decide tudo:

- **O dinheiro é uma variável do servidor.** `nacao.estoques.dinheiro` vive em
  `simulation.mjs`, na memória do processo. O navegador nunca escreve nela;
  apenas pede "quero construir um quartel", e o servidor debita.
- **O que o cliente vê é um recorte.** `projetarEstado()` monta um objeto novo a
  cada envio. Províncias de outras nações saem sem estoques, sem custos, sem
  alcance. Não há como vazar o que não é copiado.
- **A validação é uma função pura de decisão.** `executarComando()` devolve
  `{ok:true, evento}` ou `{ok:false, motivo}`. Não existe caminho em que ele
  devolva `ok:false` e tenha mexido no estado.

Quem guarda o estado, decide. Este projeto é essa frase escrita em código.

---

## 3. Os três arquivos do servidor

### `server/world.mjs` — o mapa

Gera, a partir de uma semente, o mundo inteiro: 216 províncias hexagonais,
12 nações, continentes, terreno, recursos e travessias marítimas.

**Hexágonos de topo reto** em coordenadas axiais, com `x = 1.5·q` e
`y = √3·(r + q/2)`. As seis direções são `(1,0) (1,-1) (0,-1) (-1,0) (-1,1) (0,1)`.
Um `Map` com chave `q,r` transforma "vizinho na direção 3" numa consulta O(1).

**O terreno não é sorteado por província.** Cada tipo tem uma regra geográfica:
montanha surge em faixas de colisão entre massas de terra, deserto por latitude,
floresta por interioridade, cidade no centro de gravidade de cada nação. É isso
que faz o mapa *parecer* um mapa em vez de um tabuleiro sortido.

**As nações são atribuídas por massa de terra, não por distância.** O primeiro
método — "a província pertence à semente mais próxima" — falhou de forma
interessante: Itália, Grécia, Egito e Turquia ficavam retalhados pelo Mar
Mediterrâneo, porque em linha reta a costa oposta estava mais perto do que o
próprio interior. A correção é um dicionário explícito de quais sementes podem
disputar cada massa. Os países mediterrâneos continuam com território em mais de
uma península, agora de propósito.

**As travessias marítimas** existem porque, sem elas, Reino Unido e Suécia
nasciam sem nenhum vizinho e não podiam fazer absolutamente nada durante 360
dias. A regra: para cada província costeira, considere as províncias do outro
lado do mar até uma certa distância; descarte o par se houver caminho terrestre
razoável (senão Portugal "atravessaria" até Marrocos quando a Espanha está no
meio); e mantenha a ligação apenas se **os dois lados** a escolherem entre as
suas melhores. A simetria é importante e tem teste: uma rota que só existe numa
direção geraria uma invasão sem contra-ataque possível.

### `server/simulation.mjs` — as regras

O coração. Um `Map` de províncias, um de nações, e funções que mutam esse estado.

**`avancarDia()`** executa cinco fases, sempre nesta ordem:

1. produção (a soma dos recursos de cada província, multiplicada pelo terreno);
2. consumo de alimento — e **deserção** quando o estoque zera;
3. progresso das filas de recrutamento;
4. combate: cada batalha ativa troca um dia de baixas;
5. inteligência artificial (a cada 3 dias, não todo dia).

**O combate** calcula dano em vidas, não em unidades: cada lado perde
`poder × constante × modificadores` pontos de vida por dia, e uma unidade morre
quando a vida acumulada passa do seu valor. Isso permite que uma batalha dure
3 a 5 dias sem que os números fiquem estranhos, e faz com que terreno,
fortificação e desembarque sejam multiplicadores simples.

**O cerco** é a mecânica que mais define o jogo. Enquanto uma província tem
batalha em andamento: ela não aceita reforço, o quartel não inicia recrutamento,
a fila em andamento congela, e o servidor nem sequer oferece essa província como
destino válido. Sem isso, o defensor bombeia tropas para dentro indefinidamente
e o cerco nunca termina — um defeito clássico do gênero, e o tipo de coisa que
só aparece quando se joga de verdade.

**A inteligência artificial** não é um script de ataques. Ela:

- avalia alvos por proporção de força **ponderada pela urgência** (se alguém
  está dominando o mapa, a IA fica mais agressiva contra o líder);
- declara guerra quando tem vantagem e ainda não está em guerras suficientes;
- escolhe um **ponto de esforço principal** — não ataca em todas as frentes ao
  mesmo tempo, distribui reforços por carência;
- reforça a retaguarda com 25% da guarnição de cada província segura;
- nunca ataca um jogador humano diretamente sem guerra declarada.

O primeiro esboço da IA era competente e produzia partidas chatas: as nações
trocavam as mesmas duas províncias durante 360 dias. O que faltava não era força
— era **iniciativa**. Foi aí que entraram o ponto de esforço principal e a
margem de ataque obrigatória.

### `server/index.mjs` — a porta

Servidor HTTP e WebSocket no mesmo processo, servindo `public/` e mantendo o
relógio do jogo (meio dia de jogo por segundo, com velocidades 0×/1×/2×/4×).

Três detalhes que são fáceis de errar e estão resolvidos aqui:

**Identidade tolerante a recarregamento.** O cliente gera um `jogadorId` e o
guarda no `localStorage`. Se a página recarregar, o mesmo `jogadorId` volta e o
jogador reencontra a sua nação em vez de virar espectador anônimo.

**Limite de frequência.** Um teto de comandos por segundo, para que o
autoritarismo do servidor não seja derrubado por força bruta.

**Caminho de arquivo sem escape.** Ver a seção 5, item 1 — foi um bug real.

---

## 4. O cliente: `public/jogo.js`

Desenha o retrato e colhe intenções. Três decisões de projeto:

**Canvas com transformação em vez de cálculo manual.** O mapa é desenhado em
coordenadas de mundo, com o `ctx.setTransform` cuidando de posição e zoom. Texto
e rótulos são desenhados depois, já em coordenadas de tela: assim a fonte fica
nítida em qualquer nível de zoom, e o código não precisa arredondar cada
coordenada.

**As fronteiras são arestas compartilhadas calculadas por geometria, não por
tabela de direções.** Entre dois hexágonos vizinhos, a aresta comum está na
mediadora entre os centros, tem comprimento igual ao raio e é perpendicular à
linha que liga os centros. Isso evita manter uma tabela de "qual aresta
corresponde a qual direção" — que é justamente o tipo de tabela que sai de
sincronia quando alguém mexe na geometria.

**Rótulos só a partir de certo zoom.** Abaixo de um limite, escondem-se os nomes
e ficam só as cores. Empilhar texto ilegível em cima de hexágonos pequenos deixa
o mapa pior, não mais informativo.

**O cliente não sabe quais são os destinos possíveis — ele pergunta.** O
servidor manda, para cada província do jogador, o alcance real unidade por
unidade. O destaque verde na tela é literalmente "o servidor já validou isto".

E existe um detalhe de usabilidade que só apareceu com o jogo rodando: o estado
chega 5 vezes por segundo, e a primeira versão do cliente redesenhava o painel
inteiro a cada quadro — o que apagava o que o jogador estava digitando no campo
de recrutamento. A correção guarda o foco e a posição do cursor antes de
redesenhar e os restaura depois.

---

## 5. Bugs que valem a pena contar

**1. O servidor respondia 403 em tudo.** A função que monta o caminho do arquivo
fazia `resolve(RAIZ, normalize("/index.html"))`. Em Node, um caminho que começa
com `/` é absoluto — então `normalize` devolvia `/index.html` e o `resolve`
descartava a pasta pública, procurando o arquivo na raiz do sistema. O jogo
inteiro respondia `403`. O teste de cliente pegou isso porque ele baixa a página
de verdade em vez de importar funções: nenhum teste de unidade teria visto.

**2. O defensor lutava com uma cópia.** A batalha guardava
`tropasDefensoras: { ...provincia.unidades }`. O atacante perdia soldados de
verdade; o defensor, nunca. Resultado: cercos eternos, partidas travadas. O
conserto é uma linha — guardar a referência viva, não a cópia — mas o sintoma
(dezenas de batalhas que nunca acabavam) não sugeria em nada a causa.

**3. `forcaTotal` multiplicava a força pelo número de províncias.** A soma das
batalhas estava dentro do laço das províncias. Com 45 províncias, cada batalha
era contada 45 vezes, e a IA achava que tinha exércitos enormes — declarando
guerras absurdas. Um teste de regressão de uma linha fixa o comportamento.

**4. As regras do jogo não eram as regras da tela.** O rótulo da fortificação,
o custo do quartel e a ocupação dos espaços estavam escritos à mão no cliente e
divergiram do motor. A correção foi estrutural: o servidor passou a mandar o
catálogo, e o cliente passou a só pintar.

**5. A campanha acabava antes de o jogador jogar.** A União Soviética começa com
45 das 214 províncias — um quinto do mapa. As outras nações ainda estavam
montando a primeira fábrica quando o teste de supremacia disparava: em cinco de
seis sementes a partida terminava entre os dias 73 e 166, sempre com a URSS em
mais de 40%. Vários ajustes foram tentados no lugar errado (limiar de domínio,
agressividade da IA, teto de ataques por turno) sem resolver o fundo do problema,
que era econômico: um quinto do mapa valendo o mesmo por província que as
metrópoles alemãs. A correção final foi **eficiência industrial por nação**
(`EFICIENCIA_NACIONAL`, exportada por `world.mjs`, multiplicada em
`calcularProducao`), com a URSS a 0,45 e a Alemanha a 1,18, mais um **piso de 240
dias** para a vitória por supremacia. O resultado está medido em
`tools/equilibrio.mjs`: uma semente de seis continua terminando por supremacia no
dia 240 e as outras cinco vão a armistício no dia 360, o que é uma campanha, não
um passeio.

**6. A IA construía fazendas em vez de exércitos.** `governarComIA` gastava o
dinheiro disponível assim que ele aparecia, e chegava ao dia 200 com 82
províncias, força 1018 e caixa 104. Passou a reservar um caixa de guerra (260 em
tempo de guerra, 90 em paz) antes de autorizar qualquer obra, e `recrutarComIA`
passou a preencher o quartel de **todas** as províncias com quartel, não só a
primeira. Força nacional no dia 200 de uma partida real: 2350.

---

## 6. Testes

`npm test` — 90 testes, sem navegador.

**Motor (63).** Gerados com `node:test`. Cobrem: determinismo da semente,
contiguidade de todo território, simetria dos vizinhos, toda nação capaz de
produzir todos os recursos (uma nação sem petróleo fica permanentemente incapaz
de formar blindados — isso já aconteceu), custos, os dezesseis comandos válidos
e inválidos, cerco, travessias marítimas, armistício, supremacia e um pacote de
invariantes depois de 300 dias simulados: nenhum estoque negativo, nenhuma
província sem dono, nenhuma nação eliminada continuando a controlar território.

**Cliente (23).** O servidor real sobe numa porta de teste, a página real é
baixada, e o cliente é executado **de verdade** dentro de um DOM (jsdom) com um
`WebSocket` de verdade. O teste então verifica que o cliente se conecta, desenha,
escolhe nação, responde a cliques, troca de aba, abre o manual — e que o clique
em "pausar" chega ao servidor. Há também um teste que falha se **qualquer** erro
de JavaScript escapar para o console da página.

**Dois navegadores na mesma partida (4).** Sobem duas conexões WebSocket na mesma
campanha e conferem o contrato da sala: ninguém assume uma nação já tomada, cada
jogador vê o outro como comandante no painel, um não move as tropas do outro, e a
queda de uma conexão não derruba a partida — a nação fica reservada por cinco
minutos e volta para quem reconectar.

Duas armadilhas do jsdom que custaram tempo e estão resolvidas: ele não executa
`<script type="module">` (o cliente é buscado por `fetch` e avaliado com `eval`),
e não implementa canvas, `ResizeObserver` nem `getBoundingClientRect` (os três
precisam de dublês antes de o cliente rodar).

---

## 7. Uma campanha, dois navegadores

O multiplayer não precisou de servidor novo: a decisão do item 1 já tinha posto
todo o estado (e todo o relógio) no processo Node. O que faltava era resolver
**de quem é cada nação**.

Cada conexão recebe um `jogadorId`; a primeira que pede uma nação livre vira dona
dela. A tabela de donos é o único lugar onde o servidor acredita em identidade —
em nenhum momento ele aceita "sou a Alemanha" vindo do cliente. O nome digitado
fica na sala, a nação escolhida aparece com o comandante ao lado para os outros
jogadores, e a partida é uma só: os dois navegadores recebem o **mesmo retrato do
mesmo mundo** a cada 200 ms.

Três detalhes que o desenho exigiu:

- **Reserva de cinco minutos.** Se a conexão cai, o comando não fica órfão nem é
  entregue na hora para outra pessoa: o nome fica em `ultimaConexao` e volta para
  quem reconectar com o mesmo `jogadorId` (guardado no `localStorage`) dentro da
  janela. Passado o prazo, a nação é liberada.
- **O relógio só anda quando alguém pode agir.** O `tick` roda apenas se existe
  um jogador humano no comando de alguma nação viva (`alguemNoComando()`).
  Servidor sem ninguém conectado não consome partida.
- **Sala, não lobby.** Entrar é escolher nação: a lista marca as tomadas, o
  painel mostra quem manda em quê, e reiniciar a campanha é um comando explícito
  que avisa todos os navegadores.

O teste correspondente sobe duas conexões de verdade e verifica as três coisas que
quebram na prática: roubo de nação, ordem de um jogador mexendo no exército do
outro, e queda de conexão derrubando a partida.

---

## 8. Mapa de arquivos

```
server/world.mjs        geração do mapa, terreno, nações, travessias marítimas
server/simulation.mjs   regras: economia, exército, combate, cerco, IA, vitória
server/index.mjs        HTTP + WebSocket + relógio + salas + limite de frequência
public/index.html       estrutura da interface
public/estilo.css       identidade visual (sala de guerra + papel de estado-maior)
public/jogo.js          desenho do mapa e interação
tests/motor.test.mjs        63 testes de regras
tests/cliente.test.mjs      23 testes de integração com navegador simulado
tests/multiplayer.test.mjs   4 testes com dois jogadores na mesma campanha
tools/equilibrio.mjs        simula campanhas inteiras e imprime o resultado
tools/partida-de-teste.mjs  joga uma partida real por WebSocket, sem navegador
tools/previa-mapa.mjs       gera uma imagem do mapa sem abrir o navegador
previas/                    imagens geradas por essa ferramenta
```
