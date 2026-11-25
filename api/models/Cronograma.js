const mongoose = require('mongoose');
const { Schema } = mongoose;
const Usuario = require('./Usuario');
const Trilha = require('./Trilha');

const inteiro = { validator: Number.isInteger, message: 'O valor precisa ser inteiro.' };

// ---------- Etapa de estudo (embutida) ----------
const EtapaSchema = new Schema({
  _id: { type: String, required: true },
  materiaId: { type: String, required: true },
  data: { type: Date, required: true },
  duracaoMin: {
    type: Number,
    required: true,
    min: [1, 'A duração mínima é 1 minuto.'],
    max: [120, 'RNF02: uma etapa não pode passar de 120 minutos.'],
    validate: inteiro,
  },
  pausaMin: { type: Number, default: 10, min: 0, validate: inteiro },
  concluida: { type: Boolean, default: false },
  concluidaEm: Date,
  atualizadoEm: Date,
});

// Mesma regra do CHECK do SQLite: concluída <=> tem data de conclusão
EtapaSchema.pre('validate', function () {
  if (this.concluida && !this.concluidaEm) {
    this.invalidate('concluidaEm', 'Etapa concluída precisa ter a data de conclusão.');
  }
  if (!this.concluida && this.concluidaEm) {
    this.invalidate('concluidaEm', 'Etapa não concluída não pode ter data de conclusão.');
  }
});

// ---------- Peso da matéria (embutido) ----------
const PesoSchema = new Schema(
  {
    materiaId: { type: String, required: true },
    pesoInicial: { type: Number, min: Number.MIN_VALUE },
    peso: {
      type: Number,
      required: true,
      default: 1.0,
      validate: { validator: (v) => v > 0, message: 'O peso precisa ser maior que zero.' },
    },
    atualizadoEm: Date,
  },
  { _id: false }
);

const semRepetir = (campo) => (lista) => {
  const valores = lista.map((item) => item[campo]);
  return new Set(valores).size === valores.length;
};

// ---------- Cronograma ----------
const CronogramaSchema = new Schema(
  {
    _id: { type: String, required: true },
    usuarioId: { type: String, required: true },
    trilhaId: { type: String, required: true },
    dataInicio: { type: Date, required: true },
    respostasAPartirDe: Date,
    ativo: { type: Boolean, default: true },
    distribuicaoDiaria: Boolean,
    versaoPlanejamento: Number,
    atualizadoEm: Date,
    pesos: {
      type: [PesoSchema],
      validate: { validator: semRepetir('materiaId'), message: 'Há matéria repetida nos pesos.' },
    },
    etapas: {
      type: [EtapaSchema],
      validate: { validator: semRepetir('_id'), message: 'Há etapas com o mesmo id.' },
    },
  },
  { timestamps: true }
);

// RF08: no máximo UM cronograma ativo por usuário (igual ao índice parcial do SQLite)
CronogramaSchema.index(
  { usuarioId: 1 },
  { unique: true, partialFilterExpression: { ativo: true } }
);
CronogramaSchema.index({ usuarioId: 1, ativo: 1 });

// O Mongo não tem chave estrangeira, então conferimos as relações aqui
CronogramaSchema.pre('validate', async function () {
  const mudou =
    this.isNew ||
    this.isModified('usuarioId') ||
    this.isModified('trilhaId') ||
    this.isModified('pesos') ||
    this.isModified('etapas');
  if (!mudou) return;

  const session = this.$session();
  if (this.usuarioId && !(await Usuario.exists({ _id: this.usuarioId }).session(session))) {
    this.invalidate('usuarioId', `O usuário "${this.usuarioId}" não existe.`);
  }

  if (!this.trilhaId) return;
  const trilha = await Trilha.findById(this.trilhaId).session(session);
  if (!trilha) {
    this.invalidate('trilhaId', `A trilha "${this.trilhaId}" não existe.`);
    return;
  }

  // Toda matéria usada precisa ser da trilha do cronograma
  const materiasDaTrilha = new Set(trilha.materias.map((m) => m._id));
  for (const p of this.pesos) {
    if (!materiasDaTrilha.has(p.materiaId)) {
      this.invalidate('pesos', `A matéria "${p.materiaId}" não pertence à trilha "${this.trilhaId}".`);
    }
  }
  for (const e of this.etapas) {
    if (!materiasDaTrilha.has(e.materiaId)) {
      this.invalidate('etapas', `A matéria "${e.materiaId}" não pertence à trilha "${this.trilhaId}".`);
    }
  }
});

module.exports = mongoose.model('Cronograma', CronogramaSchema, 'cronogramas');
