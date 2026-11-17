const { conectar, mongoose } = require('../db');
const Usuario = require('../models/Usuario');

const BASE = process.env.BASE || 'http://localhost:3001';
const EMAIL = 'limites.teste@email.com';
const SENHA = 'senha-forte-123';
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
  return { status: resp.status, json: await resp.json().catch(() => null), espera: resp.headers.get('retry-after') };
}

function esperar(descricao, r, statusEsperado) {
  const ok = r.status === statusEsperado;
  if (!ok) falhas++;
  const extra = r.status === 429 ? `${r.json?.erro} (Retry-After: ${r.espera}s)` : r.json?.erro ?? '';
  console.log(`${ok ? 'OK    ' : 'FALHOU'} [${r.status}] ${descricao}${extra ? `\n         -> ${extra}` : ''}`);
}

async function main() {
  await conectar();
  await Usuario.deleteMany({ email: EMAIL });

  console.log('\n--- Cadastro (limite de 2 neste servidor de teste) ---');
  const cad = await chamar('POST', '/auth/cadastro', { corpo: { nome: 'Limites', email: EMAIL, senha: SENHA } });
  esperar('1º cadastro (válido)', cad, 201);
  esperar('2º cadastro (corpo vazio)', await chamar('POST', '/auth/cadastro', { corpo: {} }), 400);
  esperar('3º cadastro: bloqueado', await chamar('POST', '/auth/cadastro', { corpo: {} }), 429);
  const token = cad.json?.token;

  console.log('\n--- Login (limite de 3) ---');
  const errado = { corpo: { email: EMAIL, senha: 'senha-errada-999' } };
  esperar('1ª tentativa errada', await chamar('POST', '/auth/login', errado), 401);
  esperar('2ª tentativa errada', await chamar('POST', '/auth/login', errado), 401);
  esperar('3ª tentativa errada', await chamar('POST', '/auth/login', errado), 401);
  esperar('4ª tentativa: bloqueada, mesmo com a senha CERTA',
    await chamar('POST', '/auth/login', { corpo: { email: EMAIL, senha: SENHA } }), 429);

  console.log('\n--- Operações da conta (limite de 3) ---');
  esperar('1ª alteração (corpo vazio)', await chamar('PATCH', '/conta', { corpo: {}, token }), 400);
  esperar('2ª alteração', await chamar('PATCH', '/conta', { corpo: {}, token }), 400);
  esperar('3ª alteração', await chamar('PATCH', '/conta', { corpo: {}, token }), 400);
  esperar('4ª alteração: bloqueada', await chamar('PATCH', '/conta', { corpo: {}, token }), 429);
  esperar('excluir também está bloqueado (mesmo limite)',
    await chamar('POST', '/conta/excluir', { corpo: { confirmacao: 'EXCLUIR', senha: SENHA }, token }), 429);

  console.log('\n--- O que NÃO tem limite continua funcionando ---');
  esperar('consultar a conta', await chamar('GET', '/conta', { token }), 200);
  esperar('catálogo de trilhas', await chamar('GET', '/catalogo/trilhas'), 200);

  await Usuario.deleteMany({ email: EMAIL });
  console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} teste(s) com resultado inesperado.`);
  await mongoose.disconnect();
}

main().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});