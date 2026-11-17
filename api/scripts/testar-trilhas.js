const { conectar, mongoose } = require('../db');
const Trilha = require('../models/Trilha');

async function deveFalhar(descricao, acao) {
  try {
    await acao();
    console.log(`PASSOU (era para falhar): ${descricao}`);
  } catch (erro) {
    console.log(`Falhou como esperado: ${descricao}\n   -> ${erro.message}\n`);
  }
}

async function main() {
  await conectar();
  await Trilha.init();

  await deveFalhar('nome repetido', () =>
    Trilha.create({ _id: 'x1', nome: 'Dados' })
  );

  await deveFalhar('nome vazio', () =>
    Trilha.create({ _id: 'x2', nome: '   ' })
  );

  await deveFalhar('sem nome', () =>
    Trilha.create({ _id: 'x3' })
  );

  await deveFalhar('matéria repetida na mesma trilha', () =>
    Trilha.create({
      _id: 'x4',
      nome: 'Trilha Teste',
      materias: [
        { _id: 'm1', nome: 'Redes' },
        { _id: 'm2', nome: 'redes' },
      ],
    })
  );

  await deveFalhar('tema sem id', () =>
    Trilha.create({
      _id: 'x5',
      nome: 'Outra Trilha Teste',
      materias: [{ _id: 'm3', nome: 'Redes', temas: [{ nome: 'OSI' }] }],
    })
  );

  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});