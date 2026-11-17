const { conectar, mongoose } = require('../db');
const Cronograma = require('../models/Cronograma');
const { deveFalhar } = require('./util-teste');

const d = (texto) => new Date(texto);

// Cronograma válido de base, do user-2 (que não tem nenhum no seed)
const base = {
  usuarioId: 'user-2',
  trilhaId: 'trilha-dev',
  dataInicio: d('2026-11-10'),
  ativo: false,
  pesos: [{ materiaId: 'mat-logica', peso: 1 }],
  etapas: [{ _id: 'e1', materiaId: 'mat-logica', data: d('2026-11-10'), duracaoMin: 60 }],
};
let n = 0;
const nova = (mudancas) => Cronograma.create({ ...base, _id: `teste-${++n}`, ...mudancas });
const etapa = (mudancas) => ({ ...base.etapas[0], ...mudancas });

async function main() {
  await conectar();
  await Cronograma.init();

  console.log('--- Regras do cronograma ---\n');
  await deveFalhar('segundo cronograma ATIVO para o mesmo usuário', () =>
    nova({ usuarioId: 'user-1', ativo: true })
  );
  await deveFalhar('usuário que não existe', () => nova({ usuarioId: 'nao-existe' }));
  await deveFalhar('trilha que não existe', () => nova({ trilhaId: 'nao-existe' }));
  await deveFalhar('data de início inválida', () => nova({ dataInicio: 'amanha' }));
  await deveFalhar('_id repetido', () => Cronograma.create({ ...base, _id: 'cron-1' }));

  console.log('--- Regras dos pesos ---\n');
  await deveFalhar('peso zero', () => nova({ pesos: [{ materiaId: 'mat-logica', peso: 0 }] }));
  await deveFalhar('matéria repetida nos pesos', () =>
    nova({ pesos: [{ materiaId: 'mat-logica', peso: 1 }, { materiaId: 'mat-logica', peso: 2 }] })
  );
  await deveFalhar('matéria de OUTRA trilha nos pesos (mat-redes na trilha-dev)', () =>
    nova({ pesos: [{ materiaId: 'mat-redes', peso: 1 }] })
  );

  console.log('--- Regras das etapas ---\n');
  await deveFalhar('etapa com 150 minutos (RNF02)', () => nova({ etapas: [etapa({ duracaoMin: 150 })] }));
  await deveFalhar('etapa com 0 minuto', () => nova({ etapas: [etapa({ duracaoMin: 0 })] }));
  await deveFalhar('etapa com 90.5 minutos', () => nova({ etapas: [etapa({ duracaoMin: 90.5 })] }));
  await deveFalhar('etapa concluída sem data de conclusão', () =>
    nova({ etapas: [etapa({ concluida: true })] })
  );
  await deveFalhar('etapa NÃO concluída com data de conclusão', () =>
    nova({ etapas: [etapa({ concluidaEm: new Date() })] })
  );
  await deveFalhar('etapa com data inválida', () => nova({ etapas: [etapa({ data: 'amanha' })] }));
  await deveFalhar('duas etapas com o mesmo id', () =>
    nova({ etapas: [etapa({}), etapa({})] })
  );
  await deveFalhar('etapa de matéria de OUTRA trilha', () =>
    nova({ etapas: [etapa({ materiaId: 'mat-redes' })] })
  );

  console.log('--- Alterar um cronograma que já existe ---\n');
  await deveFalhar('marcar etapa como concluída sem informar a data', async () => {
    const cron = await Cronograma.findById('cron-1');
    cron.etapas.id('et-3').concluida = true;
    await cron.save(); // a validação roda no save
  });

  console.log('--- Troca de trilha (RF08): isto deve FUNCIONAR ---\n');
  const redes = {
    trilhaId: 'trilha-redes',
    pesos: [{ materiaId: 'mat-redes', peso: 1 }],
    etapas: [etapa({ materiaId: 'mat-redes' })],
  };
  const antiga = await nova({ _id: 'troca-1', ativo: true, ...redes });
  antiga.ativo = false;
  await antiga.save();
  await nova({ _id: 'troca-2', ativo: true, ...redes });
  console.log('OK: desativou o cronograma antigo e criou o novo, ambos do mesmo usuário.\n');
  await Cronograma.deleteMany({ _id: { $in: ['troca-1', 'troca-2'] } });

  console.log('--- Horas estudadas por matéria (RF14) ---');
  const horas = await Cronograma.aggregate([
    { $match: { usuarioId: 'user-1' } },
    { $unwind: '$etapas' },
    { $match: { 'etapas.concluida': true } },
    { $group: { _id: '$etapas.materiaId', horas: { $sum: { $divide: ['$etapas.duracaoMin', 60] } } } },
  ]);
  console.table(horas);

  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});