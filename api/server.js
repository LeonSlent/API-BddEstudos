require('dotenv').config();
const express = require('express');
const { criarCors } = require('./middleware/cors');
const { conectar, mongoose } = require('./db');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('Defina JWT_SECRET no .env, com pelo menos 32 caracteres.');
  process.exit(1);
}

const app = express();
// Antes do JSON, da autenticação e das rotas: preflight e erros também recebem CORS.
app.use(criarCors());
app.use(express.json());

app.get('/saude', (req, res) => {
  res.json({
    status: 'ok',
    banco: mongoose.connection.name,
    conectado: mongoose.connection.readyState === 1,
  });
});

app.use('/catalogo', require('./routes/catalogo'));
app.use('/auth', require('./routes/auth'));
app.use('/sync', require('./routes/sync'));
app.use('/estudo', require('./routes/estudo'));
app.use('/conta', require('./routes/conta'));

// Nenhuma rota anterior respondeu
app.use((req, res) => {
  res.status(404).json({ erro: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
});

// Erros inesperados: o detalhe vai para o terminal, não para quem fez o pedido
app.use((erro, req, res, next) => {
  const status = erro.status && erro.status < 500 ? erro.status : 500;
  if (status === 500) {
    console.error('Erro em', req.method, req.originalUrl, '->', erro.message);
  }
  res.status(status).json({
    erro: status === 500 ? 'Erro interno do servidor.' : 'Requisição inválida.',
  });
});

const PORTA = process.env.PORT || 3000;

conectar()
  .then(() => {
    app.listen(PORTA, () => console.log(`API rodando em http://localhost:${PORTA}`));
  })
  .catch((erro) => {
    console.error('Não foi possível conectar ao banco:', erro.message);
    process.exit(1);
  });
