const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const { Hospital, Doctor, Clinic, TimeSlot, Booking, Patient } = require('./models');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// ── Simple dashboard auth middleware ──────────────────────────────────────
// Protects hospital/clinic dashboard write operations.
// Reads the token from X-Dashboard-Token header.
const HOSP_TOKENS  = new Set(); // populated on login
const CLINIC_TOKENS = new Set();
function requireDashboardAuth(req, res, next) {
    const token = req.headers['x-dashboard-token'];
    if (!token || (!HOSP_TOKENS.has(token) && !CLINIC_TOKENS.has(token))) {
        return res.status(401).json({ error: 'Unauthorized — please log in' });
    }
    next();
}

mongoose.connect(process.env.MONGODB_URI)
.then(async () => {
    console.log('✅ MongoDB Connected Successfully');

    // Drop ALL stale indexes that cause duplicate key errors
    const staleIndexes = [
        { collection: 'patients',  index: 'patientId_1' },
        { collection: 'timeslots', index: 'slotId_1' },
        { collection: 'timeslots', index: 'slotId_1_doctorId_1' },
        { collection: 'bookings',  index: 'slotId_1' },
        { collection: 'bookings',  index: 'bookingRef_1' },
    ];
    const db = mongoose.connection.db;
    for (const { collection, index } of staleIndexes) {
        try {
            const cols = await db.listCollections({ name: collection }).toArray();
            if (cols.length > 0) {
                const indexes = await db.collection(collection).indexes();
                if (indexes.find(i => i.name === index)) {
                    await db.collection(collection).dropIndex(index);
                    console.log(`✅ Dropped stale index ${index} from ${collection}`);
                }
            }
        } catch (e) {
            // Already gone — no problem
        }
    }
    console.log('✅ Index cleanup complete');

    // FIX: ensure indexes exist for the most-queried fields
    // These make all find/filter/sort operations dramatically faster
    try {
        await Promise.all([
            Doctor.collection.createIndex({ hospitalId: 1 }),
            Doctor.collection.createIndex({ available: -1 }),
            Doctor.collection.createIndex({ specialization: 1 }),
            Doctor.collection.createIndex({ hospitalId: 1, available: -1 }),
            Doctor.collection.createIndex({ name: 'text', specialization: 'text', hospital: 'text' }),
            TimeSlot.collection.createIndex({ doctorId: 1, isActive: 1, date: 1 }),
            TimeSlot.collection.createIndex({ hospitalId: 1, date: 1 }),
            TimeSlot.collection.createIndex({ date: 1, isActive: 1 }),
            Booking.collection.createIndex({ hospitalId: 1, status: 1 }),
            Booking.collection.createIndex({ patientId: 1 }),
            Clinic.collection.createIndex({ available: -1 }),
            Clinic.collection.createIndex({ specialization: 1 }),
        ]);
        console.log('✅ Performance indexes created');
    } catch(e) {
        console.log('ℹ️ Index creation skipped (may already exist):', e.message);
    }
})
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// ─── REAL-TIME HELPERS ────────────────────────────────────────
// Build a JS Date from a slot's date (YYYY-MM-DD) and time (HH:MM)
function slotToDate(dateStr, timeStr) {
    // Treat slot date+time as local time (no timezone shift)
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, min] = timeStr.split(':').map(Number);
    return new Date(y, m - 1, d, h, min, 0, 0);
}

// Auto-cleanup: mark past slots as inactive (do NOT delete — hospital needs to see history)
async function cleanExpiredSlots() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const nowHHMM = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');

    // FIX: two updateMany calls instead of find+loop+save per slot — far fewer DB round trips
    await Promise.all([
        // Past dates
        TimeSlot.updateMany(
            { date: { $lt: today }, isActive: true },
            { $set: { isActive: false } }
        ),
        // Today's already-passed times
        TimeSlot.updateMany(
            { date: today, time: { $lte: nowHHMM }, isActive: true },
            { $set: { isActive: false } }
        )
    ]);
}

// Run cleanup every minute for real-time accuracy
setInterval(cleanExpiredSlots, 60 * 1000);
cleanExpiredSlots();

// ==============================
// PATIENT AUTH ROUTES
// ==============================
app.post('/api/patients/register', async (req, res) => {
    try {
        const { name, email, password, phone, age, address } = req.body;
        const existing = await Patient.findOne({ email: email.toLowerCase() });
        if (existing) return res.status(400).json({ error: 'Email already registered' });
        // Hash password before saving — plain text never stored
        const hashedPassword = await bcrypt.hash(password, 10);
        const patient = new Patient({ name, email: email.toLowerCase(), password: hashedPassword, phone, age, address });
        await patient.save();
        res.status(201).json({ success: true, patient: { id: patient._id, name: patient.name, email: patient.email } });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/patients/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const patient = await Patient.findOne({ email: email.toLowerCase() });
        if (!patient) return res.status(404).json({ error: 'No account found with this email' });
        // Compare entered password with hashed password in DB
        const isMatch = await bcrypt.compare(password, patient.password);
        if (!isMatch) return res.status(401).json({ error: 'Incorrect password. Forgot your password? Contact admin: docavail4@gmail.com' });
        res.json({ success: true, patient: { id: patient._id, name: patient.name, email: patient.email, phone: patient.phone, age: patient.age } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// HOSPITAL ROUTES
// ==============================
app.get('/api/hospitals', async (req, res) => {
    try {
        // FIX: single aggregate replaces N*2 countDocuments calls (was 10+ DB queries for 5 hospitals)
        const [hospitals, doctorStats] = await Promise.all([
            Hospital.find().sort({ hospitalId: 1 }).lean(),
            Doctor.aggregate([
                { $group: {
                    _id: '$hospitalId',
                    total: { $sum: 1 },
                    available: { $sum: { $cond: ['$available', 1, 0] } }
                }}
            ])
        ]);
        const statsMap = {};
        for (const s of doctorStats) statsMap[s._id] = s;

        const hospitalsWithStats = hospitals.map(h => {
            const s = statsMap[h.hospitalId] || { total: 0, available: 0 };
            return {
                id: h.hospitalId,
                hospitalId: h.hospitalId,
                name: h.name,
                location: h.location,
                type: h.type,
                coordinates: h.coordinates,
                hasEmergency: h.hasEmergency,
                rating: h.rating,
                totalDoctors: s.total,
                availableCount: s.available,
                availabilityPercent: s.total > 0 ? Math.round((s.available / s.total) * 100) : 0
            };
        });
        hospitalsWithStats.sort((a, b) => b.availableCount - a.availableCount);
        res.json(hospitalsWithStats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/hospitals/:id', async (req, res) => {
    try {
        const hospital = await Hospital.findOne({ hospitalId: parseInt(req.params.id) });
        if (!hospital) return res.status(404).json({ error: 'Hospital not found' });
        res.json(hospital);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/hospitals', async (req, res) => {
    try {
        const hospital = new Hospital(req.body);
        await hospital.save();
        res.status(201).json(hospital);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Hospital login
app.post('/api/hospitals/login', async (req, res) => {
    try {
        const { hospitalId, password } = req.body;
        const hospital = await Hospital.findOne({ hospitalId: parseInt(hospitalId) });
        if (!hospital) return res.status(404).json({ error: 'Hospital not found' });
        if (hospital.password !== password) return res.status(401).json({ error: 'Invalid password' });
        const token = 'H' + hospital.hospitalId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        HOSP_TOKENS.add(token);
        res.json({ success: true, hospital, token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// DOCTOR ROUTES
// ==============================
app.get('/api/doctors', async (req, res) => {
    try {
        const doctors = await Doctor.find().sort({ available: -1, doctorId: 1 });
        res.json(doctors);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/doctors/hospital/:hospitalId', async (req, res) => {
    try {
        const hospitalId = parseInt(req.params.hospitalId);
        const doctors = await Doctor.find({ hospitalId }).sort({ available: -1, doctorId: 1 });
        res.json(doctors);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/doctors/specialization/:specialization', async (req, res) => {
    try {
        const doctors = await Doctor.find({ specialization: req.params.specialization }).sort({ available: -1, doctorId: 1 });
        res.json(doctors);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/doctors/available', async (req, res) => {
    try {
        const doctors = await Doctor.find({ available: true }).sort({ distance: 1 });
        res.json(doctors);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/doctors/:id', async (req, res) => {
    try {
        const doctor = await Doctor.findOne({ doctorId: parseInt(req.params.id) });
        if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
        res.json(doctor);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/doctors', async (req, res) => {
    try {
        const doctor = new Doctor(req.body);
        await doctor.save();
        res.status(201).json(doctor);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/doctors/:id', async (req, res) => {
    try {
        const doctor = await Doctor.findOneAndUpdate(
            { doctorId: parseInt(req.params.id) },
            req.body,
            { new: true, runValidators: true }
        );
        if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
        res.json(doctor);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.patch('/api/doctors/:id/availability', async (req, res) => {
    try {
        const doctor = await Doctor.findOne({ doctorId: parseInt(req.params.id) });
        if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
        doctor.available = !doctor.available;
        doctor.lastUpdated = new Date();
        await doctor.save();
        res.json(doctor);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/doctors/:id', async (req, res) => {
    try {
        const doctor = await Doctor.findOneAndDelete({ doctorId: parseInt(req.params.id) });
        if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
        res.json({ message: 'Doctor deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// TIME SLOTS ROUTES
// ==============================
// GET slots for a doctor (patient-facing — only show future active slots)
app.get('/api/slots/doctor/:doctorId', async (req, res) => {
    try {
        // FIX: don't block response on cleanup — run it in background
        cleanExpiredSlots().catch(() => {});
        const doctorId = parseInt(req.params.doctorId);
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const nowHHMM = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
        // FIX: filter in DB query itself — no need for JS-side filter loop
        const slots = await TimeSlot.find({
            doctorId,
            isActive: true,
            $or: [
                { date: { $gt: today } },
                { date: today, time: { $gt: nowHHMM } }
            ]
        }).sort({ date: 1, time: 1 }).lean();
        res.json(slots);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET slots for hospital (dashboard — show all including expired so dashboard has history)
app.get('/api/slots/hospital/:hospitalId', async (req, res) => {
    try {
        cleanExpiredSlots().catch(() => {});
        const hospitalId = parseInt(req.params.hospitalId);
        const today = new Date().toISOString().split('T')[0];
        const slots = await TimeSlot.find({
            hospitalId,
            date: { $gte: today }  // today onwards — dashboard sees today's expired ones too
        }).sort({ date: 1, time: 1 });
        res.json(slots);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST create time slot (hospital dashboard)
app.post('/api/slots', async (req, res) => {
    try {
        const { doctorId, hospitalId, date, time, maxBookings } = req.body;
        if (!date || !time) return res.status(400).json({ error: 'Date and time are required' });

        // Reject past slots immediately
        const slotDt = slotToDate(date, time);
        if (slotDt <= new Date()) {
            return res.status(400).json({ error: 'Cannot create a slot in the past' });
        }

        // Check if slot already exists
        const existing = await TimeSlot.findOne({ doctorId, date, time });
        if (existing) return res.status(400).json({ error: 'Slot already exists for this doctor at this date/time' });

        const slot = new TimeSlot({
            doctorId,
            hospitalId: hospitalId || 0,
            date,
            time,
            maxBookings: maxBookings || 5,
            slotDateTime: slotDt,
            isActive: true
        });
        await slot.save();
        res.status(201).json(slot);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// PUT update time slot
app.put('/api/slots/:id', async (req, res) => {
    try {
        const { date, time, maxBookings } = req.body;
        const update = { ...(date && { date }), ...(time && { time }), ...(maxBookings && { maxBookings }) };

        if (date || time) {
            // Recompute the datetime with the new values
            const slot = await TimeSlot.findById(req.params.id);
            if (!slot) return res.status(404).json({ error: 'Slot not found' });
            const newDate = date || slot.date;
            const newTime = time || slot.time;
            const slotDt = slotToDate(newDate, newTime);
            if (slotDt <= new Date()) {
                return res.status(400).json({ error: 'Cannot set a slot to a past date/time' });
            }
            update.slotDateTime = slotDt;
            update.isActive = true; // reactivate if moved to future
        }

        const updated = await TimeSlot.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!updated) return res.status(404).json({ error: 'Slot not found' });
        res.json(updated);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// DELETE time slot
app.delete('/api/slots/:id', async (req, res) => {
    try {
        const slot = await TimeSlot.findByIdAndDelete(req.params.id);
        if (!slot) return res.status(404).json({ error: 'Slot not found' });
        res.json({ message: 'Slot removed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// BOOKING ROUTES
// ==============================
// POST create booking
app.post('/api/bookings', async (req, res) => {
    try {
        const { patientId, patientName, patientAge, patientContact, patientDescription, doctorId, hospitalId, slotId } = req.body;

        // Get slot
        const slot = await TimeSlot.findById(slotId);
        if (!slot) return res.status(404).json({ error: 'Time slot not found' });
        if (!slot.isActive) return res.status(400).json({ error: 'This slot is no longer active' });
        if (slotToDate(slot.date, slot.time) <= new Date()) {
            return res.status(400).json({ error: 'This slot has already passed — please choose another time' });
        }
        if (slot.currentBookings >= slot.maxBookings) return res.status(400).json({ error: 'This slot is fully booked' });

        // ── Duplicate prevention ─────────────────────────────────────────────
        if (patientId) {
            const existingOnSlot = await Booking.findOne({ slotId, patientId, status: { $ne: 'cancelled' } });
            if (existingOnSlot) return res.status(400).json({ error: 'You have already booked this time slot.' });

            // Block same doctor same day ONLY if the existing booking's slot hasn't passed yet
            const existingWithDoctor = await Booking.findOne({ doctorId, patientId, date: slot.date, status: { $ne: 'cancelled' } });
            if (existingWithDoctor) {
                const existingSlot = await TimeSlot.findById(existingWithDoctor.slotId);
                const existingSlotTime = existingSlot ? slotToDate(existingSlot.date, existingSlot.time) : null;
                // Only block if the existing slot time is still in the future
                if (!existingSlotTime || existingSlotTime > new Date()) {
                    return res.status(400).json({ error: `You already have an upcoming booking with this doctor on ${slot.date}. Please choose a different date or wait until your current slot time has passed.` });
                }
            }
        }
        // ── End duplicate prevention ──────────────────────────────────────────

        const doctor = await Doctor.findOne({ doctorId });
        const hospital = await Hospital.findOne({ hospitalId });

        // If not a hospital doctor, check if it's a clinic doctor
        let resolvedDoctorName = 'Unknown';
        let resolvedHospitalName = 'Unknown';
        let resolvedSpecialization = '';

        if (doctor) {
            resolvedDoctorName = doctor.name;
            resolvedSpecialization = doctor.specialization || '';
        } else {
            // Try clinic lookup (clinic doctors use clinicId as doctorId)
            const clinic = await Clinic.findOne({ clinicId: parseInt(doctorId) });
            if (clinic) {
                resolvedDoctorName = clinic.doctorName;
                resolvedSpecialization = clinic.specialization || '';
                resolvedHospitalName = clinic.name || clinic.doctorName; // clinic name as entity name
            }
        }
        if (hospital) resolvedHospitalName = hospital.name;

        const bookingId = 'BK' + Date.now();
        const booking = new Booking({
            bookingId,
            patientId: patientId || null,
            patientName,
            patientAge,
            patientContact,
            patientDescription,
            doctorId,
            doctorName: resolvedDoctorName,
            specialization: resolvedSpecialization,
            hospitalId,
            hospitalName: resolvedHospitalName,
            slotId,
            date: slot.date,
            time: slot.time
        });

        await booking.save();
        // Atomic increment — prevents race conditions on concurrent bookings
        await TimeSlot.findByIdAndUpdate(slotId, { $inc: { currentBookings: 1 } });

        res.status(201).json(booking);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// GET bookings for hospital
app.get('/api/bookings/hospital/:hospitalId', async (req, res) => {
    try {
        const hospitalId = parseInt(req.params.hospitalId);
        const bookings = await Booking.find({ hospitalId, status: { $ne: 'cancelled' } })
            .sort({ date: 1, time: 1 });
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET bookings for clinic (by doctorId range belonging to that clinic)
app.get('/api/bookings/clinic/:clinicId', async (req, res) => {
    try {
        const clinicId = parseInt(req.params.clinicId);
        const clinic = await Clinic.findOne({ clinicId });
        if (!clinic) return res.json([]);
        // Clinic doctors are stored as clinicId in entityId field, or match by doctorId == clinicId
        const bookings = await Booking.find({ doctorId: clinicId, status: { $ne: 'cancelled' } })
            .sort({ date: 1, time: 1 });
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET bookings for patient
app.get('/api/bookings/patient/:patientId', async (req, res) => {
    try {
        const bookings = await Booking.find({ patientId: req.params.patientId })
            .sort({ date: -1 });
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET all bookings for hospital including full patient history (dashboard use)
app.get('/api/bookings/hospital/:hospitalId/all', async (req, res) => {
    try {
        const hospitalId = parseInt(req.params.hospitalId);
        const bookings = await Booking.find({ hospitalId })
            .sort({ date: -1, time: 1 });
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE booking (cancel/soft-delete)
app.delete('/api/bookings/:id', async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        booking.status = 'cancelled';
        await booking.save();
        // Decrement slot count
        if (booking.slotId) {
            const slot = await TimeSlot.findById(booking.slotId);
            if (slot && slot.currentBookings > 0) {
                await TimeSlot.findByIdAndUpdate(booking.slotId, { $inc: { currentBookings: -1 } });
            }
        }
        res.json({ message: 'Booking cancelled' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PATCH reschedule a booking — move to new slotId
app.patch('/api/bookings/:id/reschedule', async (req, res) => {
    try {
        const { newSlotId } = req.body;
        if (!newSlotId) return res.status(400).json({ error: 'newSlotId is required' });
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        if (booking.status === 'cancelled') return res.status(400).json({ error: 'Cannot reschedule a cancelled booking' });
        const newSlot = await TimeSlot.findById(newSlotId);
        if (!newSlot) return res.status(404).json({ error: 'New slot not found' });
        if (!newSlot.isActive) return res.status(400).json({ error: 'That slot is no longer active' });
        if (slotToDate(newSlot.date, newSlot.time) <= new Date()) return res.status(400).json({ error: 'That slot has already passed' });
        if (newSlot.currentBookings >= newSlot.maxBookings) return res.status(400).json({ error: 'That slot is fully booked' });
        // Decrement old slot
        if (booking.slotId) {
            const oldSlot = await TimeSlot.findById(booking.slotId);
            if (oldSlot && oldSlot.currentBookings > 0) {
                await TimeSlot.findByIdAndUpdate(booking.slotId, { $inc: { currentBookings: -1 } });
            }
        }
        // Update booking
        booking.slotId = newSlotId;
        booking.date   = newSlot.date;
        booking.time   = newSlot.time;
        await booking.save();
        // Increment new slot
        await TimeSlot.findByIdAndUpdate(newSlotId, { $inc: { currentBookings: 1 } });
        res.json(booking);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// HARD DELETE booking (permanently remove from DB — used by Clear History / Remove)
app.delete('/api/bookings/:id/hard', async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        // If still active, decrement slot count first
        if (booking.status !== 'cancelled' && booking.slotId) {
            const slot = await TimeSlot.findById(booking.slotId);
            if (slot && slot.currentBookings > 0) {
                await TimeSlot.findByIdAndUpdate(booking.slotId, { $inc: { currentBookings: -1 } });
            }
        }
        await Booking.findByIdAndDelete(req.params.id);
        res.json({ message: 'Booking permanently deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// SEARCH ROUTE
// ==============================
app.post('/api/doctors/search', async (req, res) => {
    try {
        const { query, specialization, hospitalId, availableOnly } = req.body;
        let filter = {};
        if (hospitalId) filter.hospitalId = hospitalId;
        if (availableOnly) filter.available = true;
        if (specialization && specialization !== 'All') filter.specialization = specialization;
        if (query) {
            filter.$or = [
                { name: { $regex: query, $options: 'i' } },
                { specialization: { $regex: query, $options: 'i' } },
                { hospital: { $regex: query, $options: 'i' } }
            ];
        }
        const doctors = await Doctor.find(filter).sort({ available: -1, doctorId: 1 });
        res.json(doctors);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// EMERGENCY ROUTES
// ==============================
app.get('/api/emergency', async (req, res) => {
    try {
        const doctors = await Doctor.find({ available: true }).sort({ distance: 1 }).limit(1);
        if (doctors.length === 0) return res.status(404).json({ error: 'No available doctors found' });
        res.json(doctors[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/emergency/nearby', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const hasCoords = !isNaN(userLat) && !isNaN(userLng);

        // Haversine distance in km
        function haversine(lat1, lon1, lat2, lon2) {
            const R = 6371;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }

        const availableDoctors = await Doctor.find({ available: true });
        const hospitals = await Hospital.find({ hasEmergency: true });

        let hospitalsWithDist = hospitals.map(h => {
            const obj = h.toObject();
            if (hasCoords && h.coordinates && h.coordinates.lat && h.coordinates.lng) {
                obj.distanceKm = haversine(userLat, userLng, h.coordinates.lat, h.coordinates.lng);
                obj.distanceLabel = obj.distanceKm < 1
                    ? `${Math.round(obj.distanceKm * 1000)} m away`
                    : `${obj.distanceKm.toFixed(1)} km away`;
            } else {
                obj.distanceKm = 9999;
                obj.distanceLabel = 'Distance unknown';
            }
            return obj;
        });

        let doctorsWithDist = availableDoctors.map(d => {
            const obj = d.toObject();
            obj.distanceKm = 9999;
            obj.distanceLabel = d.distance || 'Nearby';
            return obj;
        });

        if (hasCoords) {
            hospitalsWithDist.sort((a, b) => a.distanceKm - b.distanceKm);
        }

        res.json({
            doctors: doctorsWithDist.slice(0, 3),
            hospitals: hospitalsWithDist.slice(0, 5),
            userLat: userLat || null,
            userLng: userLng || null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// STATISTICS ROUTE
// ==============================
app.get('/api/stats/hospital/:hospitalId', async (req, res) => {
    try {
        const hospitalId = parseInt(req.params.hospitalId);
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        const totalDoctors = await Doctor.countDocuments({ hospitalId });
        const availableDoctors = await Doctor.countDocuments({ hospitalId, available: true });
        const todayBookings = await Booking.countDocuments({ hospitalId, date: today, status: 'confirmed' });
        const totalBookings = await Booking.countDocuments({ hospitalId, status: { $ne: 'cancelled' } });
        const specializations = await Doctor.aggregate([
            { $match: { hospitalId } },
            { $group: { _id: '$specialization', count: { $sum: 1 } } }
        ]);
        const upcomingSlots = await TimeSlot.countDocuments({ hospitalId, isActive: true, date: { $gte: today } });

        res.json({
            totalDoctors,
            availableDoctors,
            unavailableDoctors: totalDoctors - availableDoctors,
            specializations,
            todayBookings,
            totalBookings,
            upcomingSlots,
            serverTime: now.toISOString()  // client can sync display time
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// GLOBAL SEARCH
// ==============================
// FIX: field projection — only fetch fields we actually use, not entire documents
const DOCTOR_PROJ = { doctorId:1, name:1, specialization:1, hospital:1, hospitalId:1, available:1, image:1, rating:1, experience:1, phone:1, email:1, distance:1 };
const CLINIC_PROJ  = { clinicId:1, doctorName:1, specialization:1, name:1, available:1, image:1, rating:1, experience:1, phone:1, email:1, consultationFee:1, timings:1, address:1 };

app.get('/api/global-search', async (req, res) => {
    try {
        const { query, specialization, availableOnly, entityType } = req.query;
        let doctorFilter = {};
        let clinicFilter = {};
        if (availableOnly === 'true') { doctorFilter.available = true; clinicFilter.available = true; }
        if (specialization && specialization !== 'All') {
            doctorFilter.specialization = { $regex: specialization, $options: 'i' };
            clinicFilter.specialization = { $regex: specialization, $options: 'i' };
        }
        if (query) {
            const searchRegex = { $regex: query, $options: 'i' };
            doctorFilter.$or = [{ name: searchRegex }, { specialization: searchRegex }, { hospital: searchRegex }];
            clinicFilter.$or = [{ doctorName: searchRegex }, { specialization: searchRegex }, { name: searchRegex }];
        }

        // FIX: run both queries in parallel with lean() + projection
        const [doctors, clinics] = await Promise.all([
            (!entityType || entityType === 'all' || entityType === 'hospital')
                ? Doctor.find(doctorFilter, DOCTOR_PROJ).sort({ available: -1, rating: -1 }).lean()
                : [],
            (!entityType || entityType === 'all' || entityType === 'clinic')
                ? Clinic.find(clinicFilter, CLINIC_PROJ).sort({ available: -1, rating: -1 }).lean()
                : []
        ]);

        const results = [
            ...doctors.map(d => ({
                id: d.doctorId, doctorId: d.doctorId, hospitalId: d.hospitalId,
                name: d.name, specialization: d.specialization,
                entityName: d.hospital, entityType: 'hospital', distance: d.distance,
                available: d.available, image: d.image, rating: d.rating,
                experience: d.experience, phone: d.phone, email: d.email
            })),
            ...clinics.map(c => ({
                id: c.clinicId, name: c.doctorName, specialization: c.specialization,
                entityName: c.name, entityType: 'clinic', distance: 'Home Visit',
                available: c.available, image: c.image, rating: c.rating,
                experience: c.experience, phone: c.phone, email: c.email,
                consultationFee: c.consultationFee, timings: c.timings, address: c.address
            }))
        ];

        results.sort((a, b) => {
            if (a.available !== b.available) return b.available ? 1 : -1;
            return (b.rating || 0) - (a.rating || 0);
        });
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// CLINIC ROUTES
// ==============================
app.get('/api/clinics', async (req, res) => {
    try {
        const clinics = await Clinic.find().sort({ available: -1, clinicId: 1 });
        res.json(clinics);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/clinics/:id', async (req, res) => {
    try {
        const clinic = await Clinic.findOne({ clinicId: parseInt(req.params.id) });
        if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
        res.json(clinic);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/clinics/login', async (req, res) => {
    try {
        const { clinicId, password } = req.body;
        const clinic = await Clinic.findOne({ clinicId: parseInt(clinicId) });
        if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
        if (clinic.password !== password) return res.status(401).json({ error: 'Invalid password' });
        const token = 'C' + clinic.clinicId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        CLINIC_TOKENS.add(token);
        res.json({ success: true, clinic, token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/clinics', async (req, res) => {
    try {
        const clinic = new Clinic(req.body);
        await clinic.save();
        res.status(201).json(clinic);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/clinics/:id', async (req, res) => {
    try {
        const clinic = await Clinic.findOneAndUpdate({ clinicId: parseInt(req.params.id) }, req.body, { new: true });
        if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
        res.json(clinic);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.patch('/api/clinics/:id/availability', async (req, res) => {
    try {
        const clinic = await Clinic.findOne({ clinicId: parseInt(req.params.id) });
        if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
        clinic.available = !clinic.available;
        clinic.lastUpdated = new Date().toISOString();
        await clinic.save();
        res.json(clinic);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/clinics/:id', async (req, res) => {
    try {
        const clinic = await Clinic.findOneAndDelete({ clinicId: parseInt(req.params.id) });
        if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
        res.json({ message: 'Clinic deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Catch-all: prevents blank page on refresh in production
app.get('*', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📱 Frontend: http://localhost:${PORT}/index.html`);
});
