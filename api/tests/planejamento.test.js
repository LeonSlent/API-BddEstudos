const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diaLocal, calcularRevisao, gerarEtapas, redistribuirCicloAnterior, replanejarSemana, pesosDaSemana } = require('../lib/planejamento');
const { randomUUID } = require('node:crypto');

test('SM-2 usa dias civis e o histórico, inclusive na virada do ano', () => {
  const dia = diaLocal(new Date('2027-01-01T01:00:00Z'), -180);
  assert.equal(dia.toISOString(), '2026-12-31T00:00:00.000Z');
  for (const [nivel, intervalo] of [[1, 14], [3, 15], [5, 17]]) {
    const primeira = calcularRevisao(null, true, nivel, dia);
    assert.equal(primeira.intervaloDias, 1);
    const segunda = calcularRevisao(primeira, true, nivel, primeira.proximaRevisao);
    assert.equal(segunda.intervaloDias, 6);
    assert.equal(calcularRevisao(segunda, true, nivel, segunda.proximaRevisao).intervaloDias, intervalo);
    assert.deepEqual(calcularRevisao(segunda, true, nivel, dia), segunda);
  }
});

test('erro reinicia a sequência, fator tem piso e intervalo tem teto', () => {
  const dia = new Date('2026-12-31');
  const anterior = { repeticoes: 5, fatorFacilidade: 2.7, intervaloDias: 300 };
  const erro = calcularRevisao(anterior, false, 5, dia);
  assert.equal(erro.repeticoes, 0);
  assert.equal(erro.fatorFacilidade, 2.38);
  assert.equal(erro.proximaRevisao.toISOString().slice(0, 10), '2027-01-01');
  assert.equal(calcularRevisao(erro, true, null, erro.proximaRevisao).repeticoes, 1);
  assert.equal(calcularRevisao({ fatorFacilidade: 1.3 }, false, 1, dia).fatorFacilidade, 1.3);
  assert.equal(calcularRevisao(anterior, true, 5, dia).intervaloDias, 365);
});

function verificarSemana(etapas, inicio, umaMateria = false) {
  assert.equal(etapas.length, 28);
  assert.equal(new Set(etapas.map(e => e._id)).size, 28);
  const totais = {};
  for (let i = 0; i < 7; i++) {
    const data = +inicio + i * 86400000;
    const blocos = etapas.filter(e => +e.data === data);
    assert.deepEqual(blocos.map(e => e.duracaoMin), [60, 60, 60, 60]);
    assert.deepEqual(blocos.map(e => e.pausaMin), [0, 15, 0, 0]);
    const contagens = {};
    for (const [posicao, etapa] of blocos.entries()) {
      const id = etapa.materiaId;
      totais[id] = (totais[id] ?? 0) + 1;
      contagens[id] = (contagens[id] ?? 0) + 1;
      assert.ok(contagens[id] <= (umaMateria ? 4 : 2));
      if (!umaMateria && posicao > 0) assert.notEqual(blocos[posicao - 1].materiaId, id);
    }
  }
  return totais;
}

test('no último dia prioriza as matérias sem estudo e desconta só o trabalho realizado', () => {
  const dataInicio = new Date('2026-12-15');
  const pesos = ['a', 'b', 'c', 'd'].map((materiaId, i) => ({ materiaId, peso: i === 0 ? 1000 : 1 }));
  const etapas = gerarEtapas(pesos, [], dataInicio);
  const hoje = etapas[24].data;
  for (const e of etapas) e.concluida = e.data < hoje && e.materiaId === 'a';
  const novas = replanejarSemana({ dataInicio, etapas }, pesos, hoje);
  assert.deepEqual(novas.slice(0, 24), etapas.slice(0, 24));
  const ultimoDia = novas.slice(24).map(e => e.materiaId);
  for (const id of ['b', 'c', 'd']) assert.ok(ultimoDia.includes(id));
  assert.ok(ultimoDia.filter(id => id === 'a').length <= 1);
  verificarSemana(novas, dataInicio);
  etapas[24].concluida = true;
  assert.deepEqual(replanejarSemana({ dataInicio, etapas }, pesos, hoje), etapas);
});

test('protege os blocos fixos futuros e reserva cobertura semanal quando os pesos são muito diferentes', () => {
  const dataInicio = new Date('2026-12-15');
  const pesos = Array.from({ length: 10 }, (_, i) => ({ materiaId: String(i), peso: i < 2 ? 1000 : 0.01 }));
  const etapas = gerarEtapas(pesos, [], dataInicio);
  assert.equal(new Set(etapas.map(e => e.materiaId)).size, 10);
  etapas[9].concluida = true;
  etapas[15].atualizadoEm = dataInicio;
  const novas = replanejarSemana({ dataInicio, etapas }, pesos, dataInicio);
  assert.deepEqual(novas[9], etapas[9]);
  assert.deepEqual(novas[15], etapas[15]);
  assert.equal(new Set(novas.map(e => e.materiaId)).size, 10);
  verificarSemana(novas, dataInicio);
});

test('três matérias iguais alternam o bloco adicional no decorrer dos ciclos', () => {
  const pesos = ['a', 'b', 'c'].map(materiaId => ({ materiaId, peso: 1 }));
  const beneficiadas = new Set();
  for (let i = 0; i < 3; i++) {
    const inicio = new Date(Date.parse('2026-11-30') + i * 7 * 86400000);
    const etapas = gerarEtapas(pesos, [], inicio);
    const totais = verificarSemana(etapas, inicio);
    assert.deepEqual(Object.values(totais).sort((a, b) => a - b), [9, 9, 10]);
    beneficiadas.add(Object.keys(totais).find(id => totais[id] === 10));
  }
  assert.equal(beneficiadas.size, 3);
});

test('ciclo de quatro horas já salvo altera somente as pausas dos dias em aberto', () => {
  const dataInicio = new Date('2026-12-15');
  const pesos = [{ materiaId: 'a', peso: 1 }, { materiaId: 'b', peso: 1 }];
  const etapas = gerarEtapas(pesos, [], dataInicio).map((e, i) => ({
    ...e, pausaMin: i % 4 === 3 ? 0 : 15, concluida: i === 4,
  }));
  const ciclo = { dataInicio, pesos, etapas, distribuicaoDiaria: true, versaoPlanejamento: 2 };
  const hoje = etapas[4].data;
  const atualizadas = redistribuirCicloAnterior(ciclo, hoje, []);
  assert.deepEqual(atualizadas.slice(0, 4), etapas.slice(0, 4));
  for (let i = 4; i < etapas.length; i++) {
    assert.deepEqual(atualizadas[i], { ...etapas[i], pausaMin: i % 4 === 1 ? 15 : 0 });
  }
});

test('revisão vencida orienta a ordem em caso de empate', () => {
  const inicio = new Date('2026-12-15');
  const pesos = ['a', 'b'].map(materiaId => ({ materiaId, peso: 1 }));
  const etapas = gerarEtapas(pesos, [{ materiaId: 'b', vencimento: new Date('2026-12-01') }], inicio);
  assert.equal(etapas[0].materiaId, 'b');
});

test('conserva dias passados, dias já marcados e os ids dos blocos correspondentes do ciclo anterior', () => {
  const dataInicio = new Date('2026-11-30');
  const pesos = ['a', 'b'].map(materiaId => ({ materiaId, peso: 1 }));
  const etapas = Array.from({ length: 7 }, (_, i) => {
    const data = new Date(+dataInicio + i * 86400000);
    const materias = i === 6 ? ['a', 'b'] : [i % 2 ? 'b' : 'a'];
    return materias.map(materiaId => ({ _id: randomUUID(), materiaId, data, duracaoMin: 60 / materias.length,
      pausaMin: 15, concluida: i === 1, ...(i === 1 && { concluidaEm: data }) }));
  }).flat();
  const ciclo = { dataInicio, pesos, etapas };
  const migradas = redistribuirCicloAnterior(ciclo, etapas[1].data, []);
  assert.deepEqual(migradas.slice(0, 2), etapas.slice(0, 2));
  assert.equal(migradas.length, 2 + 5 * 4);
  assert.equal(new Set(migradas.map(e => e._id)).size, migradas.length);
  assert.ok(migradas.slice(2).every(e => e.duracaoMin === 60));
  assert.ok(etapas.every(e => migradas.some(m => m._id === e._id && m.materiaId === e.materiaId && +m.data === +e.data)));
  assert.equal(redistribuirCicloAnterior({ ...ciclo, etapas: etapas.slice(1) }, dataInicio, []), null);
  assert.equal(redistribuirCicloAnterior({ ...ciclo, pesos: pesos.map(p => ({ ...p, atualizadoEm: dataInicio })) }, dataInicio, []), null);
  const editado = { ...ciclo, distribuicaoDiaria: true, pesos: pesos.map(p => ({ ...p, atualizadoEm: dataInicio })),
    etapas: etapas.map((e, i) => i === 0 ? { ...e, duracaoMin: 45, atualizadoEm: dataInicio } : e) };
  const atualizado = redistribuirCicloAnterior(editado, dataInicio, []);
  assert.deepEqual(atualizado.slice(0, 2), editado.etapas.slice(0, 2));
  assert.equal(atualizado.slice(2).length, 20);
});

test('distribui os 28 blocos proporcionalmente, respeitando os limites e a exceção de matéria única', () => {
  const inicio = new Date('2026-12-29');
  for (const [valores, totais] of [
    [[1], [28]], [[2, 1], [14, 14]], [[1000, 2, 1], [14, 9, 5]],
    [[1.5, 1.1, 1], [12, 8, 8]], [[1, 1, 1, 1], [7, 7, 7, 7]],
  ]) {
    const pesos = valores.map((peso, i) => ({ materiaId: String(i), peso }));
    const blocos = verificarSemana(gerarEtapas(pesos, [], inicio), inicio, pesos.length === 1);
    assert.deepEqual(pesos.map(m => blocos[m.materiaId]), totais);
  }
});

test('o sinal das respostas distribui os minutos da semana seguinte', () => {
  const materias = ['redes', 'dados', 'engenharia'];
  const amostras = materias.flatMap((materiaId, i) => Array.from({ length: 4 }, () =>
    ({ semana: 0, materiaId, acertou: i > 0, dificuldade: i === 2 ? 5 : 3 })));
  const pesos = pesosDaSemana(materias, [], amostras);
  assert.deepEqual(pesos.map(p => p.peso), [1.54, 1, 0.9]);
  const inicio = new Date('2027-01-01');
  assert.deepEqual(verificarSemana(gerarEtapas(pesos, [], inicio), inicio),
    { redes: 13, dados: 8, engenharia: 7 });
  assert.deepEqual(pesosDaSemana(materias, pesos, []), pesos);
});

test('semanas encerradas são aplicadas em ordem, e matérias novas começam com peso 1', () => {
  const erro = { semana: 0, materiaId: 'a', acertou: false, dificuldade: 1 };
  const facil = { semana: 3, materiaId: 'a', acertou: true, dificuldade: 5 };
  const pesos = pesosDaSemana(['a', 'b'], [{ materiaId: 'a', peso: 2 }], [erro, facil]);
  assert.ok(Math.abs(pesos[0].peso - 1.856) < 1e-10);
  assert.equal(pesos[1].peso, 1);
});
