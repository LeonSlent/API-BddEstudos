const dia = (d) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d) => (d ? d.toISOString() : null);

const linhaCronograma = (c) => ({
  id: c._id,
  usuario_id: c.usuarioId,
  trilha_id: c.trilhaId,
  data_inicio: dia(c.dataInicio),
  ativo: c.ativo ? 1 : 0,
  atualizado_em: iso(c.atualizadoEm ?? c.updatedAt),
  // O retrato completo: o que não estiver aqui não existe mais
  pesos: (c.pesos ?? []).map((p) => ({
    cronograma_id: c._id,
    materia_id: p.materiaId,
    peso: p.peso,
    peso_inicial: p.pesoInicial ?? p.peso,
    atualizado_em: iso(p.atualizadoEm ?? c.updatedAt),
  })),
  etapas: (c.etapas ?? []).map((e) => ({
    id: e._id,
    cronograma_id: c._id,
    materia_id: e.materiaId,
    data: dia(e.data),
    duracao_min: e.duracaoMin,
    pausa_min: e.pausaMin ?? 10,
    concluida: e.concluida ? 1 : 0,
    concluida_em: iso(e.concluidaEm),
    atualizado_em: iso(e.atualizadoEm ?? c.updatedAt),
  })),
});

const linhaTentativa = (t) => ({
  id: t._id,
  usuario_id: t.usuarioId,
  questao_id: t.questaoId,
  acertou: t.acertou ? 1 : 0,
  dificuldade_informada: t.dificuldadeInformada ?? null,
  respondida_em: iso(t.respondidaEm),
  repeticoes: t.repeticoes,
  intervalo_dias: t.intervaloDias,
  fator_facilidade: t.fatorFacilidade,
  proxima_revisao: dia(t.proximaRevisao),
  atualizado_em: iso(t.updatedAt),
});

module.exports = { linhaCronograma, linhaTentativa };
