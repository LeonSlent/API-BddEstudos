const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarCors } = require('../middleware/cors');

function executar({ method = 'GET', headers = {}, config = 'http://localhost:8081' } = {}) {
  const output = { headers: {}, vary: [], status: 200, next: false, ended: false };
  const req = { method, get: name => headers[name.toLowerCase()] };
  const res = {
    vary(name) { output.vary.push(name); },
    setHeader(name, value) { output.headers[name.toLowerCase()] = value; },
    status(code) { output.status = code; return this; },
    json(body) { output.body = body; output.ended = true; return this; },
    end() { output.ended = true; return this; },
  };
  criarCors(config === null ? undefined : config)(req, res, () => { output.next = true; });
  return output;
}

test('permite leitura do catálogo pelo front-end e expõe Retry-After', () => {
  const result = executar({ headers: { origin: 'http://localhost:8081' } });
  assert.equal(result.next, true);
  assert.equal(result.headers['access-control-allow-origin'], 'http://localhost:8081');
  assert.equal(result.headers['access-control-expose-headers'], 'Retry-After');
  assert.equal(result.headers['access-control-allow-credentials'], undefined);
  assert.ok(result.vary.includes('Origin'));
});

test('preflight de login e atualização aceita JSON e Authorization antes das rotas', () => {
  for (const method of ['GET', 'POST', 'PATCH']) {
    const result = executar({ method: 'OPTIONS', headers: {
      origin: 'http://localhost:8081',
      'access-control-request-method': method,
      'access-control-request-headers': 'Content-Type, AUTHORIZATION',
    } });
    assert.equal(result.status, 204);
    assert.equal(result.next, false);
    assert.equal(result.ended, true);
    assert.equal(result.headers['access-control-allow-headers'], 'Content-Type, Authorization');
    assert.ok(result.headers['access-control-allow-methods'].includes(method));
    assert.ok(result.vary.includes('Access-Control-Request-Headers'));
    assert.equal(result.headers['access-control-max-age'], '600');
  }
});

test('requisições autenticadas continuam para as rotas com CORS aplicado', () => {
  const result = executar({ method: 'PATCH', headers: {
    origin: 'http://localhost:8081', authorization: 'Bearer token-de-teste',
  } });
  assert.equal(result.next, true);
  assert.equal(result.ended, false);
  assert.equal(result.headers['access-control-allow-origin'], 'http://localhost:8081');
});

test('rejeita origens desconhecidas, null e domínios que imitam localhost', () => {
  for (const origin of ['https://outro.example', 'null', 'http://localhost:8081.outro.example']) {
    const result = executar({ headers: { origin } });
    assert.equal(result.status, 403);
    assert.equal(result.next, false);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
});

test('configuração personalizada permite múltiplas origens e substitui as locais', () => {
  const config = ' https://app.example.com/, http://192.168.1.20:8082 ';
  for (const origin of ['https://app.example.com', 'http://192.168.1.20:8082']) {
    const result = executar({ config, headers: { origin } });
    assert.equal(result.next, true);
    assert.equal(result.headers['access-control-allow-origin'], origin);
  }
  assert.equal(executar({ config, headers: { origin: 'http://localhost:8081' } }).status, 403);
});

test('clientes nativos sem Origin continuam normalmente, inclusive com lista vazia', () => {
  const result = executar({ config: '' });
  assert.equal(result.next, true);
  assert.equal(result.headers['access-control-allow-origin'], undefined);
  assert.ok(result.vary.includes('Origin'));
});

test('preflight recusa métodos e cabeçalhos não usados pela API', () => {
  for (const [method, requestedHeaders] of [['DELETE', 'authorization'], ['POST', 'x-custom']]) {
    const result = executar({ method: 'OPTIONS', headers: {
      origin: 'http://localhost:8081',
      'access-control-request-method': method,
      'access-control-request-headers': requestedHeaders,
    } });
    assert.equal(result.status, 403);
    assert.equal(result.next, false);
    assert.equal(result.headers['access-control-allow-methods'], undefined);
  }
});

test('configuração recusa wildcard, credenciais, caminhos e protocolos inválidos', () => {
  for (const config of ['*', 'https://user:pass@app.example.com', 'https://app.example.com/caminho', 'ftp://app.example.com', 'https://app.example.com?query=1']) {
    assert.throws(() => criarCors(config));
  }
});

test('permite porta alternativa 8082 por padrão e aceita método em minúsculas no preflight', () => {
  const resultOrigem = executar({ headers: { origin: 'http://localhost:8082' }, config: null });
  assert.equal(resultOrigem.next, true);
  assert.equal(resultOrigem.headers['access-control-allow-origin'], 'http://localhost:8082');

  const resultMetodo = executar({ method: 'OPTIONS', headers: {
    origin: 'http://localhost:8081',
    'access-control-request-method': 'post',
    'access-control-request-headers': 'content-type',
  } });
  assert.equal(resultMetodo.status, 204);
  assert.ok(resultMetodo.headers['access-control-allow-methods'].includes('POST'));
});
