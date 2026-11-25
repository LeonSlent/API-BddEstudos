const jwt = require('jsonwebtoken');
const { conectar, mongoose } = require('../db');
const Usuario = require('../models/Usuario');
const Cronograma = require('../models/Cronograma');
const Tentativa = require('../models/Tentativa');
const Feedback = require('../models/Feedback');

const BASE = process.env.BASE || 'http://localhost:3000';
const A = 'conta.a@email.com';
const A_NOVO = 'conta.novo@email.com';
const B = 'conta.b@email.com';
const G = 'conta.g@gmail.com';
const SENHA = 'senha-forte-123';
const SENHA_NOVA = 'outra-senha-456';
let falhas = 0;

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

const eu = (token) => chamar('GET', '/conta', { token });
const patch = (corpo, token) => chamar('PATCH', '/conta', { corpo, token });
const excluir = (corpo, token) => chamar('POST', '/conta/excluir', { corpo, token });
const login = (email, senha) => chamar('POST', '/auth/login', { corpo: { email, senha } });
const cadastro = (email) => chamar('POST', '/auth/cadastro', { corpo: { trilha_id: 'trilha-dev', nome: 'Conta Teste', email, senha: SENHA } });

function conferir(descricao, ok, detalhe = '') {
  if (!ok) falhas++;
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${descricao}${detalhe ? `\n         -> ${detalhe}` : ''}`);
}
function esperar(descricao, r, statusEsperado, verificar) {
  const ok = r.status === statusEsperado && (!verificar || verificar(r.json));
  conferir(`[${r.status}] ${descricao}`, ok, r.json?.erro ?? '');
}

async function limpar() {
  const usuarios = await Usuario.find({ email: { $in: [A, A_NOVO, B, G] } }).select('_id').lean();
  const ids = usuarios.map((u) => u._id);
  await Promise.all([
    Cronograma.deleteMany({ usuarioId: { $in: ids } }),
    Tentativa.deleteMany({ usuarioId: { $in: ids } }),
    Feedback.deleteMany({ usuarioId: { $in: ids } }),
  ]);
  await Usuario.deleteMany({ _id: { $in: ids } });
}

// O cadastro já criou o cronograma. Acrescenta os outros dados da conta.
async function criarDados(usuarioId, prefixo) {
  await Tentativa.create({ _id: `${prefixo}-t`, usuarioId, questaoId: 'q1', acertou: true });
  await Feedback.create({ _id: `${prefixo}-f`, usuarioId, tipo: 'erro', texto: 'Teste' });
}
const contar = async (usuarioId) => [
  await Cronograma.countDocuments({ usuarioId }),
  await Tentativa.countDocuments({ usuarioId }),
  await Feedback.countDocuments({ usuarioId }),
].join();

async function main() {
  await conectar();
  await limpar();

  const cadA = await cadastro(A);
  const cadB = await cadastro(B);
  if (!cadA.json?.token) throw new Error('O cadastro de teste falhou. O servidor está rodando?');
  const tA = cadA.json.token;
  const tB = cadB.json.token;
  const idA = cadA.json.usuario.id;
  const idB = cadB.json.usuario.id;

  await Usuario.create({ _id: 'conta-g', nome: 'Google Teste', email: G, provedorLogin: 'google' });
  const tG = jwt.sign({}, process.env.JWT_SECRET, { subject: 'conta-g', expiresIn: '1h' });

  const anaAntes = JSON.stringify(await Cronograma.findById('cron-1').lean());
  const anaTentativasAntes = await Tentativa.countDocuments({ usuarioId: 'user-1' });

  console.log('\n--- Consultar a conta (RF03) ---');
  esperar('sem token', await eu(), 401);
  esperar('com token', await eu(tA), 200,
    (j) => j.usuario.email === A && j.usuario.id === idA && !JSON.stringify(j).includes('senha'));

  console.log('\n--- Editar: validações gerais ---');
  esperar('sem token', await patch({ nome: 'X' }), 401);
  esperar('corpo vazio', await patch({}, tA), 400);
  esperar('campo não permitido (provedorLogin)', await patch({ provedorLogin: 'google' }, tA), 400);
  esperar('campo não permitido (senhaHash)', await patch({ senhaHash: 'x' }, tA), 400);
  esperar('campo não permitido (_id)', await patch({ _id: 'outro' }, tA), 400);
  esperar('nome como número', await patch({ nome: 123 }, tA), 400);
  esperar('nome vazio', await patch({ nome: '   ' }, tA), 400);
  esperar('nome com 121 caracteres', await patch({ nome: 'a'.repeat(121) }, tA), 400);
  esperar('nome válido', await patch({ nome: '  Novo Nome  ' }, tA), 200, (j) => j.usuario.nome === 'Novo Nome');
  conferir('nome gravado sem os espaços das pontas', (await Usuario.findById(idA)).nome === 'Novo Nome');

  console.log('\n--- Editar: e-mail ---');
  esperar('sem a senha atual', await patch({ email: A_NOVO }, tA), 400);
  esperar('senha atual incorreta', await patch({ email: A_NOVO, senhaAtual: 'errada-123456' }, tA), 403);
  esperar('e-mail como objeto', await patch({ email: { $ne: null }, senhaAtual: SENHA }, tA), 400);
  esperar('e-mail em formato inválido', await patch({ email: 'sem-arroba', senhaAtual: SENHA }, tA), 400);
  esperar('e-mail que é de outro usuário (maiúsculas)', await patch({ email: B.toUpperCase(), senhaAtual: SENHA }, tA), 409);
  esperar('e-mail novo', await patch({ email: 'Conta.Novo@Email.com', senhaAtual: SENHA }, tA), 200,
    (j) => j.usuario.email === A_NOVO);
  esperar('login com o e-mail antigo', await login(A, SENHA), 401);
  esperar('login com o e-mail novo', await login(A_NOVO, SENHA), 200);

  console.log('\n--- Editar: senha ---');
  esperar('nova senha curta', await patch({ novaSenha: '1234567', senhaAtual: SENHA }, tA), 400);
  esperar('sem a senha atual', await patch({ novaSenha: SENHA_NOVA }, tA), 400);
  esperar('senha atual incorreta', await patch({ novaSenha: SENHA_NOVA, senhaAtual: 'errada-123456' }, tA), 403);
  const troca = await patch({ novaSenha: SENHA_NOVA, senhaAtual: SENHA }, tA);
  esperar('troca válida devolve um token novo', troca, 200, (j) => typeof j.token === 'string');
  const tA2 = troca.json?.token;
  esperar('o token ANTIGO deixou de valer', await eu(tA), 401);
  esperar('o token NOVO funciona', await eu(tA2), 200);
  esperar('login com a senha nova', await login(A_NOVO, SENHA_NOVA), 200);
  esperar('login com a senha antiga', await login(A_NOVO, SENHA), 401);
  esperar('o outro usuário (B) não foi afetado', await eu(tB), 200);

  console.log('\n--- Conta do Google ---');
  esperar('trocar o nome é permitido', await patch({ nome: 'Google Novo' }, tG), 200);
  esperar('trocar o e-mail não é', await patch({ email: 'outro@gmail.com', senhaAtual: SENHA }, tG), 400);
  esperar('trocar a senha não é', await patch({ novaSenha: SENHA_NOVA, senhaAtual: SENHA }, tG), 400);

  console.log('\n--- Excluir a conta (RF04) ---');
  await criarDados(idA, 'conta-a');
  await criarDados(idB, 'conta-b');
  esperar('sem token', await excluir({ confirmacao: 'EXCLUIR', senha: SENHA_NOVA }), 401);
  esperar('sem a confirmação', await excluir({ senha: SENHA_NOVA }, tA2), 400);
  esperar('confirmação em minúsculas', await excluir({ confirmacao: 'excluir', senha: SENHA_NOVA }, tA2), 400);
  esperar('sem a senha', await excluir({ confirmacao: 'EXCLUIR' }, tA2), 400);
  esperar('senha incorreta', await excluir({ confirmacao: 'EXCLUIR', senha: 'errada-123456' }, tA2), 403);
  conferir('nada foi apagado pelas tentativas recusadas', (await contar(idA)) === '1,1,1' && Boolean(await Usuario.findById(idA)));

  esperar('exclusão correta', await excluir({ confirmacao: 'EXCLUIR', senha: SENHA_NOVA }, tA2), 200,
    (j) => j.apagados.cronogramas === 1 && j.apagados.tentativas === 1 && j.apagados.feedbacks === 1);
  conferir('usuário e todos os dados dele sumiram', !(await Usuario.findById(idA)) && (await contar(idA)) === '0,0,0');
  conferir('os dados do outro usuário (B) continuam', (await contar(idB)) === '1,1,1');
  conferir('os dados da Ana continuam intactos',
    JSON.stringify(await Cronograma.findById('cron-1').lean()) === anaAntes &&
    (await Tentativa.countDocuments({ usuarioId: 'user-1' })) === anaTentativasAntes);
  esperar('o token da conta excluída deixou de valer', await eu(tA2), 401);
  esperar('login com a conta excluída', await login(A_NOVO, SENHA_NOVA), 401);
  esperar('o mesmo e-mail pode ser cadastrado de novo', await cadastro(A_NOVO), 201);

  esperar('conta do Google: sem a confirmação', await excluir({}, tG), 400);
  esperar('conta do Google: com a confirmação (sem senha)', await excluir({ confirmacao: 'EXCLUIR' }, tG), 200);
  conferir('conta do Google apagada', !(await Usuario.findById('conta-g')));

  await limpar();
  console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} teste(s) com resultado inesperado.`);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});