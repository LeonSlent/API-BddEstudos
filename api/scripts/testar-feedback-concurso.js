const { conectar, mongoose } = require('../db');
const Feedback = require('../models/Feedback');
const Concurso = require('../models/Concurso');
const Cronograma = require('../models/Cronograma');
const { deveFalhar } = require('./util-teste');

const HOJE = new Date('2026-11-11');

let n = 0;
const novoFeedback = (m) =>
  Feedback.create({ _id: `fbt-${++n}`, usuarioId: 'user-1', tipo: 'erro', texto: 'Teste', ...m });
const novoConcurso = (m) =>
  Concurso.create({
    _id: `ct-${++n}`, orgao: 'Órgão', cargo: 'Cargo', localizacao: 'Local',
    fimEdital: new Date('2026-12-31'), trilhaIds: ['trilha-dev'], ...m,
  });

async function main() {
  await conectar();
  await Feedback.init();
  await Concurso.init();

  console.log('--- Feedback ---\n');
  await deveFalhar('tipo inexistente', () => novoFeedback({ tipo: 'elogio' }));
  await deveFalhar('texto só com espaços', () => novoFeedback({ texto: '    ' }));
  await deveFalhar('texto com mais de 2000 caracteres', () => novoFeedback({ texto: 'a'.repeat(2001) }));
  await deveFalhar('usuário que não existe', () => novoFeedback({ usuarioId: 'nao-existe' }));
  await deveFalhar('_id repetido', () => novoFeedback({ _id: 'fb-1' }));

  console.log('--- Concurso ---\n');
  await deveFalhar('salário negativo', () => novoConcurso({ salario: -100 }));
  await deveFalhar('salário zero', () => novoConcurso({ salario: 0 }));
  await deveFalhar('data de fim do edital inválida', () => novoConcurso({ fimEdital: 'em breve' }));
  await deveFalhar('órgão vazio', () => novoConcurso({ orgao: '  ' }));
  await deveFalhar('cargo vazio', () => novoConcurso({ cargo: '  ' }));
  await deveFalhar('link do edital inválido', () => novoConcurso({ editalUrl: 'abc' }));
  await deveFalhar('sem nenhuma trilha', () => novoConcurso({ trilhaIds: [] }));
  await deveFalhar('mesma trilha repetida', () => novoConcurso({ trilhaIds: ['trilha-dev', 'trilha-dev'] }));
  await deveFalhar('trilha que não existe', () => novoConcurso({ trilhaIds: ['nao-existe'] }));
  await deveFalhar('_id repetido', () => novoConcurso({ _id: 'conc-1' }));

  console.log('--- Isto deve FUNCIONAR ---\n');
  const semSalario = await novoConcurso({ _id: 'sem-salario' }); // nem todo edital divulga o salário
  console.log('OK: concurso sem salário foi aceito. Salário =', semSalario.salario);
  await Concurso.deleteOne({ _id: 'sem-salario' });

  console.log('\n--- Concursos em andamento, com o nome das trilhas ---');
  const andamento = await Concurso.aggregate([
    { $match: { fimEdital: { $gte: HOJE } } },
    { $lookup: { from: 'trilhas', localField: 'trilhaIds', foreignField: '_id', as: 'trilhas' } },
    { $sort: { fimEdital: 1 } },
  ]);
  console.table(
    andamento.map((c) => ({
      orgao: c.orgao,
      cargo: c.cargo,
      fimEdital: c.fimEdital.toISOString().slice(0, 10),
      trilhas: c.trilhas.map((t) => t.nome).sort().join(', '),
    }))
  );

  console.log('--- Concursos da trilha do cronograma ATIVO da Ana ---');
  const cronAtivo = await Cronograma.findOne({ usuarioId: 'user-1', ativo: true });
  console.log('Trilha do cronograma ativo:', cronAtivo.trilhaId);
  const combinam = await Concurso.find({
    trilhaIds: cronAtivo.trilhaId,
    fimEdital: { $gte: HOJE },
  });
  console.table(
    combinam.map((c) => ({ orgao: c.orgao, cargo: c.cargo, fimEdital: c.fimEdital.toISOString().slice(0, 10) }))
  );

  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});