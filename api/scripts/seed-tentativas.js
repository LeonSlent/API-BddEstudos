const { conectar, mongoose } = require('../db');
const Tentativa = require('../models/Tentativa');

const tentativas = [
  {
    _id: 't1', usuarioId: 'user-1', questaoId: 'q1', acertou: false, dificuldadeInformada: 5,
    respondidaEm: new Date('2026-11-08T10:00:00Z'),
    repeticoes: 0, intervaloDias: 1, fatorFacilidade: 2.3, proximaRevisao: new Date('2026-11-09'),
  },
  {
    _id: 't2', usuarioId: 'user-1', questaoId: 'q1', acertou: true, dificuldadeInformada: 3,
    respondidaEm: new Date('2026-11-09T10:00:00Z'),
    repeticoes: 1, intervaloDias: 3, fatorFacilidade: 2.3, proximaRevisao: new Date('2026-11-12'),
  },
  {
    _id: 't3', usuarioId: 'user-1', questaoId: 'q2', acertou: true, dificuldadeInformada: 2,
    respondidaEm: new Date('2026-11-09T10:05:00Z'),
    repeticoes: 1, intervaloDias: 3, fatorFacilidade: 2.5, proximaRevisao: new Date('2026-11-14'),
  },
];

async function main() {
  await conectar();
  await Tentativa.init();
  await Tentativa.deleteMany({});
  const criadas = await Tentativa.create(tentativas);
  console.log(`${criadas.length} tentativas inseridas.`);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});