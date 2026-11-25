const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const Usuario = require('../models/Usuario');
const Questao = require('../models/Questao');
const Trilha = require('../models/Trilha');
const Tentativa = require('../models/Tentativa');
const Cronograma = require('../models/Cronograma');
const Simulado = require('../models/Simulado');
const { agendaSimulado } = require('./agenda-simulado');
const { Rejeicao, bool01, parseMomento } = require('./sync-comum');
const { deslocamento, diaLocal, calcularRevisao, gerarEtapas, redistribuirCicloAnterior,
  replanejarSemana, pesosDaSemana, SEMANA_MS, VERSAO_PLANEJAMENTO } = require('./planejamento');

const ordem = { respondidaEm: 1, _id: 1 };
const inversa = { respondidaEm: -1, _id: -1 };

function transacaoDoUsuario(usuarioId, executar) {
  return mongoose.connection.transaction(async session => {
    // O primeiro write serializa respostas/ciclos da mesma conta entre aparelhos.
    const lock = await Usuario.updateOne({ _id: usuarioId }, { $inc: { __v: 1 } }, { session, timestamps: false });
    if (!lock.matchedCount) throw new Rejeicao('Conta não encontrada.');
    return executar(session);
  });
}

async function lerResposta(p, session) {
  if (typeof p.questao_id !== 'string' || !p.questao_id) throw new Rejeicao('Informe a questão.');
  const momento = p.respondida_em === undefined ? new Date() : parseMomento(p.respondida_em);
  if (!momento || momento.getTime() > Date.now() + 86400000) throw new Rejeicao('Data de resposta inválida.');
  const dificuldade = p.dificuldade_informada;
  if (dificuldade != null && (!Number.isInteger(dificuldade) || dificuldade < 1 || dificuldade > 5)) {
    throw new Rejeicao('A dificuldade deve estar entre 1 e 5.');
  }
  const questao = await Questao.findById(p.questao_id).select('gabarito alternativas materiaId').session(session).lean();
  if (!questao) throw new Rejeicao('Questão não encontrada.');
  let acertou = bool01(p.acertou); // compatibilidade com a fila de versões anteriores
  if (p.alternativa !== undefined) {
    if (typeof p.alternativa !== 'string' || !/^[A-E]$/.test(p.alternativa) ||
        p.alternativa.charCodeAt(0) - 65 >= questao.alternativas.length) {
      throw new Rejeicao('Alternativa inválida para esta questão.');
    }
    acertou = p.alternativa === questao.gabarito;
  }
  if (acertou === undefined) throw new Rejeicao('Informe a alternativa escolhida ou o resultado.');
  return {
    questaoId: p.questao_id, acertou, respondidaEm: momento, dificuldadeInformada: dificuldade,
    ...(p.simulado_id != null && { materiaSimuladoId: questao.materiaId }),
    diaEstudo: diaLocal(momento, deslocamento(p.deslocamento_utc_min)),
  };
}

function vizinhos(usuarioId, resposta, id, operador) {
  return {
    usuarioId, questaoId: resposta.questaoId,
    $or: [
      { respondidaEm: { [operador]: resposta.respondidaEm } },
      { respondidaEm: resposta.respondidaEm, _id: { [operador]: id } },
    ],
  };
}

async function previa(usuarioId, id, p) {
  const resposta = await lerResposta(p, null);
  const anterior = await Tentativa.findOne(vizinhos(usuarioId, resposta, id, '$lt')).sort(inversa).lean();
  return [1, 3, 5].map(nivel =>
    calcularRevisao(anterior, resposta.acertou, nivel, resposta.diaEstudo).proximaRevisao.toISOString().slice(0, 10));
}

function salvarTentativa(usuarioId, id, p) {
  return transacaoDoUsuario(usuarioId, async session => {
    const existente = await Tentativa.findById(id).select('+resumoRevisao').session(session).lean();
    if (existente) {
      if (existente.usuarioId !== usuarioId) throw new Rejeicao('Este id já está em uso.');
      if ((existente.simuladoId ?? null) !== (p.simulado_id ?? null) ||
          (existente.simuladoId && existente.questaoId !== p.questao_id)) throw new Rejeicao('Tentativa pertence a outra questão ou sessão.');
      let plano = null;
      if (p.incluir_cronograma === true && existente.cronogramaRecalculadoId) {
        const ciclo = await Cronograma.findOne({ _id: existente.cronogramaRecalculadoId, usuarioId }).session(session).lean();
        if (ciclo) plano = { ciclo, resumo: existente.resumoRevisao };
      }
      return { tentativa: existente, plano };
    }
    const resposta = await lerResposta(p, session);
    if (p.simulado_id != null) {
      if (typeof p.simulado_id !== 'string' || !p.alternativa || resposta.dificuldadeInformada == null) {
        throw new Rejeicao('Informe o simulado, a alternativa e a dificuldade.');
      }
      const simulado = await Simulado.findOne({ _id: p.simulado_id, usuarioId, concluidoEm: null }).session(session).lean();
      if (!simulado || !simulado.questoes.includes(resposta.questaoId)) throw new Rejeicao('Questão fora do simulado em andamento.');
      const ciclo = await Cronograma.findOne({ _id: simulado.cronogramaId, usuarioId, ativo: true }).session(session).lean();
      exigirCicloAberto(ciclo, p.deslocamento_utc_min);
      if (await Tentativa.exists({ simuladoId: simulado._id, questaoId: resposta.questaoId }).session(session)) {
        throw new Rejeicao('Questão já respondida. Retome o simulado para continuar.');
      }
      resposta.simuladoId = simulado._id;
    }
    const anterior = await Tentativa.findOne(vizinhos(usuarioId, resposta, id, '$lt')).sort(inversa).session(session).lean();
    const estado = calcularRevisao(anterior, resposta.acertou, resposta.dificuldadeInformada, resposta.diaEstudo);
    const nova = new Tentativa({ _id: id, usuarioId, ...resposta, ...estado });
    await nova.save({ session });
    // Uma fila offline pode chegar fora de ordem. Tentativas do cliente antigo
    // são marcos históricos: conservam a data de revisão já comunicada ao aluno.
    const posteriores = await Tentativa.find(vizinhos(usuarioId, resposta, id, '$gt')).sort(ordem).session(session);
    let ultimo = nova;
    for (const item of posteriores) {
      if (!item.diaEstudo) break;
      item.set(calcularRevisao(ultimo, item.acertou, item.dificuldadeInformada, item.diaEstudo));
      await item.save({ session });
      ultimo = item;
    }
    let plano = null;
    if (!resposta.simuladoId) {
      plano = await garantirSemanaNaSessao(usuarioId, p.deslocamento_utc_min, session, true);
      if (plano) {
        nova.cronogramaRecalculadoId = plano.ciclo._id;
        nova.resumoRevisao = plano.resumo;
        await nova.save({ session });
      }
    } else if (p.concluir_simulado === true) {
      await fecharSimuladoNaSessao(usuarioId, resposta.simuladoId, p.deslocamento_utc_min, session);
    }
    return { tentativa: nova, plano };
  });
}

function consultarRevisoes(usuarioId, session = null) {
  return Tentativa.aggregate([
    { $match: { usuarioId } },
    { $sort: { questaoId: 1, ...inversa } },
    { $group: { _id: '$questaoId', vencimento: { $first: '$proximaRevisao' } } },
    { $match: { vencimento: { $type: 'date' } } },
    { $lookup: { from: Questao.collection.name, localField: '_id', foreignField: '_id', as: 'questao' } },
    { $unwind: '$questao' },
    { $project: { _id: 0, questao_id: '$_id', materiaId: '$questao.materiaId', vencimento: 1 } },
    { $sort: { vencimento: 1, questao_id: 1 } },
  ]).session(session);
}

function respostasDasSemanas(ciclo, materias, fim, offset, session) {
  const inicio = ciclo.dataInicio;
  const limiteInferior = new Date(inicio.getTime() - 86400000);
  // Um reinício explícito no mesmo dia não herda as respostas da trilha anterior.
  const corte = ciclo.respostasAPartirDe === undefined ? ciclo.createdAt : ciclo.respostasAPartirDe;
  if (corte && +diaLocal(corte, offset) === +inicio) {
    limiteInferior.setTime(+corte);
  }
  // diaEstudo é a data civil da resposta. Para registros antigos, deriva o dia pelo fuso.
  return Tentativa.aggregate([
    { $match: { usuarioId: ciclo.usuarioId, simuladoId: null, respondidaEm: {
      $gte: limiteInferior, $lt: new Date(fim.getTime() + 86400000),
    } } },
    { $set: { dia: { $ifNull: ['$diaEstudo', { $dateTrunc: {
      date: { $add: ['$respondidaEm', offset * 60000] }, unit: 'day',
    } }] } } },
    { $match: { dia: { $gte: inicio, $lt: fim } } },
    { $sort: inversa },
    { $group: { _id: {
      questao: '$questaoId',
      semana: { $floor: { $divide: [{ $subtract: ['$dia', inicio] }, SEMANA_MS] } },
    }, acertou: { $first: '$acertou' }, dificuldade: { $first: '$dificuldadeInformada' } } },
    { $lookup: { from: Questao.collection.name, localField: '_id.questao', foreignField: '_id', as: 'q' } },
    { $unwind: '$q' },
    { $match: { 'q.materiaId': { $in: materias } } },
    { $project: { _id: 0, semana: '$_id.semana', materiaId: '$q.materiaId', acertou: 1, dificuldade: 1 } },
    { $sort: { semana: 1 } },
  ]).session(session);
}

async function gravarCiclo(usuarioId, id, trilhaId, inicio, pesos, session, novoInicio = false) {
  const agora = new Date();
  const revisoes = await consultarRevisoes(usuarioId, session);
  const etapas = gerarEtapas(pesos, revisoes, inicio);
  await Cronograma.updateOne({ usuarioId, ativo: true }, { $set: { ativo: false, atualizadoEm: agora } }, { session });
  return new Cronograma({
    _id: id, usuarioId, trilhaId, ativo: true, dataInicio: inicio, atualizadoEm: agora, etapas,
    pesos: pesos.map(p => ({ ...p, pesoInicial: p.peso })), respostasAPartirDe: novoInicio ? agora : null,
    distribuicaoDiaria: true, versaoPlanejamento: VERSAO_PLANEJAMENTO,
  }).save({ session });
}

function garantirSemanaAtual(usuarioId, offset) {
  return transacaoDoUsuario(usuarioId, session => garantirSemanaNaSessao(usuarioId, offset, session));
}

async function garantirSemanaNaSessao(usuarioId, offset, session, aposRevisao = false) {
  offset = deslocamento(offset);
  const hoje = diaLocal(new Date(), offset);
  const filtro = { usuarioId, ativo: true };
  const precisaMigrar = ciclo => ciclo.distribuicaoDiaria !== false && (ciclo.versaoPlanejamento ?? 0) < VERSAO_PLANEJAMENTO;
  let atual = await Cronograma.findOne(filtro).session(session).lean();
  if (!atual) return;
  if (hoje - atual.dataInicio < SEMANA_MS) {
    if (precisaMigrar(atual)) {
      const revisoes = atual.versaoPlanejamento === 2 ? [] : await consultarRevisoes(usuarioId, session);
      const etapas = redistribuirCicloAnterior(atual, hoje, revisoes);
      const campos = etapas
        ? { etapas, distribuicaoDiaria: true, versaoPlanejamento: VERSAO_PLANEJAMENTO, atualizadoEm: new Date() }
        : { distribuicaoDiaria: false };
      atual = await Cronograma.findByIdAndUpdate(atual._id, { $set: campos, $inc: { __v: 1 } },
        { returnDocument: 'after', session }).lean();
    }
    return atualizarPlanoPorRespostas(atual, hoje, offset, session, aposRevisao);
  }
  const semanas = Math.floor((hoje - atual.dataInicio) / SEMANA_MS);
  const inicio = new Date(atual.dataInicio.getTime() + semanas * SEMANA_MS);
  const trilha = await Trilha.findById(atual.trilhaId).session(session).lean();
  if (!trilha?.materias.length) return;
  const materias = trilha.materias.map(m => m._id);
  const pesos = await calcularPesosDoCiclo(atual, materias, inicio, offset, session);
  const novo = await gravarCiclo(usuarioId, randomUUID(), trilha._id, inicio, pesos, session);
  return atualizarPlanoPorRespostas(novo.toObject(), hoje, offset, session);
}

function gerarCiclo(usuarioId, id, p, sessaoCadastro) {
  if (typeof p.trilha_id !== 'string' || !p.trilha_id) throw new Rejeicao('Informe a trilha.');
  const agora = new Date();
  const inicio = diaLocal(agora, deslocamento(p.deslocamento_utc_min));
  async function criar(session) {
    const existente = await Cronograma.findById(id).session(session).lean();
    if (existente) {
      if (existente.usuarioId !== usuarioId || existente.trilhaId !== p.trilha_id) {
        throw new Rejeicao('Id de ciclo já utilizado.');
      }
      return existente;
    }
    const trilha = await Trilha.findById(p.trilha_id).session(session).lean();
    if (!trilha?.materias.length) throw new Rejeicao('A trilha precisa ter matérias para gerar um ciclo.');
    const pesos = trilha.materias.map(m => ({ materiaId: m._id, peso: 1 }));
    return gravarCiclo(usuarioId, id, trilha._id, inicio, pesos, session, true);
  }
  return sessaoCadastro ? criar(sessaoCadastro) : transacaoDoUsuario(usuarioId, criar);
}

function exigirCicloAberto(ciclo, offset) {
  const hoje = diaLocal(new Date(), deslocamento(offset));
  if (!ciclo || !ciclo.ativo || hoje - ciclo.dataInicio >= SEMANA_MS) {
    throw new Rejeicao('Este ciclo foi encerrado. Atualize o cronograma para iniciar outro simulado.');
  }
  return hoje;
}

async function calcularAgendaSimulado(ciclo, offset, session) {
  const materias = ciclo.pesos.map(p => p.materiaId);
  const blocos = await Cronograma.aggregate([
    { $match: { usuarioId: ciclo.usuarioId, trilhaId: ciclo.trilhaId, 'etapas.concluida': true } },
    { $unwind: '$etapas' },
    { $match: { 'etapas.concluida': true } },
    { $replaceWith: '$etapas' },
    { $project: { materiaId: 1, concluida: 1, concluidaEm: 1 } },
  ]).session(session);
  const questoes = await Questao.find({ materiaId: { $in: materias } }).select('materiaId').session(session).lean();
  const revisoes = await consultarRevisoes(ciclo.usuarioId, session);
  return agendaSimulado(ciclo.pesos, blocos, questoes, revisoes, offset);
}

async function questoesPendentes(simulado, session) {
  const feitas = await Tentativa.distinct('questaoId', { usuarioId: simulado.usuarioId, simuladoId: simulado._id }).session(session);
  const respondidas = new Set(feitas);
  return simulado.questoes.filter(q => !respondidas.has(q));
}

async function consultarAgendaSimulado(usuarioId, offset) {
  const hoje = diaLocal(new Date(), offset);
  const ciclo = await Cronograma.findOne({ usuarioId, ativo: true }).select('usuarioId trilhaId pesos').lean();
  if (!ciclo) return { revisoes: [], em_andamento: false };
  let revisoes = await calcularAgendaSimulado(ciclo, offset, null);
  const aberto = await Simulado.findOne({ usuarioId, cronogramaId: ciclo._id, concluidoEm: null }).lean();
  if (aberto) {
    const pendentes = await questoesPendentes(aberto, null);
    if (aberto.agendado || pendentes.length < aberto.questoes.length) {
      const retomadas = new Set(pendentes);
      const futuras = revisoes.filter(q => q.vencimento > hoje && !retomadas.has(q.questao_id));
      revisoes = pendentes.map(questao_id => ({ questao_id, vencimento: hoje })).concat(futuras);
      return { revisoes, em_andamento: true };
    }
  }
  return { revisoes, em_andamento: false };
}

async function iniciarSimulado(usuarioId, cronogramaId, offset, agendado = false) {
  if (typeof cronogramaId !== 'string') throw new Rejeicao('Informe o ciclo de estudo.');
  return transacaoDoUsuario(usuarioId, async session => {
    const ciclo = await Cronograma.findOne({ _id: cronogramaId, usuarioId, ativo: true }).session(session).lean();
    const hoje = exigirCicloAberto(ciclo, offset);
    const filtro = { usuarioId, cronogramaId, concluidoEm: null };
    let simulado = await Simulado.findOne(filtro).session(session).lean();
    let pendentes = simulado && await questoesPendentes(simulado, session);
    // Uma prova antiga apenas pré-criada, sem respostas, pode receber a seleção do dia.
    if (agendado && (!simulado || (!simulado.agendado && pendentes.length === simulado.questoes.length))) {
      const agenda = await calcularAgendaSimulado(ciclo, offset, session);
      pendentes = agenda.filter(q => q.vencimento <= hoje).map(q => q.questao_id);
      if (!pendentes.length) throw new Rejeicao('Não há questões previstas para hoje.');
      if (simulado) {
        simulado = await Simulado.findByIdAndUpdate(simulado._id, { $set: { agendado: true, questoes: pendentes } },
          { session, returnDocument: 'after' }).lean();
      } else {
        simulado = await new Simulado({ ...filtro, _id: randomUUID(), trilhaId: ciclo.trilhaId,
          agendado: true, questoes: pendentes }).save({ session });
      }
    } else if (!simulado) {
      const questoes = await Questao.find({ materiaId: { $in: ciclo.pesos.map(p => p.materiaId) } })
        .sort({ _id: 1 }).select('_id').session(session).lean();
      if (!questoes.length) throw new Rejeicao('A trilha ainda não tem questões para um simulado.');
      simulado = await new Simulado({ ...filtro, _id: randomUUID(), trilhaId: ciclo.trilhaId,
        questoes: questoes.map(q => q._id) }).save({ session });
      pendentes = simulado.questoes;
    }
    return { id: simulado._id, total: simulado.questoes.length, pendentes };
  });
}

function concluirSimulado(usuarioId, id, offset) {
  return transacaoDoUsuario(usuarioId, session => fecharSimuladoNaSessao(usuarioId, id, offset, session));
}

function resumirMudancas(ciclo, pesos, etapas, hoje) {
  const pesosAnteriores = new Map(ciclo.pesos.map(p => [p.materiaId, p.peso]));
  // O replanejamento conserva os horários. A matéria pode mudar de ID de etapa,
  // mas o dia e a posição na sequência de estudo identificam o mesmo bloco.
  const antesPorDia = new Map();
  for (const etapa of ciclo.etapas) {
    const dia = +etapa.data;
    if (!antesPorDia.has(dia)) antesPorDia.set(dia, []);
    antesPorDia.get(dia).push(etapa);
  }
  const posicoes = new Map();
  const blocos = [];
  for (const etapa of etapas) {
    if (etapa.data < hoje) continue;
    const dia = +etapa.data;
    const indice = posicoes.get(dia) ?? 0;
    posicoes.set(dia, indice + 1);
    const anterior = antesPorDia.get(dia)[indice];
    if (anterior.materiaId !== etapa.materiaId) {
      blocos.push({ data: etapa.data.toISOString().slice(0, 10), posicao: indice + 1,
        anterior: anterior.materiaId, atual: etapa.materiaId });
    }
  }
  return { pesos: pesos.map(p => ({ materia_id: p.materiaId, anterior: pesosAnteriores.get(p.materiaId), atual: p.peso })), blocos };
}

async function fecharSimuladoNaSessao(usuarioId, id, offset, session) {
  const simulado = await Simulado.findOne({ _id: id, usuarioId }).session(session);
  if (!simulado) throw new Rejeicao('Simulado não encontrado.');
  const ciclo = await Cronograma.findOne({ _id: simulado.cronogramaId, usuarioId }).session(session).lean();
  if (simulado.concluidoEm) return { ciclo, resumo: simulado.resumo ?? null };
  const hoje = exigirCicloAberto(ciclo, offset);
  const quantidade = await Tentativa.countDocuments({ usuarioId, simuladoId: id }).session(session);
  if (quantidade !== simulado.questoes.length) throw new Rejeicao('Responda todas as questões antes de concluir o simulado.');
  simulado.concluidoEm = new Date();
  await simulado.save({ session });
  const resultado = await atualizarPlanoPorRespostas(ciclo, hoje, deslocamento(offset), session);
  simulado.resumo = resultado.resumo;
  await simulado.save({ session });
  return resultado;
}

async function calcularPesosDoCiclo(ciclo, materias, fim, offset, session) {
  const usuarioId = ciclo.usuarioId;
  const concluidos = await Simulado.find({ usuarioId, cronogramaId: ciclo._id, concluidoEm: { $ne: null } })
    .distinct('_id').session(session);
  const provas = await Tentativa.find({ usuarioId, simuladoId: { $in: concluidos } })
    .select('materiaSimuladoId acertou dificuldadeInformada').session(session).lean();
  const comuns = await respostasDasSemanas(ciclo, materias, fim, offset, session);
  const sinais = provas.map(t => ({
    semana: 0, materiaId: t.materiaSimuladoId, acertou: t.acertou, dificuldade: t.dificuldadeInformada,
  }));
  const respostas = sinais.concat(comuns);
  const avaliadas = new Set(respostas.map(r => r.materiaId));
  const base = ciclo.pesos.map(p => ({
    materiaId: p.materiaId, peso: avaliadas.has(p.materiaId) ? (p.pesoInicial ?? p.peso) : p.peso,
  }));
  return pesosDaSemana(materias, base, respostas);
}

async function atualizarPlanoPorRespostas(ciclo, hoje, offset, session, reavaliarEtapas = false) {
  const fim = new Date(+hoje + 86400000);
  const calculados = await calcularPesosDoCiclo(ciclo, ciclo.pesos.map(p => p.materiaId), fim, offset, session);
  const mudaramPesos = calculados.some((p, i) => Math.abs(p.peso - ciclo.pesos[i].peso) >= 1e-12);
  const agora = new Date();
  const pesos = mudaramPesos ? calculados.map((p, i) => ({
    ...p, pesoInicial: ciclo.pesos[i].pesoInicial ?? ciclo.pesos[i].peso, atualizadoEm: agora,
  })) : ciclo.pesos;
  const etapas = mudaramPesos || reavaliarEtapas ? replanejarSemana(ciclo, pesos, hoje) : ciclo.etapas;
  const resumo = resumirMudancas(ciclo, pesos, etapas, hoje);
  if (!mudaramPesos && !resumo.blocos.length) return { ciclo, resumo };
  const atualizado = await Cronograma.findByIdAndUpdate(ciclo._id, {
    $set: { pesos, etapas, atualizadoEm: agora }, $inc: { __v: 1 },
  }, { returnDocument: 'after', session }).lean();
  return { ciclo: atualizado, resumo };
}

module.exports = { salvarTentativa, consultarRevisoes, consultarAgendaSimulado, gerarCiclo, garantirSemanaAtual, previa, iniciarSimulado, concluirSimulado };
