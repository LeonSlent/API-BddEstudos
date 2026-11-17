const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

const NEGADO = { erro: 'Sessão inválida ou expirada. Faça login de novo.' };

async function autenticar(req, res, next) {
  const [tipo, token] = (req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Faça login para continuar.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json(NEGADO);
  }

  try {
    const usuario = await Usuario.findById(payload.sub).select('versaoToken').lean();
    // conta apagada, ou token de antes de uma troca de senha
    if (!usuario || (usuario.versaoToken ?? 0) !== (payload.v ?? 0)) {
      return res.status(401).json(NEGADO);
    }
    req.usuarioId = usuario._id; // as rotas seguintes sabem quem está pedindo
    next();
  } catch (erro) {
    next(erro);
  }
}

module.exports = { autenticar };