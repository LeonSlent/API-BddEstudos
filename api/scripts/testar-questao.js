const { conectar, mongoose } = require('../db');
const Questao = require('../models/Questao');
const { deveFalhar } = require('./util-teste');

// Questão válida de base; cada teste estraga um campo
const base = {
  temaId: 'tema-sql',
  materiaId: 'mat-bd-dev',
  enunciado: 'Pergunta de teste?',
  alternativas: ['a', 'b', 'c'],
  gabarito: 'A',
  banca: 'Banca Exemplo',
  ano: 2024,
};
let n = 0;
const nova = (mudancas) => Questao.create({ ...base, _id: `teste-${++n}`, ...mudancas });

async function main() {
  await conectar();
  await Questao.init();

  await deveFalhar('gabarito inválido (Z)', () => nova({ gabarito: 'Z' }));
  await deveFalhar('gabarito aponta para alternativa inexistente (E com 3 alternativas)', () =>
    nova({ gabarito: 'E' })
  );
  await deveFalhar('apenas 1 alternativa', () => nova({ alternativas: ['a'] }));
  await deveFalhar('mais de 5 alternativas', () =>
    nova({ alternativas: ['a', 'b', 'c', 'd', 'e', 'f'] })
  );
  await deveFalhar('alternativa vazia', () => nova({ alternativas: ['a', '   ', 'c'] }));
  await deveFalhar('ano absurdo (1800)', () => nova({ ano: 1800 }));
  await deveFalhar('ano com decimal (2024.5)', () => nova({ ano: 2024.5 }));
  await deveFalhar('enunciado vazio', () => nova({ enunciado: '   ' }));
  await deveFalhar('sem temaId', () => nova({ temaId: undefined }));
  await deveFalhar('link da fonte inválido', () => nova({ fonteUrl: 'abc' }));
  await deveFalhar('_id repetido', () => Questao.create({ ...base, _id: 'q1' }));

  // Este é o teste que o Mongo NÃO barra: tema inexistente
  await deveFalhar('temaId que não existe (o Mongo aceita!)', () =>
    nova({ _id: 'q-orfa', temaId: 'nao-existe' })
  );
  await Questao.deleteOne({ _id: 'q-orfa' });

  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});