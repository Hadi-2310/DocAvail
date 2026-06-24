const mongoose = require('mongoose');

const timeSlotSchema = new mongoose.Schema({
    doctorId: { type: Number, required: true },
    hospitalId: { type: Number, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    maxBookings: { type: Number, default: 5 },
    currentBookings: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    slotDateTime: { type: Date }
}, { timestamps: true });

timeSlotSchema.index({ doctorId: 1, date: 1 });
timeSlotSchema.index({ hospitalId: 1, date: 1 });

module.exports = mongoose.models.TimeSlot || mongoose.model('TimeSlot', timeSlotSchema);
