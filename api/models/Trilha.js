const mongoose = require('mongoose');
const { Schema } = mongoose;

// Garante que não há dois itens com o mesmo nome dentro de uma lista
const nomesUnicos = (lista) => {
  const nomes = lista.map((item) => item.nome.toLowerCase());
  return new Set(nomes).size === nomes.length;
};

const TemaSchema = new Schema({
  _id: { type: String, required: true },
  nome: { type: String, required: true, trim: true, minlength: 1 },
});

const MateriaSchema = new Schema({
  _id: { type: String, required: true },
  nome: { type: String, required: true, trim: true, minlength: 1 },
  temas: {
    type: [TemaSchema],
    validate: {
      validator: nomesUnicos,
      message: 'Há temas com nome repetido na mesma matéria.',
    },
  },
});

const TrilhaSchema = new Schema(
  {
    _id: { type: String, required: true },
    nome: { type: String, required: true, trim: true, minlength: 1, unique: true },
    materias: {
      type: [MateriaSchema],
      validate: {
        validator: nomesUnicos,
        message: 'Há matérias com nome repetido na mesma trilha.',
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Trilha', TrilhaSchema);