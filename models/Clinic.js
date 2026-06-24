const mongoose = require('mongoose');

const clinicSchema = new mongoose.Schema({
    clinicId: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    doctorName: { type: String, required: true },
    specialization: { type: String, required: true },
    address: { type: String, required: true },
    location: { type: String, required: true },
    phone: String,
    email: String,
    image: { type: String, default: 'https://i.pravatar.cc/300?img=50' },
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    experience: String,
    rating: { type: Number, min: 0, max: 5, default: 4.0 },
    available: { type: Boolean, default: true },
    consultationFee: { type: String, default: '$30' },
    timings: { type: String, default: '9 AM - 6 PM' },
    coordinates: { lat: { type: Number, default: 0 }, lng: { type: Number, default: 0 } },
    password: { type: String, default: 'clinic123' },
    lastUpdated: { type: Date, default: Date.now },
    maxBookingsPerSlot: { type: Number, default: 3 }
}, { timestamps: true });

clinicSchema.index({ specialization: 1 });
clinicSchema.index({ available: -1 });

module.exports = mongoose.models.Clinic || mongoose.model('Clinic', clinicSchema);
