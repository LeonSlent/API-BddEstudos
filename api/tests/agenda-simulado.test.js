const { test } = require('node:test');
const assert = require('node:assert/strict');
const { agendaSimulado } = require('../lib/agenda-simulado');

test('o peso determina a primeira revisão; novas conclusões preservam a revisão pendente e o SRS individual', () => {
  const pesos = [{ materiaId: 'a', peso: 2 }, { materiaId: 'b', peso: 1 }];
  const bloco = (materiaId, data, temaId) => ({ materiaId, temaId, concluida: true, concluidaEm: new Date(data) });
  const blocos = [bloco('a', '2026-11-30T01:00:00Z', 'scrum'), bloco('a', '2026-12-01T15:00:00Z', 'scrum'),
    bloco('b', '2026-11-30T01:00:00Z')];
  const questoes = [
    { _id: '1', materiaId: 'a', temaId: 'scrum' }, { _id: '2', materiaId: 'a', temaId: 'kanban' },
    { _id: '3', materiaId: 'b', temaId: 'um' }, { _id: '4', materiaId: 'b', temaId: 'dois' },
    { _id: '5', materiaId: 'fora' },
  ];
  const revisoes = [{ questao_id: '4', vencimento: new Date('2026-12-13') }];
  const agenda = agendaSimulado(pesos, blocos, questoes, revisoes, -180);
  assert.deepEqual(agenda.map(q => [q.questao_id, q.vencimento.toISOString().slice(0, 10)]),
    [['1', '2026-12-01'], ['2', '2026-12-01'], ['3', '2026-12-02'], ['4', '2026-12-13']]);
});
