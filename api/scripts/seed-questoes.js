const { conectar, mongoose } = require('../db');
const Trilha = require('../models/Trilha');
const Questao = require('../models/Questao');

const questoes = [
  {
    _id: 'q1',
    temaId: 'tema-sql',
    materiaId: 'mat-bd-dev',
    enunciado: 'Qual comando SQL é usado para consultar dados de uma tabela?',
    alternativas: ['INSERT', 'SELECT', 'DELETE', 'CREATE', 'DROP'],
    gabarito: 'B',
    banca: 'Banca Exemplo',
    ano: 2024,
  },
  {
    _id: 'q2',
    temaId: 'tema-osi',
    materiaId: 'mat-redes',
    enunciado: 'Quantas camadas possui o modelo OSI?',
    alternativas: ['4', '5', '6', '7', '8'],
    gabarito: 'D',
    banca: 'Banca Exemplo',
    ano: 2023,
  },
];

// O Mongo não confere relações sozinho, então conferimos aqui:
// cada temaId precisa existir, e dentro da matéria indicada.
async function conferirRelacoes(lista) {
  const trilhas = await Trilha.find();
  const materiaDoTema = new Map();
  for (const trilha of trilhas) {
    for (const materia of trilha.materias) {
      for (const tema of materia.temas) {
        materiaDoTema.set(tema._id, materia._id);
      }
    }
  }
  for (const q of lista) {
    if (!materiaDoTema.has(q.temaId)) {
      throw new Error(`Questão ${q._id}: o tema "${q.temaId}" não existe.`);
    }
    if (materiaDoTema.get(q.temaId) !== q.materiaId) {
      throw new Error(`Questão ${q._id}: o tema "${q.temaId}" não pertence à matéria "${q.materiaId}".`);
    }
  }
}

async function main() {
  await conectar();
  await Questao.init();
  await conferirRelacoes(questoes);
  await Questao.deleteMany({});
  const criadas = await Questao.insertMany(questoes);
  console.log(`${criadas.length} questões inseridas.`);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});