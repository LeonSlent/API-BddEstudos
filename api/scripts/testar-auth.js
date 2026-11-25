const { apagarContasDeTeste } = require('./util-teste');
const jwt = require('jsonwebtoken');
const { conectar, mongoose } = require('../db');

const BASE = 'http://localhost:3000';
const EMAIL = 'carlos.teste@email.com';
const SENHA = 'senha-forte-123';
let falhas = 0;

async function chamar(metodo, caminho, { corpo, bruto, token } = {}) {
  const headers = {};
  if (corpo !== undefined || bruto !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(BASE + caminho, {
    method: metodo,
    headers,
    body: bruto ?? (corpo !== undefined ? JSON.stringify(corpo) : undefined),
  });
  return { status: resp.status, json: await resp.json().catch(() => null) };
}

function conferir(descricao, r, esperado, verificar) {
  const ok = r.status === esperado && (!verificar || verificar(r.json));
  if (!ok) falhas++;
  const detalhe = r.json?.erro ? `\n         -> ${r.json.erro}` : '';
  console.log(`${ok ? 'OK    ' : 'FALHOU'} [${r.status}] ${descricao}${detalhe}`);
}

async function main() {
  await conectar();
  await apagarContasDeTeste([EMAIL, 'apagado.teste@email.com']);

  console.log('\n--- Cadastro ---');
  const cad = await chamar('POST', '/auth/cadastro', { corpo: { trilha_id: 'trilha-dev', nome: 'Carlos Teste', email: EMAIL, senha: SENHA } });
  conferir('cadastro válido', cad, 201, (j) =>
    typeof j.token === 'string' && j.usuario.email === EMAIL && !('senhaHash' in j.usuario));
  const tokenCarlos = cad.json?.token;

  conferir('e-mail repetido (só maiúsculas)', await chamar('POST', '/auth/cadastro',
    { corpo: { trilha_id: 'trilha-dev', nome: 'Outro', email: EMAIL.toUpperCase(), senha: SENHA } }), 409);
  conferir('senha curta (7 caracteres)', await chamar('POST', '/auth/cadastro',
    { corpo: { trilha_id: 'trilha-dev', nome: 'X', email: 'x1@email.com', senha: '1234567' } }), 400);
  conferir('senha longa demais (73 caracteres)', await chamar('POST', '/auth/cadastro',
    { corpo: { trilha_id: 'trilha-dev', nome: 'X', email: 'x2@email.com', senha: 'a'.repeat(73) } }), 400);
  conferir('e-mail em formato inválido', await chamar('POST', '/auth/cadastro',
    { corpo: { trilha_id: 'trilha-dev', nome: 'X', email: 'sem-arroba', senha: SENHA } }), 400);
  conferir('nome vazio', await chamar('POST', '/auth/cadastro',
    { corpo: { trilha_id: 'trilha-dev', nome: '   ', email: 'x3@email.com', senha: SENHA } }), 400);
  conferir('senha enviada como número', await chamar('POST', '/auth/cadastro',
    { corpo: { trilha_id: 'trilha-dev', nome: 'X', email: 'x4@email.com', senha: 12345678 } }), 400);
  conferir('e-mail enviado como objeto (tentativa de injeção)', await chamar('POST', '/auth/cadastro',
    { corpo: { trilha_id: 'trilha-dev', nome: 'X', email: { $ne: null }, senha: SENHA } }), 400);
  conferir('sem corpo nenhum', await chamar('POST', '/auth/cadastro'), 400);
  conferir('JSON malformado', await chamar('POST', '/auth/cadastro', { bruto: '{nome:' }), 400);

  console.log('\n--- Login ---');
  conferir('login correto', await chamar('POST', '/auth/login',
    { corpo: { email: EMAIL, senha: SENHA } }), 200, (j) => typeof j.token === 'string');
  conferir('login com e-mail em outras maiúsculas', await chamar('POST', '/auth/login',
    { corpo: { email: 'Carlos.Teste@Email.com', senha: SENHA } }), 200);
  conferir('login da Ana (criada pelo seed)', await chamar('POST', '/auth/login',
    { corpo: { email: 'ana@email.com', senha: 'senha-de-teste-123' } }), 200);

  const senhaErrada = await chamar('POST', '/auth/login', { corpo: { email: EMAIL, senha: 'senha-errada-999' } });
  const emailInexistente = await chamar('POST', '/auth/login', { corpo: { email: 'ninguem@email.com', senha: SENHA } });
  conferir('senha errada', senhaErrada, 401);
  conferir('e-mail que não existe', emailInexistente, 401);
  console.log(`         Mesma mensagem nos dois casos? ${senhaErrada.json?.erro === emailInexistente.json?.erro ? 'sim (certo)' : 'NÃO (errado)'}`);
  conferir('conta do Google (sem senha)', await chamar('POST', '/auth/login',
    { corpo: { email: 'bruno@gmail.com', senha: SENHA } }), 401);
  conferir('e-mail como objeto no login', await chamar('POST', '/auth/login',
    { corpo: { email: { $ne: null }, senha: SENHA } }), 400);

  console.log('\n--- Rota protegida (/auth/eu) ---');
  conferir('sem token', await chamar('GET', '/auth/eu'), 401);
  conferir('token com lixo', await chamar('GET', '/auth/eu', { token: 'isto.nao.e-um-token' }), 401);
  conferir('token assinado com outra chave', await chamar('GET', '/auth/eu',
    { token: jwt.sign({}, 'outra-chave-qualquer-com-mais-de-32-caracteres', { subject: 'user-1', expiresIn: '1h' }) }), 401);
  conferir('token expirado', await chamar('GET', '/auth/eu',
    { token: jwt.sign({}, process.env.JWT_SECRET, { subject: 'user-1', expiresIn: -10 }) }), 401);
  conferir('token válido', await chamar('GET', '/auth/eu', { token: tokenCarlos }), 200,
    (j) => j.usuario.email === EMAIL);

  const apagado = await chamar('POST', '/auth/cadastro',
    { corpo: { trilha_id: 'trilha-dev', nome: 'Vai Sumir', email: 'apagado.teste@email.com', senha: SENHA } });
  await apagarContasDeTeste(['apagado.teste@email.com']);
  conferir('token válido, mas a conta foi excluída', await chamar('GET', '/auth/eu',
    { token: apagado.json?.token }), 401);

  await apagarContasDeTeste([EMAIL]);
  console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} teste(s) com resultado inesperado.`);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});