const mongoose = require('mongoose');
const { Schema } = mongoose;
const Trilha = require('./Trilha');

const ConcursoSchema = new Schema(
  {
    _id: { type: String, required: true },
    orgao: { type: String, required: true, trim: true },
    cargo: { type: String, required: true, trim: true },
    localizacao: { type: String, required: true, trim: true },
    salario: {
      type: Number,
      validate: {
        validator: (v) => v == null || v > 0,
        message: 'O salário precisa ser maior que zero (ou ficar vazio).',
      },
    },
    fimEdital: { type: Date, required: true, index: true },
    editalUrl: { type: String, trim: true, match: /^https?:\/\/.+/ },
    // Substitui a tabela concurso_trilha: um concurso pode servir a várias trilhas
    trilhaIds: {
      type: [String],
      index: true, // equivale ao ix_concurso_trilha_trilha do SQLite
      validate: [
        {
          validator: (lista) => lista.length >= 1,
          message: 'O concurso precisa estar ligado a pelo menos uma trilha.',
        },
        {
          validator: (lista) => new Set(lista).size === lista.length,
          message: 'Há trilha repetida na lista.',
        },
      ],
    },
  },
  { timestamps: true }
);

// Sem chave estrangeira no Mongo: conferimos se as trilhas existem
ConcursoSchema.pre('validate', async function () {
  if (!(this.isNew || this.isModified('trilhaIds'))) return;
  if (!this.trilhaIds || this.trilhaIds.length === 0) return;

  const existentes = await Trilha.find({ _id: { $in: this.trilhaIds } }).select('_id');
  const ids = new Set(existentes.map((t) => t._id));
  for (const id of this.trilhaIds) {
    if (!ids.has(id)) this.invalidate('trilhaIds', `A trilha "${id}" não existe.`);
  }
});

module.exports = mongoose.model('Concurso', ConcursoSchema, 'concursos');