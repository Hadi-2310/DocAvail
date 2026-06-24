const mongoose = require('mongoose');

const hospitalSchema = new mongoose.Schema({
    hospitalId: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    location: { type: String, required: true },
    address: String,
    phone: String,
    email: String,
    password: { type: String, default: 'hospital123' },
    type: { type: String, enum: ['Multi-Specialty', 'General', 'Specialty', 'Community'], default: 'General' },
    specialties: [String],
    rating: { type: Number, min: 0, max: 5, default: 4.0 },
    coordinates: { lat: { type: Number, default: 0 }, lng: { type: Number, default: 0 } },
    hasEmergency: { type: Boolean, default: true },
    maxBookingsPerSlot: { type: Number, default: 5 }
}, { timestamps: true });

module.exports = mongoose.models.Hospital || mongoose.model('Hospital', hospitalSchema);
