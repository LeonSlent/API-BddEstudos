const mongoose = require('mongoose');
const { Schema } = mongoose;

const LETRAS = ['A', 'B', 'C', 'D', 'E'];

const QuestaoSchema = new Schema(
  {
    _id: { type: String, required: true },
    temaId: { type: String, required: true, index: true },
    materiaId: { type: String, required: true, index: true },
    enunciado: { type: String, required: true, trim: true, minlength: 1 },
    alternativas: {
      type: [String],
      validate: [
        {
          validator: (lista) => lista.length >= 2 && lista.length <= 5,
          message: 'A questão precisa ter de 2 a 5 alternativas.',
        },
        {
          validator: (lista) => lista.every((alt) => alt.trim().length > 0),
          message: 'Há alternativa vazia.',
        },
      ],
    },
    gabarito: { type: String, required: true, enum: LETRAS },
    banca: { type: String, required: true, trim: true, minlength: 1 }, // RNF03
    ano: {
      type: Number,
      required: true,
      min: 1990,
      max: 2100,
      validate: { validator: Number.isInteger, message: 'O ano precisa ser inteiro.' },
    },
    fonteUrl: { type: String, trim: true, match: /^https?:\/\/.+/ },
  },
  { timestamps: true }
);

// Regra nova: o gabarito precisa apontar para uma alternativa que existe
QuestaoSchema.pre('validate', function () {
  if (this.gabarito && this.alternativas) {
    const posicao = LETRAS.indexOf(this.gabarito);
    if (posicao >= this.alternativas.length) {
      this.invalidate('gabarito', 'O gabarito aponta para uma alternativa que não existe.');
    }
  }
});

// O terceiro argumento fixa o nome da coleção ('questoes' em vez de 'questaos')
module.exports = mongoose.model('Questao', QuestaoSchema, 'questoes');