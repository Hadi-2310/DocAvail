const mongoose = require('mongoose');

// Hospital Schema
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

// Doctor Schema
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

// Time Slot Schema
const timeSlotSchema = new mongoose.Schema({
    doctorId: { type: Number, required: true },
    hospitalId: { type: Number, required: true },
    date: { type: String, required: true },   // YYYY-MM-DD local date string
    time: { type: String, required: true },   // HH:MM 24h
    maxBookings: { type: Number, default: 5 },
    currentBookings: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    slotDateTime: { type: Date }              // computed UTC datetime for real-time comparison
}, { timestamps: true });

timeSlotSchema.index({ doctorId: 1, date: 1 });
timeSlotSchema.index({ hospitalId: 1, date: 1 });

// Booking Schema
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
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: 'TimeSlot', default: null },
    date: { type: String, required: true },
    time: { type: String, required: true },
    status: { type: String, enum: ['confirmed', 'cancelled', 'completed'], default: 'confirmed' }
}, { timestamps: true });

bookingSchema.index({ patientId: 1 });
bookingSchema.index({ hospitalId: 1, date: 1 });

// Patient Schema
const patientSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: { type: String, required: true },
    age: { type: Number },
    address: { type: String }
}, { timestamps: true });

// Clinic Schema
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

const Hospital = mongoose.model('Hospital', hospitalSchema);
const Doctor = mongoose.model('Doctor', doctorSchema);
const Clinic = mongoose.model('Clinic', clinicSchema);
const TimeSlot = mongoose.model('TimeSlot', timeSlotSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const Patient = mongoose.model('Patient', patientSchema);

module.exports = { Hospital, Doctor, Clinic, TimeSlot, Booking, Patient };
