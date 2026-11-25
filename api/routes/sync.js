const express = require('express');
const { autenticar } = require('../middleware/auth');
const Tentativa = require('../models/Tentativa');
const Feedback = require('../models/Feedback');
const { Rejeicao, Temporario, parseMomento } = require('../lib/sync-comum');
const Cronograma = require('../models/Cronograma');
const Usuario = require('../models/Usuario');
const tratadoresCronograma = require('../lib/sync-cronograma');

const router = express.Router();
router.use(autenticar); // tudo aqui exige login

const MAX_OPERACOES = 100;
const ID_VALIDO = /^[\w:-]{1,100}$/;
const OPERACOES = ['insert', 'update', 'delete'];

// Entidades da fila que ainda não tratamos
const PENDENTES = new Set(['usuario']);

const { salvarTentativa } = require('../lib/estudo');
const { linhaCronograma, linhaTentativa } = require('../lib/linhas-estudo');

// ---------- feedback: só insert ----------
async function inserirFeedback(usuarioId, entidadeId, p) {
  const existente = await Feedback.findById(entidadeId).select('usuarioId').lean();
  if (existente) {
    if (existente.usuarioId === usuarioId) return;
    throw new Rejeicao('Este id já está em uso.');
  }
  await Feedback.create({
    _id: entidadeId,
    usuarioId,
    tipo: p.tipo,
    texto: p.texto,
    versaoApp: p.versao_app ?? undefined,
  });
}

// Quem faz o quê. Operação que não está aqui é recusada.
const TRATADORES = {
  tentativa_exercicio: { insert: salvarTentativa },
  feedback: { insert: inserirFeedback },
  ...tratadoresCronograma, // cronograma, peso_materia, etapa_estudo
};

async function processar(usuarioId, item) {
  const id = Number.isInteger(item?.id) ? item.id : null;
  try {
    if (id === null) throw new Rejeicao('O item precisa ter um id numérico.');

    const { entidade, entidade_id: entidadeId, operacao, payload } = item;

    if (typeof entidade !== 'string') throw new Rejeicao('Entidade inválida.');
    const conhecida = Object.hasOwn(TRATADORES, entidade) || PENDENTES.has(entidade);
    if (!conhecida) throw new Rejeicao(`Entidade desconhecida: ${entidade.slice(0, 40)}.`);

    if (!OPERACOES.includes(operacao)) throw new Rejeicao('Operação inválida.');
    if (typeof entidadeId !== 'string' || !ID_VALIDO.test(entidadeId)) {
      throw new Rejeicao('entidade_id inválido.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Rejeicao('O payload precisa ser um objeto.');
    }

    if (PENDENTES.has(entidade)) {
      throw new Temporario('Esta entidade ainda não é aceita pela API.');
    }

    const tratador = TRATADORES[entidade][operacao];
    if (!tratador) throw new Rejeicao('Operação não permitida para esta entidade.');

    const retorno = await tratador(usuarioId, entidadeId, payload);
    if (entidade === 'tentativa_exercicio') {
      const resultado = { id, status: 'ok', tentativa: linhaTentativa(retorno.tentativa) };
      if (payload.incluir_cronograma === true) {
        resultado.plano = retorno.plano ? { cronograma: linhaCronograma(retorno.plano.ciclo), resumo: retorno.plano.resumo } : null;
      }
      return resultado;
    }
    // "ignorada": havia uma alteração mais recente no servidor. Para o app é o mesmo que ok.
    return retorno?.ignorada ? { id, status: 'ok', ignorada: true } : { id, status: 'ok' };
  } catch (erro) {
    if (erro instanceof Rejeicao) return { id, status: 'rejeitada', motivo: erro.message };
    if (erro instanceof Temporario) return { id, status: 'falha', motivo: erro.message };
    if (erro.name === 'ValidationError') {
      const motivo = Object.values(erro.errors).map((e) => e.message).join(' ');
      return { id, status: 'rejeitada', motivo };
    }
    if (erro.code === 11000) return { id, status: 'rejeitada', motivo: 'Registro duplicado.' };
    console.error('Erro no /sync:', erro.message);
    return { id, status: 'falha', motivo: 'Erro temporário no servidor. Tente de novo.' };
  }
}

// POST /sync   corpo: { operacoes: [ {id, entidade, entidade_id, operacao, payload}, ... ] }
router.post('/', async (req, res, next) => {
  try {
    const { operacoes } = req.body ?? {};
    if (!Array.isArray(operacoes) || operacoes.length === 0 || operacoes.length > MAX_OPERACOES) {
      return res.status(400).json({ erro: `Envie de 1 a ${MAX_OPERACOES} operações em "operacoes".` });
    }

    // Em ordem: a ordem em que o usuário agiu importa
    const resultados = [];
    for (const item of operacoes) {
      resultados.push(await processar(req.usuarioId, item));
    }
    res.json({ resultados });
  } catch (erro) {
    next(erro);
  }
});

module.exports = router;

// ======================= GET /sync (baixar) =======================
// GET /sync?desde=2026-11-11T10:00:00Z&limite=500
// Sem "desde": baixa tudo (aparelho novo). Com "desde": só o que mudou depois.

const iso = (d) => d?.toISOString() ?? null;

router.get('/', async (req, res, next) => {
  try {
    const agora = new Date(); // guardado ANTES das consultas

    let desde = null;
    if (req.query.desde !== undefined) {
      desde = parseMomento(req.query.desde);
      if (!desde || desde > agora) {
        return res.status(400).json({
          erro: 'desde precisa ser uma data e hora válidas no passado, como 2026-11-11T10:00:00Z.',
        });
      }
    }
    // mínimo de 10: com poucos itens por página, itens com a mesma hora podem travar a paginação
    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 500, 10), 500);

    const filtro = { usuarioId: req.usuarioId };
    if (desde) filtro.updatedAt = { $gte: desde }; // $gte: repetir um item na borda é inofensivo

    const usuario = await Usuario.findById(req.usuarioId).lean();
    if (!usuario) return res.status(401).json({ erro: 'Conta não encontrada.' });

    const [cronogramas, tentativas] = await Promise.all([
      Cronograma.find(filtro).sort({ updatedAt: 1, _id: 1 }).lean(),
      Tentativa.find(filtro).sort({ updatedAt: 1, _id: 1 }).limit(limite + 1).lean(),
    ]);

    const temMais = tentativas.length > limite;
    const pagina = temMais ? tentativas.slice(0, limite) : tentativas;
    // Se ainda há páginas, o app continua a partir da última tentativa recebida
    const proximoDesde = temMais ? pagina[pagina.length - 1].updatedAt : agora;

    res.json({
      agora: iso(agora),
      proximo_desde: iso(proximoDesde),
      tem_mais: temMais,
      usuario: {
        id: usuario._id,
        nome: usuario.nome,
        email: usuario.email,
        provedor_login: usuario.provedorLogin,
        criado_em: iso(usuario.createdAt),
        atualizado_em: iso(usuario.updatedAt),
      },
      cronogramas: cronogramas.map(linhaCronograma),
      tentativas: pagina.map(linhaTentativa),
    });
  } catch (erro) {
    next(erro);
  }
});
