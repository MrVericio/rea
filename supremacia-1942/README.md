# Supremacia 1942

Jogo de grande estratégia ambientado numa Segunda Guerra ficcional, feito para
ser jogado **no navegador, sem instalar nada**. Você comanda uma de doze nações
numa Europa dividida: administra economia, pesquisa, política interna e
diplomacia, faz guerra por terra e por mar, e tem 360 dias para alcançar a
supremacia. **Duas pessoas podem jogar a mesma campanha, cada uma no seu
navegador.**

Tudo aqui é original: o mapa, os nomes, as cores, as unidades, as regras e o
código. Nada foi copiado de jogo nenhum.

![Mapa no início da campanha](previas/mapa-dia-000.png)

---

## Como rodar

```bash
npm install
npm start          # sobe em http://localhost:3000
```

Abre no navegador e pronto. Não há passo de compilação: o cliente é JavaScript
puro servido pelo próprio servidor.

```bash
npm test           # 90 testes: motor, cliente e dois navegadores na mesma partida
npm run dev        # reinicia sozinho a cada alteração
npm run equilibrio # simula campanhas inteiras e imprime o que aconteceu com o mapa
```

Para jogar com outra pessoa, basta abrir o mesmo endereço no navegador dela: quem
estiver na sua rede usa `http://SEU-IP:3000`. Cada um escolhe o nome e uma nação
ainda livre — a partida é uma só, e o comando de cada nação pertence a quem
escolheu primeiro (com cinco minutos de reserva se a conexão cair).

---

## Como se joga

**Escolha uma nação.** As potências continentais (URSS, Suécia, Turquia,
Polônia, Itália, Egito) começam grandes e perdoam erros. As médias (Alemanha,
França, Reino Unido, Grécia) exigem atenção. Espanha e Portugal são o desafio:
pouco território, vizinhos apertados — mas crescem rápido quem se expandir.

**O tempo corre sozinho.** Um dia de jogo a cada dois segundos. Use
<kbd>Espaço</kbd> para pausar, <kbd>+</kbd>/<kbd>−</kbd> para acelerar até 4×, ou
o botão **+1 dia** para jogar turno a turno. Aperte <kbd>H</kbd> para abrir o
manual dentro do jogo.

**Clique numa província sua** para dar ordens:

- **Construir** — cada província tem espaço limitado. Fazenda dá alimento,
  siderúrgica dá aço, poço dá petróleo, mina dá carvão, centro comercial dá
  dinheiro, quartel libera o recrutamento, e fortificação aumenta a defesa.
  O terreno multiplica a produção: petróleo rende muito no deserto, aço nas
  montanhas, dinheiro nas metrópoles.
- **Recrutar** — precisa de um quartel. Quanto maior o quartel, maior a fila,
  menor o preço e mais rápida a formatura.
- **Mobilizar** — escolha quantas unidades vão, clique em *Escolher destino* e
  depois na província destacada: verde é marcha, vermelho é ataque, azul é
  travessia marítima.

**O jogo termina sempre, de uma de três formas:** aniquilação (ficar sozinho no
mapa), supremacia (passar de 40% das províncias, a partir do dia 240) ou
armistício — quando o prazo acaba e vence quem tiver mais território. O piso de
240 dias existe porque a União Soviética entra na campanha com um quinto do mapa:
sem ele a partida se decidia antes de qualquer jogador conseguir jogar.

**Governo.** Na aba *Nação* ficam o moral do povo, as doutrinas e a árvore de
pesquisa. O moral cai a cada dia de guerra e com cada província perdida, e sobe
com conquistas e propaganda; no chão, a produção e o combate desabam. Cada
doutrina adotada troca um efeito permanente por um custo diário de moral, e só
três podem valer ao mesmo tempo.

**Diplomacia.** Relações de −100 a +100 abrem pactos de não-agressão e
alianças — e aliança é **acesso militar**: suas tropas atravessam o território
aliado, mas não podem ocupá-lo. Ajuda econômica compra amizade, romper a palavra
custa moral e reputação, e quem passa de um quarto do mapa vê o mundo inteiro se
aproximar contra si.

### Eficiência industrial

Cada nação tira um tanto diferente de cada província: a Alemanha rende 18% acima
do normal por província, a União Soviética 55% abaixo. É o que impede a maior
nação do mapa de vencer sozinha por volta do dia 150 — território enorme com
indústria atrasada contra pouco território com a melhor fábrica da Europa. O
multiplicador de cada país aparece na tela de escolha da nação.

### O que o jogo não faz

Não existe pagamento, anúncio, conta ou servidor de terceiros. O servidor roda
na sua máquina e o mundo é gerado por semente — tudo o que acontece numa partida
é reproduzível a partir dela.

---

## Regras que dão identidade ao jogo

Estas quatro mecânicas são o que separa *Supremacia 1942* de um clone genérico
de estratégia por turnos:

**1. Logística é o teto do exército.** Cada unidade consome alimento todo dia.
Um império que recruta sem construir fazendas vê as tropas desertarem. Não há
como empilhar um exército infinito: ou a economia acompanha, ou as unidades
somem.

**2. Cerco corta o suprimento.** Enquanto uma província está em batalha ela
**não recebe reforço** e o **quartel não consegue recrutar** — a fila de
treinamento congela. Isso resolve o defeito clássico de jogos do gênero, em que
o defensor bombeia tropas para dentro da batalha e o cerco nunca acaba. Aqui,
quem é cercado precisa reagir fora ou perder a província.

**3. Defesa leva vantagem — e leva a sério.** Montanha, metrópole e floresta
multiplicam a defesa, e cada nível de fortificação soma +12%. Atacar exige
superioridade real. A IA só ataca com margem e o jogador aprende rápido que
números parecidos não bastam.

**4. Operação anfíbia.** Potências insulares não ficam presas na ilha: onde o
mar é o caminho mais curto, aparece uma rota azul pontilhada. Atravessar o mar
**consome o movimento inteiro do dia** e quem desembarca luta com a defesa
inimiga valendo 25% a mais. Assim, o Reino Unido tem a Mancha para invadir a
França, e a Suécia alcança o continente pelo Skagerrak.

---

## Arquitetura: por que o servidor decide tudo

O jogo é **autoritativo no servidor**. Isso não é detalhe de implementação: é a
decisão que define o projeto.

```
navegador  ──comando──▶  servidor  ──valida──▶  estado oficial
    ▲                        │
    └────── retrato ─────────┘   (o cliente só desenha; nunca calcula)
```

- `server/world.mjs` — gera o mapa: hexágonos, continentes, terreno, nações,
  províncias, travessias marítimas. Determinístico por semente.
- `server/simulation.mjs` — o motor de regras: produção, consumo, recrutamento,
  combate, cerco, conquista, diplomacia, inteligência artificial e vitória.
- `server/index.mjs` — serve os arquivos, mantém o relógio e conversa por
  WebSocket.
- `public/jogo.js` — desenha o que o servidor mandou, coleta cliques e envia
  comandos. **Não contém nenhum número do jogo.**

### O cliente não sabe quanto custa um blindado

Isso é literal. Quando o jogador seleciona uma província, o servidor envia o
catálogo inteiro junto do estado: preços já com o desconto do quartel, a lista
de construções possíveis, o alcance exato de cada tipo de unidade e o bônus de
desembarque. O cliente só pinta.

A consequência prática: **um cliente modificado não consegue trapacear**. O pior
que ele pode fazer é mandar comandos demais — e para isso existe limite de
frequência. Toda recusa vem com um motivo em português, que o jogador lê na
tela ("Essa província precisa de um Quartel para recrutar.", "Renânia está sob
cerco: não é possível reforçar até a batalha terminar.").

E existe uma garantia que vale a pena citar porque é fácil de quebrar sem
perceber: **um comando recusado não altera absolutamente nada no estado**. Há um
teste dedicado a isso (`nenhum comando recusado deixa marca no estado`), escrito
depois de um bug real em que as tropas sumiam da origem antes de a validação
terminar.

### Por que isso importa (e a ligação com o pedido original)

A conversa que originou este projeto começou com uma ideia de modificar o ouro
de um jogo online. A resposta foi não — e o motivo é exatamente o que este
código demonstra.

Naquele jogo, o dinheiro ficava no servidor. Mexer no cliente não daria ouro;
no máximo, faria o servidor recusar a partida. Não era uma questão de
dificuldade, era de onde o estado mora. **Quem guarda o estado, decide.** Este
projeto existe para mostrar o outro lado da mesma moeda: construindo o jogo, é
possível ver *por que* o servidor decide tudo — e por que isso é o que mantém a
partida honesta.

---

## Qualidade: o que os testes cobrem

`npm test` roda 90 testes, sem precisar de navegador.

**Motor (63 testes)** — geração determinística, territórios contíguos, simetria
dos vizinhos, economia (toda nação consegue produzir todos os recursos), custos,
validação de cada comando, cerco, travessias marítimas, pesquisa, doutrinas,
moral, pactos e alianças, os três finais de partida, e uma bateria de invariantes
depois de centenas de dias de simulação: estoques nunca negativos, nenhuma
província sem dono, ninguém eliminado continuando a controlar território.

**Cliente (23 testes)** — o servidor real sobe, a página real é carregada num DOM
(jsdom), o cliente é executado de verdade e o teste verifica que ele se conecta,
desenha o mapa, escolhe nação, responde a cliques, troca de aba, abre o manual —
e que **um clique em "pausar" chega de fato ao servidor**.

**Dois navegadores na mesma partida (4 testes)** — sobem duas conexões WebSocket
na mesma campanha e conferem que ninguém entra numa nação já tomada, que o
segundo jogador vê o primeiro como comandante, que um não move as tropas do
outro e que a queda de um não derruba a partida.

Dois bugs que só apareceram porque o teste carrega a página real:

1. `resolve()` trata `/index.html` como caminho absoluto do sistema e descartava
   a pasta pública — o servidor respondia **403 em tudo**. A prévia mostraria
   apenas "403".
2. `forcaTotal` somava as batalhas *dentro* do laço das províncias, multiplicando
   a força pelo número de províncias conquistadas. A IA ficava com números
   absurdos e declarava guerras sem sentido.

---

## Ferramentas

```bash
node tools/previa-mapa.mjs 200 1942 previas/meio-da-campanha.svg
```

Gera uma imagem do mapa sem abrir o navegador, usando a mesma geometria e a
mesma paleta do cliente. Serve para conferir o desenho e para documentar uma
campanha. As imagens em `previas/` foram feitas com ela.

---

## O mapa

216 províncias hexagonais, 12 nações, seis massas de terra desenhadas à mão
(Ibéria, França, Europa central, Escandinávia, Leste europeu, Rússia, Balcãs,
Itália, Anatólia, Levante, Norte da África, Egito) mais as ilhas Britânicas.
O litoral, as montanhas, os desertos e as metrópoles são gerados por semente:
a mesma semente sempre produz exatamente o mesmo mundo.

![Campanha concluída](previas/mapa-final.png)

*Uma campanha completa, só com inteligência artificial: a Turquia terminou com
56 províncias depois de invadir as Ilhas Britânicas e a Escandinávia por mar,
enquanto seis nações desapareceram do mapa.*

---

## Requisitos

Node.js 20 ou mais novo. Uma dependência de execução (`ws`) e uma de
desenvolvimento (`jsdom`, só para os testes).
