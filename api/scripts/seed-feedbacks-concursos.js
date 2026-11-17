const { conectar, mongoose } = require('../db');
const Feedback = require('../models/Feedback');
const Concurso = require('../models/Concurso');

const feedbacks = [
  { _id: 'fb-1', usuarioId: 'user-1', tipo: 'erro', texto: 'O cronograma não atualiza depois que marco uma etapa.', versaoApp: '1.0.0' },
  { _id: 'fb-2', usuarioId: 'user-1', tipo: 'sugestao', texto: 'Seria bom ter um modo escuro.', versaoApp: '1.0.0' },
  { _id: 'fb-3', usuarioId: 'user-1', tipo: 'sugestao', texto: 'Adicionar questões de provas mais antigas.' },
];

const concursos = [
  { _id: 'conc-1', orgao: 'Tribunal de Justiça Exemplo', cargo: 'Analista de Sistemas', localizacao: 'Curitiba/PR', salario: 9500, fimEdital: new Date('2026-12-15'), trilhaIds: ['trilha-dev', 'trilha-dados'] },
  { _id: 'conc-2', orgao: 'Prefeitura Exemplo', cargo: 'Técnico em Redes', localizacao: 'Londrina/PR', salario: 5200.5, fimEdital: new Date('2027-01-20'), trilhaIds: ['trilha-redes'] },
  { _id: 'conc-3', orgao: 'Banco Exemplo', cargo: 'Analista de Segurança', localizacao: 'São Paulo/SP', salario: 12000, fimEdital: new Date('2026-10-30'), trilhaIds: ['trilha-seg'] }, // já encerrado
];

async function main() {
  await conectar();
  await Feedback.init();
  await Concurso.init();
  await Feedback.deleteMany({});
  await Concurso.deleteMany({});
  const f = await Feedback.create(feedbacks);
  const c = await Concurso.create(concursos);
  console.log(`${f.length} feedbacks e ${c.length} concursos inseridos.`);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});