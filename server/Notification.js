const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recipe', required: true },
  recipeName: { type: String, required: true },
  type: { type: String, enum: ['modified', 'approved', 'rejected', 'removed'], required: true },
  message: { type: String, required: true, maxlength: 500 },
  readAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
