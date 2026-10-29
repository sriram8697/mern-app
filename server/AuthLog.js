const mongoose = require('mongoose');

const authLogSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  action: { type: String, enum: ['signup', 'login_success', 'login_failed'], required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.models.AuthLog || mongoose.model('AuthLog', authLogSchema);
