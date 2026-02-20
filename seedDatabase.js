const mongoose = require('mongoose');
require('dotenv').config();
const { Hospital, Doctor, Clinic, Patient } = require('./models');

mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// =============================================================================
//  KERALA SEED — Thiruvananthapuram & Kollam Districts
//  Hospital names, addresses, coordinates: REAL
//  Doctor names, phone numbers: FICTIONAL (safe for mini-project)
// =============================================================================

const hospitals = [
    // ── THIRUVANANTHAPURAM ────────────────────────────────────────────────────
    {
        hospitalId: 1, name: 'KIMS Hospital',
        location: 'Anayara, Thiruvananthapuram',
        address: 'Anayara P.O, Thiruvananthapuram, Kerala 695029',
        phone: '0471-3041000', email: 'appointments@kimshealth.org', password: 'hospital123',
        type: 'Multi-Specialty',
        specialties: ['Cardiology','Neurology','Oncology','Orthopedic','Pediatrics','Gastroenterology'],
        rating: 4.8, coordinates: { lat: 8.4893, lng: 76.9475 }, hasEmergency: true, maxBookingsPerSlot: 5
    },
    {
        hospitalId: 2, name: 'Sree Chitra Tirunal Institute (SCTIMST)',
        location: 'Medical College, Thiruvananthapuram',
        address: 'Medical College P.O, Thiruvananthapuram, Kerala 695011',
        phone: '0471-2524664', email: 'appointments@sctimst.ac.in', password: 'hospital123',
        type: 'Specialty',
        specialties: ['Cardiology','Neurology','Neurosurgery'],
        rating: 4.9, coordinates: { lat: 8.5241, lng: 76.9366 }, hasEmergency: true, maxBookingsPerSlot: 4
    },
    {
        hospitalId: 3, name: 'Government Medical College Thiruvananthapuram',
        location: 'Medical College, Thiruvananthapuram',
        address: 'Medical College P.O, Thiruvananthapuram, Kerala 695011',
        phone: '0471-2528386', email: 'principal.gmctvm@kerala.gov.in', password: 'hospital123',
        type: 'General',
        specialties: ['General Medicine','Surgery','Pediatrics','Orthopedic','Dermatology','Gynecology'],
        rating: 4.2, coordinates: { lat: 8.5208, lng: 76.9338 }, hasEmergency: true, maxBookingsPerSlot: 6
    },
    {
        hospitalId: 4, name: 'Ananthapuri Hospital',
        location: 'Chackai, Thiruvananthapuram',
        address: 'NH Bypass, Chackai, Thiruvananthapuram, Kerala 695024',
        phone: '0471-2731000', email: 'appointments@ananthapurihospitals.com', password: 'hospital123',
        type: 'Multi-Specialty',
        specialties: ['Cardiology','Orthopedic','Neurology','General Medicine','Gynecology'],
        rating: 4.5, coordinates: { lat: 8.4987, lng: 76.9545 }, hasEmergency: true, maxBookingsPerSlot: 5
    },
    {
        hospitalId: 5, name: 'Cosmopolitan Hospital',
        location: 'Pattom, Thiruvananthapuram',
        address: 'Murinjapalam, Pattom P.O, Thiruvananthapuram, Kerala 695004',
        phone: '0471-2318000', email: 'info@cosmopolitanhospital.com', password: 'hospital123',
        type: 'Multi-Specialty',
        specialties: ['Cardiology','Nephrology','Orthopedic','Neurology','Oncology'],
        rating: 4.6, coordinates: { lat: 8.5360, lng: 76.9484 }, hasEmergency: true, maxBookingsPerSlot: 5
    },
    {
        hospitalId: 6, name: 'SK Hospital',
        location: 'Sreekaryam, Thiruvananthapuram',
        address: 'Sreekaryam P.O, Thiruvananthapuram, Kerala 695017',
        phone: '0471-2590444', email: 'info@skhospital.in', password: 'hospital123',
        type: 'Multi-Specialty',
        specialties: ['General Medicine','Orthopedic','Cardiology','Pediatrics'],
        rating: 4.4, coordinates: { lat: 8.5452, lng: 76.9101 }, hasEmergency: true, maxBookingsPerSlot: 5
    },
    {
        hospitalId: 7, name: 'SAT Hospital (Medical College)',
        location: 'Medical College, Thiruvananthapuram',
        address: 'SAT Hospital, Medical College P.O, Thiruvananthapuram, Kerala 695011',
        phone: '0471-2528186', email: 'sat.hospital@kerala.gov.in', password: 'hospital123',
        type: 'Specialty',
        specialties: ['Pediatrics','Neonatology','Pediatric Surgery'],
        rating: 4.3, coordinates: { lat: 8.5219, lng: 76.9302 }, hasEmergency: true, maxBookingsPerSlot: 5
    },
    // ── KOLLAM ────────────────────────────────────────────────────────────────
    {
        hospitalId: 8, name: 'Bishop Benziger Hospital',
        location: 'Kollam Town',
        address: 'Bishop Benziger Hospital Road, Kollam, Kerala 691001',
        phone: '0474-2763007', email: 'appointments@benzigerhospital.com', password: 'hospital123',
        type: 'Multi-Specialty',
        specialties: ['Cardiology','General Medicine','Orthopedic','Pediatrics','Gynecology'],
        rating: 4.5, coordinates: { lat: 8.8932, lng: 76.6141 }, hasEmergency: true, maxBookingsPerSlot: 5
    },
    {
        hospitalId: 9, name: 'Government Medical College Kollam',
        location: 'Parippally, Kollam',
        address: 'Parippally, Kollam, Kerala 691574',
        phone: '0474-2572211', email: 'principal.gmcklm@kerala.gov.in', password: 'hospital123',
        type: 'General',
        specialties: ['General Medicine','Surgery','Pediatrics','Dermatology','Orthopedic'],
        rating: 4.1, coordinates: { lat: 8.9443, lng: 76.7206 }, hasEmergency: true, maxBookingsPerSlot: 6
    },
    {
        hospitalId: 10, name: 'Travancore Medical College',
        location: 'Umayanalloor, Kollam',
        address: 'Umayanalloor P.O, Kollam, Kerala 691589',
        phone: '0474-2527100', email: 'info@travancoremedical.ac.in', password: 'hospital123',
        type: 'Multi-Specialty',
        specialties: ['General Medicine','Cardiology','Orthopedic','Neurology','Pediatrics'],
        rating: 4.3, coordinates: { lat: 8.9012, lng: 76.6887 }, hasEmergency: true, maxBookingsPerSlot: 5
    },
    {
        hospitalId: 11, name: 'Pilgrim Hospital',
        location: 'Kadappakada, Kollam',
        address: 'Kadappakada, Kollam, Kerala 691008',
        phone: '0474-2742100', email: 'info@pilgrimhospital.in', password: 'hospital123',
        type: 'Multi-Specialty',
        specialties: ['Cardiology','Orthopedic','General Medicine','Gynecology'],
        rating: 4.3, coordinates: { lat: 8.8855, lng: 76.6022 }, hasEmergency: true, maxBookingsPerSlot: 5
    },
    {
        hospitalId: 12, name: 'Aster MIMS Kollam',
        location: 'Chinnakada, Kollam',
        address: 'NH 744, Chinnakada, Kollam, Kerala 691001',
        phone: '0474-2799999', email: 'kollam@asterhospitals.in', password: 'hospital123',
        type: 'Multi-Specialty',
        specialties: ['Cardiology','Oncology','Neurology','Orthopedic','Gastroenterology'],
        rating: 4.6, coordinates: { lat: 8.8869, lng: 76.5961 }, hasEmergency: true, maxBookingsPerSlot: 5
    }
];

const doctors = [
    // KIMS (1)
    { doctorId:1, name:'Dr. Rajesh Nair', specialization:'Cardiologist', hospital:'KIMS Hospital', hospitalId:1, available:true, distance:'', image:'https://i.pravatar.cc/300?img=11', gender:'Male', experience:'18 years', rating:4.9, phone:'0471-3041101', email:'rajesh.nair@kimshealth.org', lastUpdated:new Date() },
    { doctorId:2, name:'Dr. Priya Menon', specialization:'Neurologist', hospital:'KIMS Hospital', hospitalId:1, available:true, distance:'', image:'https://i.pravatar.cc/300?img=47', gender:'Female', experience:'14 years', rating:4.8, phone:'0471-3041102', email:'priya.menon@kimshealth.org', lastUpdated:new Date() },
    { doctorId:3, name:'Dr. Suresh Pillai', specialization:'Orthopedic', hospital:'KIMS Hospital', hospitalId:1, available:false, distance:'', image:'https://i.pravatar.cc/300?img=52', gender:'Male', experience:'20 years', rating:4.7, phone:'0471-3041103', email:'suresh.pillai@kimshealth.org', lastUpdated:new Date() },
    { doctorId:4, name:'Dr. Anitha Krishnan', specialization:'Pediatrician', hospital:'KIMS Hospital', hospitalId:1, available:true, distance:'', image:'https://i.pravatar.cc/300?img=44', gender:'Female', experience:'12 years', rating:4.8, phone:'0471-3041104', email:'anitha.krishnan@kimshealth.org', lastUpdated:new Date() },
    { doctorId:5, name:'Dr. Rajan Thankachan', specialization:'Gastroenterologist', hospital:'KIMS Hospital', hospitalId:1, available:true, distance:'', image:'https://i.pravatar.cc/300?img=61', gender:'Male', experience:'16 years', rating:4.7, phone:'0471-3041105', email:'rajan.thankachan@kimshealth.org', lastUpdated:new Date() },
    // SCTIMST (2)
    { doctorId:6, name:'Dr. Gopinath Iyer', specialization:'Cardiologist', hospital:'Sree Chitra Tirunal Institute (SCTIMST)', hospitalId:2, available:true, distance:'', image:'https://i.pravatar.cc/300?img=68', gender:'Male', experience:'25 years', rating:5.0, phone:'0471-2524701', email:'gopinath.iyer@sctimst.ac.in', lastUpdated:new Date() },
    { doctorId:7, name:'Dr. Lekha Varma', specialization:'Neurologist', hospital:'Sree Chitra Tirunal Institute (SCTIMST)', hospitalId:2, available:true, distance:'', image:'https://i.pravatar.cc/300?img=38', gender:'Female', experience:'22 years', rating:4.9, phone:'0471-2524702', email:'lekha.varma@sctimst.ac.in', lastUpdated:new Date() },
    // Govt Medical TVM (3)
    { doctorId:8, name:'Dr. Biju Thomas', specialization:'General Physician', hospital:'Government Medical College Thiruvananthapuram', hospitalId:3, available:true, distance:'', image:'https://i.pravatar.cc/300?img=59', gender:'Male', experience:'16 years', rating:4.4, phone:'0471-2528401', email:'biju.thomas@gmctvm.gov.in', lastUpdated:new Date() },
    { doctorId:9, name:'Dr. Sindhu Mohan', specialization:'Dermatologist', hospital:'Government Medical College Thiruvananthapuram', hospitalId:3, available:false, distance:'', image:'https://i.pravatar.cc/300?img=32', gender:'Female', experience:'10 years', rating:4.3, phone:'0471-2528402', email:'sindhu.mohan@gmctvm.gov.in', lastUpdated:new Date() },
    { doctorId:10, name:'Dr. Manoj Chandran', specialization:'Orthopedic', hospital:'Government Medical College Thiruvananthapuram', hospitalId:3, available:true, distance:'', image:'https://i.pravatar.cc/300?img=57', gender:'Male', experience:'13 years', rating:4.2, phone:'0471-2528403', email:'manoj.chandran@gmctvm.gov.in', lastUpdated:new Date() },
    // Ananthapuri (4)
    { doctorId:11, name:'Dr. Vivek Nambiar', specialization:'Cardiologist', hospital:'Ananthapuri Hospital', hospitalId:4, available:true, distance:'', image:'https://i.pravatar.cc/300?img=15', gender:'Male', experience:'17 years', rating:4.7, phone:'0471-2731101', email:'vivek.nambiar@ananthapurihospitals.com', lastUpdated:new Date() },
    { doctorId:12, name:'Dr. Deepa Rajeev', specialization:'Gynecologist', hospital:'Ananthapuri Hospital', hospitalId:4, available:true, distance:'', image:'https://i.pravatar.cc/300?img=49', gender:'Female', experience:'19 years', rating:4.8, phone:'0471-2731102', email:'deepa.rajeev@ananthapurihospitals.com', lastUpdated:new Date() },
    // Cosmopolitan (5)
    { doctorId:13, name:'Dr. Santhosh Rajan', specialization:'Neurologist', hospital:'Cosmopolitan Hospital', hospitalId:5, available:true, distance:'', image:'https://i.pravatar.cc/300?img=62', gender:'Male', experience:'21 years', rating:4.7, phone:'0471-2318101', email:'santhosh.rajan@cosmopolitanhospital.com', lastUpdated:new Date() },
    { doctorId:14, name:'Dr. Nisha Gopalan', specialization:'Oncologist', hospital:'Cosmopolitan Hospital', hospitalId:5, available:true, distance:'', image:'https://i.pravatar.cc/300?img=36', gender:'Female', experience:'16 years', rating:4.8, phone:'0471-2318102', email:'nisha.gopalan@cosmopolitanhospital.com', lastUpdated:new Date() },
    // SK Hospital (6)
    { doctorId:15, name:'Dr. Arun Kumar', specialization:'General Physician', hospital:'SK Hospital', hospitalId:6, available:true, distance:'', image:'https://i.pravatar.cc/300?img=53', gender:'Male', experience:'11 years', rating:4.4, phone:'0471-2590501', email:'arun.kumar@skhospital.in', lastUpdated:new Date() },
    // SAT Hospital (7)
    { doctorId:16, name:'Dr. Rekha Suresh', specialization:'Pediatrician', hospital:'SAT Hospital (Medical College)', hospitalId:7, available:true, distance:'', image:'https://i.pravatar.cc/300?img=41', gender:'Female', experience:'15 years', rating:4.6, phone:'0471-2528201', email:'rekha.suresh@sathospital.gov.in', lastUpdated:new Date() },
    // Bishop Benziger (8)
    { doctorId:17, name:'Dr. Jose Mathew', specialization:'Cardiologist', hospital:'Bishop Benziger Hospital', hospitalId:8, available:true, distance:'', image:'https://i.pravatar.cc/300?img=70', gender:'Male', experience:'23 years', rating:4.8, phone:'0474-2763101', email:'jose.mathew@benzigerhospital.com', lastUpdated:new Date() },
    { doctorId:18, name:'Dr. Mary Antony', specialization:'Gynecologist', hospital:'Bishop Benziger Hospital', hospitalId:8, available:true, distance:'', image:'https://i.pravatar.cc/300?img=45', gender:'Female', experience:'18 years', rating:4.7, phone:'0474-2763102', email:'mary.antony@benzigerhospital.com', lastUpdated:new Date() },
    { doctorId:19, name:'Dr. Paul Varghese', specialization:'Orthopedic', hospital:'Bishop Benziger Hospital', hospitalId:8, available:false, distance:'', image:'https://i.pravatar.cc/300?img=65', gender:'Male', experience:'14 years', rating:4.5, phone:'0474-2763103', email:'paul.varghese@benzigerhospital.com', lastUpdated:new Date() },
    // Govt Medical Kollam (9)
    { doctorId:20, name:'Dr. Sreeja Balakrishnan', specialization:'Dermatologist', hospital:'Government Medical College Kollam', hospitalId:9, available:true, distance:'', image:'https://i.pravatar.cc/300?img=33', gender:'Female', experience:'9 years', rating:4.2, phone:'0474-2572301', email:'sreeja.b@gmcklm.gov.in', lastUpdated:new Date() },
    { doctorId:21, name:'Dr. Ramesh Kumar', specialization:'General Physician', hospital:'Government Medical College Kollam', hospitalId:9, available:true, distance:'', image:'https://i.pravatar.cc/300?img=56', gender:'Male', experience:'12 years', rating:4.1, phone:'0474-2572302', email:'ramesh.kumar@gmcklm.gov.in', lastUpdated:new Date() },
    // Travancore Medical (10)
    { doctorId:22, name:'Dr. Dileep Krishnaswamy', specialization:'Neurologist', hospital:'Travancore Medical College', hospitalId:10, available:true, distance:'', image:'https://i.pravatar.cc/300?img=67', gender:'Male', experience:'14 years', rating:4.4, phone:'0474-2527201', email:'dileep.k@travancoremedical.ac.in', lastUpdated:new Date() },
    // Pilgrim (11)
    { doctorId:23, name:'Dr. Sheeja Philip', specialization:'Gynecologist', hospital:'Pilgrim Hospital', hospitalId:11, available:true, distance:'', image:'https://i.pravatar.cc/300?img=48', gender:'Female', experience:'17 years', rating:4.5, phone:'0474-2742201', email:'sheeja.philip@pilgrimhospital.in', lastUpdated:new Date() },
    // Aster MIMS Kollam (12)
    { doctorId:24, name:'Dr. Ambika Pillai', specialization:'Oncologist', hospital:'Aster MIMS Kollam', hospitalId:12, available:true, distance:'', image:'https://i.pravatar.cc/300?img=39', gender:'Female', experience:'16 years', rating:4.8, phone:'0474-2799901', email:'ambika.pillai@asterhospitals.in', lastUpdated:new Date() },
    { doctorId:25, name:'Dr. Unnikrishnan Nair', specialization:'Gastroenterologist', hospital:'Aster MIMS Kollam', hospitalId:12, available:false, distance:'', image:'https://i.pravatar.cc/300?img=63', gender:'Male', experience:'19 years', rating:4.7, phone:'0474-2799902', email:'unnikrishnan.nair@asterhospitals.in', lastUpdated:new Date() }
];

const clinics = [
    { clinicId:101, name:'Nair Family Clinic', doctorName:'Dr. Vijayan Nair', specialization:'Family Medicine', address:'TC 12/445, Kowdiar, Thiruvananthapuram, Kerala 695003', location:'Kowdiar, Thiruvananthapuram', phone:'0471-2314567', email:'vijayan.nair@nairfamilyclinic.com', image:'https://i.pravatar.cc/300?img=17', gender:'Male', experience:'20 years', rating:4.7, available:true, distance:'', consultationFee:'₹300', timings:'9 AM - 1 PM, 5 PM - 8 PM', coordinates:{ lat:8.5374, lng:76.9506 }, password:'clinic101', maxBookingsPerSlot:3 },
    { clinicId:102, name:'Sreekumar Skin & Hair Clinic', doctorName:'Dr. Sreekumar P', specialization:'Dermatologist', address:'MG Road, Palayam, Thiruvananthapuram, Kerala 695034', location:'Palayam, Thiruvananthapuram', phone:'0471-2335678', email:'sreekumar@skinclinic.in', image:'https://i.pravatar.cc/300?img=25', gender:'Male', experience:'15 years', rating:4.6, available:true, distance:'', consultationFee:'₹400', timings:'10 AM - 6 PM', coordinates:{ lat:8.5132, lng:76.9576 }, password:'clinic102', maxBookingsPerSlot:3 },
    { clinicId:103, name:'Meenakshi Childrens Clinic', doctorName:'Dr. Meenakshi Devi', specialization:'Pediatrician', address:'Near Pettah Junction, Thiruvananthapuram, Kerala 695024', location:'Pettah, Thiruvananthapuram', phone:'0471-2376543', email:'meenakshi@childrenclinic.in', image:'https://i.pravatar.cc/300?img=43', gender:'Female', experience:'17 years', rating:4.9, available:true, distance:'', consultationFee:'₹350', timings:'9 AM - 12 PM, 4 PM - 7 PM', coordinates:{ lat:8.4812, lng:76.9431 }, password:'clinic103', maxBookingsPerSlot:3 },
    { clinicId:104, name:'Kerala Heart Care Clinic', doctorName:'Dr. Anil Varghese', specialization:'Cardiologist', address:'Statue Junction, Thiruvananthapuram, Kerala 695001', location:'Statue Junction, Thiruvananthapuram', phone:'0471-2447890', email:'anil.varghese@heartcareclinic.in', image:'https://i.pravatar.cc/300?img=64', gender:'Male', experience:'22 years', rating:4.8, available:false, distance:'', consultationFee:'₹600', timings:'8 AM - 11 AM', coordinates:{ lat:8.4979, lng:76.9504 }, password:'clinic104', maxBookingsPerSlot:2 },
    { clinicId:105, name:'Sreedharan Bone & Joint Clinic', doctorName:'Dr. Sreedharan K', specialization:'Orthopedic', address:'Vazhuthacaud, Thiruvananthapuram, Kerala 695014', location:'Vazhuthacaud, Thiruvananthapuram', phone:'0471-2338901', email:'sreedharan@boneclinic.in', image:'https://i.pravatar.cc/300?img=71', gender:'Male', experience:'18 years', rating:4.6, available:true, distance:'', consultationFee:'₹500', timings:'9 AM - 1 PM', coordinates:{ lat:8.5023, lng:76.9530 }, password:'clinic105', maxBookingsPerSlot:3 },
    { clinicId:106, name:'Kollam General Practice Clinic', doctorName:'Dr. Sunil Mohan', specialization:'General Physician', address:'Chinnakada, Kollam, Kerala 691001', location:'Chinnakada, Kollam', phone:'0474-2765432', email:'sunil.mohan@kollampractice.in', image:'https://i.pravatar.cc/300?img=18', gender:'Male', experience:'14 years', rating:4.4, available:true, distance:'', consultationFee:'₹250', timings:'8 AM - 6 PM', coordinates:{ lat:8.8872, lng:76.5953 }, password:'clinic106', maxBookingsPerSlot:4 },
    { clinicId:107, name:'Kollam Womens Clinic', doctorName:'Dr. Remya Krishnan', specialization:'Gynecologist', address:'Near Asramam Maidan, Kollam, Kerala 691002', location:'Asramam, Kollam', phone:'0474-2789012', email:'remya.krishnan@kollamwomens.in', image:'https://i.pravatar.cc/300?img=48', gender:'Female', experience:'16 years', rating:4.7, available:true, distance:'', consultationFee:'₹400', timings:'9 AM - 2 PM', coordinates:{ lat:8.8801, lng:76.5903 }, password:'clinic107', maxBookingsPerSlot:3 },
    { clinicId:108, name:'Kollam Neuro & Brain Clinic', doctorName:'Dr. Prakash Menon', specialization:'Neurologist', address:'Polayathode, Kollam, Kerala 691010', location:'Polayathode, Kollam', phone:'0474-2712345', email:'prakash.menon@neuroclinic.in', image:'https://i.pravatar.cc/300?img=60', gender:'Male', experience:'19 years', rating:4.6, available:false, distance:'', consultationFee:'₹550', timings:'10 AM - 1 PM', coordinates:{ lat:8.8791, lng:76.6043 }, password:'clinic108', maxBookingsPerSlot:2 }
];

async function seedDatabase() {
    try {
        console.log('🗑️  Clearing existing data...');
        await Hospital.deleteMany({});
        await Doctor.deleteMany({});
        await Clinic.deleteMany({});
        try {
            const db = mongoose.connection.db;
            for (const [col, idx] of [['timeslots','slotId_1'],['patients','patientId_1']]) {
                try { const f=await db.listCollections({name:col}).toArray(); if(f.length) await db.collection(col).dropIndex(idx); } catch(e) {}
            }
        } catch(e) {}

        await Hospital.insertMany(hospitals);
        console.log(`✅ ${hospitals.length} hospitals — Thiruvananthapuram & Kollam`);
        await Doctor.insertMany(doctors);
        console.log(`✅ ${doctors.length} doctors inserted`);
        await Clinic.insertMany(clinics);
        console.log(`✅ ${clinics.length} clinics inserted`);

        console.log('\n🎉 Kerala database seeded!\n');
        console.log('📍 TVM: KIMS · SCTIMST · Govt Medical · Ananthapuri · Cosmopolitan · SK Hospital · SAT Hospital');
        console.log('📍 KLM: Bishop Benziger · Govt Medical · Travancore Medical · Pilgrim · Aster MIMS\n');
        console.log('Hospitals (1-12)  → hospital123');
        console.log('Clinic 101-105 TVM → clinic101 … clinic105');
        console.log('Clinic 106-108 KLM → clinic106 … clinic108');
        process.exit(0);
    } catch(e) { console.error('❌', e.message); process.exit(1); }
}
seedDatabase();
