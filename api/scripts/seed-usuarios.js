const bcrypt = require('bcryptjs');
const { conectar, mongoose } = require('../db');
const Usuario = require('../models/Usuario');

async function main() {
  await conectar();
  await Usuario.init();
  await Usuario.deleteMany({});

  const senhaHash = await bcrypt.hash('senha-de-teste-123', 10);

  const criados = await Usuario.insertMany([
    { _id: 'user-1', nome: 'Ana Souza', email: 'ana@email.com', senhaHash },
    { _id: 'user-2', nome: 'Bruno Lima', email: 'bruno@gmail.com', provedorLogin: 'google' },
  ]);

  console.log(`${criados.length} usuários inseridos.`);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});