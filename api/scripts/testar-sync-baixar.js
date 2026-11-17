const { conectar, mongoose } = require('../db');
const Usuario = require('../models/Usuario');
const Cronograma = require('../models/Cronograma');
const Tentativa = require('../models/Tentativa');

const BASE = 'http://localhost:3000';
const EMAIL = 'sync.baixar@email.com';
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

const agoraMs = Date.now();
const t = (segundos) => new Date(agoraMs + segundos * 1000).toISOString();
const op = (entidade, entidade_id, operacao, payload) => ({ id: ++n, entidade, entidade_id, operacao, payload });
const enviar = (operacoes, token) => chamar('POST', '/sync', { corpo: { operacoes }, token });
const baixar = (token, query = '') => chamar('GET', `/sync${query}`, { token });
const comDesde = (desde) => `?desde=${encodeURIComponent(desde)}`;

function conferir(descricao, ok, detalhe = '') {
  if (!ok) falhas++;
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${descricao}${detalhe ? `\n         -> ${detalhe}` : ''}`);
}

async function limpar() {
  await Tentativa.deleteMany({ _id: /^baixar-/ });
  const antigo = await Usuario.findOne({ email: EMAIL }).lean();
  if (antigo) {
    await Cronograma.deleteMany({ usuarioId: antigo._id });
    await Tentativa.deleteMany({ usuarioId: antigo._id });
  }
  await Usuario.deleteMany({ email: EMAIL });
}

async function main() {
  await conectar();
  await limpar();

  const login = await chamar('POST', '/auth/login', { corpo: { email: 'ana@email.com', senha: 'senha-de-teste-123' } });
  const tokenAna = login.json?.token;
  if (!tokenAna) throw new Error('Não consegui fazer login com a Ana. Rode seed-usuarios.js.');

  const cad = await chamar('POST', '/auth/cadastro', { corpo: { nome: 'Baixar Teste', email: EMAIL, senha: 'senha-forte-123' } });
  const token = cad.json?.token;
  const donoId = cad.json?.usuario?.id;
  if (!token) throw new Error('O cadastro de teste falhou. O servidor está rodando?');

  console.log('\n--- Acesso e parâmetros ---');
  conferir('sem token → 401', (await baixar(undefined)).status === 401);
  conferir('desde inválido → 400', (await baixar(tokenAna, '?desde=abc')).status === 400);
  conferir('desde repetido → 400', (await baixar(tokenAna, '?desde=a&desde=b')).status === 400);
  conferir('desde no futuro → 400', (await baixar(tokenAna, comDesde('2999-01-01T00:00:00Z'))).status === 400);

  console.log('\n--- Download completo (aparelho novo) com a Ana ---');
  const r1 = await baixar(tokenAna);
  const j = r1.json;
  conferir('responde 200', r1.status === 200);
  conferir('perfil da Ana', j?.usuario?.email === 'ana@email.com' && j.usuario.provedor_login === 'email');
  conferir('nenhum hash de senha na resposta', !/\$2[aby]\$/.test(JSON.stringify(j)) && !JSON.stringify(j).includes('senha'));
  const cron1 = j?.cronogramas?.find((c) => c.id === 'cron-1');
  const cron2 = j?.cronogramas?.find((c) => c.id === 'cron-2');
  conferir('vieram o cron-1 e o cron-2', Boolean(cron1) && Boolean(cron2));
  conferir('cron-1: inativo, com a data certa', cron1?.ativo === 0 && cron1.data_inicio === '2026-11-10');
  conferir('cron-1 veio com os 3 pesos e as 4 etapas', cron1?.pesos.length === 3 && cron1.etapas.length === 4);
  conferir('cron-2: ativo, sem etapas', cron2?.ativo === 1 && cron2.etapas.length === 0);
  conferir('etapas no formato do SQLite (data AAAA-MM-DD, concluida 0 ou 1)',
    cron1?.etapas.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.data) && (e.concluida === 0 || e.concluida === 1)));
  const et1 = cron1?.etapas.find((e) => e.id === 'et-1');
  conferir('et-1 concluída, com a hora de conclusão', et1?.concluida === 1 && Boolean(et1.concluida_em));
  conferir('nenhum atualizado_em vazio',
    [cron1, cron2, ...cron1.pesos, ...cron1.etapas].every((x) => Boolean(x.atualizado_em)));
  const idsTent = (j?.tentativas ?? []).map((x) => x.id);
  conferir('vieram as tentativas t1, t2 e t3', ['t1', 't2', 't3'].every((id) => idsTent.includes(id)));
  const tt2 = j?.tentativas.find((x) => x.id === 't2');
  conferir('t2 no formato do SQLite', tt2?.acertou === 1 && tt2.proxima_revisao === '2026-11-12' && tt2.intervalo_dias === 3);
  conferir('tem_mais = false e proximo_desde = agora', j?.tem_mais === false && j.proximo_desde === j.agora);

  console.log('\n--- Só o que mudou desde a última vez ---');
  const r2 = await baixar(tokenAna, comDesde(j.agora));
  conferir('nada mudou: zero cronogramas e zero tentativas',
    r2.json?.cronogramas.length === 0 && r2.json.tentativas.length === 0);
  conferir('o perfil continua vindo (é pequeno)', r2.json?.usuario?.email === 'ana@email.com');

  await enviar([op('tentativa_exercicio', 'baixar-t1', 'insert',
    { questao_id: 'q1', acertou: 1, respondida_em: t(-10) })], tokenAna);
  const r3 = await baixar(tokenAna, comDesde(j.agora));
  conferir('uma tentativa nova aparece sozinha',
    r3.json?.tentativas.length === 1 && r3.json.tentativas[0].id === 'baixar-t1' && r3.json.cronogramas.length === 0);

  console.log('\n--- Isolamento entre usuários ---');
  const vazio = await baixar(token);
  conferir('usuário novo baixa tudo vazio',
    vazio.json?.cronogramas.length === 0 && vazio.json.tentativas.length === 0 && vazio.json.usuario.email === EMAIL);

  console.log('\n--- O cronograma vem como retrato completo ---');
  await enviar([
    op('cronograma', 'baixar-c1', 'insert', { trilha_id: 'trilha-dev', data_inicio: '2026-11-12', ativo: 1, atualizado_em: t(-300) }),
    op('peso_materia', 'baixar-c1:mat-logica', 'insert', { peso: 2, atualizado_em: t(-290) }),
    op('etapa_estudo', 'baixar-e1', 'insert', { cronograma_id: 'baixar-c1', materia_id: 'mat-logica', data: '2026-11-12', duracao_min: 60, atualizado_em: t(-280) }),
    op('etapa_estudo', 'baixar-e2', 'insert', { cronograma_id: 'baixar-c1', materia_id: 'mat-logica', data: '2026-11-13', duracao_min: 45, atualizado_em: t(-270) }),
  ], token);
  const r4 = await baixar(token);
  const c = r4.json?.cronogramas.find((x) => x.id === 'baixar-c1');
  conferir('o cronograma criado veio com 1 peso e 2 etapas', c?.pesos.length === 1 && c.etapas.length === 2);
  conferir('o outro usuário só vê o que é dele (nada da Ana)',
    r4.json.cronogramas.every((x) => x.usuario_id === donoId) && r4.json.tentativas.length === 0);

  await enviar([op('etapa_estudo', 'baixar-e2', 'delete', {})], token);
  const r5 = await baixar(token, comDesde(r4.json.agora));
  const c5 = r5.json?.cronogramas.find((x) => x.id === 'baixar-c1');
  conferir('apagar uma etapa: o retrato novo vem sem ela',
    c5?.etapas.length === 1 && c5.etapas[0].id === 'baixar-e1',
    'é assim que o app descobre que a etapa sumiu');

  await enviar([op('etapa_estudo', 'baixar-e1', 'update', { concluida: 1, concluida_em: t(-5), atualizado_em: t(-5) })], token);
  const r6 = await baixar(token, comDesde(r5.json.agora));
  const e1 = r6.json?.cronogramas.find((x) => x.id === 'baixar-c1')?.etapas[0];
  conferir('concluir uma etapa: aparece como concluída', e1?.concluida === 1 && Boolean(e1.concluida_em));

  console.log('\n--- Paginação das tentativas (limite = 10, são 25 tentativas) ---');
  const lote = Array.from({ length: 25 }, (_, i) =>
    op('tentativa_exercicio', `baixar-p${i}`, 'insert', { questao_id: 'q1', acertou: i % 2, respondida_em: t(-200 + i) }));
  const envio = await enviar(lote, token);
  conferir('as 25 tentativas foram aceitas', envio.json?.resultados.every((x) => x.status === 'ok'));

  let desde = null;
  let temMais = true;
  let paginas = 0;
  const ids = new Set();
  while (temMais && paginas < 20) {
    const r = await baixar(token, `?limite=10${desde ? `&desde=${encodeURIComponent(desde)}` : ''}`);
    (r.json?.tentativas ?? []).forEach((x) => ids.add(x.id));
    temMais = r.json?.tem_mais === true;
    desde = r.json?.proximo_desde;
    paginas++;
  }
  conferir(`baixou as 25 tentativas, sem perder nenhuma, em ${paginas} páginas`, ids.size === 25 && paginas >= 3);

  await limpar();
  console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} teste(s) com resultado inesperado.`);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});