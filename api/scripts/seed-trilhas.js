const { conectar, mongoose } = require('../db');
const Trilha = require('../models/Trilha');

const trilhas = [
  {
    _id: 'trilha-dev',
    nome: 'Desenvolvimento',
    materias: [
      {
        _id: 'mat-logica',
        nome: 'Lógica de Programação',
        temas: [
          { _id: 'tema-algoritmos', nome: 'Algoritmos e Estruturas de Controle' },
          { _id: 'tema-vetores', nome: 'Vetores e Matrizes' },
        ],
      },
      {
        _id: 'mat-eng-sw',
        nome: 'Engenharia de Software',
        temas: [
          { _id: 'tema-scrum', nome: 'Metodologias Ágeis' },
          { _id: 'tema-uml', nome: 'UML' },
        ],
      },
      {
        _id: 'mat-bd-dev',
        nome: 'Banco de Dados',
        temas: [
          { _id: 'tema-sql', nome: 'SQL' },
          { _id: 'tema-modelagem', nome: 'Modelagem Entidade-Relacionamento' },
        ],
      },
    ],
  },
  {
    _id: 'trilha-redes',
    nome: 'Redes/Infraestrutura',
    materias: [
      {
        _id: 'mat-redes',
        nome: 'Redes de Computadores',
        temas: [{ _id: 'tema-osi', nome: 'Modelo OSI e TCP/IP' }],
      },
    ],
  },
  {
    _id: 'trilha-dados',
    nome: 'Dados',
    materias: [{ _id: 'mat-bd-dados', nome: 'Banco de Dados', temas: [] }],
  },
  { _id: 'trilha-seg', nome: 'Segurança', materias: [] },
  require('./catalogo-governanca').trilha,
];

async function main() {
  await conectar();
  await Trilha.init(); // garante que o índice do nome único já existe
  await Trilha.deleteMany({}); // limpa para poder rodar o script várias vezes
  const criadas = await Trilha.insertMany(trilhas);
  console.log(`${criadas.length} trilhas inseridas.`);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});
