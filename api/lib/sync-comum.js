// Erro permanente: o item está errado e reenviar não adianta
class Rejeicao extends Error {}
// Erro temporário: pode funcionar numa próxima tentativa
class Temporario extends Error {}

const bool01 = (v) =>
  v === 1 || v === true ? true : v === 0 || v === false ? false : undefined;

// 'AAAA-MM-DD' -> Date (meia-noite UTC), ou null se não for uma data que existe
function parseDia(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const d = new Date(`${texto}T00:00:00Z`);
  // o segundo teste pega '2026-02-31', que alguns motores "arredondam" para março
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== texto) return null;
  return d;
}

// '2026-11-11T10:00:00Z' -> Date, ou null
function parseMomento(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(texto)) return null;
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Hora em que o usuário fez a alteração. Nunca aceitamos o futuro.
function momentoDaAlteracao(payload) {
  const d = parseMomento(payload.atualizado_em);
  if (!d) {
    throw new Rejeicao('atualizado_em é obrigatório e precisa ser uma data e hora válidas.');
  }
  const agora = new Date();
  return d > agora ? agora : d;
}

// Recusa campos que não estão na lista
function exigirApenas(payload, permitidos) {
  const extras = Object.keys(payload).filter(
    (k) => k !== 'atualizado_em' && !permitidos.includes(k)
  );
  if (extras.length) {
    throw new Rejeicao(`Campo(s) não permitido(s): ${extras.slice(0, 5).join(', ')}.`);
  }
}

// Um registro sem atualizadoEm (dados antigos) perde para qualquer alteração
const quando = (data) => data ?? new Date(0);

module.exports = {
  Rejeicao, Temporario, bool01, parseDia, parseMomento,
  momentoDaAlteracao, exigirApenas, quando,
};