const mongoose = require('mongoose');

const recipeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
  category: { type: String, required: true, enum: ['Breakfast', 'Lunch', 'Dinner'] },
  time: { type: Number, required: true, min: 1, max: 600 },
  description: { type: String, required: true, trim: true, minlength: 10, maxlength: 600 },
  ingredients: [{ type: String, required: true, trim: true, maxlength: 200 }],
  image: { type: String, maxlength: 5600000 },
  rating: { type: Number, min: 0, max: 5, default: 5 },
  tags: { type: [String], default: [] },
  source: { type: String, enum: ['curated', 'community'], default: 'community' },
  seedKey: { type: String, unique: true, sparse: true },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'removed'], default: 'pending' },
  reviewMessage: { type: String, default: '' },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.models.Recipe || mongoose.model('Recipe', recipeSchema);
