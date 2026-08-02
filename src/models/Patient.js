const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: { type: String, default: '' },
    age: { type: Number },
    address: { type: String },
    googleId: { type: String, default: null },
    emailVerified: { type: Boolean, default: true },
    emailVerificationTokenHash: { type: String, default: null },
    emailVerificationExpiresAt: { type: Date, default: null },
    emailVerificationSentAt: { type: Date, default: null },
    emailVerifiedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.models.Patient || mongoose.model('Patient', patientSchema);
