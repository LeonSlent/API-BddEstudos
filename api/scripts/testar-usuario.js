const bcrypt = require('bcryptjs');
const { conectar, mongoose } = require('../db');
const Usuario = require('../models/Usuario');
const { deveFalhar } = require('./util-teste');

let n = 0;
const novo = async (mudancas) => {
  const senhaHash = await bcrypt.hash('qualquer-senha', 4); // custo baixo, só para o teste ficar rápido
  return Usuario.create({
    _id: `teste-${++n}`,
    nome: 'Pessoa Teste',
    email: `teste${n}@email.com`,
    senhaHash,
    ...mudancas,
  });
};

async function main() {
  await conectar();
  await Usuario.init();

  await deveFalhar('e-mail repetido, só mudando as maiúsculas', () =>
    novo({ email: 'ANA@EMAIL.COM' })
  );
  await deveFalhar('e-mail sem arroba', () => novo({ email: 'carlos-sem-arroba' }));
  await deveFalhar('e-mail com espaço', () => novo({ email: 'ana @email.com' }));
  await deveFalhar('provedor inválido', () => novo({ provedorLogin: 'facebook' }));
  await deveFalhar('conta de e-mail sem senha', () => novo({ senhaHash: undefined }));
  await deveFalhar('nome vazio', () => novo({ nome: '   ' }));
  await deveFalhar('sem e-mail', () => novo({ email: undefined }));
  await deveFalhar('token de recuperação sem validade', () => novo({ resetToken: 'abc123' }));
  await deveFalhar('_id repetido', () => novo({ _id: 'user-1' }));

  // Estes dois devem PASSAR
  const google = await novo({
    _id: 'teste-google',
    email: 'Pessoa.Google@Gmail.com',
    provedorLogin: 'google',
    senhaHash: undefined,
  });
  console.log('OK: conta do Google sem senha foi aceita.');
  console.log('OK: e-mail foi guardado como:', google.email);
  await Usuario.deleteOne({ _id: 'teste-google' });

  // A senha não deve vir numa consulta normal
  const ana = await Usuario.findById('user-1');
  console.log('A senha vem na consulta normal?', ana.senhaHash !== undefined ? 'SIM (errado)' : 'não (certo)');
  const anaComSenha = await Usuario.findById('user-1').select('+senhaHash');
  console.log('E pedindo de propósito?', anaComSenha.senhaHash ? 'sim (certo)' : 'não (errado)');
  console.log('A senha confere?', await bcrypt.compare('senha-de-teste-123', anaComSenha.senhaHash));

  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});