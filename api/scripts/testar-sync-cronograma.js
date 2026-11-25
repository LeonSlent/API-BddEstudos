const { conectar, mongoose } = require('../db');
const Usuario = require('../models/Usuario');
const Cronograma = require('../models/Cronograma');

const BASE = 'http://localhost:3000';
const EMAIL = 'sync.cron@email.com';
let falhas = 0;
let n = 0;

async function chamar(metodo, caminho, { corpo, token } = {}) {
  const headers = {};
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(BASE + caminho, {
    method: metodo,
    headers,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  return { status: resp.status, json: await resp.json().catch(() => null) };
}

// Momentos no passado, relativos a agora (o servidor recusa o futuro)
const agora = Date.now();
const t = (segundos) => new Date(agora + segundos * 1000).toISOString();

const op = (entidade, entidade_id, operacao, payload) => ({ id: ++n, entidade, entidade_id, operacao, payload });

function conferir(descricao, ok, detalhe = '') {
  if (!ok) falhas++;
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${descricao}${detalhe ? `\n         -> ${detalhe}` : ''}`);
}

let token;
async function esperar(descricao, operacao, statusEsperado, { ignorada } = {}) {
  const r = await chamar('POST', '/sync', { corpo: { operacoes: [operacao] }, token });
  const res = r.json?.resultados?.[0];
  const ok =
    r.status === 200 && res?.status === statusEsperado &&
    (ignorada === undefined || Boolean(res.ignorada) === ignorada);
  conferir(descricao, ok, res?.motivo ?? (res?.ignorada ? 'alteração ignorada (havia uma mais recente)' : `HTTP ${r.status}`));
}

const cron = (id) => Cronograma.findById(id).lean();
const dia = (d) => d?.toISOString().slice(0, 10);

async function apagarRestos() {
  const antigo = await Usuario.findOne({ email: EMAIL }).lean();
  if (antigo) await Cronograma.deleteMany({ usuarioId: antigo._id });
  await Usuario.deleteMany({ email: EMAIL });
}

async function main() {
  await conectar();
  await apagarRestos();

  const cad = await chamar('POST', '/auth/cadastro', { corpo: { trilha_id: 'trilha-dev', nome: 'Sync Cron', email: EMAIL, senha: 'senha-forte-123' } });
  token = cad.json?.token;
  const donoId = cad.json?.usuario?.id;
  if (!token) throw new Error('O cadastro de teste falhou. O servidor está rodando?');

  const inicial = await Cronograma.findOne({ usuarioId: donoId, ativo: true });
  await esperar('desativar o ciclo inicial antes de importar outro', op('cronograma', inicial._id, 'update', { ativo: 0, atualizado_em: new Date().toISOString() }), 'ok');

  // Foto dos dados da Ana, para provar no fim que ninguém mexeu neles
  const anaAntes = await cron('cron-1');

  console.log('\n--- Cronograma ---');
  const c1 = { trilha_id: 'trilha-dev', data_inicio: '2026-11-12', ativo: 1, atualizado_em: t(-600) };
  await esperar('insert válido', op('cronograma', 'sync-c1', 'insert', c1), 'ok');
  let doc = await cron('sync-c1');
  conferir('gravado no Atlas, em nome do usuário do token',
    doc?.usuarioId === donoId && doc.ativo === true && doc.trilhaId === 'trilha-dev');
  await esperar('mesmo insert reenviado (idempotente)', op('cronograma', 'sync-c1', 'insert', c1), 'ok');
  await esperar('trilha que não existe', op('cronograma', 'sync-x1', 'insert', { ...c1, trilha_id: 'nao-existe' }), 'rejeitada');
  await esperar('data que não existe (31 de fevereiro)', op('cronograma', 'sync-x2', 'insert', { ...c1, data_inicio: '2026-02-31' }), 'rejeitada');
  await esperar('ativo = 2', op('cronograma', 'sync-x3', 'insert', { ...c1, ativo: 2 }), 'rejeitada');
  await esperar('sem atualizado_em', op('cronograma', 'sync-x4', 'insert', { trilha_id: 'trilha-dev', data_inicio: '2026-11-12', ativo: 1 }), 'rejeitada');
  await esperar('campo extra no payload (usuario_id)', op('cronograma', 'sync-x5', 'insert', { ...c1, usuario_id: 'user-1' }), 'rejeitada');
  await esperar('segundo cronograma ativo para o mesmo usuário', op('cronograma', 'sync-x6', 'insert', c1), 'rejeitada');
  conferir('nenhum dos rejeitados foi gravado',
    (await Cronograma.countDocuments({ usuarioId: donoId })) === 1);

  await esperar('desativar (ativo = 0)', op('cronograma', 'sync-c1', 'update', { ativo: 0, atualizado_em: t(-300) }), 'ok');
  conferir('ficou desativado', (await cron('sync-c1')).ativo === false);
  await esperar('alteração mais antiga que a guardada é ignorada', op('cronograma', 'sync-c1', 'update', { ativo: 1, atualizado_em: t(-500) }), 'ok', { ignorada: true });
  conferir('continua desativado', (await cron('sync-c1')).ativo === false);
  await esperar('campo que não pode mudar (trilha_id)', op('cronograma', 'sync-c1', 'update', { trilha_id: 'trilha-redes', atualizado_em: t(-200) }), 'rejeitada');
  await esperar('cronograma que não existe', op('cronograma', 'sync-nao-existe', 'update', { ativo: 0, atualizado_em: t(-200) }), 'falha');
  await esperar('cronograma de OUTRO usuário (cron-1 da Ana)', op('cronograma', 'cron-1', 'update', { ativo: 1, atualizado_em: t(-200) }), 'falha');
  await esperar('insert com um id que é de outro usuário', op('cronograma', 'cron-1', 'insert', c1), 'rejeitada');
  await esperar('delete de cronograma (não permitido)', op('cronograma', 'sync-c1', 'delete', {}), 'rejeitada');
  await esperar('trocar de trilha (RF08): novo cronograma ativo',
    op('cronograma', 'sync-c3', 'insert', { trilha_id: 'trilha-redes', data_inicio: '2026-11-13', ativo: 1, atualizado_em: t(-200) }), 'ok');

  console.log('\n--- Pesos (cronograma sync-c1, trilha Desenvolvimento) ---');
  const peso = (materia, valor, segundos) => ({ peso: valor, atualizado_em: t(segundos) });
  const pesoDe = async (materia) => (await cron('sync-c1')).pesos.find((p) => p.materiaId === materia)?.peso;

  await esperar('insert válido', op('peso_materia', 'sync-c1:mat-logica', 'insert', peso('', 1.5, -400)), 'ok');
  conferir('gravado com o valor certo', (await pesoDe('mat-logica')) === 1.5);
  await esperar('update com momento mais novo', op('peso_materia', 'sync-c1:mat-logica', 'update', peso('', 2, -100)), 'ok');
  conferir('valor atualizado para 2', (await pesoDe('mat-logica')) === 2);
  await esperar('update mais antigo é ignorado', op('peso_materia', 'sync-c1:mat-logica', 'update', peso('', 9, -350)), 'ok', { ignorada: true });
  conferir('continua em 2', (await pesoDe('mat-logica')) === 2);
  await esperar('peso zero', op('peso_materia', 'sync-c1:mat-eng-sw', 'insert', peso('', 0, -90)), 'rejeitada');
  await esperar('peso como texto', op('peso_materia', 'sync-c1:mat-eng-sw', 'insert', peso('', '2', -90)), 'rejeitada');
  await esperar('matéria de OUTRA trilha (mat-redes em Desenvolvimento)', op('peso_materia', 'sync-c1:mat-redes', 'insert', peso('', 1, -90)), 'rejeitada');
  await esperar('cronograma que não existe', op('peso_materia', 'nao-existe:mat-logica', 'insert', peso('', 1, -90)), 'falha');
  await esperar('cronograma de OUTRO usuário (cron-1 da Ana)', op('peso_materia', 'cron-1:mat-logica', 'update', peso('', 50, -90)), 'falha');
  await esperar('entidade_id sem ":"', op('peso_materia', 'sync-c1', 'insert', peso('', 1, -90)), 'rejeitada');
  await esperar('entidade_id com três partes', op('peso_materia', 'a:b:c', 'insert', peso('', 1, -90)), 'rejeitada');

  console.log('\n--- Etapas (cronograma sync-c1) ---');
  const e1 = { cronograma_id: 'sync-c1', materia_id: 'mat-logica', data: '2026-11-12', duracao_min: 90, pausa_min: 10, concluida: 0, atualizado_em: t(-400) };
  const etapaDe = async (id) => (await cron('sync-c1')).etapas.find((e) => e._id === id);

  await esperar('insert válido', op('etapa_estudo', 'sync-e1', 'insert', e1), 'ok');
  conferir('gravada com os valores certos', (await etapaDe('sync-e1'))?.duracaoMin === 90);
  await esperar('mesmo insert reenviado (idempotente)', op('etapa_estudo', 'sync-e1', 'insert', e1), 'ok');
  conferir('continua só uma etapa', (await cron('sync-c1')).etapas.length === 1);
  await esperar('150 minutos (RNF02)', op('etapa_estudo', 'sync-x1', 'insert', { ...e1, duracao_min: 150 }), 'rejeitada');
  await esperar('90.5 minutos', op('etapa_estudo', 'sync-x2', 'insert', { ...e1, duracao_min: 90.5 }), 'rejeitada');
  await esperar('duração como texto', op('etapa_estudo', 'sync-x3', 'insert', { ...e1, duracao_min: '90' }), 'rejeitada');
  await esperar('data que não existe', op('etapa_estudo', 'sync-x4', 'insert', { ...e1, data: '2026-02-31' }), 'rejeitada');
  await esperar('concluída sem data de conclusão', op('etapa_estudo', 'sync-x5', 'insert', { ...e1, concluida: 1 }), 'rejeitada');
  await esperar('matéria de OUTRA trilha', op('etapa_estudo', 'sync-x6', 'insert', { ...e1, materia_id: 'mat-redes' }), 'rejeitada');
  await esperar('campo extra no payload (usuario_id)', op('etapa_estudo', 'sync-x7', 'insert', { ...e1, usuario_id: 'user-1' }), 'rejeitada');
  await esperar('cronograma que não existe', op('etapa_estudo', 'sync-x8', 'insert', { ...e1, cronograma_id: 'nao-existe' }), 'falha');
  await esperar('cronograma de OUTRO usuário (cron-1 da Ana)', op('etapa_estudo', 'sync-x9', 'insert', { ...e1, cronograma_id: 'cron-1' }), 'falha');
  conferir('nenhuma etapa rejeitada foi gravada', (await cron('sync-c1')).etapas.length === 1);

  await esperar('concluir a etapa (RF12)',
    op('etapa_estudo', 'sync-e1', 'update', { concluida: 1, concluida_em: t(-50), atualizado_em: t(-50) }), 'ok');
  conferir('ficou concluída, com a data', (await etapaDe('sync-e1')).concluida === true && Boolean((await etapaDe('sync-e1')).concluidaEm));

  await esperar('segunda etapa (pendente)',
    op('etapa_estudo', 'sync-e2', 'insert', { ...e1, materia_id: 'mat-eng-sw', duracao_min: 60, atualizado_em: t(-390) }), 'ok');
  await esperar('atrasar a etapa um dia (RF13)', op('etapa_estudo', 'sync-e2', 'update', { data: '2026-11-13', atualizado_em: t(-40) }), 'ok');
  conferir('data virou 2026-11-13', dia((await etapaDe('sync-e2')).data) === '2026-11-13');
  await esperar('alteração mais antiga é ignorada', op('etapa_estudo', 'sync-e2', 'update', { data: '2026-11-20', atualizado_em: t(-300) }), 'ok', { ignorada: true });
  conferir('data continua 2026-11-13', dia((await etapaDe('sync-e2')).data) === '2026-11-13');
  await esperar('campo que não pode mudar (materia_id)', op('etapa_estudo', 'sync-e2', 'update', { materia_id: 'mat-logica', atualizado_em: t(-30) }), 'rejeitada');
  await esperar('duração de 200 minutos', op('etapa_estudo', 'sync-e2', 'update', { duracao_min: 200, atualizado_em: t(-30) }), 'rejeitada');
  await esperar('concluir sem informar a data de conclusão', op('etapa_estudo', 'sync-e2', 'update', { concluida: 1, atualizado_em: t(-30) }), 'rejeitada');
  conferir('a etapa continua pendente', (await etapaDe('sync-e2')).concluida === false);
  await esperar('update sem nenhum campo', op('etapa_estudo', 'sync-e2', 'update', { atualizado_em: t(-30) }), 'rejeitada');
  await esperar('etapa que não existe', op('etapa_estudo', 'sync-nao-existe', 'update', { data: '2026-11-13', atualizado_em: t(-30) }), 'falha');
  await esperar('etapa de OUTRO usuário (et-2 da Ana)', op('etapa_estudo', 'et-2', 'update', { data: '2030-01-01', atualizado_em: t(-30) }), 'falha');

  await esperar('atualizado_em no futuro (2999)', op('etapa_estudo', 'sync-e2', 'update', { data: '2026-11-14', atualizado_em: '2999-01-01T00:00:00Z' }), 'ok');
  conferir('o servidor usou a própria hora em vez da data do futuro',
    new Date((await etapaDe('sync-e2')).atualizadoEm).getTime() <= Date.now() + 2000);

  await esperar('apagar etapa concluída (não permitido)', op('etapa_estudo', 'sync-e1', 'delete', {}), 'rejeitada');
  await esperar('apagar etapa pendente', op('etapa_estudo', 'sync-e2', 'delete', {}), 'ok');
  conferir('a etapa pendente sumiu e a concluída ficou',
    !(await etapaDe('sync-e2')) && Boolean(await etapaDe('sync-e1')));
  await esperar('apagar de novo (idempotente)', op('etapa_estudo', 'sync-e2', 'delete', {}), 'ok');

  console.log('\n--- Lote misto: cronograma, peso e etapas dependentes no mesmo pedido ---');
  const lote = await chamar('POST', '/sync', {
    token,
    corpo: {
      operacoes: [
        op('cronograma', 'sync-c4', 'insert', { trilha_id: 'trilha-dev', data_inicio: '2026-11-15', ativo: 0, atualizado_em: t(-20) }),
        op('peso_materia', 'sync-c4:mat-bd-dev', 'insert', { peso: 2, atualizado_em: t(-19) }),
        op('etapa_estudo', 'sync-e5', 'insert', { cronograma_id: 'sync-c4', materia_id: 'mat-bd-dev', data: '2026-11-15', duracao_min: 45, atualizado_em: t(-18) }),
        op('etapa_estudo', 'sync-e6', 'insert', { cronograma_id: 'sync-c4', materia_id: 'mat-bd-dev', data: '2026-11-15', duracao_min: 500, atualizado_em: t(-17) }),
      ],
    },
  });
  const r = lote.json?.resultados ?? [];
  conferir('quatro resultados, na ordem: ok, ok, ok, rejeitada',
    r.map((x) => x.status).join() === 'ok,ok,ok,rejeitada', r.map((x) => `${x.id}:${x.status}`).join('  '));
  const c4 = await cron('sync-c4');
  conferir('o cronograma novo ficou com 1 peso e 1 etapa', c4?.pesos.length === 1 && c4.etapas.length === 1);

  console.log('\n--- Os dados da Ana não foram tocados ---');
  const anaDepois = await cron('cron-1');
  conferir('cron-1 da Ana é idêntico ao de antes dos testes',
    JSON.stringify(anaAntes) === JSON.stringify(anaDepois));

  await Cronograma.deleteMany({ usuarioId: donoId });
  await Usuario.deleteOne({ _id: donoId });
  console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} teste(s) com resultado inesperado.`);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});