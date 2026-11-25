const mongoose = require('mongoose');
const Trilha = require('../models/Trilha');
const Questao = require('../models/Questao');
const { trilha, questoes } = require('./catalogo-governanca');

async function completarGovernanca() {
  return mongoose.connection.transaction(async session => {
    const atual = await Trilha.findById(trilha._id).session(session) || new Trilha(trilha);
    for (const materia of trilha.materias) {
      const existente = atual.materias.id(materia._id);
      if (!existente) {
        atual.materias.push(materia);
        continue;
      }
      for (const tema of materia.temas) {
        if (!existente.temas.id(tema._id)) existente.temas.push(tema);
      }
    }
    if (atual.isNew || atual.isModified()) await atual.save({ session });
    const existentes = await Questao.find({ _id: { $in: questoes.map(q => q._id) } })
      .select('materiaId temaId').session(session).lean();
    const porId = new Map(existentes.map(q => [q._id, q]));
    for (const q of questoes) {
      const existente = porId.get(q._id);
      if (existente && (existente.materiaId !== q.materiaId || existente.temaId !== q.temaId)) {
        throw new Error('ID de questão em uso em outra matéria ou tema: ' + q._id);
      }
    }
    const novas = questoes.filter(q => !porId.has(q._id));
    if (novas.length) await Questao.insertMany(novas, { session });
    return novas.length;
  });
}

if (require.main === module) {
  const { conectar } = require('../db');
  conectar().then(completarGovernanca)
    .then(total => console.log(total + ' questões acrescentadas à trilha Governança.'))
    .catch(erro => { console.error(erro.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}

module.exports = { completarGovernanca };
