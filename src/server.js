const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const Hospital = require('./models/Hospital');
const Doctor = require('./models/Doctor');
const Clinic = require('./models/Clinic');
const TimeSlot = require('./models/TimeSlot');
const Booking = require('./models/Booking');
const Patient = require('./models/Patient');

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(self)');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self' https://maps.google.com https://www.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    next();
});
app.use(cors((req, callback) => {
    const origin = req.header('Origin');
    let allowed = !origin;
    try {
        allowed = allowed || new URL(origin).host === req.headers.host;
    } catch (e) {}
    allowed = allowed
        || (allowedOrigins.length === 0 && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || ''))
        || allowedOrigins.includes(origin);
    callback(null, { origin: allowed });
}));
app.use(bodyParser.json({ limit: '100kb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '100kb' }));
app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') sanitizeObject(req.body);
    next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Simple dashboard auth middleware ──────────────────────────────────────
// Protects hospital/clinic dashboard write operations.
// Reads the token from X-Dashboard-Token header.
const DASHBOARD_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const HOSP_TOKENS  = new Map(); // populated on login
const CLINIC_TOKENS = new Map();
function requireDashboardAuth(req, res, next) {
    const token = req.headers['x-dashboard-token'];
    if (!token || (!isValidDashboardToken(HOSP_TOKENS, token) && !isValidDashboardToken(CLINIC_TOKENS, token))) {
        return res.status(401).json({ error: 'Unauthorized — please log in' });
    }
    next();
}

function issueDashboardToken(store, subjectId) {
    const token = crypto.randomBytes(32).toString('hex');
    store.set(token, { subjectId, expiresAt: Date.now() + DASHBOARD_TOKEN_TTL_MS });
    return token;
}

function isValidDashboardToken(store, token) {
    const session = store.get(token);
    if (!session) return false;
    if (session.expiresAt <= Date.now()) {
        store.delete(token);
        return false;
    }
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const store of [HOSP_TOKENS, CLINIC_TOKENS]) {
        for (const [token, session] of store.entries()) {
            if (session.expiresAt <= now) store.delete(token);
        }
    }
}, 15 * 60 * 1000);

function createRateLimiter({ windowMs, max, message }) {
    const hits = new Map();
    return (req, res, next) => {
        const key = `${req.ip}:${req.path}`;
        const now = Date.now();
        const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };
        if (entry.resetAt <= now) {
            entry.count = 0;
            entry.resetAt = now + windowMs;
        }
        entry.count += 1;
        hits.set(key, entry);
        res.setHeader('RateLimit-Limit', String(max));
        res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
        res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
        if (entry.count > max) return res.status(429).json({ error: message });
        next();
    };
}

const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many login attempts. Please wait and try again.'
});

function sanitizeObject(value) {
    if (!value || typeof value !== 'object') return value;
    for (const key of Object.keys(value)) {
        if (typeof value[key] === 'string') {
            value[key] = value[key].trim().replace(/[<>]/g, '');
            if (value[key].length > 1000) value[key] = value[key].slice(0, 1000);
        } else if (value[key] && typeof value[key] === 'object') {
            sanitizeObject(value[key]);
        }
    }
    return value;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
function isValidEmail(value) {
    return EMAIL_RE.test(normalizeEmail(value));
}

const AUTH_TOKEN_TTL_SECONDS = 8 * 60 * 60;
const JWT_SECRET = process.env.JWT_SECRET || 'docavail-dev-jwt-secret-change-me';

function base64UrlEncode(input) {
    return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input) {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
}

function issueJwt(payload, expiresInSeconds = AUTH_TOKEN_TTL_SECONDS) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
        ...payload,
        iss: 'docavail',
        iat: now,
        exp: now + expiresInSeconds
    };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
    const unsigned = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url');
    return `${unsigned}.${signature}`;
}

function verifyJwt(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    try {
        const payload = JSON.parse(base64UrlDecode(encodedPayload));
        if (!payload || typeof payload !== 'object') return null;
        if (payload.exp && payload.exp <= Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

function getAuthToken(req) {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
    const legacy = req.headers['x-dashboard-token'];
    return typeof legacy === 'string' ? legacy.trim() : '';
}

function requireJwtAuth(kind) {
    return (req, res, next) => {
        const payload = verifyJwt(getAuthToken(req));
        if (!payload) {
            return res.status(401).json({ error: 'Unauthorized - please log in' });
        }
        if (kind && payload.kind !== kind) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        req.auth = payload;
        next();
    };
}

const requirePatientAuth = requireJwtAuth('patient');
const requireAnyAuth = requireJwtAuth();

function isBcryptHash(value) {
    return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

async function verifyStoredPassword(doc, plainPassword) {
    if (!doc || typeof plainPassword !== 'string') return false;
    if (isBcryptHash(doc.password)) return bcrypt.compare(plainPassword, doc.password);
    const matched = doc.password === plainPassword;
    if (matched) {
        doc.password = await bcrypt.hash(plainPassword, 10);
        await doc.save();
    }
    return matched;
}

function stripSecretFields(doc) {
    const obj = doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
    delete obj.password;
    return obj;
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
    if (mongoose.connection.readyState !== 1) return;

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
setInterval(() => cleanExpiredSlots().catch(err => console.error('Slot cleanup error:', err.message)), 60 * 1000);
cleanExpiredSlots().catch(err => console.error('Slot cleanup error:', err.message));

// Use JWT-based auth for dashboard writes.
requireDashboardAuth = requireJwtAuth('dashboard');

// ==============================
// PATIENT AUTH ROUTES
// ==============================
app.post('/api/patients/register', loginLimiter, async (req, res) => {
    try {
        const { name, email, password, phone, age, address } = req.body;
        if (!name || !email || !password || !phone) {
            return res.status(400).json({ error: 'Name, email, phone, and password are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        const normalizedEmail = normalizeEmail(email);
        if (!isValidEmail(normalizedEmail)) {
            return res.status(400).json({ error: 'Please enter a valid email address' });
        }
        const existing = await Patient.findOne({ email: normalizedEmail });
        if (existing) return res.status(400).json({ error: 'Email already registered' });
        // Hash password before saving — plain text never stored
        const hashedPassword = await bcrypt.hash(password, 10);
        const patient = new Patient({ name, email: normalizedEmail, password: hashedPassword, phone, age, address });
        await patient.save();
        const token = issueJwt({
            kind: 'patient',
            patientId: patient._id.toString(),
            name: patient.name,
            email: patient.email,
            phone: patient.phone
        });
        res.status(201).json({
            success: true,
            patient: { id: patient._id, name: patient.name, email: patient.email, phone: patient.phone, age: patient.age },
            token
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/patients/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        const normalizedEmail = normalizeEmail(email);
        if (!isValidEmail(normalizedEmail)) {
            return res.status(400).json({ error: 'Please enter a valid email address' });
        }
        const patient = await Patient.findOne({ email: normalizedEmail });
        if (!patient) return res.status(404).json({ error: 'No account found with this email' });
        // Compare entered password with hashed password in DB
        const isMatch = await bcrypt.compare(password, patient.password);
        if (!isMatch) return res.status(401).json({ error: 'Incorrect password. Forgot your password? Contact admin: docavail4@gmail.com' });
        const token = issueJwt({
            kind: 'patient',
            patientId: patient._id.toString(),
            name: patient.name,
            email: patient.email,
            phone: patient.phone
        });
        res.json({ success: true, patient: { id: patient._id, name: patient.name, email: patient.email, phone: patient.phone, age: patient.age }, token });
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
        res.json(stripSecretFields(hospital));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/hospitals', requireDashboardAuth, async (req, res) => {
    try {
        const hospitalData = { ...req.body };
        if (hospitalData.password) hospitalData.password = await bcrypt.hash(hospitalData.password, 10);
        const hospital = new Hospital(hospitalData);
        await hospital.save();
        res.status(201).json(stripSecretFields(hospital));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Hospital login
app.post('/api/hospitals/login', loginLimiter, async (req, res) => {
    try {
        const { hospitalId, password } = req.body;
        if (!hospitalId || !password) return res.status(400).json({ error: 'Hospital ID and password are required' });
        const hospital = await Hospital.findOne({ hospitalId: parseInt(hospitalId) });
        if (!hospital) return res.status(404).json({ error: 'Hospital not found' });
        if (!(await verifyStoredPassword(hospital, password))) return res.status(401).json({ error: 'Invalid password' });
        const token = issueJwt({ kind: 'dashboard', dashboardType: 'hospital', subjectId: hospital.hospitalId, hospitalId: hospital.hospitalId });
        res.json({ success: true, hospital: stripSecretFields(hospital), token });
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
        const today = new Date().toISOString().split('T')[0];

        const [doctors, futureSlots] = await Promise.all([
            Doctor.find({ hospitalId }).sort({ available: -1, doctorId: 1 }).lean(),
            TimeSlot.aggregate([
                { $match: { hospitalId, isActive: true, date: { $gte: today } } },
                { $group: { _id: '$doctorId', futureSlotCount: { $sum: 1 } } }
            ])
        ]);

        const slotCountMap = {};
        for (const s of futureSlots) slotCountMap[s._id] = s.futureSlotCount;

        const result = doctors.map(d => ({ ...d, futureSlotCount: slotCountMap[d.doctorId] || 0 }));
        res.json(result);
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

app.post('/api/doctors', requireDashboardAuth, async (req, res) => {
    try {
        const doctor = new Doctor(req.body);
        await doctor.save();
        res.status(201).json(doctor);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/doctors/:id', requireDashboardAuth, async (req, res) => {
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

app.patch('/api/doctors/:id/availability', requireDashboardAuth, async (req, res) => {
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

app.delete('/api/doctors/:id', requireDashboardAuth, async (req, res) => {
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
app.post('/api/slots', requireDashboardAuth, async (req, res) => {
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
app.put('/api/slots/:id', requireDashboardAuth, async (req, res) => {
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
app.delete('/api/slots/:id', requireDashboardAuth, async (req, res) => {
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
app.post('/api/bookings', requirePatientAuth, async (req, res) => {
    try {
        const patientId = req.auth.patientId;
        const patientName = req.auth.name || req.body.patientName;
        const patientAge = req.body.patientAge ?? null;
        const patientContact = req.auth.phone || req.body.patientContact || '';
        const patientDescription = req.body.patientDescription || '';
        const { doctorId, hospitalId, slotId } = req.body;

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

            // Note: we only block booking the exact same slot twice (above).
            // Same-day same-doctor is allowed — patient may want a different time slot.
        }
        // ── End duplicate prevention ──────────────────────────────────────────

        const doctor = await Doctor.findOne({ doctorId });
        const hospital = await Hospital.findOne({ hospitalId });

        // If not a hospital doctor, check if it's a clinic doctor
        let resolvedDoctorName = 'Unknown';
        let resolvedHospitalName = 'Unknown';
        let resolvedSpecialization = '';
        let resolvedClinicId = null;

        if (doctor) {
            resolvedDoctorName = doctor.name;
            resolvedSpecialization = doctor.specialization || '';
        } else {
            // Try clinic lookup (clinic doctors use clinicId as doctorId)
            const clinic = await Clinic.findOne({ clinicId: parseInt(doctorId) });
            if (clinic) {
                resolvedDoctorName = clinic.doctorName;
                resolvedSpecialization = clinic.specialization || '';
                resolvedHospitalName = clinic.name || clinic.doctorName;
                resolvedClinicId = clinic.clinicId;
            }
        }
        if (hospital) resolvedHospitalName = hospital.name;

        const bookingId = 'BK' + Date.now();
        const booking = new Booking({
            bookingId,
            patientId,
            patientName,
            patientAge,
            patientContact,
            patientDescription,
            doctorId,
            doctorName: resolvedDoctorName,
            specialization: resolvedSpecialization,
            hospitalId,
            hospitalName: resolvedHospitalName,
            clinicId: resolvedClinicId,
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
app.get('/api/bookings/hospital/:hospitalId', requireDashboardAuth, async (req, res) => {
    try {
        const hospitalId = parseInt(req.params.hospitalId);
        const bookings = await Booking.find({ hospitalId, status: { $ne: 'cancelled' } })
            .sort({ date: 1, time: 1 });
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET bookings for clinic (by clinicId field or doctorId == clinicId)
app.get('/api/bookings/clinic/:clinicId', requireDashboardAuth, async (req, res) => {
    try {
        const clinicId = parseInt(req.params.clinicId);
        const clinic = await Clinic.findOne({ clinicId });
        if (!clinic) return res.json([]);
        // Find by clinicId field (new bookings) OR doctorId == clinicId (legacy)
        const bookings = await Booking.find({
            $or: [{ clinicId: clinicId }, { doctorId: clinicId }],
            status: { $ne: 'cancelled' }
        }).sort({ date: 1, time: 1 });
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET bookings for patient
app.get('/api/bookings/patient/:patientId', requireAnyAuth, async (req, res) => {
    try {
        if (req.auth.kind === 'patient' && String(req.params.patientId) !== String(req.auth.patientId)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const bookings = await Booking.find({ patientId: req.params.patientId })
            .sort({ date: -1 });
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET all bookings for hospital including full patient history (dashboard use)
app.get('/api/bookings/hospital/:hospitalId/all', requireDashboardAuth, async (req, res) => {
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
app.delete('/api/bookings/:id', requireAnyAuth, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        if (req.auth.kind === 'patient' && String(booking.patientId) !== String(req.auth.patientId)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
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
app.patch('/api/bookings/:id/reschedule', requireAnyAuth, async (req, res) => {
    try {
        const { newSlotId } = req.body;
        if (!newSlotId) return res.status(400).json({ error: 'newSlotId is required' });
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        if (req.auth.kind === 'patient' && String(booking.patientId) !== String(req.auth.patientId)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
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
app.delete('/api/bookings/:id/hard', requireAnyAuth, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        if (req.auth.kind === 'patient' && String(booking.patientId) !== String(req.auth.patientId)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
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
        res.json(clinics.map(stripSecretFields));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/clinics/:id', async (req, res) => {
    try {
        const clinic = await Clinic.findOne({ clinicId: parseInt(req.params.id) });
        if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
        res.json(stripSecretFields(clinic));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/clinics/login', loginLimiter, async (req, res) => {
    try {
        const { clinicId, password } = req.body;
        if (!clinicId || !password) return res.status(400).json({ error: 'Clinic ID and password are required' });
        const clinic = await Clinic.findOne({ clinicId: parseInt(clinicId) });
        if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
        if (!(await verifyStoredPassword(clinic, password))) return res.status(401).json({ error: 'Invalid password' });
        const token = issueJwt({ kind: 'dashboard', dashboardType: 'clinic', subjectId: clinic.clinicId, clinicId: clinic.clinicId });
        res.json({ success: true, clinic: stripSecretFields(clinic), token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/clinics', requireDashboardAuth, async (req, res) => {
    try {
        const clinicData = { ...req.body };
        if (clinicData.password) clinicData.password = await bcrypt.hash(clinicData.password, 10);
        const clinic = new Clinic(clinicData);
        await clinic.save();
        res.status(201).json(stripSecretFields(clinic));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/clinics/:id', requireDashboardAuth, async (req, res) => {
    try {
        const update = { ...req.body };
        if (update.password) update.password = await bcrypt.hash(update.password, 10);
        const clinic = await Clinic.findOneAndUpdate({ clinicId: parseInt(req.params.id) }, update, { new: true, runValidators: true });
        if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
        res.json(stripSecretFields(clinic));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.patch('/api/clinics/:id/availability', requireDashboardAuth, async (req, res) => {
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

app.delete('/api/clinics/:id', requireDashboardAuth, async (req, res) => {
    try {
        const clinic = await Clinic.findOneAndDelete({ clinicId: parseInt(req.params.id) });
        if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
        res.json({ message: 'Clinic deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Catch-all: prevents blank page on refresh in production
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📱 Frontend: http://localhost:${PORT}/index.html`);
});
