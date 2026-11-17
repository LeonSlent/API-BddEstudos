const express = require('express');
const Trilha = require('../models/Trilha');
const Questao = require('../models/Questao');
const Concurso = require('../models/Concurso');

const router = express.Router();

// Encaminha erros de rotas async para o tratador de erros do servidor
const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// GET /catalogo/trilhas
// Todas as trilhas, já com matérias e temas embutidos
router.get('/trilhas', rota(async (req, res) => {
  const trilhas = await Trilha.find().sort({ nome: 1 }).select('-__v').lean();
  res.json({ total: trilhas.length, trilhas });
}));

// GET /catalogo/questoes?trilhaId=trilha-dev&desde=2026-11-01T00:00:00Z&pagina=1&limite=200
// Questões de uma trilha. O parâmetro "desde" traz só o que mudou depois dessa data.
router.get('/questoes', rota(async (req, res) => {
  const { trilhaId, desde } = req.query;

  if (typeof trilhaId !== 'string' || !trilhaId) {
    return res.status(400).json({ erro: 'Informe o parâmetro trilhaId.' });
  }

  let desdeData;
  if (desde !== undefined) {
    desdeData = typeof desde === 'string' ? new Date(desde) : new Date(NaN);
    if (Number.isNaN(desdeData.getTime())) {
      return res.status(400).json({ erro: 'O parâmetro desde precisa ser uma data válida, como 2026-11-01T00:00:00Z.' });
    }
  }

  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 200, 1), 500);
  const pagina = Math.max(parseInt(req.query.pagina, 10) || 1, 1);

  const trilha = await Trilha.findById(trilhaId).select('materias._id').lean();
  if (!trilha) {
    return res.status(404).json({ erro: `Trilha "${trilhaId}" não encontrada.` });
  }

  const filtro = { materiaId: { $in: trilha.materias.map((m) => m._id) } };
  if (desdeData) filtro.updatedAt = { $gt: desdeData };

  const [total, questoes] = await Promise.all([
    Questao.countDocuments(filtro),
    Questao.find(filtro)
      .sort({ _id: 1 })
      .skip((pagina - 1) * limite)
      .limit(limite)
      .select('-__v')
      .lean(),
  ]);

  res.json({ total, pagina, limite, questoes });
}));

// GET /catalogo/concursos?trilhaId=trilha-dados
// Concursos com edital ainda aberto, do que fecha primeiro para o que fecha depois
router.get('/concursos', rota(async (req, res) => {
  const { trilhaId } = req.query;
  if (trilhaId !== undefined && typeof trilhaId !== 'string') {
    return res.status(400).json({ erro: 'O parâmetro trilhaId precisa ser um texto.' });
  }

  const hoje = new Date(new Date().toISOString().slice(0, 10)); // meia-noite UTC de hoje
  const filtro = { fimEdital: { $gte: hoje } };
  if (trilhaId) filtro.trilhaIds = trilhaId;

  const concursos = await Concurso.find(filtro).sort({ fimEdital: 1 }).select('-__v').lean();
  res.json({ total: concursos.length, concursos });
}));

module.exports = router;