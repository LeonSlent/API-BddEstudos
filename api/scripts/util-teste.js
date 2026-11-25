async function deveFalhar(descricao, acao) {
  try {
    await acao();
    console.log(`PASSOU (era para falhar): ${descricao}\n`);
  } catch (erro) {
    console.log(`Falhou como esperado: ${descricao}\n   -> ${erro.message}\n`);
  }
}

async function apagarContasDeTeste(emails) {
  const Usuario = require('../models/Usuario');
  const Cronograma = require('../models/Cronograma');
  const ids = await Usuario.distinct('_id', { email: { $in: emails } });
  await Cronograma.deleteMany({ usuarioId: { $in: ids } });
  await Usuario.deleteMany({ _id: { $in: ids } });
}

module.exports = { deveFalhar, apagarContasDeTeste };
