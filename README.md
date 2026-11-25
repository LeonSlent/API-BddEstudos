# API e banco de dados: estudos para concursos de TI

Este repositório é **somente a camada de dados**: a **API (Node + Express)** conectada ao **MongoDB Atlas** e o **schema do banco local (SQLite)**. **Não há aplicativo, telas nem interface aqui.**

Ele nasceu do levantamento de requisitos de um aplicativo de celular que ajuda a estudar para concursos de TI com **cronogramas dinâmicos** baseados em **repetição espaçada (SRS)**. O aplicativo (React Native) é um **projeto à parte**, que vai usar esta API e o schema do SQLite. Os requisitos que dependem de tela ou de lógica do cliente aparecem marcados na [seção 10](#10-cobertura-dos-requisitos).

> Projeto de estudo. As questões, os concursos e os usuários que aparecem nos scripts de teste são inventados.

---

## Sumário

1. [Visão geral da arquitetura](#1-visão-geral-da-arquitetura)
2. [Estrutura de pastas](#2-estrutura-de-pastas)
3. [Como rodar do zero (Windows)](#3-como-rodar-do-zero-windows)
4. [Banco local: SQLite](#4-banco-local-sqlite)
5. [Banco do servidor: MongoDB Atlas](#5-banco-do-servidor-mongodb-atlas)
6. [A API, rota por rota](#6-a-api-rota-por-rota)
7. [Como funciona a sincronização offline](#7-como-funciona-a-sincronização-offline)
8. [Segurança](#8-segurança)
9. [Testes](#9-testes)
10. [Cobertura dos requisitos](#10-cobertura-dos-requisitos)
11. [Problemas comuns e soluções](#11-problemas-comuns-e-soluções)
12. [O que falta fazer](#12-o-que-falta-fazer)
13. [Convenções e decisões de projeto](#13-convenções-e-decisões-de-projeto)

---

## 1. Visão geral da arquitetura

```
 ┌──────────────────────────┐                      ┌───────────────────────────┐
 │  Cliente (app)           │                      │  Servidor                 │
 │                          │   HTTPS + token JWT  │                           │
 │  SQLite (14 tabelas)     │ ───────────────────► │  API Node + Express       │
 │  • funciona offline      │   POST /sync (envia) │  • valida tudo            │
 │  • fila de sincronização │ ◄─────────────────── │  • autentica              │
 │  • exibição do plano      │   GET /sync (baixa)  │         │                 │
 └──────────────────────────┘                      │         ▼                 │
                                                   │  MongoDB Atlas (7 coleções)│
                                                   └───────────────────────────┘
```

**Ideia central:** o cliente (o futuro app) precisa funcionar mesmo **sem internet** (requisito RNF04). Por isso a modelagem prevê:

- O **celular** guarda tudo o que o estudo precisa em um banco **SQLite** local: trilhas, matérias, questões, cronograma, respostas.
- O **servidor** (API + MongoDB Atlas) é a cópia central. Ele guarda os dados do usuário para que ele possa trocar de aparelho, e distribui o catálogo (questões, concursos).
- Tudo que o usuário faz offline entra numa **fila de sincronização** no celular. Quando a internet volta, o app **envia** a fila e **baixa** as novidades.
- A API corrige a alternativa recebida, calcula a revisão por questão e gera os ciclos. O app exibe os resultados após sincronizar.

### Divisão de responsabilidades (cliente × API)

| Tarefa | Onde fica |
|---|---|
| Gerar o cronograma em ciclo (RF06) | API |
| Calcular a próxima revisão de uma questão (RF07) | API |
| Corrigir a alternativa escolhida | API ao salvar, app ao revelar o gabarito |
| Agendar as notificações (RF10) | Cliente (app) |
| Guardar e validar os dados | API |
| Criar conta, login, trocar senha, excluir conta | API |
| Distribuir o catálogo (trilhas, questões, concursos) | API |

O **cliente** é o aplicativo, que **não faz parte deste repositório**. As linhas marcadas como cliente são o contrato: o que a API espera que quem a consome faça.

---

## 2. Estrutura de pastas

```
estudos-app/
├── README.md                  ← este arquivo
├── schema_final.sql           ← estrutura do banco SQLite (a "planta")
├── estudos.db                 ← banco SQLite de testes (NÃO vai para o Git)
└── api/
    ├── server.js              ← liga o servidor e monta as rotas
    ├── db.js                  ← conexão com o MongoDB Atlas
    ├── package.json
    ├── .env                   ← segredos (NÃO vai para o Git)
    ├── .gitignore
    ├── models/                ← estrutura e regras de cada coleção do MongoDB
    │   ├── Trilha.js          ← trilhas, com matérias e temas embutidos
    │   ├── Questao.js
    │   ├── Usuario.js
    │   ├── Cronograma.js      ← com etapas e pesos embutidos
    │   ├── Tentativa.js       ← cada resposta a uma questão
    │   ├── Feedback.js
    │   └── Concurso.js
    ├── routes/                ← os endereços da API
    │   ├── catalogo.js        ← GET /catalogo/...
    │   ├── auth.js            ← POST /auth/cadastro, /auth/login, GET /auth/eu
    │   ├── conta.js           ← GET/PATCH /conta, POST /conta/excluir
    │   └── sync.js            ← POST /sync e GET /sync
    ├── middleware/
    │   ├── auth.js            ← confere o token em rotas protegidas
    │   └── limites.js         ← limite de tentativas (login, cadastro, conta)
    ├── lib/
    │   ├── usuario-comum.js   ← gerar token, formato do perfil, regra da senha
    │   ├── sync-comum.js      ← funções e erros usados pelo /sync
    │   └── sync-cronograma.js ← sincronização de cronograma, pesos e etapas
    └── scripts/               ← dados de exemplo e testes automáticos
        ├── seed-*.js          ← preenchem o Atlas com dados de teste
        ├── testar-*.js        ← testes automáticos
        └── util-teste.js      ← função de apoio dos testes
```

### `estudos.db` × `schema_final.sql`

- O **`estudos.db`** é um banco **pronto, com dados** dentro (binário, só o SQLite lê). Serve para testar. Não vai para o Git.
- O **`schema_final.sql`** é um arquivo de **texto** com os comandos `CREATE TABLE`: a "planta" do banco, sem dados. **É a fonte da verdade** da estrutura. Vai para o Git.
- Do `.sql` você constrói quantos bancos vazios quiser. O app, na primeira abertura, vai executá-lo para criar o banco do celular.

---

## 3. Como rodar do zero (Windows)

Os comandos abaixo são para o **PowerShell**.

### 3.1 Instalar as ferramentas

```powershell
winget install OpenJS.NodeJS.LTS
winget install SQLite.SQLite
```

Depois **feche o VS Code por completo e abra de novo**. O Windows só atualiza a lista de programas em janelas novas. Confira:

```powershell
node --version
npm --version
sqlite3 --version
```

Se o `npm` reclamar que "a execução de scripts foi desabilitada", libere para o seu usuário:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### 3.2 Criar o banco SQLite (opcional, para estudar a estrutura)

Na pasta `estudos-app`:

```powershell
sqlite3 estudos.db
```

Dentro do SQLite (comandos com ponto **começam na primeira coluna**, sem espaço antes):

```
.read schema_final.sql
.tables
```

Devem aparecer as 14 tabelas. Para sair: `.quit`.

### 3.3 Criar o MongoDB Atlas

1. Crie uma conta em **cloud.mongodb.com**.
2. Crie um cluster gratuito (**M0**).
3. Em **Security > Database Access**, crie um usuário do banco. Use senha **só com letras e números** (símbolos como `@ : / #` quebram a string de conexão).
4. Em **Security > Network Access**, libere o seu IP. Para desenvolvimento em grupo é comum liberar `0.0.0.0/0` (qualquer IP), mas isso só vale para estudo. Veja [Segurança](#8-segurança).
5. Em **Connect > Drivers > Node.js**, copie a string de conexão e troque `<db_password>` pela senha.

### 3.4 Configurar a API

```powershell
cd api
npm install
```

Crie o arquivo `api/.env` (nunca vai para o Git):

```
MONGODB_URI=mongodb+srv://USUARIO:SENHA@SEU-CLUSTER.mongodb.net/estudos?retryWrites=true&w=majority
JWT_SECRET=um-texto-aleatorio-com-pelo-menos-32-caracteres
LIMITE_LOGIN=1000
LIMITE_CADASTRO=1000
LIMITE_CONTA=1000
```

- Note o `/estudos` antes do `?` na `MONGODB_URI`: é o **nome do banco**. Sem ele, o Atlas usa um banco chamado `test`.
- Para gerar uma `JWT_SECRET` aleatória:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

- As três variáveis `LIMITE_...` com valor 1000 existem **só para desenvolvimento**, para os scripts de teste não esbarrarem no limite de tentativas. **Apague-as antes de publicar**, e valerão os padrões (10 logins a cada 15 minutos, 10 cadastros por hora, 10 operações de conta a cada 15 minutos).
- **Salve o arquivo** antes de rodar. O Node lê o que está no disco, não o que está na tela.

### 3.5 Testar a conexão e preencher o banco com dados de exemplo

Sempre de dentro da pasta `api`:

```powershell
node scripts/testar-conexao.js
node scripts/seed-trilhas.js
node scripts/seed-questoes.js
node scripts/seed-usuarios.js
node scripts/seed-cronogramas.js
node scripts/seed-tentativas.js
node scripts/seed-feedbacks-concursos.js
```

**A ordem importa**: as questões dependem das trilhas, os cronogramas dependem dos usuários e das trilhas, e assim por diante. O usuário de exemplo é `ana@email.com`, com a senha `senha-de-teste-123`.

> Os seeds **apagam** a coleção inteira antes de inserir (`deleteMany({})`). Nunca rode contra um banco com dados reais.

### 3.6 Subir a API

```powershell
npm start
```

Deve aparecer `API rodando em http://localhost:3000`. Teste em **http://localhost:3000/saude**.

> **Atenção com o `npm run dev`** (reinício automático): o `node --watch` observa também a pasta `node_modules` e, no Windows, pode reiniciar o servidor no meio da primeira requisição com corpo JSON, o que faz os testes falharem com `fetch failed`. Se usar o `dev`, restrinja o que ele observa com `--watch-path` para as suas pastas de código (`routes`, `models`, `middleware`, `lib`) e os arquivos `server.js` e `db.js`. Na dúvida, use `npm start` e reinicie à mão (`Ctrl+C` e `npm start`) depois de editar.

### Acesso direto pelo front-end (CORS)

A API permite requisições do Expo Web diretamente na porta 3000. Não é necessário iniciar o proxy do front-end. O middleware CORS roda antes do JSON e da autenticação, responde ao preflight `OPTIONS` e permite `GET`, `POST` e `PATCH`, com os cabeçalhos `Content-Type` e `Authorization`.

Configure as origens permitidas no `api/.env`:

```dotenv
CORS_ORIGINS=http://localhost:8081,http://127.0.0.1:8081,http://localhost:19006,http://127.0.0.1:19006
```

Essa é também a lista padrão quando a variável não existe. Uma lista configurada substitui os padrões; uma lista vazia não permite origens de navegador. Inclua a porta efetivamente usada pelo Expo (por exemplo `http://localhost:8082`) ou o IP da rede, quando necessário. Em produção, use a origem HTTPS do seu site. Reinicie a API após alterar o `.env`.

No `.env` do front-end, use `EXPO_PUBLIC_API_URL=http://localhost:3000` e reinicie o Expo. Aplicativos nativos e clientes de terminal sem `Origin` continuam funcionando. A autenticação JWT permanece obrigatória nas rotas protegidas.

Para verificar as regras CORS sem acessar o banco nem abrir portas: `npm run test:cors`, dentro de `api`.

### 3.7 Regra de ouro dos terminais

Todo comando do projeto (`npm`, `node scripts/...`) roda **de dentro da pasta `api`**. Confira o prompt: `PS C:\...\estudos-app\api>`.

---

## 4. Banco local: SQLite

O `schema_final.sql` é fornecido aqui **para o cliente usar** no celular. A API **não acessa** o SQLite: ela só fala com o MongoDB Atlas, e o desenho do SQLite espelha o que a API recebe e devolve.

O arquivo cria **14 tabelas**, em três grupos.

### 4.1 Catálogo (o app baixa do servidor e só lê)

| Tabela | Para que serve | Regras |
|---|---|---|
| `trilha` | Trilhas de estudo (Desenvolvimento, Redes, Dados, Segurança, Governança) | nome único |
| `materia` | Matérias de uma trilha | nome único dentro da trilha |
| `tema` | Temas de uma matéria | nome único dentro da matéria |
| `questao` | Questões de provas | gabarito só A–E; alternativas em JSON válido; ano de 1990 a 2100; guarda `banca` e `fonte_url` (RNF03) |
| `concurso` | Concursos em andamento (RF11) | salário vazio ou positivo; data de fim do edital válida |
| `concurso_trilha` | Liga concurso e trilha (muitos-para-muitos) | chave composta |

### 4.2 Dados do usuário (criados no celular, sincronizados)

| Tabela | Para que serve | Regras |
|---|---|---|
| `usuario` | Perfil (**sem a senha**) | e-mail único sem diferenciar maiúsculas, formato validado; provedor `email` ou `google` |
| `cronograma` | Cronograma de uma trilha | **só um ativo por usuário** (índice parcial); trocar de trilha cria outro (RF08) |
| `peso_materia` | Peso de cada matéria no cronograma (RF06) | chave composta; peso > 0 |
| `etapa_estudo` | Uma sessão de estudo (RF12, RF13) | duração de 1 a 120 minutos (RNF02); concluída ⇔ tem data de conclusão |
| `tentativa_exercicio` | Cada resposta do usuário + estado da repetição espaçada (RF07, RF09) | dificuldade 1–5; fator de facilidade ≥ 1,3; um registro novo por resposta |
| `feedback` | Erros e sugestões (RF16) | tipo `erro` ou `sugestao`; texto de 1 a 2000 caracteres |
| `notificacao` | Lembretes agendados (RF10) | **só no celular**, não sincroniza |

### 4.3 Sincronização

| Tabela | Para que serve |
|---|---|
| `fila_sincronizacao` | Tudo o que o usuário fez offline, em ordem (`id` crescente). Guarda entidade, operação, o conteúdo em JSON, o número de tentativas de envio e o último erro. |

### 4.4 Cuidados ao usar o SQLite

- **Ligue as chaves estrangeiras a cada conexão**: `PRAGMA foreign_keys = ON;`. O SQLite vem com elas desligadas; sem isso ele aceita, por exemplo, uma matéria ligada a uma trilha que não existe. O `schema_final.sql` já traz o comando no começo, mas no app ele precisa estar no código de conexão.
- **`atualizado_em` não muda sozinho** em um `UPDATE`. O app precisa atualizar a coluna a cada alteração.
- **O SQLite não confere** se a matéria de um peso ou de uma etapa pertence à trilha do cronograma, nem se o campo `acertou` bate com o gabarito. Essas regras ficam no código do app (a API confere de novo).
- **Datas** em texto ISO 8601 em UTC (`2026-11-08T00:29:55Z`). O `Z` indica UTC; no Brasil isso é 3 horas à frente do relógio local. O app converte para o horário local só na hora de mostrar.

### 4.5 Consultas úteis (já testadas)

**O que revisar hoje** (a data que vale é a da tentativa mais recente de cada questão):

```sql
SELECT t.questao_id, t.proxima_revisao
FROM tentativa_exercicio t
WHERE t.usuario_id = 'user-1'
  AND t.proxima_revisao <= '2026-11-12'
  AND t.respondida_em = (
        SELECT MAX(t2.respondida_em)
        FROM tentativa_exercicio t2
        WHERE t2.usuario_id = t.usuario_id
          AND t2.questao_id = t.questao_id
      );
```

**Desempenho por tema** (dashboard, RF14):

```sql
SELECT te.nome AS tema,
       COUNT(*) AS respostas,
       SUM(t.acertou) AS acertos,
       ROUND(100.0 * SUM(t.acertou) / COUNT(*), 1) AS percentual_acerto
FROM tentativa_exercicio t
JOIN questao q ON q.id = t.questao_id
JOIN tema te   ON te.id = q.tema_id
WHERE t.usuario_id = 'user-1'
GROUP BY te.id;
```

**Horas estudadas por matéria** (dashboard, RF14):

```sql
SELECT m.nome AS materia, ROUND(SUM(e.duracao_min) / 60.0, 1) AS horas
FROM etapa_estudo e
JOIN materia m ON m.id = e.materia_id
WHERE e.concluida = 1
GROUP BY m.id;
```

---

## 5. Banco do servidor: MongoDB Atlas

O banco se chama `estudos` e tem **7 coleções**. Cada uma tem um *model* em `api/models/` com as regras de validação (o equivalente aos `CHECK` do SQLite).

| Coleção | Model | Observações |
|---|---|---|
| `trilhas` | `Trilha` | **Matérias e temas ficam embutidos** no documento da trilha, porque sempre são lidos juntos |
| `questoes` | `Questao` | `alternativas` é uma lista de verdade (2 a 5 itens); o gabarito precisa apontar para uma alternativa que existe |
| `usuarios` | `Usuario` | Guarda `senhaHash` (nunca a senha), `versaoToken` e os campos de recuperação de senha. `senhaHash`, `resetToken` e `resetTokenExpira` **não vêm em consultas normais** (`select: false`) |
| `cronogramas` | `Cronograma` | **Etapas e pesos embutidos**. Índice parcial: um cronograma ativo por usuário |
| `tentativas` | `Tentativa` | Coleção própria, porque cresce sem parar. Cada resposta é um documento novo |
| `feedbacks` | `Feedback` | |
| `concursos` | `Concurso` | `trilhaIds` é uma lista (substitui a tabela de ligação do SQLite). Exige pelo menos uma trilha |

`notificacao` e `fila_sincronizacao` **não existem** no Atlas: ficam só no celular.

### SQLite × MongoDB: o que muda

| Assunto | SQLite | MongoDB |
|---|---|---|
| Relações | Chave estrangeira, o banco confere | **Não existe.** O código confere (por exemplo, o `pre('validate')` do `Cronograma` consulta se a trilha existe) |
| Apagar em cascata | `ON DELETE CASCADE` | **Não existe.** A rota de excluir conta apaga na mão |
| Listas | Tabela de ligação ou JSON em texto | Listas de verdade dentro do documento |
| Dados que sempre andam juntos | Tabelas separadas | Embutidos (matérias dentro da trilha, etapas dentro do cronograma) |
| Regras | `CHECK`, `UNIQUE`, `NOT NULL` | Validações do Mongoose + índices |
| `atualizado_em` | Manual | `updatedAt` automático (mais o `atualizadoEm` do app, usado na sincronização) |
| Atualizações em massa | `UPDATE` sempre respeita as regras | `updateOne`/`updateMany` **pulam as validações**. Use `findById` + `save()` quando a regra importar |

Os ids são **textos (UUID)** nos dois bancos, para um registro criado offline no celular nunca colidir com o servidor.

---

## 6. A API, rota por rota

Endereço local: `http://localhost:3000`. Todas as respostas são JSON.

### Códigos de resposta usados

| Código | Significado |
|---|---|
| 200 | Deu certo |
| 201 | Criado (cadastro) |
| 400 | Pedido inválido (campo faltando, formato errado) |
| 401 | Não autenticado (sem token, token inválido, expirado ou conta apagada) |
| 403 | Autenticado, mas a ação foi negada (senha atual errada) |
| 404 | Rota não encontrada |
| 409 | Conflito (e-mail já cadastrado) |
| 429 | Tentativas demais, aguarde (o cabeçalho `Retry-After` diz quantos segundos) |
| 500 | Erro interno (o detalhe vai só para o terminal do servidor) |

### 6.1 Saúde

| | |
|---|---|
| `GET /saude` | Confirma que o servidor e o banco estão de pé. Resposta: `{"status":"ok","banco":"estudos","conectado":true}` |

### 6.2 Catálogo (abertas, somente leitura)

| Rota | Parâmetros | Resposta |
|---|---|---|
| `GET /catalogo/trilhas` | — | Todas as trilhas, em ordem alfabética, com matérias e temas dentro |
| `GET /catalogo/questoes` | `trilhaId` (**obrigatório**); `desde` (data ISO: só o que mudou depois); `pagina`; `limite` (padrão 200, máximo 500) | Questões da trilha, **com o gabarito** (o app precisa dele para corrigir offline) |
| `GET /catalogo/concursos` | `trilhaId` (opcional) | Concursos com edital ainda aberto, do que fecha primeiro para o que fecha depois |

Exemplo: `http://localhost:3000/catalogo/questoes?trilhaId=trilha-dev&desde=2026-11-01T00:00:00Z`

### 6.3 Autenticação

Fluxo: o app envia e-mail e senha → a API devolve um **token JWT** → o app guarda o token (no celular, em armazenamento seguro, **não** no SQLite comum) e o manda em toda chamada protegida:

```
Authorization: Bearer <token>
```

O token vale 30 dias (pensado para uso offline) e é invalidado se o usuário trocar a senha.

| Rota | Corpo | Resposta |
|---|---|---|
| `POST /auth/cadastro` | `nome`, `email`, `senha`, `trilha_id` e `deslocamento_utc_min` opcional | `201` com `{ token, usuario }`. A conta e o primeiro ciclo são criados juntos. A trilha precisa ter matérias. Cada matéria começa com peso 1, inclusive ao iniciar outra trilha. E-mail repetido dá `409`. |
| `POST /auth/login` | `{ "email", "senha" }` | `200` com `{ token, usuario }`. Erro dá sempre a mesma mensagem (`401`), seja e-mail inexistente, senha errada ou conta do Google |
| `GET /auth/eu` | — (token) | O perfil de quem está logado |

O `id` do usuário é gerado **pelo servidor** no cadastro (criar conta exige internet). O app grava esse id na tabela `usuario` do SQLite.

### 6.4 Conta (exige login)

| Rota | Corpo | O que faz |
|---|---|---|
| `GET /conta` | — | Consulta os dados da conta (RF03) |
| `PATCH /conta` | `{ "nome"?, "email"?, "novaSenha"?, "senhaAtual"? }` | Edita a conta (RF02). **Trocar e-mail ou senha exige a `senhaAtual`**. Senha errada dá `403` (e não `401`, para o app não achar que a sessão caiu). Trocar a senha derruba as outras sessões e devolve um token novo |
| `POST /conta/excluir` | `{ "confirmacao": "EXCLUIR", "senha"? }` | Exclui a conta (RF04) e **tudo** o que é do usuário: cronogramas (com etapas e pesos), tentativas e feedbacks. Contas com senha precisam informá-la |

- Contas do Google só podem trocar o **nome**.
- A exclusão é `POST` (e não `DELETE`) porque alguns clientes HTTP descartam o corpo do `DELETE`.

### Planejamento de estudos (exige login)

| Rota | Entrada e resultado |
|---|---|
| `POST /estudo/ciclos` | Recebe `id`, `trilha_id` e `deslocamento_utc_min`. Retorna `{ cronograma }` com pesos e blocos para sete dias. O mesmo ID recupera o ciclo em caso de reenvio. |
| `POST /estudo/ciclos/atual` | Sincroniza a semana atual e incorpora as respostas de prática e revisão já gravadas. Recebe `deslocamento_utc_min`. Com `incluir_cronograma: true`, também devolve o cronograma e o resumo das mudanças. |
| `POST /estudo/simulados` | Recebe `cronograma_id` e `deslocamento_utc_min`. Inicia ou retoma o simulado do ciclo ativo e retorna `id`, `total` e as questões `pendentes`. |
| `POST /estudo/simulados/:id/concluir` | Devolve o cronograma atual e o `resumo` gravado na conclusão. Ele inclui o peso anterior e o novo de cada matéria e a troca de matéria por data e posição do bloco. Reenviar a confirmação mantém o resumo original. Simulados concluídos antes desse registro devolvem `resumo: null`. |
| `GET /estudo/agenda` | Retorna `{ revisoes: [{ questao_id, vencimento }] }` com a data vigente de cada questão do usuário, em ordem de vencimento. |
| `POST /estudo/previa` | Recebe `id`, `questao_id`, `alternativa`, `respondida_em` e `deslocamento_utc_min`. Retorna as datas estimadas para `hard`, `medium` e `easy`. A gravação por `POST /sync` devolve a tentativa definitiva no resultado da operação. |

O deslocamento é em minutos a leste de UTC (São Paulo usa -180). Clientes antigos usam -180 por padrão. As datas já agendadas continuam válidas. O servidor usa SM-2 com intervalos iniciais de 1 e 6 dias, teto de 365 dias e revisão no dia seguinte após erro.

Cada ciclo tem 28 blocos de uma hora, quatro por dia durante sete dias. A API atribui cada bloco à matéria com a maior prioridade `peso / (2 × blocos já atribuídos + 1)`, até o limite de 14 por matéria na semana. As cotas são distribuídas pelos dias, com no máximo dois blocos por matéria ao dia e alternância entre matérias. Em uma trilha de matéria única, ela ocupa todos os quatro blocos diários. O desempate entre pesos iguais alterna a cada ciclo semanal. Há um intervalo de 15 minutos após as duas primeiras horas de estudo, e as revisões orientam a ordem entre matérias empatadas.

O ciclo tem sete dias civis a partir da data inicial. Cada matéria começa a primeira semana com peso 1. Os campos `peso_inicial` e `peso` guardam a base do ciclo e a prioridade vigente. Cada tentativa tem uma revisão individual e pode incluir `simulado_id`. Na última resposta, o app envia `concluir_simulado: true` para persistir a resposta e o novo plano na mesma transação.

O cronograma consulta `GET /estudo/agenda?simulado=1&deslocamento_utc_min=-180`. A primeira revisão das questões inéditas de uma matéria parte do dia local de conclusão do primeiro bloco dessa matéria. Isso também vale para blocos antigos registrados com um tema específico. O intervalo inicial é `round(3 / peso)`, limitado a 1–7 dias. Para questões respondidas vale a próxima data individual da repetição espaçada. Com `agendado: true`, o início do simulado seleciona as questões devidas até hoje e fixa a seleção para a retomada. Blocos concluídos em ciclos anteriores da mesma trilha também contam.

A API recalcula os pesos a partir da base do ciclo, das respostas de todos os simulados concluídos e da última resposta de prática ou revisão por questão na semana. O app sincroniza o plano após cada resposta comum. Abrir ou atualizar os dados também incorpora as respostas já salvas. Para difícil, médio e fácil, o sinal vale +0,80, +0,54 e +0,32 em um erro, ou +0,14, 0 e −0,10 em um acerto. Com `n` respostas na matéria, o alvo é `1 + 2 × média dos sinais` e o novo peso é `base + n/(n+4) × (alvo − base)`. A renovação usa a mesma base e o mesmo histórico para evitar dupla contagem.

A meta semanal reserva um bloco por matéria quando há capacidade. O replanejamento desconta os minutos concluídos e os blocos futuros já fixados. Dias passados, blocos editados e o dia atual com estudo já concluído ficam preservados. O tempo pendente de dias passados não dá crédito de estudo. Se acabaram as vagas, o simulado ainda atualiza os pesos.

A renovação ocorre quando o aplicativo sincroniza ou atravessa a virada da semana. Se houve várias semanas de ausência, as semanas com respostas são processadas em ordem até a atual. Apenas o plano a ser usado agora é gerado. A substituição do ciclo ativo e a gravação dos novos pesos e blocos ocorrem na mesma transação. Os cronogramas já gerados conservam os valores usados naquele momento. Iniciar outra trilha ou reiniciar explicitamente o ciclo começa uma nova sequência com pesos iguais.

As gravações de estudo usam transações MongoDB para serializar alterações por conta. Use Atlas ou um replica set no desenvolvimento local. Na pasta `api`, `npm test` executa a suíte. Para incluir as rotas HTTP e a persistência, configure `TEST_REPLICA_URI` com um replica set de teste. O teste cria e remove uma base exclusiva.

### 6.5 Sincronização (exige login)

Veja a [seção 7](#7-como-funciona-a-sincronização-offline) para o funcionamento completo.

| Rota | O que faz |
|---|---|
| `POST /sync` | O app **envia** a fila de operações feitas offline |
| `GET /sync?desde=...&limite=...` | O app **baixa** o que mudou no servidor |

---

## 7. Como funciona a sincronização offline

### 7.1 O ciclo completo (feito pelo cliente)

```
1. ENVIAR   → lê a fila_sincronizacao em ordem de id → POST /sync
2. BAIXAR   → GET /sync?desde=<última sincronização>
3. APLICAR  → grava o que veio no SQLite (em uma transação)
4. GUARDAR  → salva o proximo_desde para a próxima vez
```

**Sempre enviar antes de baixar.** Se o app baixasse primeiro, uma versão antiga do servidor poderia sobrescrever uma alteração que o usuário ainda não enviou.

### 7.2 Enviar: `POST /sync`

Corpo (de 1 a 100 operações, na ordem em que o usuário agiu):

```json
{
  "operacoes": [
    {
      "id": 12,
      "entidade": "tentativa_exercicio",
      "entidade_id": "e8f4a1c0-...",
      "operacao": "insert",
      "payload": {
        "questao_id": "q1",
        "alternativa": "B",
        "dificuldade_informada": 3,
        "respondida_em": "2026-11-11T10:00:00Z",
        "deslocamento_utc_min": -180
      }
    }
  ]
}
```

O `id` é o da linha na `fila_sincronizacao`. A resposta traz **um resultado por item**, na mesma ordem:

```json
{ "resultados": [ { "id": 12, "status": "ok" } ] }
```

| `status` | Significado | O que o app faz |
|---|---|---|
| `ok` | Gravado (ou já estava gravado) | Apaga o item da fila. Se vier `"ignorada": true`, havia uma alteração mais recente no servidor; para o app é o mesmo que `ok` |
| `rejeitada` | O item está errado e reenviar não adianta | Guarda o `motivo` em `ultimo_erro` e **para de reenviar** esse item |
| `falha` | Erro temporário (ou o item depende de algo que ainda não chegou) | Soma 1 em `tentativas` e tenta de novo depois. Após 5 tentativas, para de insistir |

O app deve reenviar a fila **em ordem** e parar no primeiro `falha`, em vez de seguir adiante: um item pode depender dos anteriores (uma etapa depende do cronograma).

### 7.3 O que cada entidade aceita

| Entidade | `insert` | `update` | `delete` | Campos do `payload` |
|---|:---:|:---:|:---:|---|
| `tentativa_exercicio` | ✅ | ❌ | ❌ | `questao_id`, `alternativa` (A–E), `dificuldade_informada`, `respondida_em`, `deslocamento_utc_min`. Para filas antigas também é aceito `acertou`. A API salva a resposta de prática ou revisão, calcula a próxima revisão e replaneja o restante do ciclo em uma transação. Com `incluir_cronograma: true`, o resultado inclui `plano`, com o cronograma e o resumo da resposta, ou `null` se não houver plano. Reenviar o mesmo ID recupera o resultado sem contar a resposta novamente. |
| `feedback` | ✅ | ❌ | ❌ | `tipo` (`erro`/`sugestao`), `texto`, `versao_app` |
| `cronograma` | ✅ | ✅ (só `ativo`) | ❌ | `trilha_id`, `data_inicio` (`AAAA-MM-DD`), `ativo` (0/1), `atualizado_em` |
| `peso_materia` | ✅ | ✅ | ❌ | `peso` (número > 0, máximo 1000), `atualizado_em`. O `entidade_id` é `"cronograma_id:materia_id"` |
| `etapa_estudo` | ✅ | ✅ | ✅ (só pendentes) | `cronograma_id`, `materia_id`, `data`, `duracao_min`, `pausa_min`, `concluida`, `concluida_em`, `atualizado_em`. No `update`, só `data`, `duracao_min`, `pausa_min`, `concluida` e `concluida_em` |
| `usuario` | ⏳ | ⏳ | ⏳ | Ainda não aceita (responde `falha`). Use `PATCH /conta` |

Tentativas e feedbacks só aceitam `insert`: são um **histórico**, e editar uma tentativa estragaria o cálculo da repetição espaçada. Etapas concluídas não podem ser apagadas, porque são o histórico de horas estudadas. O `payload` precisa ser sempre um objeto (para `delete`, envie `{}`).

### 7.4 Regras de segurança do `/sync`

- **O usuário vem do token, nunca do payload.** Se alguém mandar `usuario_id: "outra-pessoa"`, o campo é ignorado.
- **Idempotente.** Se o servidor gravar e a resposta se perder, o app reenvia o mesmo item e recebe `ok`, sem duplicar.
- **Ninguém toma o id de outro usuário.** Inserir com um id que já pertence a outra pessoa é `rejeitada`.
- **Campos fora da lista são recusados** (por exemplo, não dá para mudar a matéria de uma etapa).
- **Cronogramas e etapas de outros usuários** respondem como "não encontrado", para não revelar que o id existe.
- **Máximo de 100 operações** por chamada, e ids com no máximo 100 caracteres (letras, números, `_`, `:` e `-`).

### 7.5 Conflitos: a alteração mais recente vence

Cronogramas, pesos e etapas guardam `atualizado_em`, a hora em que o usuário fez a alteração **no aparelho**. O servidor compara:

- Alteração **mais nova** que a guardada → aplica.
- Alteração **mais antiga** → ignora (`ok` com `ignorada: true`).
- `atualizado_em` **no futuro** → o servidor usa a própria hora. Isso impede que um celular com o relógio errado "trave" um registro com uma data de 2999.

**Limitação conhecida:** apagar uma etapa pendente vence sempre. Se um aparelho apaga e outro edita, o `update` seguinte vira `falha`.

### 7.6 Baixar: `GET /sync`

```
GET /sync?desde=2026-11-11T10:00:00Z&limite=500
```

- Sem `desde`: baixa tudo (aparelho novo). Com `desde`: só o que mudou depois.
- `desde` precisa ser uma data válida no passado.
- `limite` (de 10 a 500, padrão 500) pagina as **tentativas**, que crescem sem parar.

Resposta:

```json
{
  "agora": "2026-11-12T12:00:00.000Z",
  "proximo_desde": "2026-11-12T12:00:00.000Z",
  "tem_mais": false,
  "usuario": { "id": "...", "nome": "...", "email": "...", "provedor_login": "email", "criado_em": "...", "atualizado_em": "..." },
  "cronogramas": [
    {
      "id": "...", "usuario_id": "...", "trilha_id": "...", "data_inicio": "2026-11-10", "ativo": 1, "atualizado_em": "...",
      "pesos":  [ { "cronograma_id": "...", "materia_id": "...", "peso": 2, "atualizado_em": "..." } ],
      "etapas": [ { "id": "...", "cronograma_id": "...", "materia_id": "...", "data": "2026-11-10", "duracao_min": 90,
                    "pausa_min": 10, "concluida": 1, "concluida_em": "...", "atualizado_em": "..." } ]
    }
  ],
  "tentativas": [ { "id": "...", "usuario_id": "...", "questao_id": "...", "acertou": 1, "...": "..." } ]
}
```

Pontos importantes:

- Os nomes dos campos são **os das colunas do SQLite** e os booleanos já vêm como 0/1, para o app gravar direto.
- **Cronogramas vêm como retrato completo.** Se algo mudou, o cronograma chega inteiro, com todas as etapas e pesos. É assim que o app descobre que uma etapa foi apagada em outro aparelho: se ela não está no retrato, não existe mais.
- **Paginação:** se `tem_mais` for `true`, o app repete o pedido com o `proximo_desde` recebido, até `tem_mais` virar `false`. Só então a sincronização está concluída.
- O servidor guarda o `agora` **antes** de consultar, para nunca perder uma mudança que aconteça durante a montagem da resposta.
- Aplicar no SQLite: gravar tudo em **uma transação**; para cada cronograma, inserir ou atualizar o cronograma, os pesos e as etapas, e apagar as etapas e pesos locais que **não** vieram — **exceto** o que ainda tem item pendente na fila.

---

## 8. Segurança

### O que a API já faz

| Proteção | Como |
|---|---|
| Senhas | Guardadas só como **hash bcrypt** (custo 12). Nunca voltam em nenhuma resposta |
| Login | Mensagem **única** para e-mail inexistente, senha errada e conta do Google, e tempo de resposta parecido nos casos (não revela quais e-mails têm conta) |
| Tokens | JWT assinado com `HS256`, que **só aceita esse algoritmo**. Vale 30 dias. Cada token carrega a "versão" das sessões do usuário: **trocar a senha invalida os tokens antigos** |
| Conta apagada | O middleware consulta o banco a cada requisição, então um token de uma conta excluída é recusado em todas as rotas |
| Injeção NoSQL | Tudo que vem de fora tem o **tipo conferido** antes de tocar no banco (um e-mail enviado como `{"$ne": null}` é recusado) |
| Limite de tentativas | Login: 10 a cada 15 min. Cadastro: 10 por hora. Operações de conta: 10 a cada 15 min (por IP) |
| Isolamento | Cada usuário só lê e grava o que é dele |
| Erros | O detalhe de um erro interno vai só para o terminal, nunca para quem fez o pedido |
| Senha atual | Exigida para trocar e-mail, senha ou excluir a conta |

### Cuidados que dependem de você

- **Nunca coloque no Git** o `.env` (senha do banco e chave dos tokens), o `node_modules` ou os arquivos `.db`. Antes de cada `git commit`, confira o `git status`.
- Se o `.env` for enviado por engano alguma vez, apagá-lo depois **não resolve**, porque o histórico guarda tudo. É preciso **trocar a senha do usuário no Atlas e a `JWT_SECRET`**.
- **Nunca cole** a string de conexão, a senha ou a `JWT_SECRET` em conversas, prints ou issues.
- Liberar `0.0.0.0/0` no **Network Access** do Atlas deixa qualquer IP tentar conectar; o que protege é o usuário e a senha. Use só em desenvolvimento, com senhas longas, **um usuário do banco por pessoa** (assim dá para revogar um sem afetar os outros) e permissão de leitura e escrita, não de administrador.
- Prefira um repositório **privado** no GitHub enquanto for projeto de estudo.
- Antes de publicar a API: usar **HTTPS**, apagar as variáveis `LIMITE_...` do `.env`, usar um **banco de produção separado** do de desenvolvimento e, se a hospedagem usar proxy, configurar `app.set('trust proxy', 1)` no `server.js` (senão todos os usuários caem no mesmo contador de limite).

---

## 9. Testes

Os scripts em `api/scripts/` são **testes automáticos que chamam o servidor de verdade**. Eles criam os próprios usuários de teste e apagam tudo no fim. Cada linha mostra `OK` ou `FALHOU` (com o motivo), e o final diz `Tudo certo.` ou quantos testes deram resultado inesperado.

### 9.1 Testes de estrutura (só o banco, o servidor não precisa estar rodando)

| Script | O que verifica |
|---|---|
| `testar-conexao.js` | Conecta ao Atlas e mostra o nome do banco |
| `testar-trilha.js` | Nome repetido, vazio, matéria repetida, tema sem id |
| `testar-questao.js` | Gabarito, número de alternativas, ano, link, e o caso de propósito de um tema que não existe (que o Mongo **aceita**) |
| `testar-usuario.js` | E-mail repetido e inválido, provedor, conta sem senha, `select: false` |
| `testar-cronograma.js` | Um cronograma ativo por usuário, pesos, etapas (120 min), matéria de outra trilha, troca de trilha |
| `testar-tentativa.js` | Dificuldade, fator de facilidade, questão e usuário inexistentes, "o que revisar hoje", desempenho por tema |
| `testar-feedback-concurso.js` | Regras de feedback e concurso, concursos em andamento |

### 9.2 Testes da API (**o servidor precisa estar rodando** com `npm start`)

Rode em **outro terminal**, também dentro da pasta `api`:

| Script | O que verifica |
|---|---|
| `testar-auth.js` | Cadastro, login, injeção NoSQL, tokens inválidos/expirados, conta excluída |
| `testar-sync.js` | `POST /sync` com tentativas e feedbacks, idempotência, isolamento |
| `testar-sync-cronograma.js` | `POST /sync` com cronograma, pesos e etapas, conflitos por data, relógio no futuro |
| `testar-sync-baixar.js` | `GET /sync`, formato do SQLite, paginação, retrato completo |
| `testar-conta.js` | Consultar, editar e excluir a conta, tokens derrubados na troca de senha |
| `testar-limites.js` | Limite de tentativas (**precisa de um servidor de teste separado**, veja abaixo) |

### 9.3 Teste do limite de tentativas

Os contadores ficam na memória do servidor e os limites do `.env` são altos. Por isso este teste usa um **segundo servidor**, em outra porta e com limites baixos.

1. Abra um **terminal novo** (na pasta `api`) e suba o servidor de teste:

```powershell
$env:PORT = "3001"; $env:LIMITE_LOGIN = "3"; $env:LIMITE_CADASTRO = "2"; $env:LIMITE_CONTA = "3"; node server.js
```

2. Em **outro** terminal (pasta `api`):

```powershell
node scripts/testar-limites.js
```

3. Ao terminar, pare o servidor com `Ctrl+C` e **feche aquele terminal**, para as variáveis não vazarem para outros comandos. Para repetir o teste, suba o servidor da 3001 de novo (os contadores zeram).

### 9.4 Regras de ouro para os testes

- Os scripts de seed e de teste usam o **mesmo banco do desenvolvimento** e **apagam dados**. Nunca aponte para um banco de produção. Uma boa proteção é recusar a execução quando `NODE_ENV` for `production`.
- Rode os testes depois de qualquer mudança na API. Se algo quebrar, o teste mostra exatamente o quê.
- Os testes de API ficam parados com `fetch failed` quando o servidor não está no ar.

---

## 10. Cobertura dos requisitos

Como este repositório é só banco e API, cada requisito tem duas partes: o que **já está pronto aqui** e o que **fica com o cliente (app)**.

### Requisitos funcionais

| Código | Descrição resumida | Situação |
|---|---|---|
| RF01 | Criar conta | ✅ `POST /auth/cadastro` |
| RF02 | Alterar dados da conta | ✅ `PATCH /conta` |
| RF03 | Consultar dados da conta | ✅ `GET /conta` |
| RF04 | Excluir a conta | ✅ `POST /conta/excluir` (apaga todos os dados do usuário no servidor). O app precisa também limpar o SQLite e o token |
| RF05 | Escolher a trilha | ✅ Dados e catálogo prontos (`GET /catalogo/trilhas`). Tela no app |
| RF06 | Plano de estudos em ciclo com pesos | ✅ A API gera e persiste o ciclo em `POST /estudo/ciclos` |
| RF07 | Exercícios com repetição espaçada | ✅ A API calcula e persiste a próxima revisão por questão |
| RF08 | Novo cronograma de outra trilha | ✅ Regra de um ativo por usuário; trocar de trilha cria outro |
| RF09 | Avaliar a dificuldade do exercício | ✅ Campo `dificuldade_informada` (1–5, opcional) |
| RF10 | Notificações | 🟡 Tabela `notificacao` pronta (local). **Agendamento no app** |
| RF11 | Lista de concursos | ✅ `GET /catalogo/concursos` |
| RF12 | Marcar etapa como concluída | ✅ Via `/sync` (`etapa_estudo`, `update`) |
| RF13 | Atrasar etapas não concluídas | 🟡 Alterar `data` já é aceito pelo `/sync`. **A regra de quando atrasar fica no app** |
| RF14 | Dashboard | 🟡 Consultas prontas e testadas (seção 4.5). **Tela no app** |
| RF15 | Recuperar a senha | ⏳ Campos no model (`resetToken`, `resetTokenExpira`). Falta rota e envio de e-mail |
| RF16 | Reportar erros e sugestões | ✅ Via `/sync` (`feedback`) |
| RF17 | Login com o Google | ⏳ Campo `provedorLogin` pronto. Falta a verificação do Google |

### Requisitos não funcionais

| Código | Descrição resumida | Situação |
|---|---|---|
| RNF01 | App em React Native | ➖ Fora do escopo deste repositório (é o projeto do app) |
| RNF02 | Máximo de 2 horas consecutivas e pausas | ✅ O gerador programa quatro horas de estudo por dia, com uma pausa de 15 minutos entre o segundo e o terceiro bloco. O modelo valida o limite de 120 minutos por etapa. |
| RNF03 | Só provas de domínio público de bancas oficiais | 🟡 Campos `banca`, `ano` e `fonte_url`. **O conteúdo real precisa ser curado** (as questões atuais são de exemplo) |
| RNF04 | Funcionar offline com sincronização | ✅ Servidor pronto (`/sync` nos dois sentidos). **Falta o lado do app** |
| RNF05 | — | O texto do requisito aparece cortado no documento original; confira e complete |

Legenda: ✅ pronto neste repositório · 🟡 estrutura pronta aqui; a lógica ou a tela é responsabilidade do cliente (app) · ⏳ ainda não feito neste repositório · ➖ fora do escopo

---

## 11. Problemas comuns e soluções

| Sintoma | Causa e solução |
|---|---|
| `sqlite3` / `node` "não é reconhecido" logo após instalar | O terminal não atualizou o PATH. **Feche o VS Code por completo** e abra de novo |
| `npm`: "execução de scripts foi desabilitada" | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` |
| `Cannot find module '...\scripts\xxx.js'` ou `Could not read package.json` | Você está na pasta errada. Entre na pasta `api` (`cd api`) e confira o prompt |
| No SQLite, o prompt vira `;->` e nada funciona | Há uma instrução aberta. Digite `;` e Enter. Comandos que começam com ponto (`.read`, `.tables`, `.quit`) **não podem ter espaço antes** |
| Colei `Remove-Item` ou `dir` dentro do SQLite | Esses são comandos do PowerShell. Saia do SQLite com `.quit` antes |
| `fetch failed` ao rodar um teste de API | O servidor não está no ar (ou caiu ao reiniciar com algum erro). Rode `npm start` e leia a mensagem. Se estiver usando `npm run dev`, veja o aviso da seção 3.6 |
| `404` em uma rota que você acabou de criar | O servidor ainda roda a versão antiga. Reinicie (`Ctrl+C` e `npm start`) e confira se a linha `app.use(...)` está **antes** do tratador de "rota não encontrada" no `server.js` |
| `SyntaxError: Identifier ... has already been declared` | Uma função ficou duplicada num copia-e-cola (acontece quando sobra um trecho antigo). Substitua o arquivo inteiro, em vez de editar partes |
| Conectou, mas o banco se chama `test` | A string de conexão não tem `/estudos` antes do `?`, **ou o `.env` não foi salvo** (confira a bolinha na aba do arquivo) |
| `bad auth` / `Authentication failed` | Usuário ou senha da string de conexão errados, ou `<db_password>` não foi substituído. Senhas com `@ : / #` quebram a string |
| `Could not connect to any servers` / mensagem sobre IP | O seu IP não está em **Network Access** no Atlas. Se a internet é residencial, o IP muda de tempos em tempos |
| `MONGODB_URI` aparece como `undefined` | O `.env` não está na pasta `api`, está com outro nome ou não foi salvo |
| `Defina JWT_SECRET no .env...` ao subir | Falta a `JWT_SECRET` (mínimo de 32 caracteres) no `.env`, ou ele não foi salvo |
| `EADDRINUSE` | A porta já está em uso por outro servidor aberto. Feche o outro terminal ou use outra porta (`PORT=3001`) |
| Testes de cadastro/login dão `429` | O limite de tentativas pegou. Confira as variáveis `LIMITE_...` no `.env` (valor 1000 para desenvolvimento) e reinicie o servidor |
| O `.db` aparece como "arquivo binário" no VS Code | Instale uma extensão de SQLite (por exemplo, **SQLite Viewer**) e confirme que ela está **ativada**. Depois: botão direito no `.db` > **Open With...** |
| Uma data aparece **um dia atrasada** no app | `new Date('2026-11-10')` é meia-noite em UTC, que no Brasil é 21h do dia anterior. Trate datas só de dia como texto `AAAA-MM-DD` ou converta o fuso na hora de mostrar |

---

## 12. O que falta fazer

### Nesta API

- **RF15**: recuperação de senha (rota + envio de e-mail)
- **RF17**: login com o Google (verificar o token do Google; criar conta com `provedorLogin: 'google'`)
- Verificação de e-mail no cadastro (hoje qualquer um pode cadastrar o e-mail de outra pessoa)
- Aceitar a entidade `usuario` no `/sync` (ou manter `PATCH /conta` como único caminho)
- Questões e concursos **reais** (RNF03), com uma rota ou ferramenta para cadastrá-los
- Trava de segurança nos scripts de seed e de teste: recusar a execução quando `NODE_ENV` for `production`
- Colocar os contadores do limite de tentativas em armazenamento compartilhado, se houver mais de um servidor
- Antes de publicar: HTTPS, banco de produção separado, `trust proxy`, variáveis de ambiente na hospedagem

### Contrato com o cliente (quem for construir o app)

Esta API só funciona direito se o cliente fizer a sua parte:

- Abrir o SQLite, executar o `schema_final.sql` na primeira abertura e **ligar `PRAGMA foreign_keys = ON` a cada conexão**
- Guardar o token em armazenamento seguro (nunca no SQLite comum) e enviá-lo em `Authorization: Bearer <token>`
- Baixar o catálogo da trilha escolhida **antes** de o usuário ficar offline
- Solicitar o ciclo por `POST /estudo/ciclos`, enviar a alternativa e a dificuldade por `POST /sync` e exibir a agenda de `GET /estudo/agenda`.
- Corrigir questões comparando com o gabarito, mesmo offline
- Agendar notificações (RF10) e montar o dashboard (RF14) com as consultas da seção 4.5
- Rodar a sincronização como descrito na seção 7: enviar a fila, baixar, aplicar em transação e guardar o `proximo_desde`. Para guardar o `proximo_desde`, o cliente precisa de uma tabela de configuração no SQLite, que o `schema_final.sql` ainda não tem
- Ao excluir a conta: apagar todas as tabelas locais, cancelar as notificações e remover o token

### Limitações conhecidas

- Apagar e editar a mesma etapa em aparelhos diferentes: o `delete` sempre vence
- Se mais de 10 tentativas tiverem exatamente a mesma hora (em milissegundos), a paginação do `GET /sync` pode repetir uma página
- O SQLite e o servidor não conferem se `acertou` bate com o gabarito
- O servidor não verifica o e-mail do cadastro

---

## 13. Convenções e decisões de projeto

- **Ids**: texto (UUID gerado com `crypto.randomUUID()`) em quase tudo. A exceção é a `fila_sincronizacao`, que usa número crescente porque **a ordem importa**. O id do usuário é gerado pelo servidor.
- **Datas e horas**: ISO 8601 em **UTC** (`2026-11-08T00:29:55Z`). Datas só de dia (`data_inicio`, `data`, `proxima_revisao`): `AAAA-MM-DD`.
- **Booleanos**: `0`/`1` no SQLite e na resposta do `/sync`; `true`/`false` no MongoDB.
- **Nomes**: banco SQLite em `snake_case` (`usuario_id`, `duracao_min`); MongoDB e código em `camelCase` (`usuarioId`, `duracaoMin`). A API traduz no `GET /sync`.
- **Validar sempre as duas pontas**: o app valida para dar resposta rápida ao usuário, a API valida porque nunca se deve confiar no que vem de fora, e os bancos (`CHECK`, índices, validações do Mongoose) são a última barreira.
- **Onde cada regra vive**: o que o banco consegue garantir sozinho fica no banco (por exemplo, a duração de até 120 minutos); o que depende de outras tabelas ou coleções fica no código (por exemplo, a matéria pertencer à trilha do cronograma).
- **Embutir × separar no MongoDB**: embutir o que é sempre lido junto e tem tamanho limitado (matérias na trilha, etapas no cronograma); separar o que cresce sem parar (tentativas).
- **Tentativas são imutáveis**: cada resposta é um registro novo, e a data de revisão que vale é a da tentativa mais recente de cada questão.
- **Trocar de trilha** (RF08) **não edita** o cronograma: desativa o antigo e cria um novo. O histórico fica guardado.
- **Segredos só em `.env`**, nunca no código.
