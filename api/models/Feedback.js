const mongoose = require('mongoose');
const { Schema } = mongoose;
const Usuario = require('./Usuario');

const FeedbackSchema = new Schema(
  {
    _id: { type: String, required: true },
    usuarioId: { type: String, required: true, index: true },
    tipo: { type: String, required: true, enum: ['erro', 'sugestao'] },
    texto: { type: String, required: true, trim: true, maxlength: 2000 },
    versaoApp: { type: String, trim: true },
  },
  { timestamps: true }
);

FeedbackSchema.pre('validate', async function () {
  if (this.isNew || this.isModified('usuarioId')) {
    if (this.usuarioId && !(await Usuario.exists({ _id: this.usuarioId }))) {
      this.invalidate('usuarioId', `O usuário "${this.usuarioId}" não existe.`);
    }
  }
});

module.exports = mongoose.model('Feedback', FeedbackSchema, 'feedbacks');