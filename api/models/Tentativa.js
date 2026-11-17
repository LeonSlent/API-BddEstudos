const mongoose = require('mongoose');
const { Schema } = mongoose;
const Usuario = require('./Usuario');
const Questao = require('./Questao');

const inteiro = { validator: Number.isInteger, message: 'O valor precisa ser inteiro.' };

const TentativaSchema = new Schema(
  {
    _id: { type: String, required: true },
    usuarioId: { type: String, required: true },
    questaoId: { type: String, required: true },
    acertou: { type: Boolean, required: true },
    dificuldadeInformada: {
      type: Number,
      min: [1, 'A dificuldade vai de 1 a 5.'],
      max: [5, 'A dificuldade vai de 1 a 5.'],
      validate: inteiro,
    }, // RF09: opcional, o usuário pode pular
    respondidaEm: { type: Date, default: Date.now },

    // Estado do algoritmo de repetição espaçada (estilo SM-2)
    repeticoes: { type: Number, default: 0, min: 0, validate: inteiro },
    intervaloDias: { type: Number, default: 0, min: 0, validate: inteiro },
    fatorFacilidade: {
      type: Number,
      default: 2.5,
      min: [1.3, 'O fator de facilidade não pode ser menor que 1.3.'],
    },
    proximaRevisao: Date,
  },
  { timestamps: true }
);

// "O que revisar hoje" e "histórico desta questão" são as buscas mais comuns
TentativaSchema.index({ usuarioId: 1, proximaRevisao: 1 });
TentativaSchema.index({ usuarioId: 1, questaoId: 1 });

// Sem chave estrangeira no Mongo: conferimos o usuário e a questão aqui
TentativaSchema.pre('validate', async function () {
  if (this.isNew || this.isModified('usuarioId')) {
    if (this.usuarioId && !(await Usuario.exists({ _id: this.usuarioId }))) {
      this.invalidate('usuarioId', `O usuário "${this.usuarioId}" não existe.`);
    }
  }
  if (this.isNew || this.isModified('questaoId')) {
    if (this.questaoId && !(await Questao.exists({ _id: this.questaoId }))) {
      this.invalidate('questaoId', `A questão "${this.questaoId}" não existe.`);
    }
  }
});

module.exports = mongoose.model('Tentativa', TentativaSchema, 'tentativas');