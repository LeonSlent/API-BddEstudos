const { diaLocal } = require('./planejamento');

// A primeira exposição vem do bloco. A partir da primeira resposta vale a data individual do SRS.
function agendaSimulado(pesos, blocos, questoes, revisoes, offset) {
  const porMateria = new Map(pesos.map(p => [p.materiaId, p.peso]));
  const primeiraConclusao = new Map();
  for (const bloco of blocos) {
    if (!bloco.concluida || !bloco.concluidaEm || !porMateria.has(bloco.materiaId)) continue;
    const data = +diaLocal(bloco.concluidaEm, offset);
    primeiraConclusao.set(bloco.materiaId, Math.min(primeiraConclusao.get(bloco.materiaId) ?? Infinity, data));
  }
  const individuais = new Map(revisoes.map(r => [r.questao_id, r.vencimento]));
  const agenda = [];
  for (const q of questoes) {
    const peso = porMateria.get(q.materiaId);
    if (peso === undefined) continue;
    let vencimento = individuais.get(q._id);
    if (!vencimento) {
      const primeira = primeiraConclusao.get(q.materiaId);
      if (primeira === undefined) continue;
      const dias = Math.max(1, Math.min(7, Math.round(3 / peso)));
      vencimento = new Date(primeira + dias * 86400000);
    }
    agenda.push({ questao_id: q._id, vencimento, peso });
  }
  return agenda.sort((a, b) => a.vencimento - b.vencimento || b.peso - a.peso || a.questao_id.localeCompare(b.questao_id));
}

module.exports = { agendaSimulado };
