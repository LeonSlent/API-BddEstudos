-- =====================================================================
-- Schema SQLite FINAL (banco local do app de estudos para concursos de TI)
-- Construído tabela por tabela. Para criar um banco limpo:
--     sqlite3 estudos_novo.db
--     .read schema_final.sql
-- Convenções:
--   * ids TEXT (UUID), exceto fila_sincronizacao (número crescente)
--   * datas em ISO 8601 UTC (ex: 2026-11-08T00:29:55Z)
--   * a senha NÃO fica aqui: a autenticação é feita pela API
--   * o SQLite exige PRAGMA foreign_keys = ON a cada conexão
-- =====================================================================
PRAGMA foreign_keys = ON;

-- ---------- CATÁLOGO (baixado do Atlas, somente leitura no app) ----------

CREATE TABLE trilha (
  id    TEXT PRIMARY KEY,
  nome  TEXT NOT NULL UNIQUE
);

CREATE TABLE materia (
  id         TEXT PRIMARY KEY,
  trilha_id  TEXT NOT NULL REFERENCES trilha(id),
  nome       TEXT NOT NULL,
  UNIQUE (trilha_id, nome)
);

CREATE TABLE tema (
  id          TEXT PRIMARY KEY,
  materia_id  TEXT NOT NULL REFERENCES materia(id),
  nome        TEXT NOT NULL,
  UNIQUE (materia_id, nome)
);

CREATE TABLE questao (
  id            TEXT PRIMARY KEY,
  tema_id       TEXT NOT NULL REFERENCES tema(id),
  enunciado     TEXT NOT NULL,
  alternativas  TEXT NOT NULL CHECK (json_valid(alternativas)),
  gabarito      TEXT NOT NULL CHECK (gabarito IN ('A','B','C','D','E')),
  banca         TEXT NOT NULL,                       -- RNF03: só bancas oficiais
  ano           INTEGER NOT NULL CHECK (ano BETWEEN 1990 AND 2100),
  fonte_url     TEXT
);

CREATE TABLE concurso (
  id             TEXT PRIMARY KEY,
  orgao          TEXT NOT NULL CHECK (length(trim(orgao)) > 0),
  cargo          TEXT NOT NULL CHECK (length(trim(cargo)) > 0),
  localizacao    TEXT NOT NULL CHECK (length(trim(localizacao)) > 0),
  salario        REAL CHECK (salario IS NULL OR salario > 0),
  fim_edital     TEXT NOT NULL CHECK (date(fim_edital) IS NOT NULL),
  edital_url     TEXT,
  atualizado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX ix_concurso_fim ON concurso(fim_edital);

CREATE TABLE concurso_trilha (
  concurso_id  TEXT NOT NULL REFERENCES concurso(id) ON DELETE CASCADE,
  trilha_id    TEXT NOT NULL REFERENCES trilha(id),
  PRIMARY KEY (concurso_id, trilha_id)
);
CREATE INDEX ix_concurso_trilha_trilha ON concurso_trilha(trilha_id);

-- ---------- DADOS DO USUÁRIO (criados offline e sincronizados) ----------

CREATE TABLE usuario (
  id              TEXT PRIMARY KEY,
  nome            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE
                  CHECK (email LIKE '%_@_%._%'),
  provedor_login  TEXT NOT NULL DEFAULT 'email'
                  CHECK (provedor_login IN ('email','google')),
  criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE cronograma (
  id             TEXT PRIMARY KEY,
  usuario_id     TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  trilha_id      TEXT NOT NULL REFERENCES trilha(id),
  data_inicio    TEXT NOT NULL CHECK (date(data_inicio) IS NOT NULL),
  ativo          INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
-- RF08: só um cronograma ativo por usuário
CREATE UNIQUE INDEX ux_cronograma_ativo
  ON cronograma(usuario_id) WHERE ativo = 1;

-- RF06: peso de cada matéria dentro de um cronograma
CREATE TABLE peso_materia (
  cronograma_id  TEXT NOT NULL REFERENCES cronograma(id) ON DELETE CASCADE,
  materia_id     TEXT NOT NULL REFERENCES materia(id),
  peso           REAL NOT NULL DEFAULT 1.0 CHECK (peso > 0),
  atualizado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (cronograma_id, materia_id)
);

-- RF12, RF13, RNF02
CREATE TABLE etapa_estudo (
  id             TEXT PRIMARY KEY,
  cronograma_id  TEXT NOT NULL REFERENCES cronograma(id) ON DELETE CASCADE,
  materia_id     TEXT NOT NULL REFERENCES materia(id),
  data           TEXT NOT NULL CHECK (date(data) IS NOT NULL),
  duracao_min    INTEGER NOT NULL CHECK (duracao_min BETWEEN 1 AND 120),  -- RNF02
  pausa_min      INTEGER NOT NULL DEFAULT 10 CHECK (pausa_min >= 0),
  concluida      INTEGER NOT NULL DEFAULT 0 CHECK (concluida IN (0,1)),
  concluida_em   TEXT,
  criado_em      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (
    (concluida = 0 AND concluida_em IS NULL) OR
    (concluida = 1 AND concluida_em IS NOT NULL)
  )
);
CREATE INDEX ix_etapa_cronograma_data ON etapa_estudo(cronograma_id, data);

-- RF07 e RF09: cada resposta + estado da repetição espaçada (estilo SM-2)
CREATE TABLE tentativa_exercicio (
  id                     TEXT PRIMARY KEY,
  usuario_id             TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  questao_id             TEXT NOT NULL REFERENCES questao(id),
  acertou                INTEGER NOT NULL CHECK (acertou IN (0,1)),
  dificuldade_informada  INTEGER CHECK (dificuldade_informada BETWEEN 1 AND 5),
  respondida_em          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
                         CHECK (datetime(respondida_em) IS NOT NULL),
  repeticoes             INTEGER NOT NULL DEFAULT 0 CHECK (repeticoes >= 0),
  intervalo_dias         INTEGER NOT NULL DEFAULT 0 CHECK (intervalo_dias >= 0),
  fator_facilidade       REAL NOT NULL DEFAULT 2.5 CHECK (fator_facilidade >= 1.3),
  proxima_revisao        TEXT CHECK (proxima_revisao IS NULL OR date(proxima_revisao) IS NOT NULL),
  atualizado_em          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX ix_tentativa_revisao ON tentativa_exercicio(usuario_id, proxima_revisao);
CREATE INDEX ix_tentativa_questao ON tentativa_exercicio(usuario_id, questao_id);

-- RF10 (fica só no celular, não sincroniza)
CREATE TABLE notificacao (
  id             TEXT PRIMARY KEY,
  usuario_id     TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('exercicio','revisao','estudo')),
  mensagem       TEXT NOT NULL CHECK (length(trim(mensagem)) > 0),
  agendada_para  TEXT NOT NULL CHECK (datetime(agendada_para) IS NOT NULL),
  enviada        INTEGER NOT NULL DEFAULT 0 CHECK (enviada IN (0,1)),
  enviada_em     TEXT,
  criado_em      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (
    (enviada = 0 AND enviada_em IS NULL) OR
    (enviada = 1 AND enviada_em IS NOT NULL)
  )
);
CREATE INDEX ix_notificacao_pendentes
  ON notificacao(usuario_id, enviada, agendada_para);

-- RF16
CREATE TABLE feedback (
  id          TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('erro','sugestao')),
  texto       TEXT NOT NULL CHECK (length(trim(texto)) BETWEEN 1 AND 2000),
  versao_app  TEXT,
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX ix_feedback_usuario ON feedback(usuario_id, criado_em);

-- ---------- SINCRONIZAÇÃO (RNF04) ----------
-- Toda alteração feita offline entra aqui. Quando a internet volta, o app
-- envia os itens em ordem de id para a API e apaga os que deram certo.
CREATE TABLE fila_sincronizacao (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entidade     TEXT NOT NULL CHECK (entidade IN (
                 'usuario','cronograma','peso_materia',
                 'etapa_estudo','tentativa_exercicio','feedback')),
  entidade_id  TEXT NOT NULL CHECK (length(entidade_id) > 0),  -- peso_materia: 'cronograma_id:materia_id'
  operacao     TEXT NOT NULL CHECK (operacao IN ('insert','update','delete')),
  payload      TEXT NOT NULL CHECK (json_valid(payload)),
  criado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  tentativas   INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  ultimo_erro  TEXT
);
CREATE INDEX ix_fila_entidade ON fila_sincronizacao(entidade, entidade_id);
