require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado ao Atlas! Banco:', mongoose.connection.name);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Falha na conexão:', erro.message);
  process.exit(1);
});