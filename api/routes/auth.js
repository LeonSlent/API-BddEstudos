const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');
const { autenticar } = require('../middleware/auth');
const { limiteLogin, limiteCadastro } = require('../middleware/limites');
const { CUSTO_BCRYPT, gerarToken, perfil } = require('../lib/usuario-comum');
const { gerarCiclo } = require('../lib/estudo');
const { Rejeicao } = require('../lib/sync-comum');

const router = express.Router();
const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Hash de mentira: no login, comparamos contra ele quando o e-mail não existe,
// para a resposta demorar o mesmo tempo e não revelar quais e-mails têm conta.
const HASH_FALSO = bcrypt.hashSync('senha-falsa-para-igualar-o-tempo', CUSTO_BCRYPT);

// POST /auth/cadastro   corpo: { nome, email, senha, trilha_id, deslocamento_utc_min? }
router.post('/cadastro', limiteCadastro, rota(async (req, res) => {
  const { nome, email, senha, trilha_id, deslocamento_utc_min } = req.body ?? {};

  if (![nome, email, senha].every((v) => typeof v === 'string')) {
    return res.status(400).json({ erro: 'Envie nome, email e senha como texto.' });
  }
  // O bcrypt só considera os primeiros 72 bytes da senha
  if (senha.length < 8 || Buffer.byteLength(senha) > 72) {
    return res.status(400).json({ erro: 'A senha precisa ter de 8 a 72 caracteres.' });
  }
  if (typeof trilha_id !== 'string' || !trilha_id.trim()) {
    return res.status(400).json({ erro: 'Escolha uma trilha de estudo para criar sua conta.' });
  }

  const senhaHash = await bcrypt.hash(senha, CUSTO_BCRYPT);

  try {
    const usuario = await Usuario.db.transaction(async session => {
      const novo = new Usuario({ _id: crypto.randomUUID(), nome, email, senhaHash });
      await novo.save({ session });
      await gerarCiclo(novo._id, crypto.randomUUID(), { trilha_id, deslocamento_utc_min }, session);
      return novo;
    });
    return res.status(201).json({
      token: gerarToken(usuario._id, usuario.versaoToken),
      usuario: perfil(usuario),
    });
  } catch (erro) {
    if (erro instanceof Rejeicao) return res.status(400).json({ erro: erro.message });
    if (erro.code === 11000 && erro.keyPattern?.email) {
      return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
    }
    if (erro.name === 'ValidationError') {
      const mensagens = Object.values(erro.errors).map((e) => e.message);
      return res.status(400).json({ erro: mensagens.join(' ') });
    }
    throw erro;
  }
}));

// POST /auth/login   corpo: { email, senha }
router.post('/login', limiteLogin, rota(async (req, res) => {
  const { email, senha } = req.body ?? {};

  if (typeof email !== 'string' || typeof senha !== 'string' || senha.length > 200) {
    return res.status(400).json({ erro: 'Envie email e senha como texto.' });
  }

  const usuario = await Usuario.findOne({ email: email.trim().toLowerCase() }).select('+senhaHash');
  const confere = await bcrypt.compare(senha, usuario?.senhaHash ?? HASH_FALSO);

  // Mesma resposta para "e-mail não existe", "senha errada" e "conta do Google"
  if (!usuario || !usuario.senhaHash || !confere) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  }

  res.json({
    token: gerarToken(usuario._id, usuario.versaoToken),
    usuario: perfil(usuario),
  });
}));

// GET /auth/eu   cabeçalho: Authorization: Bearer <token>
router.get('/eu', autenticar, rota(async (req, res) => {
  const usuario = await Usuario.findById(req.usuarioId);
  if (!usuario) {
    // o token é válido, mas a conta foi excluída (RF04)
    return res.status(401).json({ erro: 'Conta não encontrada.' });
  }
  res.json({ usuario: perfil(usuario) });
}));

module.exports = router;
