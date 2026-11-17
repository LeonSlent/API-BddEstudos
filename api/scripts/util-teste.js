async function deveFalhar(descricao, acao) {
  try {
    await acao();
    console.log(`PASSOU (era para falhar): ${descricao}\n`);
  } catch (erro) {
    console.log(`Falhou como esperado: ${descricao}\n   -> ${erro.message}\n`);
  }
}

module.exports = { deveFalhar };