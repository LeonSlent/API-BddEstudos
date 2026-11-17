const { rateLimit } = require('express-rate-limit');

const numero = (valor, padrao) => {
  const n = parseInt(valor, 10);
  return Number.isInteger(n) && n > 0 ? n : padrao;
};

const criar = (janelaMs, limite, mensagem) =>
  rateLimit({
    windowMs: janelaMs,
    limit: limite,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { erro: mensagem },
  });

const QUINZE_MIN = 15 * 60 * 1000;
const UMA_HORA = 60 * 60 * 1000;

module.exports = {
  limiteLogin: criar(QUINZE_MIN, numero(process.env.LIMITE_LOGIN, 10),
    'Muitas tentativas de login. Aguarde alguns minutos e tente de novo.'),
  limiteCadastro: criar(UMA_HORA, numero(process.env.LIMITE_CADASTRO, 10),
    'Muitos cadastros a partir desta rede. Tente de novo mais tarde.'),
  limiteConta: criar(QUINZE_MIN, numero(process.env.LIMITE_CONTA, 10),
    'Muitas tentativas nesta operação. Aguarde alguns minutos e tente de novo.'),
};