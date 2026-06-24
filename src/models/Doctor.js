const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema({
    doctorId: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    specialization: { type: String, required: true },
    hospital: { type: String, required: true },
    hospitalId: { type: Number, required: true, ref: 'Hospital' },
    clinicId: { type: Number, default: null },
    entityType: { type: String, enum: ['hospital', 'clinic'], default: 'hospital' },
    distance: { type: String, default: '' },
    available: { type: Boolean, default: true },
    image: { type: String, required: true },
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    experience: { type: String, required: true },
    rating: { type: Number, min: 0, max: 5, default: 4.5 },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

doctorSchema.index({ hospitalId: 1, available: -1 });
doctorSchema.index({ specialization: 1 });
doctorSchema.index({ available: -1 });

module.exports = mongoose.models.Doctor || mongoose.model('Doctor', doctorSchema);
