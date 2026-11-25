const { Schema } = require('mongoose');

module.exports = new Schema({
  pesos: [{ _id: false, materia_id: String, anterior: Number, atual: Number }],
  blocos: [{ _id: false, data: String, posicao: Number, anterior: String, atual: String }],
}, { _id: false });
