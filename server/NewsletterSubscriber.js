const mongoose = require('mongoose');

const newsletterSubscriberSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.models.NewsletterSubscriber
  || mongoose.model('NewsletterSubscriber', newsletterSubscriberSchema);
