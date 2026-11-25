// Executar apontando TEST_REPLICA_URI para um replica set de testes.
// Usa somente uma base com nome aleatório, sem carregar o .env da API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const Trilha = require('../models/Trilha');
const Questao = require('../models/Questao');
const Cronograma = require('../models/Cronograma');

test('API de estudo persiste, recupera e isola cronogramas e revisões', { skip: !process.env.TEST_REPLICA_URI }, async t => {
  const dbName = 'teste_estudo_' + randomUUID().replaceAll('-', '');
  await mongoose.connect(process.env.TEST_REPLICA_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  const app = express();
  app.use(express.json());
  app.use('/auth', require('../routes/auth'));
  app.use('/sync', require('../routes/sync'));
  app.use('/estudo', require('../routes/estudo'));
  app.use('/catalogo', require('../routes/catalogo'));
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  await new Promise(resolve => server.once('listening', resolve));
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  await Usuario.create(['u1', 'u2'].map(id => ({ _id: id, nome: id, email: id + '@example.org', provedorLogin: 'google' })));
  await Trilha.create({ _id: 'ti', nome: 'TI', materias: [{ _id: 'm', nome: 'Dados' }] });
  await Questao.create({ _id: 'q', materiaId: 'm', temaId: 'tema', enunciado: 'Q?',
    alternativas: ['A', 'B'], gabarito: 'B', banca: 'Teste', ano: 2025 });
  process.env.JWT_SECRET = randomUUID();

  async function api(path, body, user = 'u1', status = 200) {
    const token = jwt.sign({ sub: user, v: 0 }, process.env.JWT_SECRET);
    const res = await fetch('http://127.0.0.1:' + server.address().port + path, {
      method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    const value = await res.json();
    assert.equal(res.status, status, JSON.stringify(value));
    return value;
  }
  await Trilha.create({ _id: 'segunda', nome: 'Segunda trilha', materias: [
    { _id: 'r', nome: 'Redes' }, { _id: 's', nome: 'Segurança' },
  ] });
  await Trilha.create({ _id: 'vazia', nome: 'Sem matérias' });
  const cadastro = { email: 'nova@example.org', nome: 'Nova', senha: 'senha-de-teste' };
  await t.test('conta nova em Governança inicia e retoma um simulado de todas as matérias', async () => {
    const { completarGovernanca } = require('../scripts/completar-governanca');
    await Trilha.create({ _id: 'trilha-gov', nome: 'Governança', materias: [
      { _id: 'mat-ageis', nome: 'Metodologias Ágeis', temas: [{ _id: 'tema-scrum', nome: 'Scrum' }] },
    ] });
    await Questao.create({ _id: 'scrum-existente', materiaId: 'mat-ageis', temaId: 'tema-scrum',
      enunciado: 'Questão existente?', alternativas: ['A', 'B'], gabarito: 'A', banca: 'Teste', ano: 2025 });
    assert.equal(await completarGovernanca(), 10);
    assert.equal(await completarGovernanca(), 0);
    const { usuario } = await api('/auth/cadastro', { ...cadastro, email: 'gov@example.org', trilha_id: 'trilha-gov' }, 'u1', 201);
    const [ciclo] = (await api('/sync', undefined, usuario.id)).cronogramas;
    const iniciar = () => api('/estudo/simulados', { cronograma_id: ciclo.id }, usuario.id);
    const simulado = await iniciar();
    const catalogo = await api('/catalogo/questoes?trilhaId=trilha-gov');
    assert.equal(new Set(catalogo.questoes.map(q => q.materiaId)).size, 5);
    assert.equal(simulado.total, 11);
    assert.deepEqual(simulado.pendentes, catalogo.questoes.map(q => q._id));
    assert.ok(simulado.pendentes.includes('scrum-existente'));
    assert.deepEqual(await iniciar(), simulado);
    const agenda = () => api('/estudo/agenda?simulado=1&deslocamento_utc_min=0', undefined, usuario.id);
    const abrir = status => api('/estudo/simulados', { cronograma_id: ciclo.id, agendado: true, deslocamento_utc_min: 0 }, usuario.id, status);
    assert.deepEqual(await agenda(), { revisoes: [], em_andamento: false });
    await abrir(400);
    const etapa = ciclo.etapas.find(e => e.materia_id === 'mat-ageis');
    const concluir = async (concluida, instante, tema) => {
      const resultado = await api('/sync', { operacoes: [{ id: 1, entidade: 'etapa_estudo', entidade_id: etapa.id,
        operacao: 'update', payload: { concluida, concluida_em: instante, tema_id: tema, atualizado_em: new Date().toISOString() } }] }, usuario.id);
      assert.equal(resultado.resultados[0].status, 'ok');
    };
    const agora = Date.now();
    const data = dias => new Date(agora + dias * 86400000);
    const ageis = ['gov-kanban-fluxo', 'gov-kanban-limite', 'scrum-existente'];
    const previstas = dias => ageis.map(questao_id => ({ questao_id, vencimento: data(dias).toISOString().slice(0, 10) }));
    await concluir(1, data(0).toISOString());
    assert.deepEqual((await agenda()).revisoes, previstas(3));
    await abrir(400);
    await concluir(0, null, null);
    assert.deepEqual((await agenda()).revisoes, []);
    await concluir(1, data(-4).toISOString(), 'tema-scrum');
    const provaDoDia = await abrir(200);
    assert.deepEqual(provaDoDia, { id: simulado.id, total: ageis.length, pendentes: ageis });
    assert.deepEqual(await abrir(200), provaDoDia);
    assert.equal((await agenda()).em_andamento, true);
    for (const [i, questao_id] of ageis.entries()) {
      const fim = await api('/sync', { operacoes: [{ id: 1, entidade: 'tentativa_exercicio', entidade_id: randomUUID(),
        operacao: 'insert', payload: { questao_id, simulado_id: provaDoDia.id, alternativa: 'A',
          dificuldade_informada: 3, concluir_simulado: i === ageis.length - 1, deslocamento_utc_min: 0 } }] }, usuario.id);
      assert.equal(fim.resultados[0].status, 'ok');
    }
    assert.deepEqual(await agenda(), { revisoes: previstas(1), em_andamento: false });
    await abrir(400);
  });
  for (const trilha_id of [undefined, 'inexistente', 'vazia']) {
    await api('/auth/cadastro', { ...cadastro, trilha_id }, 'u1', 400);
    assert.equal(await Usuario.countDocuments({ email: cadastro.email }), 0);
  }
  const conta = await api('/auth/cadastro', { ...cadastro, trilha_id: 'segunda' }, 'u1', 201);
  const [inicial] = (await api('/sync', undefined, conta.usuario.id)).cronogramas;
  assert.equal(inicial.ativo, 1);
  assert.equal(inicial.trilha_id, 'segunda');
  assert.deepEqual(inicial.pesos.map(p => [p.materia_id, p.peso]), [['r', 1], ['s', 1]]);
  for (const id of ['r', 's']) {
    const blocos = inicial.etapas.filter(e => e.materia_id === id);
    assert.equal(new Set(blocos.map(e => e.data)).size, 7);
    assert.equal(blocos.length, 14);
    assert.ok(blocos.every(e => e.duracao_min === 60));
  }
  // Mesma conta criada com o gerador antigo e reaberta por dois aparelhos.
  const dias = [...new Set(inicial.etapas.map(e => e.data))];
  for (const dia of dias) {
    assert.deepEqual(inicial.etapas.filter(e => e.data === dia).map(e => e.pausa_min), [0, 15, 0, 0]);
  }
  const antigas = dias.flatMap((dia, indice) => {
    const materias = indice === 6 ? ['r', 's'] : [indice % 2 ? 's' : 'r'];
    return materias.map(materiaId => ({ _id: randomUUID(), materiaId, data: new Date(dia),
      duracaoMin: 60 / materias.length, pausaMin: 15, concluida: false }));
  });
  await Cronograma.updateOne({ _id: inicial.id }, { $unset: { versaoPlanejamento: 1 }, $set: { etapas: antigas } });
  const carregar = () => api('/estudo/ciclos/atual', { deslocamento_utc_min: -180 }, conta.usuario.id);
  await Promise.all([carregar(), carregar()]);
  const [migrado] = (await api('/sync', undefined, conta.usuario.id)).cronogramas;
  assert.equal(migrado.id, inicial.id);
  assert.equal(migrado.etapas.length, 28);
  assert.ok(migrado.etapas.every(e => e.duracao_min === 60));
  assert.ok(antigas.every(antiga => migrado.etapas.some(e => e.id === antiga._id)));
  await carregar();
  assert.deepEqual((await api('/sync', undefined, conta.usuario.id)).cronogramas, [migrado]);
  const cicloAnterior = await Cronograma.findById(inicial.id).lean();
  const etapasComTresPausas = cicloAnterior.etapas.map((e, i) => ({ ...e, pausaMin: i % 4 === 3 ? 0 : 15 }));
  await Cronograma.updateOne({ _id: inicial.id }, { $set: { etapas: etapasComTresPausas, versaoPlanejamento: 2 } });
  await carregar();
  const [corrigido] = (await api('/sync', undefined, conta.usuario.id)).cronogramas;
  assert.deepEqual(corrigido.etapas.map(e => [e.id, e.pausa_min]), migrado.etapas.map(e => [e.id, e.pausa_min]));
  const troca = await api('/estudo/ciclos', { id: 'troca', trilha_id: 'ti' }, conta.usuario.id);
  assert.deepEqual(troca.cronograma.pesos.map(p => [p.materia_id, p.peso]), [['m', 1]]);
  const payload = { questao_id: 'q', alternativa: 'B', dificuldade_informada: 3,
    respondida_em: '2025-01-02T01:00:00Z', deslocamento_utc_min: -180,
    acertou: 0, repeticoes: 50, intervalo_dias: 300, proxima_revisao: '2099-01-01' };
  const salvar = async (id, p) => (await api('/sync', { operacoes: [
    { id: 1, entidade: 'tentativa_exercicio', entidade_id: id, operacao: 'insert', payload: p },
  ] })).resultados[0];
  const previa = await api('/estudo/previa', { id: 't1', ...payload });
  const t1 = await salvar('t1', payload);
  assert.equal(t1.tentativa.acertou, 1);
  assert.equal(t1.tentativa.intervalo_dias, 1);
  assert.equal(t1.tentativa.proxima_revisao, previa.medium);
  assert.equal(previa.medium, '2025-01-02');
  const ultima = { ...payload, respondida_em: '2025-01-09T12:00:00Z' };
  await Promise.all([salvar('t3', ultima), salvar('t3', ultima)]);
  await salvar('t2', { ...payload, respondida_em: '2025-01-02T12:00:00Z' });
  const agenda = await api('/estudo/agenda');
  assert.deepEqual(agenda.revisoes, [{ questao_id: 'q', vencimento: '2025-01-24' }]);
  assert.deepEqual((await api('/estudo/agenda', undefined, 'u2')).revisoes, []);
  const ciclo = id => api('/estudo/ciclos', { id, trilha_id: 'ti' });
  const primeiro = await ciclo('c1');
  assert.equal(primeiro.cronograma.etapas.length, 28);
  await api('/estudo/ciclos', { id: 'invalido', trilha_id: 'ausente' }, 'u1', 400);
  const [segundo, reenvio] = await Promise.all([ciclo('c2'), ciclo('c2')]);
  assert.deepEqual(reenvio, segundo);
  const sync = await api('/sync');
  assert.equal(sync.tentativas.length, 3);
  assert.equal(sync.cronogramas.length, 2);
  assert.equal(sync.cronogramas.find(c => c.id === 'c1').ativo, 0);
  assert.deepEqual(sync.cronogramas.find(c => c.ativo), segundo.cronograma);
  assert.equal((await api('/sync', undefined, 'u2')).cronogramas.length, 0);

  // Reproduz uma conta existente com o ciclo encerrado e histórico anterior a diaEstudo.
  const Tentativa = require('../models/Tentativa');
  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);
  const inicio = new Date(hoje.getTime() - 7 * 86400000);
  await Cronograma.updateOne({ _id: 'c2' }, { $set: { dataInicio: inicio } });
  await Tentativa.create([
    { _id: 'semana-1', usuarioId: 'u1', questaoId: 'q', respondidaEm: inicio, acertou: true, dificuldadeInformada: 5 },
    { _id: 'semana-2', usuarioId: 'u1', questaoId: 'q', respondidaEm: new Date(+inicio + 60000), acertou: false, dificuldadeInformada: 3 },
    { _id: 'semana-aberta', usuarioId: 'u1', questaoId: 'q', respondidaEm: hoje, acertou: true, dificuldadeInformada: 5 },
    { _id: 'outro-aluno', usuarioId: 'u2', questaoId: 'q', respondidaEm: inicio, acertou: true, dificuldadeInformada: 5 },
  ]);
  const renovar = () => api('/estudo/ciclos/atual', { deslocamento_utc_min: 0 });
  await Promise.all([renovar(), renovar()]);
  const ciclos = (await api('/sync')).cronogramas;
  assert.equal(ciclos.length, 3);
  const [aberto] = ciclos.filter(c => c.ativo);
  assert.equal(aberto.data_inicio, hoje.toISOString().slice(0, 10));
  assert.ok(Math.abs(aberto.pesos[0].peso_inicial - 1.216) < 1e-9);
  assert.ok(Math.abs(aberto.pesos[0].peso - (1.216 + (0.8 - 1.216) / 5)) < 1e-9);
  assert.equal(ciclos.find(c => c.id === 'c2').pesos[0].peso, 1);

  await t.test('retoma, fecha dois simulados e leva os pesos para a próxima semana uma única vez', async () => {
    await Trilha.create({ _id: 'prova', nome: 'Prova', materias: ['a', 'b', 'c'].map(_id => ({ _id, nome: _id })) });
    const questoes = ['a1', 'a2', 'a3', 'a4', 'b1', 'c1'];
    await Questao.create(questoes.map(_id => ({ _id, materiaId: _id[0], temaId: 'tema', enunciado: 'Q?',
      alternativas: ['A', 'B'], gabarito: 'B', banca: 'Teste', ano: 2025 })));
    const { cronograma } = await api('/estudo/ciclos', { id: 'prova-u2', trilha_id: 'prova', deslocamento_utc_min: 0 }, 'u2');
    const iniciar = () => api('/estudo/simulados', { cronograma_id: cronograma.id, deslocamento_utc_min: 0 }, 'u2');
    const fechar = (id, usuario = 'u2', status = 200) =>
      api('/estudo/simulados/' + id + '/concluir', { deslocamento_utc_min: 0 }, usuario, status);
    const responder = async (id, questao, alternativa, usuario = 'u2', concluir = false) => {
      const { resultados } = await api('/sync', { operacoes: [{ id: 1, entidade: 'tentativa_exercicio',
        operacao: 'insert', entidade_id: randomUUID(), payload: { simulado_id: id, questao_id: questao,
          alternativa, concluir_simulado: concluir, dificuldade_informada: questao === 'c1' ? 3 : 1, deslocamento_utc_min: 0 } }] }, usuario);
      return resultados[0].status;
    };
    const [sim, mesmo] = await Promise.all([iniciar(), iniciar()]);
    assert.deepEqual(sim, mesmo);
    assert.deepEqual(sim.pendentes, questoes);
    await fechar(sim.id, 'u1', 400);
    await fechar(sim.id, 'u2', 400);
    assert.equal(await responder(sim.id, 'q', 'A'), 'rejeitada');
    assert.equal(await responder(sim.id, 'a1', 'A', 'u1'), 'rejeitada');
    assert.equal(await responder(sim.id, 'a1', 'A'), 'ok');
    assert.equal(await responder(sim.id, 'a1', 'A'), 'rejeitada');
    const retomado = await iniciar();
    assert.deepEqual(retomado.pendentes, questoes.slice(1));
    for (const q of retomado.pendentes) assert.equal(await responder(sim.id, q, q[0] === 'a' ? 'A' : 'B'), 'ok');
    const [primeiro, repetido] = await Promise.all([fechar(sim.id), fechar(sim.id)]);
    assert.deepEqual(primeiro, repetido);
    function conferirResumo(antes, { cronograma: depois, resumo }) {
      assert.deepEqual(resumo.pesos, depois.pesos.map(p => ({
        materia_id: p.materia_id, anterior: antes.pesos.find(a => a.materia_id === p.materia_id).peso, atual: p.peso,
      })));
      const esperados = [];
      for (const dia of new Set(antes.etapas.map(e => e.data))) {
        const anteriores = antes.etapas.filter(e => e.data === dia);
        depois.etapas.filter(e => e.data === dia).forEach((e, i) => {
          if (anteriores[i].materia_id !== e.materia_id) esperados.push({
            data: dia, posicao: i + 1, anterior: anteriores[i].materia_id, atual: e.materia_id,
          });
        });
      }
      assert.deepEqual(resumo.blocos, esperados);
    }
    conferirResumo(cronograma, primeiro);
    assert.ok(primeiro.resumo.blocos.length > 0);
    assert.deepEqual(primeiro.resumo.pesos.find(p => p.materia_id === 'c'), { materia_id: 'c', anterior: 1, atual: 1 });
    assert.ok(Math.abs(primeiro.cronograma.pesos[0].peso - 1.8) < 1e-10);
    assert.ok(primeiro.cronograma.etapas.filter(e => e.materia_id === 'a').length >
      cronograma.etapas.filter(e => e.materia_id === 'a').length);
    const agora = new Date().toISOString();
    const marcacao = await api('/sync', { operacoes: [{ id: 1, entidade: 'etapa_estudo', operacao: 'update',
      entidade_id: primeiro.cronograma.etapas[0].id, payload: { concluida: 1, concluida_em: agora, atualizado_em: agora } }] }, 'u2');
    assert.equal(marcacao.resultados[0].status, 'ok', marcacao.resultados[0].motivo);
    const outro = await iniciar();
    assert.notEqual(outro.id, sim.id);
    assert.equal(await responder(outro.id, questoes[0], 'B', 'u2', true), 'rejeitada');
    for (const q of questoes) assert.equal(await responder(outro.id, q, 'B', 'u2', q === questoes.at(-1)), 'ok');
    const confirmado = (await api('/sync', undefined, 'u2')).cronogramas.find(c => c.ativo);
    const segundoResumo = await fechar(outro.id);
    const { cronograma: atualizado } = segundoResumo;
    conferirResumo(primeiro.cronograma, segundoResumo);
    assert.ok(segundoResumo.resumo.blocos.every(b => b.data !== atualizado.data_inicio));
    assert.deepEqual((await fechar(sim.id)).resumo, primeiro.resumo);
    assert.deepEqual(confirmado, atualizado);
    const esperado = 1 + 8 / 12 * (0.8 + 0.14);
    assert.ok(Math.abs(atualizado.pesos[0].peso - esperado) < 1e-10);
    assert.equal(atualizado.pesos[0].peso_inicial, 1);
    assert.equal(atualizado.etapas[0].concluida, 1);
    assert.deepEqual(atualizado.etapas.slice(0, 4).map(e => e.id), primeiro.cronograma.etapas.slice(0, 4).map(e => e.id));
    const revisar = async (alternativa, id = randomUUID(), incluir = false) => {
      const r = await api('/sync', { operacoes: [{ id: 1, entidade: 'tentativa_exercicio', operacao: 'insert',
        entidade_id: id, payload: { questao_id: 'a1', alternativa, dificuldade_informada: 1, deslocamento_utc_min: 0, incluir_cronograma: incluir } }] }, 'u2');
      assert.equal(r.resultados[0].status, 'ok');
      return r.resultados[0];
    };
    const carregarPlano = () => api('/estudo/ciclos/atual', { incluir_cronograma: true, deslocamento_utc_min: 0 }, 'u2');
    await revisar('B');
    const aposPrimeira = (await api('/sync', undefined, 'u2')).cronogramas.find(c => c.ativo);
    assert.notEqual(aposPrimeira.pesos[0].peso, atualizado.pesos[0].peso);
    const idRevisao = randomUUID();
    const { plano: aposRevisao } = await revisar('A', idRevisao, true);
    assert.equal(aposRevisao.resumo.pesos[0].anterior, aposPrimeira.pesos[0].peso);
    assert.deepEqual((await revisar('A', idRevisao, true)).plano, aposRevisao);
    assert.ok(Math.abs(aposRevisao.cronograma.pesos[0].peso - (1 + 2 * (5 * 0.8 + 4 * 0.14) / 13)) < 1e-10);
    assert.ok(aposRevisao.resumo.pesos[0].atual > aposRevisao.resumo.pesos[0].anterior);
    const primeiroDia = c => c.etapas.slice(0, 4).map(e => [e.id, e.materia_id, e.concluida, e.concluida_em]);
    assert.deepEqual(primeiroDia(aposRevisao.cronograma), primeiroDia(atualizado));
    const repeticao = await carregarPlano();
    assert.deepEqual(repeticao.cronograma, aposRevisao.cronograma);
    assert.deepEqual(repeticao.resumo.blocos, []);
    await Cronograma.updateOne({ _id: cronograma.id }, { $set: { dataInicio: inicio } });
    await Tentativa.updateMany({ usuarioId: 'u2', simuladoId: { $in: [sim.id, outro.id] } }, { $set: { diaEstudo: inicio } });
    await Tentativa.updateMany({ usuarioId: 'u2', questaoId: 'a1', simuladoId: null }, { $set: { diaEstudo: inicio, respondidaEm: inicio } });
    await Tentativa.updateOne({ usuarioId: 'u2', questaoId: 'a1', simuladoId: null, acertou: false },
      { $set: { respondidaEm: new Date(+inicio + 60000) } });
    await api('/estudo/ciclos/atual', { deslocamento_utc_min: 0 }, 'u2');
    const novo = (await api('/sync', undefined, 'u2')).cronogramas.find(c => c.ativo);
    assert.equal(novo.pesos[0].peso_inicial, aposRevisao.cronograma.pesos[0].peso);
    assert.equal(novo.pesos[0].peso, aposRevisao.cronograma.pesos[0].peso);
  });
});
