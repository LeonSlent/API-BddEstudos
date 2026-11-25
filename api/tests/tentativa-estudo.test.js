const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Usuario = require('../models/Usuario');
const Questao = require('../models/Questao');
const Tentativa = require('../models/Tentativa');
const Cronograma = require('../models/Cronograma');
const { salvarTentativa, previa } = require('../lib/estudo');

test('grava o resultado do gabarito, usa o histórico e devolve o mesmo registro no reenvio', async t => {
  let gravada;
  const anterior = { _id: 'antiga', usuarioId: 'aluno', questaoId: 'q',
    respondidaEm: new Date('2025-02-01'), repeticoes: 2, intervaloDias: 6,
    fatorFacilidade: 2.5, proximaRevisao: new Date('2025-02-07') };
  t.mock.method(mongoose.connection, 'transaction', executar => executar(null));
  t.mock.method(Usuario.collection, 'updateOne', async () => ({ matchedCount: 1 }));
  t.mock.method(Cronograma.collection, 'findOne', async () => null);
  t.mock.method(Usuario.collection, 'findOne', async () => ({ _id: 'aluno' }));
  t.mock.method(Questao.collection, 'findOne', async () => ({ _id: 'q', alternativas: ['X', 'Y'], gabarito: 'A' }));
  t.mock.method(Tentativa.collection, 'findOne', async filtro => {
    if (filtro._id === 'nova') return gravada;
    assert.equal(filtro.usuarioId, 'aluno');
    assert.equal(filtro.questaoId, 'q');
    return anterior;
  });
  t.mock.method(Tentativa.collection, 'find', () => ({ toArray: async () => [] }));
  const escrita = t.mock.method(Tentativa.collection, 'insertOne', async doc => {
    gravada = doc;
    return { acknowledged: true, insertedId: doc._id };
  });
  const entrada = { questao_id: 'q', alternativa: 'A', acertou: 0, intervalo_dias: 99,
    dificuldade_informada: 3, respondida_em: '2025-02-07T12:00:00Z' };
  assert.deepEqual(await previa('aluno', 'nova', entrada), ['2025-02-22', '2025-02-22', '2025-02-22']);
  const { tentativa: resposta, plano } = await salvarTentativa('aluno', 'nova', entrada);
  assert.ok(!plano);
  assert.equal(resposta.acertou, true);
  assert.equal(resposta.intervaloDias, 15);
  assert.equal(resposta.repeticoes, 3);
  const { tentativa: reenvio } = await salvarTentativa('aluno', 'nova', entrada);
  assert.deepEqual(reenvio.proximaRevisao, resposta.proximaRevisao);
  assert.equal(escrita.mock.callCount(), 1);
  await assert.rejects(salvarTentativa('outro', 'nova', entrada), /id já está em uso/);
});
