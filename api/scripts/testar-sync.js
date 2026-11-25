const { apagarContasDeTeste } = require('./util-teste');
const { conectar, mongoose } = require('../db');
const Tentativa = require('../models/Tentativa');
const Feedback = require('../models/Feedback');

const BASE = 'http://localhost:3000';
let falhas = 0;

async function chamar(metodo, caminho, { corpo, token } = {}) {
  const headers = {};
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(BASE + caminho, {
    method: metodo,
    headers,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  return { status: resp.status, json: await resp.json().catch(() => null) };
}

const enviar = (operacoes, token) => chamar('POST', '/sync', { corpo: { operacoes }, token });
const op = (id, entidade, entidade_id, operacao, payload) => ({ id, entidade, entidade_id, operacao, payload });

function conferir(descricao, ok, detalhe = '') {
  if (!ok) falhas++;
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${descricao}${detalhe ? `\n         -> ${detalhe}` : ''}`);
}

// Confere o status e o motivo do primeiro (ou único) resultado
async function esperar(descricao, ops, token, statusEsperado) {
  const r = await enviar(ops, token);
  const res = r.json?.resultados?.[0];
  conferir(descricao, r.status === 200 && res?.status === statusEsperado,
    res?.motivo ?? `HTTP ${r.status}`);
  return r;
}

async function limpar() {
  await Tentativa.deleteMany({ _id: /^sync-/ });
  await Feedback.deleteMany({ _id: /^sync-/ });
  await apagarContasDeTeste(['sync.teste@email.com']);
}

const t1 = {
  questao_id: 'q1', acertou: 1, dificuldade_informada: 3,
  respondida_em: '2026-11-11T10:00:00Z', repeticoes: 1, intervalo_dias: 3,
  fator_facilidade: 2.5, proxima_revisao: '2026-11-14',
};

async function main() {
  await conectar();
  await limpar();

  const login = await chamar('POST', '/auth/login', { corpo: { email: 'ana@email.com', senha: 'senha-de-teste-123' } });
  const token = login.json?.token;
  if (!token) throw new Error('Não consegui fazer login com a Ana. Rode seed-usuarios.js.');

  console.log('\n--- Acesso e formato do pedido ---');
  conferir('sem token → 401', (await chamar('POST', '/sync', { corpo: { operacoes: [] } })).status === 401);
  conferir('operacoes que não é lista → 400', (await enviar('texto', token)).status === 400);
  conferir('lista vazia → 400', (await enviar([], token)).status === 400);
  const muitas = Array.from({ length: 101 }, (_, i) => op(i + 1, 'feedback', `sync-x${i}`, 'insert', {}));
  conferir('mais de 100 operações → 400', (await enviar(muitas, token)).status === 400);

  console.log('\n--- Tentativas ---');
  const r1 = await esperar('insert válido', [op(1, 'tentativa_exercicio', 'sync-t1', 'insert', t1)], token, 'ok');
  const doc = await Tentativa.findById('sync-t1').lean();
  conferir('gravada no Atlas, em nome do usuário do token',
    doc?.usuarioId === 'user-1' && doc.acertou === true && doc.intervaloDias === r1.json.resultados[0].tentativa.intervalo_dias);

  await esperar('mesmo item reenviado (idempotente)', [op(1, 'tentativa_exercicio', 'sync-t1', 'insert', t1)], token, 'ok');

  await esperar('payload tentando usar outro usuario_id',
    [op(2, 'tentativa_exercicio', 'sync-t2', 'insert', { ...t1, usuario_id: 'user-2' })], token, 'ok');
  const doc2 = await Tentativa.findById('sync-t2').lean();
  conferir('o usuario_id do payload foi ignorado', doc2?.usuarioId === 'user-1');

  await esperar('tentativa sem dificuldade e sem campos do algoritmo',
    [op(3, 'tentativa_exercicio', 'sync-t3', 'insert', { questao_id: 'q2', acertou: 0, dificuldade_informada: null })], token, 'ok');

  await esperar('questão que não existe', [op(4, 'tentativa_exercicio', 'sync-t4', 'insert', { ...t1, questao_id: 'nao-existe' })], token, 'rejeitada');
  await esperar('acertou = 2', [op(5, 'tentativa_exercicio', 'sync-t5', 'insert', { ...t1, acertou: 2 })], token, 'rejeitada');
  await esperar('dificuldade 9', [op(6, 'tentativa_exercicio', 'sync-t6', 'insert', { ...t1, dificuldade_informada: 9 })], token, 'rejeitada');
  await esperar('respondida_em no futuro distante', [op(7, 'tentativa_exercicio', 'sync-t7', 'insert', { ...t1, respondida_em: '2999-01-01T00:00:00Z' })], token, 'rejeitada');
  await esperar('update de tentativa (não permitido)', [op(8, 'tentativa_exercicio', 'sync-t1', 'update', { acertou: 0 })], token, 'rejeitada');
  await esperar('delete de tentativa (não permitido)', [op(9, 'tentativa_exercicio', 'sync-t1', 'delete', {})], token, 'rejeitada');

  console.log('\n--- Feedback ---');
  await esperar('insert válido', [op(10, 'feedback', 'sync-f1', 'insert', { tipo: 'sugestao', texto: 'Teste de sincronização', versao_app: '1.0.0' })], token, 'ok');
  conferir('gravado no Atlas', (await Feedback.findById('sync-f1').lean())?.versaoApp === '1.0.0');
  await esperar('tipo inválido', [op(11, 'feedback', 'sync-f2', 'insert', { tipo: 'elogio', texto: 'Oi' })], token, 'rejeitada');
  await esperar('delete de feedback (não permitido)', [op(12, 'feedback', 'sync-f1', 'delete', {})], token, 'rejeitada');

  console.log('\n--- Itens malformados e entidades ---');
  await esperar('entidade desconhecida (notificacao)', [op(13, 'notificacao', 'n1', 'insert', {})], token, 'rejeitada');
  await esperar("entidade 'constructor'", [op(14, 'constructor', 'c1', 'insert', {})], token, 'rejeitada');
  await esperar('usuario (ainda não suportada)', [op(15, 'usuario', 'user-1', 'update', { nome: 'X' })], token, 'falha');
  await esperar('payload em texto', [op(16, 'feedback', 'sync-f3', 'insert', 'texto solto')], token, 'rejeitada');
  await esperar('operação inexistente', [op(17, 'feedback', 'sync-f3', 'apagar', {})], token, 'rejeitada');
  await esperar('entidade_id com caracteres estranhos', [op(18, 'feedback', '../../etc', 'insert', {})], token, 'rejeitada');
  await esperar('entidade_id vazio', [op(19, 'feedback', '', 'insert', {})], token, 'rejeitada');
  await esperar('item sem id', [{ entidade: 'feedback', entidade_id: 'sync-f3', operacao: 'insert', payload: {} }], token, 'rejeitada');

  console.log('\n--- Lote misto: ordem e ids preservados ---');
  const lote = await enviar([
    op(20, 'feedback', 'sync-f4', 'insert', { tipo: 'erro', texto: 'Primeiro do lote' }),
    op(21, 'tentativa_exercicio', 'sync-t8', 'insert', { ...t1, acertou: 7 }),
    op(22, 'tentativa_exercicio', 'sync-t9', 'insert', t1),
  ], token);
  const r = lote.json?.resultados ?? [];
  conferir('3 resultados, na ordem, com os ids da fila',
    r.length === 3 && r.map((x) => x.id).join() === '20,21,22' && r.map((x) => x.status).join() === 'ok,rejeitada,ok',
    JSON.stringify(r.map((x) => `${x.id}:${x.status}`)));

  console.log('\n--- Outro usuário não pode tomar um id que já existe ---');
  const cad = await chamar('POST', '/auth/cadastro', { corpo: { trilha_id: 'trilha-dev', nome: 'Sync Teste', email: 'sync.teste@email.com', senha: 'senha-forte-123' } });
  await esperar('insert com o id "t1" que é da Ana (do seed)', [op(23, 'tentativa_exercicio', 't1', 'insert', { ...t1, acertou: 1 })], cad.json?.token, 'rejeitada');
  const original = await Tentativa.findById('t1').lean();
  conferir('a tentativa original da Ana continua intacta', original?.usuarioId === 'user-1' && original.acertou === false);

  await limpar();
  console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} teste(s) com resultado inesperado.`);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});