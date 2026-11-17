const { conectar, mongoose } = require('../db');
const Tentativa = require('../models/Tentativa');
const { deveFalhar } = require('./util-teste');

const base = { usuarioId: 'user-1', questaoId: 'q1', acertou: true };
let n = 0;
const nova = (mudancas) => Tentativa.create({ ...base, _id: `teste-${++n}`, ...mudancas });

async function main() {
  await conectar();
  await Tentativa.init();

  console.log('--- Regras ---\n');
  await deveFalhar('acertou com valor que não é verdadeiro/falso', () => nova({ acertou: 'talvez' }));
  await deveFalhar('sem o campo acertou', () => nova({ acertou: undefined }));
  await deveFalhar('dificuldade 6', () => nova({ dificuldadeInformada: 6 }));
  await deveFalhar('dificuldade 0', () => nova({ dificuldadeInformada: 0 }));
  await deveFalhar('dificuldade 3.5', () => nova({ dificuldadeInformada: 3.5 }));
  await deveFalhar('fator de facilidade abaixo do mínimo (1.0)', () => nova({ fatorFacilidade: 1.0 }));
  await deveFalhar('repetições negativas', () => nova({ repeticoes: -1 }));
  await deveFalhar('intervalo negativo', () => nova({ intervaloDias: -1 }));
  await deveFalhar('data de revisão inválida', () => nova({ proximaRevisao: 'breve' }));
  await deveFalhar('questão que não existe', () => nova({ questaoId: 'nao-existe' }));
  await deveFalhar('usuário que não existe', () => nova({ usuarioId: 'nao-existe' }));
  await deveFalhar('_id repetido', () => Tentativa.create({ ...base, _id: 't1' }));

  console.log('--- Isto deve FUNCIONAR ---\n');
  const semNota = await nova({ _id: 'sem-nota' }); // o usuário pulou a avaliação de dificuldade
  console.log('OK: tentativa sem dificuldade informada foi aceita. Valores padrão:',
    `repeticoes=${semNota.repeticoes}, fator=${semNota.fatorFacilidade}`);
  await Tentativa.deleteOne({ _id: 'sem-nota' });

  console.log('\n--- O que revisar hoje (considerando hoje = 2026-11-12) ---');
  const revisar = await Tentativa.aggregate([
    { $match: { usuarioId: 'user-1' } },
    { $sort: { respondidaEm: -1 } },
    { $group: { _id: '$questaoId', ultima: { $first: '$$ROOT' } } },
    { $match: { 'ultima.proximaRevisao': { $lte: new Date('2026-11-12') } } },
    { $project: { _id: 0, questaoId: '$_id', proximaRevisao: '$ultima.proximaRevisao' } },
  ]);
  console.table(
    revisar.map((r) => ({ questaoId: r.questaoId, proximaRevisao: r.proximaRevisao.toISOString().slice(0, 10) }))
  );

  console.log('--- Desempenho por tema (RF14) ---');
  const desempenho = await Tentativa.aggregate([
    { $match: { usuarioId: 'user-1' } },
    { $lookup: { from: 'questoes', localField: 'questaoId', foreignField: '_id', as: 'questao' } },
    { $unwind: '$questao' },
    {
      $group: {
        _id: '$questao.temaId',
        respostas: { $sum: 1 },
        acertos: { $sum: { $cond: ['$acertou', 1, 0] } },
      },
    },
    {
      $project: {
        respostas: 1,
        acertos: 1,
        percentual: { $round: [{ $multiply: [100, { $divide: ['$acertos', '$respostas'] }] }, 1] },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  console.table(desempenho);

  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});