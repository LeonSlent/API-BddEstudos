const { conectar, mongoose } = require('../db');
const Cronograma = require('../models/Cronograma');

const d = (texto) => new Date(texto); // 'AAAA-MM-DD' vira data em UTC

const cronogramas = [
  {
    _id: 'cron-1',
    usuarioId: 'user-1',
    trilhaId: 'trilha-dev',
    dataInicio: d('2026-11-10'),
    ativo: false, // a Ana trocou de trilha (RF08)
    pesos: [
      { materiaId: 'mat-logica', peso: 1.0 },
      { materiaId: 'mat-eng-sw', peso: 1.5 },
      { materiaId: 'mat-bd-dev', peso: 2.5 },
    ],
    etapas: [
      {
        _id: 'et-1', materiaId: 'mat-bd-dev', data: d('2026-11-10'), duracaoMin: 90,
        concluida: true, concluidaEm: new Date('2026-11-10T22:00:00Z'),
      },
      { _id: 'et-2', materiaId: 'mat-eng-sw', data: d('2026-11-11'), duracaoMin: 60 }, // atrasada 1 dia (RF13)
      { _id: 'et-3', materiaId: 'mat-logica', data: d('2026-11-11'), duracaoMin: 120 },
      { _id: 'et-4', materiaId: 'mat-bd-dev', data: d('2026-11-11'), duracaoMin: 45 },
    ],
  },
  {
    _id: 'cron-2',
    usuarioId: 'user-1',
    trilhaId: 'trilha-dados',
    dataInicio: d('2026-11-12'),
    ativo: true,
    pesos: [{ materiaId: 'mat-bd-dados', peso: 1.0 }],
    etapas: [],
  },
];

async function main() {
  await conectar();
  await Cronograma.init(); // cria os índices, inclusive o parcial
  await Cronograma.deleteMany({});
  const criados = await Cronograma.create(cronogramas);
  console.log(`${criados.length} cronogramas inseridos.`);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});