const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { gerarCiclo } = require('../lib/estudo');
const Usuario = require('../models/Usuario');
const Cronograma = require('../models/Cronograma');
const Trilha = require('../models/Trilha');
const Tentativa = require('../models/Tentativa');

test('cadastro e troca de trilha gravam um peso igual por matéria na transação da conta', async t => {
  const client = new mongoose.mongo.MongoClient('mongodb://127.0.0.1');
  const session = client.startSession();
  t.after(async () => { await session.endSession(); await client.close(); });
  const materias = ['a', 'b', 'c'].map(id => ({ _id: id, nome: id }));
  const troca = t.mock.method(Usuario.db, 'transaction', executar => executar(session));
  t.mock.method(Usuario.collection, 'updateOne', async () => ({ matchedCount: 1 }));
  t.mock.method(Usuario.collection, 'findOne', async (filtro, opcoes) => {
    // O hook do cronograma só pode ver a conta recém-criada dentro da mesma sessão.
    assert.equal(opcoes.session, session);
    return { _id: filtro._id };
  });
  t.mock.method(Trilha.collection, 'findOne', async ({ _id }) =>
    ({ _id, materias: _id === 'inicial' ? materias : materias.slice(1) }));
  t.mock.method(Tentativa.collection, 'aggregate', () => ({ toArray: async () => [] }));
  t.mock.method(Cronograma.collection, 'findOne', async () => null);
  t.mock.method(Cronograma.collection, 'updateOne', async () => ({ matchedCount: 0 }));
  t.mock.method(Cronograma.collection, 'insertOne', async (doc, opcoes) => {
    assert.equal(opcoes.session, session);
    return { acknowledged: true, insertedId: doc._id };
  });
  const inicial = await gerarCiclo('aluno', 'c1', { trilha_id: 'inicial' }, session);
  assert.equal(troca.mock.callCount(), 0);
  assert.deepEqual(inicial.pesos.map(p => [p.materiaId, p.peso]), [['a', 1], ['b', 1], ['c', 1]]);
  const quantidades = materias.map(m => inicial.etapas.filter(e => e.materiaId === m._id).length);
  assert.deepEqual(quantidades.sort((a, b) => a - b), [9, 9, 10]);
  assert.ok(inicial.etapas.every(e => e.duracaoMin === 60));
  const outro = await gerarCiclo('aluno', 'c2', { trilha_id: 'outra' });
  assert.equal(troca.mock.callCount(), 1);
  assert.deepEqual(outro.pesos.map(p => [p.materiaId, p.peso]), [['b', 1], ['c', 1]]);
  assert.equal(outro.etapas.filter(e => e.materiaId === 'b').reduce((s, e) => s + e.duracaoMin, 0), 840);
});
