require('dotenv').config();
const mongoose = require('mongoose');

async function conectar() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado ao banco:', mongoose.connection.name);
}

module.exports = { conectar, mongoose };