// Verifica a configuração sem imprimir URI, senha ou segredo JWT.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

async function main() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri) || /[<>]/.test(uri)) {
    throw new Error('Preencha MONGODB_URI no .env com a URI completa do seu banco, sem placeholders.');
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres.');
  }
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT precisa ser uma porta entre 1 e 65535.');
  }
  require('../middleware/cors').criarCors();
  console.log('Configuração preenchida; valores secretos não serão exibidos.');
  if (!process.argv.includes('--banco')) return;

  const mongoose = require('mongoose');
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 10000 });
    await mongoose.connection.db.command({ ping: 1 });
    console.log('MongoDB: conexão e ping confirmados. Nenhum dado foi alterado.');
  } catch (error) {
    if (error.code === 18 || /authentication failed|bad auth/i.test(error.message || '')) {
      throw new Error('MongoDB recusou a autenticação. Confira o usuário de banco, a senha e a codificação de caracteres especiais na URI.');
    }
    if (/ENOTFOUND|ENODATA|ECONNREFUSED|ETIMEOUT|querySrv/i.test(error.message || '')) {
      throw new Error('Não foi possível alcançar o MongoDB. Confira o host da URI, DNS e acesso de rede.');
    }
    throw new Error('Conexão não confirmada. Confira a URI, as permissões de rede do Atlas e o acesso deste computador ao banco.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
