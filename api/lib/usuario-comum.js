const jwt = require('jsonwebtoken');

const CUSTO_BCRYPT = 12;

// "v" é a versão das sessões do usuário: trocar a senha aumenta o número
// do usuário, e os tokens antigos (com o número velho) deixam de valer.
const gerarToken = (usuarioId, versaoToken) =>
  jwt.sign({ v: versaoToken ?? 0 }, process.env.JWT_SECRET, {
    subject: usuarioId,
    expiresIn: '30d',
    algorithm: 'HS256',
  });

const perfil = (u) => ({
  id: u._id,
  nome: u.nome,
  email: u.email,
  provedorLogin: u.provedorLogin,
  criadoEm: u.createdAt,
});

// Devolve a mensagem de erro, ou null se a senha serve
function erroDeSenha(senha) {
  if (typeof senha !== 'string') return 'A senha precisa ser um texto.';
  // o bcrypt só considera os primeiros 72 bytes
  if (senha.length < 8 || Buffer.byteLength(senha) > 72) {
    return 'A senha precisa ter de 8 a 72 caracteres.';
  }
  return null;
}

module.exports = { CUSTO_BCRYPT, gerarToken, perfil, erroDeSenha };