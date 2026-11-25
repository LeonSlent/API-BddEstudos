const ORIGENS_LOCAIS = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:8082',
  'http://127.0.0.1:8082',
  'http://localhost:19006',
  'http://127.0.0.1:19006',
].join(',');

function criarCors(configuracao = process.env.CORS_ORIGINS ?? ORIGENS_LOCAIS) {
  const origens = new Set(configuracao.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const url = new URL(item);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new Error('CORS_ORIGINS deve conter origens HTTP/HTTPS separadas por vírgula, sem caminho ou credenciais.');
    }
    return url.origin;
  }));
  const metodos = ['GET', 'POST', 'PATCH'];
  const cabecalhos = ['content-type', 'authorization'];

  return (req, res, next) => {
    res.vary('Origin');
    const origem = req.get('Origin');
    // Aplicativos nativos e clientes de terminal normalmente não enviam Origin.
    if (!origem) return next();
    if (!origens.has(origem)) {
      return res.status(403).json({ erro: 'Origem não permitida pelo CORS.' });
    }

    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
    // JWT é enviado pelo cabeçalho Authorization; não usamos cookies entre origens.
    if (req.method !== 'OPTIONS' || !req.get('Access-Control-Request-Method')) return next();

    res.vary('Access-Control-Request-Method');
    res.vary('Access-Control-Request-Headers');
    const metodo = (req.get('Access-Control-Request-Method') || '').toUpperCase();
    const solicitados = (req.get('Access-Control-Request-Headers') || '')
      .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (!metodos.includes(metodo) || solicitados.some((item) => !cabecalhos.includes(item))) {
      return res.status(403).json({ erro: 'Método ou cabeçalho não permitido pelo CORS.' });
    }
    res.setHeader('Access-Control-Allow-Methods', metodos.join(', '));
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
    return res.status(204).end();
  };
}

module.exports = { criarCors };
