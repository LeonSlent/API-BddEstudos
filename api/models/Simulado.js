const mongoose = require('mongoose');

const resumoSchema = require('./ResumoPlanejamentoSchema');

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  usuarioId: { type: String, required: true },
  trilhaId: { type: String, required: true },
  cronogramaId: { type: String, required: true },
  questoes: { type: [String], required: true },
  agendado: Boolean,
  concluidoEm: { type: Date, default: null },
  resumo: resumoSchema,
}, { timestamps: true });

schema.index({ usuarioId: 1, cronogramaId: 1 }, { unique: true, partialFilterExpression: { concluidoEm: null } });
module.exports = mongoose.model('Simulado', schema, 'simulados');
