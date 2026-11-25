const Cronograma = require('../models/Cronograma');
const {
  Rejeicao, Temporario, bool01, parseDia, parseMomento,
  momentoDaAlteracao, exigirApenas, quando,
} = require('./sync-comum');

// Grava o documento traduzindo os erros do banco para o vocabulário do /sync
async function salvar(doc) {
  try {
    await doc.save();
  } catch (erro) {
    if (erro.name === 'VersionError') {
      throw new Temporario('Alteração simultânea no mesmo cronograma. Tente de novo.');
    }
    if (erro.code === 11000) {
      if (erro.keyPattern?.usuarioId) {
        throw new Rejeicao('Já existe outro cronograma ativo para este usuário.');
      }
      throw new Rejeicao('Registro duplicado.');
    }
    throw erro;
  }
}

// ======================= CRONOGRAMA =======================

async function inserirCronograma(usuarioId, id, p) {
  const existente = await Cronograma.findById(id).select('usuarioId').lean();
  if (existente) {
    if (existente.usuarioId === usuarioId) return; // já recebido antes
    throw new Rejeicao('Este id já está em uso.');
  }

  exigirApenas(p, ['trilha_id', 'data_inicio', 'ativo']);
  const momento = momentoDaAlteracao(p);
  if (typeof p.trilha_id !== 'string') throw new Rejeicao('trilha_id precisa ser um texto.');
  const dataInicio = parseDia(p.data_inicio);
  if (!dataInicio) throw new Rejeicao('data_inicio precisa ser uma data válida (AAAA-MM-DD).');
  const ativo = p.ativo === undefined ? true : bool01(p.ativo);
  if (ativo === undefined) throw new Rejeicao('ativo precisa ser 0 ou 1.');

  await salvar(new Cronograma({
    _id: id, usuarioId, trilhaId: p.trilha_id, dataInicio, ativo, atualizadoEm: momento, distribuicaoDiaria: false,
  }));
}

async function atualizarCronograma(usuarioId, id, p) {
  exigirApenas(p, ['ativo']); // trilha e data de início nunca mudam: troca de trilha = cronograma novo
  const momento = momentoDaAlteracao(p);
  const ativo = bool01(p.ativo);
  if (ativo === undefined) throw new Rejeicao('ativo precisa ser 0 ou 1.');

  const cron = await Cronograma.findOne({ _id: id, usuarioId });
  if (!cron) throw new Temporario('Cronograma não encontrado.');
  if (momento < quando(cron.atualizadoEm)) return { ignorada: true };

  cron.ativo = ativo;
  cron.atualizadoEm = momento;
  await salvar(cron);
}

// ======================= PESO DA MATÉRIA =======================
// entidade_id = 'cronograma_id:materia_id'. Insert e update fazem a mesma coisa.

async function gravarPeso(usuarioId, entidadeId, p) {
  const partes = entidadeId.split(':');
  if (partes.length !== 2 || !partes[0] || !partes[1]) {
    throw new Rejeicao('entidade_id de peso_materia deve ser "cronograma_id:materia_id".');
  }
  const [cronogramaId, materiaId] = partes;

  exigirApenas(p, ['peso']);
  const momento = momentoDaAlteracao(p);
  if (typeof p.peso !== 'number' || !Number.isFinite(p.peso) || p.peso <= 0 || p.peso > 1000) {
    throw new Rejeicao('peso precisa ser um número maior que zero (máximo 1000).');
  }

  const cron = await Cronograma.findOne({ _id: cronogramaId, usuarioId });
  if (!cron) throw new Temporario('Cronograma não encontrado.');

  const atual = cron.pesos.find((x) => x.materiaId === materiaId);
  if (atual) {
    if (momento < quando(atual.atualizadoEm)) return { ignorada: true };
    atual.peso = p.peso;
    atual.atualizadoEm = momento;
  } else {
    cron.pesos.push({ materiaId, peso: p.peso, atualizadoEm: momento });
  }
  await salvar(cron);
}

// ======================= ETAPA DE ESTUDO =======================

// Clientes anteriores ainda enviam tema_id. O bloco representa a matéria inteira.
const CAMPOS_ETAPA_EDITAVEIS = ['data', 'duracao_min', 'pausa_min', 'concluida', 'concluida_em', 'tema_id'];
const CAMPOS_ETAPA_NOVA = ['cronograma_id', 'materia_id', ...CAMPOS_ETAPA_EDITAVEIS];

const exigirNumero = (valor, nome) => {
  if (typeof valor !== 'number') throw new Rejeicao(`${nome} precisa ser um número.`);
};

async function inserirEtapa(usuarioId, id, p) {
  exigirApenas(p, CAMPOS_ETAPA_NOVA);
  if (typeof p.cronograma_id !== 'string') throw new Rejeicao('cronograma_id precisa ser um texto.');

  // Esta etapa já foi recebida antes? (reenvio de um item que já tinha dado certo)
  const jaExiste = await Cronograma.findOne({ usuarioId, 'etapas._id': id }).select('_id').lean();
  if (jaExiste) {
    if (jaExiste._id === p.cronograma_id) return;
    throw new Rejeicao('Este id já está em uso em outro cronograma.');
  }

  const cron = await Cronograma.findOne({ _id: p.cronograma_id, usuarioId });
  if (!cron) throw new Temporario('Cronograma não encontrado.');

  const momento = momentoDaAlteracao(p);
  if (typeof p.materia_id !== 'string') throw new Rejeicao('materia_id precisa ser um texto.');
  const data = parseDia(p.data);
  if (!data) throw new Rejeicao('data precisa ser uma data válida (AAAA-MM-DD).');
  exigirNumero(p.duracao_min, 'duracao_min');
  if (p.pausa_min != null) exigirNumero(p.pausa_min, 'pausa_min');
  const concluida = p.concluida === undefined ? false : bool01(p.concluida);
  if (concluida === undefined) throw new Rejeicao('concluida precisa ser 0 ou 1.');
  let concluidaEm;
  if (p.concluida_em != null) {
    concluidaEm = parseMomento(p.concluida_em);
    if (!concluidaEm) throw new Rejeicao('concluida_em precisa ser uma data e hora válidas.');
  }

  cron.etapas.push({
    _id: id,
    materiaId: p.materia_id,
    data,
    duracaoMin: p.duracao_min,
    pausaMin: p.pausa_min ?? undefined,
    concluida,
    concluidaEm,
    atualizadoEm: momento,
  });
  await salvar(cron); // aqui o model confere: 1 a 120 min, matéria da trilha, concluída com data...
}

async function atualizarEtapa(usuarioId, id, p) {
  exigirApenas(p, CAMPOS_ETAPA_EDITAVEIS);
  const momento = momentoDaAlteracao(p);
  if (Object.keys(p).every((k) => k === 'atualizado_em')) {
    throw new Rejeicao('Nenhum campo para atualizar.');
  }

  const cron = await Cronograma.findOne({ usuarioId, 'etapas._id': id });
  if (!cron) throw new Temporario('Etapa não encontrada.');
  const etapa = cron.etapas.id(id);
  if (momento < quando(etapa.atualizadoEm)) return { ignorada: true };

  if ('data' in p) {
    const d = parseDia(p.data);
    if (!d) throw new Rejeicao('data precisa ser uma data válida (AAAA-MM-DD).');
    etapa.data = d;
  }
  if ('duracao_min' in p) {
    exigirNumero(p.duracao_min, 'duracao_min');
    etapa.duracaoMin = p.duracao_min;
  }
  if ('pausa_min' in p) {
    exigirNumero(p.pausa_min, 'pausa_min');
    etapa.pausaMin = p.pausa_min;
  }
  if ('concluida' in p) {
    const c = bool01(p.concluida);
    if (c === undefined) throw new Rejeicao('concluida precisa ser 0 ou 1.');
    etapa.concluida = c;
    if (!c) etapa.concluidaEm = undefined;
  }
  if ('concluida_em' in p) {
    if (p.concluida_em === null) {
      etapa.concluidaEm = undefined;
    } else {
      const d = parseMomento(p.concluida_em);
      if (!d) throw new Rejeicao('concluida_em precisa ser uma data e hora válidas.');
      etapa.concluidaEm = d;
    }
  }
  etapa.atualizadoEm = momento;
  await salvar(cron);
}

async function apagarEtapa(usuarioId, id) {
  const cron = await Cronograma.findOne({ usuarioId, 'etapas._id': id });
  if (!cron) return; // já não existe: apagar de novo dá no mesmo
  if (cron.etapas.id(id).concluida) {
    throw new Rejeicao('Etapas concluídas fazem parte do histórico e não podem ser apagadas.');
  }
  cron.etapas.pull({ _id: id });
  await salvar(cron);
}

module.exports = {
  cronograma: { insert: inserirCronograma, update: atualizarCronograma },
  peso_materia: { insert: gravarPeso, update: gravarPeso },
  etapa_estudo: { insert: inserirEtapa, update: atualizarEtapa, delete: apagarEtapa },
};
