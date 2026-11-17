
const express = require('express');
const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');
const Cronograma = require('../models/Cronograma');
const Tentativa = require('../models/Tentativa');
const Feedback = require('../models/Feedback');
const { autenticar } = require('../middleware/auth');
const { limiteConta } = require('../middleware/limites');
const { CUSTO_BCRYPT, gerarToken, perfil, erroDeSenha } = require('../lib/usuario-comum');

const router = express.Router();
const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(autenticar); // tudo aqui exige login

const SESSAO_INVALIDA = { erro: 'Sessão inválida ou expirada. Faça login de novo.' };
const CAMPOS_PATCH = ['nome', 'email', 'senhaAtual', 'novaSenha'];

async function senhaConfere(texto, hash) {
  if (typeof texto !== 'string' || texto.length > 200) return false;
  return bcrypt.compare(texto, hash);
}

// GET /conta  (RF03): consultar os dados da conta
router.get('/', rota(async (req, res) => {
  const usuario = await Usuario.findById(req.usuarioId);
  if (!usuario) return res.status(401).json(SESSAO_INVALIDA);
  res.json({ usuario: perfil(usuario) });
}));

// PATCH /conta  (RF02)   corpo: { nome?, email?, novaSenha?, senhaAtual? }
router.patch('/', limiteConta, rota(async (req, res) => {
  const corpo = req.body;
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return res.status(400).json({ erro: 'Envie os campos a alterar em JSON.' });
  }
  const extras = Object.keys(corpo).filter((k) => !CAMPOS_PATCH.includes(k));
  if (extras.length) {
    return res.status(400).json({ erro: `Campo(s) não permitido(s): ${extras.slice(0, 5).join(', ')}.` });
  }
  for (const campo of CAMPOS_PATCH) {
    if (corpo[campo] !== undefined && typeof corpo[campo] !== 'string') {
      return res.status(400).json({ erro: `${campo} precisa ser um texto.` });
    }
  }
  const { nome, email, senhaAtual, novaSenha } = corpo;
  if (nome === undefined && email === undefined && novaSenha === undefined) {
    return res.status(400).json({ erro: 'Envie pelo menos um campo: nome, email ou novaSenha.' });
  }

  const usuario = await Usuario.findById(req.usuarioId).select('+senhaHash');
  if (!usuario) return res.status(401).json(SESSAO_INVALIDA);

  const novoEmail = email !== undefined ? email.trim().toLowerCase() : undefined;
  const mudaEmail = novoEmail !== undefined && novoEmail !== usuario.email;
  const mudaSenha = novaSenha !== undefined;

  // E-mail e senha são o que protege a conta: pedimos a senha atual de novo
  if (mudaEmail || mudaSenha) {
    if (!usuario.senhaHash) {
      return res.status(400).json({ erro: 'Contas criadas com o Google não podem trocar e-mail nem senha por aqui.' });
    }
    if (senhaAtual === undefined) {
      return res.status(400).json({ erro: 'Informe a senhaAtual para trocar e-mail ou senha.' });
    }
    if (!(await senhaConfere(senhaAtual, usuario.senhaHash))) {
      return res.status(403).json({ erro: 'Senha atual incorreta.' });
    }
  }

  if (mudaSenha) {
    const erro = erroDeSenha(novaSenha);
    if (erro) return res.status(400).json({ erro });
    usuario.senhaHash = await bcrypt.hash(novaSenha, CUSTO_BCRYPT);
    usuario.versaoToken = (usuario.versaoToken ?? 0) + 1; // derruba os tokens antigos
  }
  if (nome !== undefined) usuario.nome = nome;
  if (mudaEmail) usuario.email = novoEmail;

  try {
    await usuario.save();
  } catch (erro) {
    if (erro.code === 11000 && erro.keyPattern?.email) {
      return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
    }
    if (erro.name === 'ValidationError') {
      return res.status(400).json({ erro: Object.values(erro.errors).map((e) => e.message).join(' ') });
    }
    throw erro;
  }

  const resposta = { usuario: perfil(usuario) };
  // Quem trocou a senha recebe um token novo, para continuar logado neste aparelho
  if (mudaSenha) resposta.token = gerarToken(usuario._id, usuario.versaoToken);
  res.json(resposta);
}));

// POST /conta/excluir  (RF04)   corpo: { confirmacao: "EXCLUIR", senha? }
router.post('/excluir', limiteConta, rota(async (req, res) => {
  const { senha, confirmacao } = req.body ?? {};
  if (confirmacao !== 'EXCLUIR') {
    return res.status(400).json({ erro: 'Para excluir a conta, envie confirmacao: "EXCLUIR".' });
  }

  const usuario = await Usuario.findById(req.usuarioId).select('+senhaHash');
  if (!usuario) return res.status(401).json(SESSAO_INVALIDA);

  if (usuario.senhaHash) { // contas do Google não têm senha
    if (typeof senha !== 'string') {
      return res.status(400).json({ erro: 'Informe a sua senha para excluir a conta.' });
    }
    if (!(await senhaConfere(senha, usuario.senhaHash))) {
      return res.status(403).json({ erro: 'Senha incorreta.' });
    }
  }

  const id = usuario._id;
  const apagarDados = async () => {
    const [c, t, f] = await Promise.all([
      Cronograma.deleteMany({ usuarioId: id }),
      Tentativa.deleteMany({ usuarioId: id }),
      Feedback.deleteMany({ usuarioId: id }),
    ]);
    return { cronogramas: c.deletedCount, tentativas: t.deletedCount, feedbacks: f.deletedCount };
  };

  // Sem CASCADE no Mongo, apagamos tudo na mão. A segunda varredura, depois de
  // apagar o usuário, pega qualquer coisa que tenha chegado no meio do caminho.
  const antes = await apagarDados();
  await Usuario.deleteOne({ _id: id });
  const depois = await apagarDados();

  res.json({
    ok: true,
    apagados: {
      cronogramas: antes.cronogramas + depois.cronogramas,
      tentativas: antes.tentativas + depois.tentativas,
      feedbacks: antes.feedbacks + depois.feedbacks,
    },
  });
}));

module.exports = router;