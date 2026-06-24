const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    bookingId: { type: String, required: true, unique: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },
    patientName: { type: String, required: true },
    patientAge: { type: Number, default: null },
    patientContact: { type: String, default: '' },
    patientDescription: { type: String, default: '' },
    doctorId: { type: Number, required: true },
    doctorName: { type: String, required: true },
    specialization: { type: String, default: '' },
    hospitalId: { type: Number, required: true },
    hospitalName: { type: String, required: true },
    clinicId: { type: Number, default: null },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: 'TimeSlot', default: null },
    date: { type: String, required: true },
    time: { type: String, required: true },
    status: { type: String, enum: ['confirmed', 'cancelled', 'completed'], default: 'confirmed' }
}, { timestamps: true });

bookingSchema.index({ patientId: 1 });
bookingSchema.index({ hospitalId: 1, date: 1 });

module.exports = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);
