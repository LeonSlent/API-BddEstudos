const mongoose = require('mongoose');
const { Schema } = mongoose;

const UsuarioSchema = new Schema(
  {
    _id: { type: String, required: true },
    nome: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true, // guarda sempre em minúsculas, como o COLLATE NOCASE do SQLite
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'E-mail em formato inválido.'],
    },
    provedorLogin: { type: String, enum: ['email', 'google'], default: 'email' },
    versaoToken: { type: Number, default: 0 }, // sobe a cada troca de senha e invalida os tokens antigos

    // select: false = não vem nas consultas, a menos que você peça de propósito
    senhaHash: { type: String, select: false },
    resetToken: { type: String, select: false },
    resetTokenExpira: { type: Date, select: false },
  },
  { timestamps: true }
);

// Regra: quem entra por e-mail precisa ter senha; quem entra pelo Google não precisa
UsuarioSchema.pre('validate', function () {
  if (this.provedorLogin === 'email' && !this.senhaHash) {
    this.invalidate('senhaHash', 'Conta criada por e-mail precisa de senha.');
  }
  if (this.resetToken && !this.resetTokenExpira) {
    this.invalidate('resetTokenExpira', 'O token de recuperação precisa de uma data de validade.');
  }
});

module.exports = mongoose.model('Usuario', UsuarioSchema, 'usuarios');