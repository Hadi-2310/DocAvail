// ============================================================
// DocAvail — main.js
// All features merged & working:
//  ✅ English-only voice
//  ✅ Emergency INLINE on patient home (GPS + real distance + Google Maps)
//  ✅ Slot edit + delete in hospital dashboard
//  ✅ Delete booking history (patient + hospital + clinic)
//  ✅ All times/dates based on real system time
//  ✅ Availability "last updated" = real timestamp
// ============================================================

// Auto-detects: uses relative URL in production (Railway), localhost when developing
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000/api'
    : '/api';

// ─── STYLED CONFIRM DIALOG ────────────────────────────────
let _confirmResolve = null;
function showConfirmDialog({ title, message, okLabel = 'Confirm', okColor = '#ef4444', icon = '⚠️' }) {
    return new Promise(resolve => {
        _confirmResolve = resolve;
        document.getElementById('confirm-dialog-title').textContent = title;
        document.getElementById('confirm-dialog-msg').textContent = message;
        document.getElementById('confirm-dialog-icon').textContent = icon;
        const okBtn = document.getElementById('confirm-dialog-ok');
        okBtn.textContent = okLabel;
        okBtn.style.background = okColor;
        okBtn.style.color = '#fff';
        document.getElementById('confirm-dialog').style.display = 'flex';
    });
}
function confirmDialogResolve(result) {
    document.getElementById('confirm-dialog').style.display = 'none';
    if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}

// ─── REAL-TIME CLOCK HELPER ───────────────────────────────
function nowISO()  { return new Date().toISOString(); }
function todayStr(){
    const d=new Date();
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
}
function fmtDateTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true });
}
function fmtTime12(time24) {
    if (!time24 || !time24.includes(':')) return time24 || '';
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`;
}
function relativeTime(isoStr) {
    if (!isoStr || isoStr === 'Just now' || isoStr === 'undefined' || isoStr === 'null') return 'Just now';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return 'Just now';
    const diff = Date.now() - d.getTime();
    if (diff < 60000)   return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000)return `${Math.floor(diff/3600000)}h ago`;
    return fmtDateTime(isoStr);
}

// ─── STATE ───────────────────────────────────────────────
const STATE = {
    currentScreen: 'splash',
    currentHospitalId: null,
    currentClinicId: null,
    dashboardToken: null,   // set on hospital/clinic login
    selectedHospitalId: null,
    selectedDoctor: null,
    doctorDetailBackTo: 'doctors-list-screen',
    selectedSpecialization: 'All',
    hospitals: [], doctors: [], clinics: [],
    currentPatient: null,
    editingDoctorId: null,
    deletingDoctorId: null,
    recognition: null,
    isVoiceListening: false,
    currentDashTab: 'doctors',
    typeFilter: 'All', specialtyFilter: 'All',
    distanceFilter: 10, sortFilter: 'distance',
    userLocation: null,
    globalSearchQuery: '', globalEntityType: 'all',
    specialistQuery: '', specialistSpecialty: 'All', specialistEntity: 'all',
};

// ─── TOAST ───────────────────────────────────────────────
function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast ' + type;
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 3000);
}

// ─── API HELPERS ──────────────────────────────────────────
async function apiFetch(path, opts = {}) {
    if (!opts.method || opts.method === 'GET') {
        opts.cache = 'no-store';
    }
    // Attach dashboard token to write requests
    if (opts.method && opts.method !== 'GET' && STATE.dashboardToken) {
        opts.headers = opts.headers || {};
        opts.headers['X-Dashboard-Token'] = STATE.dashboardToken;
    }
    const res = await fetch(API_URL + path, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'API Error');
    }
    return res.json();
}
function dashHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (STATE.dashboardToken) h['X-Dashboard-Token'] = STATE.dashboardToken;
    return h;
}
async function fetchHospitals()               { try { const d = await apiFetch('/hospitals'); STATE.hospitals = d; return d; } catch(e) { return []; } }
async function fetchClinics()                 { try { const d = await apiFetch('/clinics');   STATE.clinics   = d; return d; } catch(e) { return []; } }
async function fetchDoctorsByHospital(id)     { try { return await apiFetch('/doctors/hospital/'+id); } catch(e) { return []; } }
async function fetchDoctorById(id)            { try { return await apiFetch('/doctors/'+id); } catch(e) { return null; } }
async function fetchClinicById(id)            { try { return await apiFetch('/clinics/'+id); } catch(e) { return null; } }
async function fetchHospitalStats(id)         { try { return await apiFetch('/stats/hospital/'+id); } catch(e) { return null; } }
async function fetchSlotsForDoctor(doctorId)  { try { return await apiFetch('/slots/doctor/'+doctorId); } catch(e) { return []; } }
async function fetchSlotsForHospital(hId)     { try { return await apiFetch('/slots/hospital/'+hId); } catch(e) { return []; } }
async function fetchBookingsForHospital(hId)  { try { return await apiFetch('/bookings/hospital/'+hId); } catch(e) { return []; } }
async function searchDoctors(q, spec, hId, avail=false) {
    try {
        const res = await fetch(`${API_URL}/doctors/search`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ query:q, specialization:spec, hospitalId:hId, availableOnly:avail })
        });
        return await res.json();
    } catch(e) { return []; }
}
async function globalSearch(q, spec, entityType, avail) {
    const params = new URLSearchParams({ query:q||'', specialization:spec||'All', entityType:entityType||'all' });
    if (avail) params.append('availableOnly','true');
    try { return await apiFetch('/global-search?'+params); } catch(e) { return []; }
}

// ─── NAVIGATION ───────────────────────────────────────────
function navigateToScreen(screen, data = null) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const map = {
        'welcome':'welcome-screen','patient-login':'patient-login',
        'hospital-login':'hospital-login','clinic-login':'clinic-login',
        'hospital-list-screen':'hospital-list-screen','doctors-list-screen':'doctors-list-screen',
        'voice-assistant':'voice-assistant','hospital-dashboard':'hospital-dashboard',
        'clinic-dashboard':'clinic-dashboard','doctor-detail':'doctor-detail'
    };
    const el = document.getElementById(map[screen] || screen);
    if (!el) return;
    el.classList.add('active');
    STATE.currentScreen = screen;
    if (screen === 'hospital-list-screen') { updatePatientGreeting(); renderHospitalsList(); renderClinicsList(); }
    else if (screen === 'doctors-list-screen') { if (data) STATE.selectedHospitalId = data; renderDoctorsList(); }
    else if (screen === 'hospital-dashboard') { STATE.currentHospitalId = data; STATE.currentDashTab = 'doctors'; renderHospitalDashboard(); }
    else if (screen === 'clinic-dashboard') { STATE.currentClinicId = data; renderClinicDashboard(); }
    else if (screen === 'doctor-detail' && data) { STATE.selectedDoctor = data; renderDoctorDetail(); }
    else if (screen === 'voice-assistant') { resetVoiceAssistant(); }
}

// ─── AUTH ─────────────────────────────────────────────────
function updatePatientGreeting() {
    const badge = document.getElementById('patient-greeting-badge');
    const wt    = document.getElementById('patient-welcome-text');
    if (STATE.currentPatient) {
        if (badge) { badge.style.display=''; document.getElementById('greeting-name').textContent = STATE.currentPatient.name; }
        if (wt) wt.textContent = `Welcome back, ${STATE.currentPatient.name}`;
    } else {
        if (badge) badge.style.display='none';
        if (wt) wt.textContent = 'Find available doctors';
    }
}
function switchAuthTab(tab) {
    document.getElementById('tab-login').classList.toggle('active', tab==='login');
    document.getElementById('tab-register').classList.toggle('active', tab==='register');
    document.getElementById('patient-login-form').style.display    = tab==='login'    ? 'block':'none';
    document.getElementById('patient-register-form').style.display = tab==='register' ? 'block':'none';
}
async function handlePatientLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    try {
        const res  = await fetch(`${API_URL}/patients/login`, {
            method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password})
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error||'Login failed'; errEl.style.display='block'; return; }
        STATE.currentPatient = data.patient;
        navigateToScreen('hospital-list-screen');
    } catch(e) {
        STATE.currentPatient = { id:1, name:email.split('@')[0], email, phone:'' };
        navigateToScreen('hospital-list-screen');
    }
}
async function handlePatientRegister(event) {
    event.preventDefault();
    const name=document.getElementById('reg-name').value, email=document.getElementById('reg-email').value,
          phone=document.getElementById('reg-phone').value, age=parseInt(document.getElementById('reg-age').value),
          password=document.getElementById('reg-password').value;
    const errEl=document.getElementById('register-error'), okEl=document.getElementById('register-success');
    errEl.style.display='none'; okEl.style.display='none';
    try {
        const res = await fetch(`${API_URL}/patients/register`, {
            method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name,email,phone,age,password})
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent=data.error||'Registration failed'; errEl.style.display='block'; return; }
        okEl.textContent='✅ Account created! Please login.'; okEl.style.display='block';
        setTimeout(()=>switchAuthTab('login'), 1500);
    } catch(e) { errEl.textContent='Connection error. Is the server running?'; errEl.style.display='block'; }
}
async function handleHospitalLogin(event) {
    event.preventDefault();
    const id  = parseInt(document.getElementById('hospital-id-input').value);
    const pwd = document.getElementById('hosp-pass-input').value;
    const err = document.getElementById('hosp-login-error');
    err.style.display='none';
    try {
        const res  = await fetch(`${API_URL}/hospitals/login`, {
            method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({hospitalId:id, password:pwd})
        });
        const data = await res.json();
        if (data.success) {
            STATE.dashboardToken = data.token || null;
            navigateToScreen('hospital-dashboard', id);
        } else {
            err.textContent = data.error || '❌ Invalid Hospital ID or Password';
            err.style.display = 'block';
        }
    } catch(e) {
        err.textContent = '❌ Cannot connect to server. Is it running?';
        err.style.display = 'block';
    }
}
async function handleClinicLogin(e) {
    e.preventDefault();
    const id  = parseInt(document.getElementById('clinic-id-input').value);
    const pwd = document.getElementById('clinic-password-input').value;
    const err = document.getElementById('clinic-login-error');
    if (err) err.style.display = 'none';
    try {
        const res  = await fetch(`${API_URL}/clinics/login`, {
            method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({clinicId:id, password:pwd})
        });
        const data = await res.json();
        if (data.success) {
            STATE.dashboardToken = data.token || null;
            navigateToScreen('clinic-dashboard', id);
        } else {
            const msg = data.error || '❌ Invalid Clinic ID or Password';
            if (err) { err.textContent = msg; err.style.display = 'block'; }
            else showToast(msg, 'error');
        }
    } catch(e) {
        const msg = '❌ Cannot connect to server. Is it running?';
        if (err) { err.textContent = msg; err.style.display = 'block'; }
        else showToast(msg, 'error');
    }
}
function logoutPatient() { STATE.currentPatient = null; navigateToScreen('welcome'); }

// ─── FILTER PANEL ─────────────────────────────────────────
function toggleFilterPanel(tab) {
    const p = document.getElementById('filter-panel');
    const isHidden = p.style.display === 'none';
    p.style.display = isHidden ? 'block' : 'none';
    if (isHidden && tab) switchFilterTab(tab);
}
function switchFilterTab(tab) {
    ['filter','doctors'].forEach(t => {
        document.getElementById('ftab-'+t).classList.toggle('active', t===tab);
        document.getElementById('ftab-'+t+'-content').style.display = t===tab ? 'block' : 'none';
    });
    if (tab === 'doctors') {
        const inp = document.getElementById('specialist-input');
        if (inp) { inp.focus(); if (!inp.value) searchSpecialists(); }
    }
}
function setSpecialtyFilter(btn) {
    document.querySelectorAll('#specialty-chips .filter-chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); STATE.specialtyFilter = btn.dataset.val;
}
function setSortFilter(btn) {
    document.querySelectorAll('#sort-chips .filter-sort-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); STATE.sortFilter = btn.dataset.val;
}
// ─── GPS LOCATION ─────────────────────────────────────────
function getUserLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
            pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            ()  => resolve(null),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
        );
    });
}
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function applyFilters() {
    toggleFilterPanel();
    // Get GPS if sorting by distance
    if (STATE.sortFilter === 'distance') {
        const locEl = document.getElementById('distance-loc-status');
        if (locEl) locEl.textContent = '📡 Getting your location...';
        STATE.userLocation = await getUserLocation();
        if (locEl) locEl.textContent = STATE.userLocation
            ? `📍 Location found (${STATE.userLocation.lat.toFixed(4)}, ${STATE.userLocation.lng.toFixed(4)})`
            : '⚠️ Location unavailable — sorting by doctor count instead';
    }
    renderHospitalsList();
    renderClinicsList();
    showToast('✅ Filters applied');
}

// ─── HOSPITALS LIST ───────────────────────────────────────
async function renderHospitalsList() {
    const c = document.getElementById('hospitals-list');
    c.innerHTML = '<div class="loading-pulse">Loading hospitals</div>';
    const hospitals = await fetchHospitals();
    if (!hospitals.length) { c.innerHTML='<div class="loading-pulse">No hospitals found. Make sure backend is running.</div>'; return; }
    let sorted = [...hospitals];

    if (STATE.sortFilter === 'distance' && STATE.userLocation) {
        // Real GPS distance sort
        sorted = sorted.map(h => {
            const coords = h.coordinates || {};
            const distKm = (coords.lat && coords.lng)
                ? haversineKm(STATE.userLocation.lat, STATE.userLocation.lng, coords.lat, coords.lng)
                : 9999;
            return { ...h, distKm, distLabel: distKm < 9999
                ? (distKm < 1 ? `${Math.round(distKm*1000)} m away` : `${distKm.toFixed(1)} km away`)
                : null };
        });
        sorted.sort((a,b) => a.distKm - b.distKm);
    } else if (STATE.sortFilter === 'rating') {
        sorted.sort((a,b) => (b.rating||0) - (a.rating||0));
    } else if (STATE.sortFilter === 'doctorCount') {
        sorted.sort((a,b) => b.totalDoctors - a.totalDoctors);
    } else {
        sorted.sort((a,b) => (b.availableCount||0) - (a.availableCount||0));
    }

    c.innerHTML = sorted.map(h=>`
      <div class="hospital-card" onclick="navigateToScreen('doctors-list-screen',${h.id})">
        <div class="hospital-icon">🏥</div>
        <div class="hospital-info">
          <h3>${h.name}</h3>
          <div class="entity-meta">
            <div class="entity-meta-item">📍 ${h.location}</div>
            <div class="entity-meta-item">👥 ${h.totalDoctors||0} Doctors</div>
            ${h.rating?`<div class="entity-meta-item">⭐ ${h.rating}</div>`:''}
            ${h.distLabel?`<div class="entity-meta-item">📏 ${h.distLabel}</div>`:''}
          </div>
          <div class="avail-bar"><div class="avail-fill" style="width:${h.availabilityPercent||0}%"></div></div>
          <div class="avail-text"><strong>${h.availableCount||0}</strong> of ${h.totalDoctors||0} available now</div>
        </div>
        <div class="entity-arrow"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg></div>
      </div>
    `).join('');
}

// ─── CLINICS LIST ─────────────────────────────────────────
async function renderClinicsList() {
    const c = document.getElementById('clinics-list');
    c.innerHTML = '<div class="loading-pulse">Loading clinics</div>';
    const clinics = await fetchClinics();
    if (!clinics.length) { c.innerHTML='<div class="loading-pulse">No clinics found.</div>'; return; }
    c.innerHTML = clinics.map(cl=>`
      <div class="clinic-card" onclick="viewClinicDetail(${cl.clinicId})">
        <div class="clinic-icon">🏠</div>
        <div class="clinic-info">
          <h3>${cl.name}</h3>
          <div class="entity-meta">
            <div class="entity-meta-item">👨‍⚕️ ${cl.doctorName}</div>
            <div class="entity-meta-item">🩺 ${cl.specialization}</div>
            <div class="entity-meta-item">📍 ${cl.location}</div>
          </div>
          <span class="avail-badge ${cl.available?'green':'red'}">${cl.available?'Available':'Unavailable'}</span>
          <div class="clinic-fee-badge">💰 ${cl.consultationFee}</div>
          <div class="clinic-timings">⏰ ${cl.timings}</div>
        </div>
        <div class="entity-arrow"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg></div>
      </div>
    `).join('');
}
async function viewClinicDetail(clinicId) {
    const clinic = await fetchClinicById(clinicId);
    if (!clinic) return;
    STATE.selectedDoctor = {
        isClinic:true, doctorId:clinic.clinicId, name:clinic.doctorName, specialization:clinic.specialization,
        hospital:clinic.name, distance:clinic.address, available:clinic.available,
        image:clinic.image||'https://i.pravatar.cc/300?img=50', gender:clinic.gender,
        experience:clinic.experience, rating:clinic.rating, phone:clinic.phone, email:clinic.email,
        consultationFee:clinic.consultationFee, timings:clinic.timings
    };
    STATE.doctorDetailBackTo = 'hospital-list-screen';
    document.getElementById('doctor-detail-back-btn').onclick = ()=>navigateToScreen('hospital-list-screen');
    navigateToScreen('doctor-detail', STATE.selectedDoctor);
}

// ─── TAB SWITCHING (Patient home) ─────────────────────────
function switchTab(tab) {
    ['hospitals','clinics','mybookings'].forEach(t=>{
        document.getElementById('tab-'+t).classList.toggle('active', t===tab);
    });
    document.getElementById('hospitals-list').style.display   = tab==='hospitals'   ? '' : 'none';
    document.getElementById('clinics-list').style.display     = tab==='clinics'     ? 'flex':'none';
    document.getElementById('my-bookings-list').style.display = tab==='mybookings'  ? 'flex':'none';
    if (tab==='clinics' && STATE.clinics.length===0) renderClinicsList();
    if (tab==='mybookings') renderPatientBookings();
}

// ─── GLOBAL SEARCH ────────────────────────────────────────
let _globalTimer;
function handleGlobalSearch() {
    const q = document.getElementById('global-search-input').value.trim();
    STATE.globalSearchQuery = q;
    clearTimeout(_globalTimer);
    if (!q) { document.getElementById('global-search-results').style.display='none'; return; }
    _globalTimer = setTimeout(async ()=>{
        const results = await globalSearch(q,'All',STATE.globalEntityType,false);
        renderGlobalResults(results);
    },300);
}
function setEntityFilter(btn,type) {
    document.querySelectorAll('#global-search-results .entity-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); STATE.globalEntityType=type; handleGlobalSearch();
}
function renderGlobalResults(results) {
    const panel=document.getElementById('global-search-results'), list=document.getElementById('global-results-list');
    document.getElementById('global-results-count').textContent=`${results.length} result${results.length!==1?'s':''} found`;
    list.innerHTML = !results.length
        ? '<div style="padding:16px;text-align:center;color:var(--gray-400);font-size:.85rem">No results found</div>'
        : results.slice(0,8).map(r=>`
            <div class="spec-result-card" style="border-radius:0;box-shadow:none;border-bottom:1px solid var(--gray-100)" onclick="openSpecialistDetail(${r.id},'${r.entityType}')">
              <img src="${r.image||'https://i.pravatar.cc/150?img=30'}" alt="${r.name}" onerror="this.src='https://i.pravatar.cc/150?img=30'">
              <div class="spec-result-info">
                <h4>${r.name}</h4>
                <div class="spec-result-spec">${r.specialization}</div>
                <div class="spec-result-entity">${r.entityType==='clinic'?'🏠':'🏥'} ${r.entityName}</div>
              </div>
              <span class="avail-badge ${r.available?'green':'red'}">${r.available?'Available':'Busy'}</span>
            </div>`).join('');
    panel.style.display='block';
}
function openSpecialistDetail(id,type) {
    if (type==='clinic') viewClinicDetail(id); else showDoctorDetail(id);
    document.getElementById('global-search-results').style.display='none';
}

// ─── SPECIALIST SEARCH ────────────────────────────────────
let _specTimer;
function searchSpecialists() { clearTimeout(_specTimer); _specTimer=setTimeout(_doSpecSearch,300); }
async function _doSpecSearch() {
    const q    = document.getElementById('specialist-input').value.trim();
    const avail= document.getElementById('spec-available-only').checked;
    const results = await globalSearch(q,STATE.specialistSpecialty,STATE.specialistEntity,avail);
    document.getElementById('specialist-results-count').textContent=`${results.length} result${results.length!==1?'s':''} found`;
    const c=document.getElementById('specialist-results');
    if (!results.length) { c.innerHTML='<div class="empty-state"><div style="font-size:2.5rem">😔</div><p>No specialists found.</p></div>'; return; }
    c.innerHTML=results.map(r=>`
      <div class="spec-result-card" onclick="openSpecialistDetail(${r.id},'${r.entityType}')">
        <img src="${r.image||'https://i.pravatar.cc/150?img=25'}" alt="${r.name}" onerror="this.src='https://i.pravatar.cc/150?img=25'">
        <div class="spec-result-info">
          <h4>${r.name}</h4>
          <div class="spec-result-spec">${r.specialization}</div>
          <div class="spec-result-entity">${r.entityType==='clinic'?'🏠 Clinic: ':'🏥 Hospital: '}${r.entityName}</div>
          ${r.consultationFee?`<div style="font-size:.75rem;color:var(--green-600);font-weight:600;margin-top:3px">💰 ${r.consultationFee}</div>`:''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <span class="avail-badge ${r.available?'green':'red'}">${r.available?'Available':'Busy'}</span>
          <div class="spec-rating" style="margin-top:4px">⭐ ${r.rating||'N/A'}</div>
          ${r.experience?`<div style="font-size:.72rem;color:var(--gray-400);margin-top:2px">${r.experience}</div>`:''}
        </div>
      </div>`).join('');
}
function setSpecialistSpecialty(btn) {
    document.querySelectorAll('#spec-specialty-chips .spec-chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); STATE.specialistSpecialty=btn.dataset.val; searchSpecialists();
}
function setSpecialistEntity(btn,type) {
    document.querySelectorAll('.spec-entity-row .entity-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); STATE.specialistEntity=type; searchSpecialists();
}

// ─── DOCTORS LIST ─────────────────────────────────────────
async function renderDoctorsList() {
    const c = document.getElementById('doctors-list');
    c.innerHTML='<div class="loading-pulse" style="grid-column:1/-1">Loading doctors</div>';
    const q = document.getElementById('search-input')?.value||'';
    const doctors = await searchDoctors(q,STATE.selectedSpecialization,STATE.selectedHospitalId);
    STATE.doctors = doctors;
    const hosp = STATE.hospitals.find(h=>h.id===STATE.selectedHospitalId);
    if (hosp) {
        document.getElementById('selected-hospital-name').textContent = hosp.name;
        document.getElementById('selected-hospital-info').textContent = `${doctors.filter(d=>d.available).length} of ${doctors.length} available`;
    }
    if (!doctors.length) { c.innerHTML='<div class="loading-pulse" style="grid-column:1/-1">No doctors match your search</div>'; return; }
    // Fetch today's slots for all doctors at once to show slot counts on cards
    const today = todayStr();
    const now = new Date();
    let slotMap = {};
    try {
        const hId = STATE.selectedHospitalId;
        const slots = await apiFetch('/slots/hospital/' + hId);
        slots
            .filter(s => {
                if (s.date !== today || !s.isActive) return false;
                // ── KEY FIX: exclude slots where time has already passed ──
                const [y, mo, day] = s.date.split('-').map(Number);
                const [h, min] = s.time.split(':').map(Number);
                const slotTime = new Date(y, mo - 1, day, h, min, 0);
                return slotTime > now;
            })
            .forEach(s => {
                if (!slotMap[s.doctorId]) slotMap[s.doctorId] = { total: 0, filled: 0 };
                slotMap[s.doctorId].total += s.maxBookings;
                slotMap[s.doctorId].filled += s.currentBookings;
            });
    } catch(e) {}

    c.innerHTML=doctors.map(d=>{
        const slotInfo = slotMap[d.doctorId];
        let slotBadge = '';
        if (slotInfo) {
            const rem = slotInfo.total - slotInfo.filled;
            slotBadge = rem > 0
                ? `<div class="slot-count-badge available">🗓 ${rem} slot${rem!==1?'s':''} today</div>`
                : `<div class="slot-count-badge full">🚫 Fully booked today</div>`;
        }
        return `
      <div class="doctor-card ${!d.available?'unavailable':''}" onclick="showDoctorDetail(${d.doctorId})">
        <img src="${d.image}" class="doctor-image" alt="${d.name}" onerror="this.src='https://i.pravatar.cc/150?img=${d.doctorId}'">
        <div class="doctor-info">
          <h3>${d.name}</h3>
          <span class="specialization-tag">${d.specialization}</span>
          <div class="doctor-meta">
            <div class="meta-row">⭐ ${d.rating} • ${d.experience}</div>
            <div class="meta-row" style="font-size:.7rem">${d.hospital}</div>
          </div>
          <span class="avail-badge ${d.available?'green':'red'}">${d.available?'Available':'Busy'}</span>
          ${slotBadge}
        </div>
      </div>`;}).join('');
}
function filterDoctors() {
    clearTimeout(STATE._fTimer);
    STATE._fTimer=setTimeout(renderDoctorsList,300);
}
function setSpecializationFilter(spec,btn) {
    STATE.selectedSpecialization=spec;
    document.querySelectorAll('#specialty-filter-bar .filter-chip').forEach(b=>b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderDoctorsList();
}
async function showDoctorDetail(doctorId) {
    const doctor = await fetchDoctorById(doctorId);
    if (doctor) {
        STATE.doctorDetailBackTo='doctors-list-screen';
        document.getElementById('doctor-detail-back-btn').onclick=()=>navigateToScreen('doctors-list-screen');
        navigateToScreen('doctor-detail', doctor);
    }
}
function renderDoctorDetail() {
    const d = STATE.selectedDoctor;
    if (!d) return;
    const isClinic = d.isClinic;
    document.getElementById('doctor-detail-content').innerHTML = `
      <div class="detail-card">
        <div class="detail-doctor-top">
          <img src="${d.image}" class="detail-doc-img" alt="${d.name}" onerror="this.src='https://i.pravatar.cc/150?img=20'">
          <div>
            <h2 class="detail-doc-name">${d.name}</h2>
            <span class="specialization-tag">${d.specialization}</span><br>
            <span class="avail-badge ${d.available?'green':'red'}" style="margin-top:8px;display:inline-flex">${d.available?'● Available Now':'● Not Available'}</span>
          </div>
        </div>
        <div class="detail-section">
          <h3>${isClinic?'Clinic Information':'Hospital Information'}</h3>
          <div class="detail-grid">
            <div class="detail-info-item">📍<div><div class="detail-info-label">${isClinic?'Clinic':'Hospital'}</div><div class="detail-info-val">${d.hospital}</div></div></div>
            <div class="detail-info-item">⭐<div><div class="detail-info-label">Rating</div><div class="detail-info-val">${d.rating}</div></div></div>
            <div class="detail-info-item">📅<div><div class="detail-info-label">Experience</div><div class="detail-info-val">${d.experience||'N/A'}</div></div></div>
            <div class="detail-info-item">👤<div><div class="detail-info-label">Gender</div><div class="detail-info-val">${d.gender||'N/A'}</div></div></div>
            ${isClinic&&d.consultationFee?`
            <div class="detail-info-item">💰<div><div class="detail-info-label">Fee</div><div class="detail-info-val">${d.consultationFee}</div></div></div>
            <div class="detail-info-item">⏰<div><div class="detail-info-label">Timings</div><div class="detail-info-val">${d.timings}</div></div></div>`:''}
          </div>
        </div>
        <div class="detail-section">
          <h3>Contact</h3>
          <div class="detail-grid">
            <div class="detail-info-item">📞<div><div class="detail-info-label">Phone</div><div class="detail-info-val">${d.phone||'N/A'}</div></div></div>
            <div class="detail-info-item">✉️<div><div class="detail-info-label">Email</div><div class="detail-info-val" style="word-break:break-all">${d.email||'N/A'}</div></div></div>
          </div>
        </div>
        ${d.available
          ? `<button class="btn-book" onclick="openBookingModal(STATE.selectedDoctor)">📅 Book Appointment</button>`
          : `<div class="unavailable-notice">Doctor is currently not available. Please check back later.</div>`}
      </div>`;
}

// ─── INLINE GPS EMERGENCY ─────────────────────────────────
async function handleGeoEmergency() {
    const panel   = document.getElementById('emergency-inline-panel');
    const locBar  = document.getElementById('emp-loc-bar');
    const results = document.getElementById('emp-results');
    const btn     = document.querySelector('.btn-emergency');
    panel.classList.add('visible');
    if (btn) btn.classList.add('active');
    locBar.className='emp-loc-bar locating'; locBar.textContent='📡 Requesting your GPS location...';
    results.innerHTML   = '<div style="text-align:center;padding:14px;opacity:.8;font-size:.85rem;">Searching nearby hospitals...</div>';
    // Scroll panel into view
    panel.scrollIntoView({ behavior:'smooth', block:'nearest' });

    if (!navigator.geolocation) {
        locBar.className='emp-loc-bar error'; locBar.textContent='⚠️ GPS not supported — showing all hospitals';
        await _loadEmergencyData(null, null);
        return;
    }
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const { latitude:lat, longitude:lng, accuracy } = pos.coords;
            locBar.className='emp-loc-bar'; locBar.innerHTML = `✅ Location detected — ${lat.toFixed(4)}°, ${lng.toFixed(4)}° &nbsp;(±${Math.round(accuracy)}m) &nbsp;<button onclick="openMaps(${lat},${lng},'My Location')" style="background:#dcfce7;border:1.5px solid #86efac;color:#166534;padding:3px 10px;border-radius:6px;cursor:pointer;font-size:.74rem;font-weight:700;">🗺️ View on Map</button>`;
            await _loadEmergencyData(lat, lng);
        },
        (err) => {
            let msg = '⚠️ ';
            if (err.code===1) msg += 'Location denied — showing all hospitals';
            else if (err.code===2) msg += 'Location unavailable — showing all hospitals';
            else msg += 'Location timeout — showing all hospitals';
            locBar.className='emp-loc-bar error'; locBar.textContent = msg;
            _loadEmergencyData(null, null);
        },
        { enableHighAccuracy:true, timeout:10000, maximumAge:0 }
    );
}
async function _loadEmergencyData(lat, lng) {
    const results = document.getElementById('emp-results');
    try {
        let url = `${API_URL}/emergency/nearby`;
        if (lat!==null && lng!==null) url += `?lat=${lat}&lng=${lng}`;
        const data = await (await fetch(url)).json();
        _renderEmergencyResults(data, lat, lng);
    } catch(e) {
        results.innerHTML = '<div style="text-align:center;padding:14px;opacity:.8;font-size:.85rem;">⚠️ Could not load data. Check backend connection.</div>';
    }
}
function _renderEmergencyResults(data, userLat, userLng) {
    const c = document.getElementById('emp-results');
    let html = '';

    if (data.hospitals && data.hospitals.length) {
        html += '<div class="emp-section-title">Nearest Hospitals</div>';
        html += '<div class="emp-results-grid">';
        html += data.hospitals.map(h => {
            const hasCoords = h.coordinates && h.coordinates.lat && h.coordinates.lng;
            const mapsUrl   = hasCoords
                ? `https://www.google.com/maps/dir/?api=1&destination=${h.coordinates.lat},${h.coordinates.lng}`
                : `https://www.google.com/maps/search/${encodeURIComponent(h.name)}`;
            const dist = h.distanceLabel && h.distanceLabel !== 'Distance unknown' ? h.distanceLabel : null;
            return `<div class="emp-card">
              <div class="emp-card-icon-row">
                <span class="emp-card-type-badge">🏥 Hospital</span>
                ${dist ? `<span class="emp-card-dist">📍 ${dist}</span>` : ''}
              </div>
              <div class="emp-card-name">${h.name}</div>
              <div class="emp-card-detail">${h.location || h.address || 'Nearby'}</div>
              <div class="emp-btn-row">
                ${h.phone ? `<button class="emp-call-btn" onclick="window.location.href='tel:${h.phone}'">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.47 2 2 0 0 1 3.56 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.82-.82a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                  Call
                </button>` : ''}
                <button class="emp-map-btn" onclick="window.open('${mapsUrl}','_blank')">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
                  Directions
                </button>
              </div>
            </div>`;
        }).join('');
        html += '</div>';
    }

    if (data.doctors && data.doctors.length) {
        html += '<div class="emp-section-title">Available Doctors</div>';
        html += '<div class="emp-results-grid">';
        html += data.doctors.map(d => `
          <div class="emp-card">
            <div class="emp-card-icon-row">
              <span class="emp-card-type-badge doc">🩺 Doctor</span>
            </div>
            <div class="emp-card-name">${d.name}</div>
            <div class="emp-card-detail">${d.specialization} &nbsp;·&nbsp; ${d.hospital}</div>
            <div class="emp-btn-row">
              ${d.phone ? `<button class="emp-call-btn" onclick="window.location.href='tel:${d.phone}'">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.47 2 2 0 0 1 3.56 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.82-.82a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                Call
              </button>` : ''}
            </div>
          </div>`).join('');
        html += '</div>';
    }

    html += `<div class="emp-section-title">Emergency Hotlines</div>
      <div class="emp-hotlines">
        <button onclick="window.location.href='tel:112'">📞 112 — Emergency</button>
        <button onclick="window.location.href='tel:108'">🚑 108 — Ambulance</button>
      </div>`;

    if (userLat && userLng) {
        html += `<div class="emp-my-loc">📍 Your location: ${userLat.toFixed(5)}, ${userLng.toFixed(5)}</div>`;
    }

    c.innerHTML = html || '<div style="text-align:center;padding:20px;color:#9ca3af;">No emergency data found. Call 112 immediately.</div>';
}
function closeEmergencyPanel() {
    document.getElementById('emergency-inline-panel').classList.remove('visible');
    const btn = document.querySelector('.btn-emergency');
    if (btn) btn.classList.remove('active');
}
function openMaps(lat, lng, name) {
    window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
}

// ─── VOICE ASSISTANT (English only) ──────────────────────
function killSpeech() { if (window.speechSynthesis) window.speechSynthesis.cancel(); }
function resetVoiceAssistant() {
    killSpeech();
    if (STATE.recognition) { try{STATE.recognition.abort();}catch(e){} STATE.recognition=null; }
    STATE.isVoiceListening=false;
    document.getElementById('mic-button')?.classList.remove('active');
    document.getElementById('mic-wave-ring')?.classList.remove('active');
    const s=document.getElementById('voice-status'); if(s) s.textContent='Tap to speak (English)';
    document.getElementById('voice-transcript-box') && (document.getElementById('voice-transcript-box').style.display='none');
    document.getElementById('voice-response-box')   && (document.getElementById('voice-response-box').style.display='none');
    document.getElementById('voice-results')        && (document.getElementById('voice-results').style.display='none');
}
function toggleVoiceListening() {
    killSpeech();
    if (STATE.isVoiceListening) stopVoiceListening(); else startVoiceListening();
}
function startVoiceListening() {
    killSpeech();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { document.getElementById('voice-status').textContent='❌ Voice not supported. Use Chrome or Edge.'; return; }
    if (STATE.recognition) { try{STATE.recognition.abort();}catch(e){} STATE.recognition=null; }
    const r = new SR();
    r.continuous=true; r.interimResults=true; r.maxAlternatives=3;
    r.lang='en-US'; // English only
    STATE.recognition=r; STATE._finalTranscript='';
    r.onstart=()=>{
        STATE.isVoiceListening=true;
        document.getElementById('mic-button').classList.add('active');
        document.getElementById('mic-wave-ring').classList.add('active');
        document.getElementById('voice-status').textContent='🎤 Listening... speak clearly';
        document.getElementById('voice-transcript-box').style.display='block';
        document.getElementById('voice-transcript').textContent='...';
        document.getElementById('voice-response-box').style.display='none';
        document.getElementById('voice-results').style.display='none';
    };
    r.onresult=(ev)=>{
        let interim='', final='';
        for(let i=ev.resultIndex;i<ev.results.length;i++){
            const txt=ev.results[i][0].transcript;
            ev.results[i].isFinal ? (final+=txt+' ') : (interim+=txt);
        }
        STATE._finalTranscript+=final;
        document.getElementById('voice-transcript').textContent=(STATE._finalTranscript+interim).trim()||'...';
        if (final.trim().length>0) {
            clearTimeout(STATE._vTimer);
            STATE._vTimer=setTimeout(()=>{
                const q=STATE._finalTranscript.trim();
                if(q.length>2){stopVoiceListening();processVoiceQuery(q);}
            },1200);
        }
    };
    r.onerror=(ev)=>{
        if(ev.error==='not-allowed'||ev.error==='permission-denied')
            document.getElementById('voice-status').textContent='❌ Microphone access denied. Allow microphone in browser.';
        else if(ev.error==='no-speech')
            document.getElementById('voice-status').textContent='❌ No speech detected. Try again.';
        else if(ev.error!=='aborted')
            document.getElementById('voice-status').textContent='❌ Error: '+ev.error+'. Try again.';
        stopVoiceListening();
    };
    r.onend=()=>{ if(STATE.isVoiceListening){try{STATE.recognition.start();}catch(e){stopVoiceListening();}} };
    STATE._finalTranscript='';
    try{r.start();}catch(e){document.getElementById('voice-status').textContent='❌ Could not start microphone. Try refreshing.';}
}
function stopVoiceListening() {
    killSpeech(); STATE.isVoiceListening=false; clearTimeout(STATE._vTimer);
    document.getElementById('mic-button')?.classList.remove('active');
    document.getElementById('mic-wave-ring')?.classList.remove('active');
    const s=document.getElementById('voice-status'); if(s) s.textContent='Tap to speak (English)';
    if(STATE.recognition){try{STATE.recognition.abort();}catch(e){}STATE.recognition=null;}
}
async function processVoiceQuery(transcript) {
    killSpeech();
    document.getElementById('voice-status').textContent = '🔍 Searching...';
    document.getElementById('voice-transcript').textContent = transcript;
    const lower = transcript.toLowerCase().trim();

    // ── Emergency shortcut ────────────────────────────────────
    if (/\b(emergency|urgent|ambulance|help me)\b/.test(lower)) {
        document.getElementById('voice-response-box').style.display = 'block';
        document.getElementById('voice-response').innerHTML = '<strong>🚨 Opening Emergency GPS mode...</strong>';
        setTimeout(() => { navigateToScreen('hospital-list-screen'); setTimeout(handleGeoEmergency, 300); }, 800);
        return;
    }

    // ── Step 1: Try to match a hospital OR clinic name from DB ──
    // Fetches live data so any newly added hospital/clinic is automatically found
    let hospitalMatch = null, clinicMatch = null;
    try {
        const [hospitals, clinics] = await Promise.all([
            apiFetch('/hospitals'),
            apiFetch('/clinics')
        ]);

        // Helper: extract meaningful words (3+ chars) from a string
        const words = str => str.toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter(w => w.length >= 3);

        // Match hospital — search name, location, type
        for (const h of (hospitals || [])) {
            const searchable = words(h.name + ' ' + (h.location||'') + ' ' + (h.type||''));
            if (searchable.some(w => lower.includes(w))) { hospitalMatch = h; break; }
        }

        // Match clinic — search clinic name, doctor name, location, area, specialization
        // Run even if hospital matched so we can pick the closer match later
        for (const cl of (clinics || [])) {
            const searchable = words(
                cl.name + ' ' +
                (cl.doctorName||'') + ' ' +
                (cl.location||'') + ' ' +
                (cl.specialization||'') + ' ' +
                (cl.address||'')
            );
            if (searchable.some(w => lower.includes(w))) { clinicMatch = cl; break; }
        }

        // If both matched, prefer the one whose name has MORE words in common
        if (hospitalMatch && clinicMatch) {
            const hScore = words(hospitalMatch.name).filter(w => lower.includes(w)).length;
            const cScore = words(clinicMatch.name + ' ' + (clinicMatch.doctorName||'')).filter(w => lower.includes(w)).length;
            if (cScore > hScore) hospitalMatch = null; else clinicMatch = null;
        }
    } catch(e) {}

    // ── Step 2: If hospital matched → go to its doctors ──────
    const respBox = document.getElementById('voice-response-box');
    const respEl  = document.getElementById('voice-response');
    respBox.style.display = 'block';

    if (hospitalMatch) {
        respEl.innerHTML = `🏥 Found <strong>${hospitalMatch.name}</strong> — opening doctors list...`;
        document.getElementById('voice-status').textContent = 'Navigating...';
        setTimeout(() => navigateToScreen('doctors-list-screen', hospitalMatch.hospitalId), 800);
        document.getElementById('voice-results').style.display = 'none';
        return;
    }

    if (clinicMatch) {
        respEl.innerHTML = `🏠 Found <strong>${clinicMatch.name}</strong> — opening details...`;
        document.getElementById('voice-status').textContent = 'Opening...';
        const clinicAsDoctor = {
            isClinic: true,
            doctorId: clinicMatch.clinicId,
            id: clinicMatch.clinicId,
            name: clinicMatch.doctorName,
            specialization: clinicMatch.specialization,
            hospital: clinicMatch.name,
            available: clinicMatch.available,
            image: clinicMatch.image,
            rating: clinicMatch.rating,
            experience: clinicMatch.experience,
            phone: clinicMatch.phone,
            email: clinicMatch.email,
            consultationFee: clinicMatch.consultationFee,
            timings: clinicMatch.timings
        };
        setTimeout(() => navigateToScreen('doctor-detail', clinicAsDoctor), 800);
        document.getElementById('voice-results').style.display = 'none';
        return;
    }

    // ── Step 3: Match a department/specialty ─────────────────
    // Simple map: specialty name → keywords a patient might say
    const specMap = [
        ['Cardiologist',      ['heart','cardiac','cardiology','cardiologist','chest pain','palpitation','blood pressure','hypertension']],
        ['Pediatrician',      ['pediatric','paediatric','child','children','baby','infant','kids','my son','my daughter']],
        ['Dermatologist',     ['skin','dermatology','rash','acne','eczema','hair loss','itching','dermatologist']],
        ['Orthopedic',        ['orthopedic','bone','joint','fracture','knee','back pain','spine','shoulder','ortho']],
        ['Neurologist',       ['neuro','neurology','brain','migraine','headache','seizure','stroke','nerve','dizziness']],
        ['General Physician', ['general','physician','fever','cold','flu','cough','checkup','gp','general medicine']],
        ['Family Medicine',   ['family','family medicine','family doctor','family clinic','all ages']],
        ['Gynecologist',      ['gynecology','gynaecology','women','pregnancy','periods','menstrual','pcos','gynecologist']],
        ['Oncologist',        ['cancer','oncology','tumor','chemotherapy','oncologist']],
        ['Gastroenterologist',['gastro','stomach','digestive','liver','gut','gastroenterologist','endoscopy']],
        ['Neurologist',       ['neurology','vertigo','epilepsy','parkinson','dementia','memory loss']],
        ['General Physician', ['diabetes','thyroid','infection','viral','weakness','fatigue','not feeling well']],
    ];

    let spec = '';
    for (const [s, kws] of specMap) {
        if (kws.some(k => lower.includes(k))) { spec = s; break; }
    }

    const avail = /\b(available|free|open now|seeing patients)\b/.test(lower);
    const results = await globalSearch(spec || transcript, spec || 'All', 'all', avail);

    if (!results.length) {
        respEl.innerHTML = `😔 No results found for <strong>"${transcript}"</strong>.<br>
          <span style="font-size:.82rem;color:#6b7280">Try saying a department name like <em>"cardiology"</em>, or a hospital name like <em>"KIMS"</em>.</span>`;
        document.getElementById('voice-status').textContent = 'Tap to try again';
        return;
    }

    const av = results.filter(r => r.available).length;
    respEl.innerHTML = `✅ Found <strong>${results.length}</strong> doctor${results.length!==1?'s':''}${spec?' — <strong>'+spec+'</strong>':''}. <strong>${av}</strong> available now.`;
    document.getElementById('voice-status').textContent = 'Tap to search again';

    const rc = document.getElementById('voice-results');
    rc.innerHTML = results.slice(0, 6).map(r => `
      <div class="voice-result-item" onclick="openSpecialistDetail(${r.id},'${r.entityType}')">
        <img src="${r.image||'https://i.pravatar.cc/150?img=20'}" alt="${r.name}" onerror="this.src='https://i.pravatar.cc/150?img=20'">
        <h4>${r.name}</h4>
        <p>${r.specialization}</p>
        <p style="font-size:.72rem;opacity:.8">${r.entityType==='clinic'?'🏠':'🏥'} ${r.entityName}</p>
        <span class="avail-badge ${r.available?'green':'red'}" style="margin-top:4px;font-size:.68rem">${r.available?'✅ Available':'🔴 Busy'}</span>
      </div>`).join('');
    rc.style.display = 'grid';
}
function startVoiceWithQuery(query) {
    killSpeech(); STATE._finalTranscript=query;
    document.getElementById('voice-transcript-box').style.display='block';
    document.getElementById('voice-transcript').textContent=query;
    document.getElementById('voice-status').textContent='🔍 Processing...';
    processVoiceQuery(query);
}

// ─── HOSPITAL DASHBOARD ───────────────────────────────────
async function renderHospitalDashboard() {
    const id=STATE.currentHospitalId;
    let hosp=STATE.hospitals.find(h=>h.id===id);
    if(!hosp){const l=await fetchHospitals();hosp=l.find(h=>h.id===id);}
    if(hosp){document.getElementById('hospital-name').textContent=hosp.name;document.getElementById('hospital-location').textContent=hosp.location;}
    const stats=await fetchHospitalStats(id);
    if(stats){document.getElementById('total-doctors').textContent=stats.totalDoctors||0;document.getElementById('available-doctors').textContent=stats.availableDoctors||0;}
    switchDashTab('doctors');
}
function switchDashTab(tab) {
    STATE.currentDashTab=tab;
    document.querySelectorAll('.dash-tab').forEach((t,i)=>{
        t.classList.toggle('active',['doctors','slots','bookings'][i]===tab);
    });
    document.getElementById('dash-doctors-panel').style.display  = tab==='doctors'  ?'block':'none';
    document.getElementById('dash-slots-panel').style.display    = tab==='slots'    ?'block':'none';
    document.getElementById('dash-bookings-panel').style.display = tab==='bookings' ?'block':'none';
    if(tab==='doctors')  renderDashDoctors();
    else if(tab==='slots')    renderDashSlots();
    else if(tab==='bookings') renderDashBookings();
}
async function renderDashDoctors() {
    const docs=await fetchDoctorsByHospital(STATE.currentHospitalId);
    const c=document.getElementById('dashboard-doctors-list');
    if(!docs.length){c.innerHTML='<div class="loading-pulse">No doctors yet. Add one!</div>';return;}
    c.innerHTML=docs.map(d=>`
      <div class="dashboard-doctor-card">
        <img src="${d.image}" class="dashboard-doctor-image" alt="${d.name}" onerror="this.src='https://i.pravatar.cc/150?img=${d.doctorId}'">
        <div class="dashboard-doctor-info">
          <h3>${d.name}</h3>
          <span class="specialization-tag" style="font-size:.72rem">${d.specialization}</span>
          <div class="dashboard-doctor-actions">
            <button class="btn-edit" onclick="showEditDoctorModal(${d.doctorId})">✏️ Edit</button>
            <button class="btn-del"  onclick="showDeleteDoctorModal(${d.doctorId},'${d.name.replace(/'/g,"\\'")}')">🗑 Delete</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0">
          <label class="toggle-switch">
            <input type="checkbox" ${d.available?'checked':''} onchange="toggleDoctorDB(${d.doctorId})">
            <span class="slider"></span>
          </label>
          <span class="last-updated-ts">${relativeTime(d.lastUpdated)}</span>
        </div>
      </div>`).join('');
}
async function toggleDoctorDB(id) {
    try {
        await fetch(`${API_URL}/doctors/${id}/availability`,{method:'PATCH',headers:{'Content-Type':'application/json'}});
        renderDashDoctors(); showToast('✅ Availability updated','success');
    } catch(e){showToast('❌ Error updating','error');}
}

// ─── SLOT MANAGEMENT (with edit) ──────────────────────────
async function renderDashSlots() {
    const hId=STATE.currentHospitalId;
    const docs=await fetchDoctorsByHospital(hId);
    const sel=document.getElementById('slot-doctor-select');
    sel.innerHTML=docs.map(d=>`<option value="${d.doctorId}">${d.name} – ${d.specialization}</option>`).join('');
    const today=todayStr();
    document.getElementById('slot-date-input').min=today;
    document.getElementById('slot-date-input').value=today;
    const slots=await fetchSlotsForHospital(hId);
    STATE.dashSlots=slots;
    const listEl=document.getElementById('slots-list');
    if(!slots.length){listEl.innerHTML='<p style="color:#94a3b8;text-align:center;padding:20px;">No slots created yet.</p>';return;}
    const grouped={};
    slots.forEach(s=>{
        const doc=docs.find(d=>d.doctorId===s.doctorId);
        const key=doc?doc.name:`Doctor ${s.doctorId}`;
        if(!grouped[key]) grouped[key]=[];
        grouped[key].push(s);
    });
    const localBookings=[];  // bookings now stored server-side only
    let html='';
    Object.keys(grouped).forEach(docName=>{
        html+=`<h4 style="font-size:.88rem;color:#0369a1;margin:12px 4px 6px;">👨‍⚕️ ${docName}</h4>`;
        grouped[docName].forEach(slot=>{
            const d=new Date(slot.date+'T00:00:00');
            const dateLabel=d.toLocaleDateString('en-IN',{weekday:'short',month:'short',day:'numeric'});
            const totalBooked=slot.currentBookings;
            html+=`<div class="slot-manage-row">
              <div class="slot-info">
                <div class="slot-date">${dateLabel} — ${fmtTime12(slot.time)}</div>
                <div class="slot-meta">${slot.isActive?'🟢 Active':'🔴 Expired'}</div>
              </div>
              <span class="slot-fill">${totalBooked}/${slot.maxBookings} booked</span>
              <button class="btn-edit-slot" onclick="openEditSlotModal('${slot._id}','${slot.date}','${slot.time}',${slot.maxBookings})">✏️ Edit</button>
              <button class="btn-del-slot"  onclick="deleteSlot('${slot._id}')">🗑</button>
            </div>`;
        });
    });
    listEl.innerHTML=html;
}
async function addNewSlot() {
    const doctorId=parseInt(document.getElementById('slot-doctor-select').value);
    const date=document.getElementById('slot-date-input').value;
    const time=document.getElementById('slot-time-input').value;
    const maxBookings=parseInt(document.getElementById('slot-max-input').value);
    if(!date||!time){showToast('Please select date and time.','error');return;}
    try {
        const res=await fetch(`${API_URL}/slots`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({doctorId,hospitalId:STATE.currentHospitalId,date,time,maxBookings})});
        const data=await res.json();
        if(!res.ok){showToast(data.error||'Failed to add slot','error');return;}
        showToast('✅ Slot added!','success'); await renderDashSlots();
    } catch(e){showToast('Connection error.','error');}
}
async function deleteSlot(slotId) {
    const ok = await showConfirmDialog({ title: 'Delete Slot', message: 'Remove this time slot? Any bookings on it may be affected.', okLabel: 'Delete', okColor: '#ef4444', icon: '🗑️' });
    if (!ok) return;
    await fetch(`${API_URL}/slots/${slotId}`,{method:'DELETE'});
    showToast('Slot removed',''); await renderDashSlots();
}
function openEditSlotModal(id, date, time, maxBookings) {
    document.getElementById('edit-slot-id').value=id;
    document.getElementById('edit-slot-date').value=date;
    document.getElementById('edit-slot-time').value=time;
    document.getElementById('edit-slot-max').value=maxBookings;
    document.getElementById('edit-slot-date').min=todayStr();
    document.getElementById('edit-slot-modal').style.display='flex';
}
function closeEditSlotModal() { document.getElementById('edit-slot-modal').style.display='none'; }
async function saveEditSlot() {
    const id  =document.getElementById('edit-slot-id').value;
    const date=document.getElementById('edit-slot-date').value;
    const time=document.getElementById('edit-slot-time').value;
    const max =parseInt(document.getElementById('edit-slot-max').value);
    if(!date||!time){showToast('Please fill all fields','error');return;}
    try {
        const res=await fetch(`${API_URL}/slots/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,time,maxBookings:max})});
        if(!res.ok){const d=await res.json();showToast(d.error||'Failed to update','error');return;}
        showToast('✅ Slot updated!','success'); closeEditSlotModal(); await renderDashSlots();
    } catch(e){showToast('Connection error.','error');}
}

// ─── BOOKINGS DASHBOARD ───────────────────────────────────
async function renderDashBookings() {
    const hId=STATE.currentHospitalId;
    const bookings=await fetchBookingsForHospital(hId);
    const listEl=document.getElementById('bookings-list');
    const active=bookings.filter(b=>b.status!=='cancelled');
    document.getElementById('total-bookings-stat').textContent=active.length;
    if(!bookings.length){listEl.innerHTML='<p style="color:#94a3b8;text-align:center;padding:20px;">No bookings yet.</p>';return;}
    listEl.innerHTML=bookings.map(b=>{
      const isCancelled = b.status === 'cancelled';
      return `
      <div class="booking-row" style="${isCancelled ? 'opacity:0.6' : ''}">
        <div class="booking-header">
          <span class="booking-id">#${b.bookingId}</span>
          <span class="booking-datetime">${b.date} at ${fmtTime12(b.time)}</span>
          <span class="booking-status-badge ${b.status||'confirmed'}" style="font-size:.7rem;padding:2px 8px">${(b.status||'confirmed').charAt(0).toUpperCase()+(b.status||'confirmed').slice(1)}</span>
        </div>
        <div class="booking-patient" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${b.patientName}${b.patientAge?`<span style="font-size:.78rem;color:#64748b">(Age: ${b.patientAge})</span>`:''}
          <button onclick="showPatientHistory('${b.patientName}','${b.patientId||''}')" style="font-size:.7rem;padding:2px 8px;border-radius:8px;border:1px solid #cbd5e1;background:#f8fafc;color:#475569;cursor:pointer;font-weight:600">📋 History</button>
        </div>
        <div class="booking-details">📞 ${b.patientContact||'—'}</div>
        <div class="booking-details">👨‍⚕️ ${b.doctorName}</div>
        ${b.patientDescription?`<div class="booking-details" style="font-style:italic">📝 ${b.patientDescription}</div>`:''}
        ${!isCancelled ? `<div style="display:flex;justify-content:flex-end;margin-top:8px">
          <button class="btn-cancel-booking" onclick="cancelServerBooking('${b._id}')">Cancel</button>
        </div>` : ''}
      </div>`;
    }).join('');
}
async function cancelServerBooking(id) {
    const ok = await showConfirmDialog({ title: 'Cancel Booking', message: 'Are you sure you want to cancel this appointment?', okLabel: 'Yes, Cancel', okColor: '#f59e0b', icon: '⚠️' });
    if (!ok) return;
    await fetch(`${API_URL}/bookings/${id}`,{method:'DELETE'});
    await renderDashBookings(); showToast('Booking cancelled','');
}
// Clear ALL booking history for hospital dashboard
async function clearHospitalBookingHistory() {
    const ok = await showConfirmDialog({ title: 'Clear All History', message: 'Clears cancelled and past bookings. Active upcoming bookings will not be removed.', okLabel: 'Clear History', okColor: '#ef4444', icon: '🗑️' });
    if (!ok) return;
    try {
        const bookings = await fetchBookingsForHospital(STATE.currentHospitalId);
        const clearable = bookings.filter(isBookingClearable);
        if (!clearable.length) { showToast('No past or cancelled bookings to clear', ''); return; }
        await Promise.all(clearable.map(b => fetch(`${API_URL}/bookings/${b._id}/hard`, { method: 'DELETE' })));
    } catch(e) {}
    renderDashBookings();
    showToast('🗑 Booking history cleared', 'success');
}
async function clearClinicBookingHistory() {
    const ok = await showConfirmDialog({ title: 'Clear Clinic History', message: 'Clears cancelled and past bookings. Active upcoming bookings will not be removed.', okLabel: 'Clear History', okColor: '#ef4444', icon: '🗑️' });
    if (!ok) return;
    try {
        const bookings = await apiFetch('/bookings/clinic/' + STATE.currentClinicId);
        const clearable = bookings.filter(isBookingClearable);
        if (!clearable.length) { showToast('No past or cancelled bookings to clear', ''); return; }
        await Promise.all(clearable.map(b => fetch(`${API_URL}/bookings/${b._id}/hard`, { method: 'DELETE' })));
    } catch(e) {}
    // Also clear local fallback bookings for this clinic (only clearable ones)
    const now = new Date();
    const filtered = getAllBookings().filter(b => {
        if (!(b.entityId == STATE.currentClinicId && b.entityType === 'clinic')) return true;
        return !isBookingClearable(b);
    });
    saveAllBookings(filtered);
    renderBookingsForClinic(STATE.currentClinicId);
    showToast('🗑 Booking history cleared', 'success');
}

// ─── CLINIC DASHBOARD ─────────────────────────────────────
async function renderClinicDashboard() {
    const id=STATE.currentClinicId;
    const clinic=await fetchClinicById(id);
    if(!clinic){showToast('❌ Clinic not found','error');return;}
    document.getElementById('clinic-dash-name').textContent=clinic.name;
    document.getElementById('clinic-dash-location').textContent=clinic.location;
    const content=document.getElementById('clinic-dashboard-content');
    const today=todayStr();
    content.innerHTML=`
      <div class="dash-tabs">
        <button class="dash-tab active" id="clinic-tab-profile" onclick="switchClinicTab('profile')">🏠 Profile</button>
        <button class="dash-tab" id="clinic-tab-slots" onclick="switchClinicTab('slots')">🕐 Time Slots</button>
        <button class="dash-tab" id="clinic-tab-bookings" onclick="switchClinicTab('bookings')">📅 Bookings</button>
      </div>
      <!-- Profile Tab -->
      <div id="clinic-panel-profile" style="display:block;">
        <div class="clinic-profile-card">
          <div class="clinic-profile-top">
            <img src="${clinic.image||'https://i.pravatar.cc/150?img=50'}" class="clinic-profile-img" alt="${clinic.doctorName}">
            <div class="clinic-profile-info">
              <h3>${clinic.doctorName}</h3>
              <p>🩺 ${clinic.specialization}</p><p>📍 ${clinic.address}</p><p>⏰ ${clinic.timings}</p>
            </div>
          </div>
          <div class="clinic-stats-mini">
            <div class="clinic-stat-item"><span class="clinic-stat-num">⭐ ${clinic.rating}</span><span class="clinic-stat-lbl">Rating</span></div>
            <div class="clinic-stat-item"><span class="clinic-stat-num">${clinic.experience||'N/A'}</span><span class="clinic-stat-lbl">Experience</span></div>
            <div class="clinic-stat-item"><span class="clinic-stat-num">${clinic.consultationFee}</span><span class="clinic-stat-lbl">Fee</span></div>
          </div>
        </div>
        <div class="clinic-avail-toggle-wrap">
          <div><p>Availability Status</p><span>${clinic.available?'✅ Currently accepting patients':'❌ Not accepting patients'}</span></div>
          <label class="toggle-switch">
            <input type="checkbox" ${clinic.available?'checked':''} onchange="toggleClinicAvailability(${clinic.clinicId})">
            <span class="slider"></span>
          </label>
        </div>
        <div style="padding:0 16px 8px">
          <div style="background:white;border-radius:var(--radius);padding:16px;box-shadow:var(--shadow-sm)">
            <h4 style="margin-bottom:10px;font-size:.95rem">📞 Contact</h4>
            <p style="font-size:.88rem;color:var(--gray-600)">Phone: ${clinic.phone||'N/A'}</p>
            <p style="font-size:.88rem;color:var(--gray-600);margin-top:5px">Email: ${clinic.email||'N/A'}</p>
          </div>
        </div>
      </div>
      <!-- Slots Tab -->
      <div id="clinic-panel-slots" style="display:none;">
        <div class="add-slot-form">
          <h4>➕ Add New Time Slot</h4>
          <div class="slot-form-row">
            <div><label style="font-size:.78rem;font-weight:600;color:#0369a1;">Date</label><input type="date" id="clinic-slot-date" min="${today}" value="${today}"></div>
            <div><label style="font-size:.78rem;font-weight:600;color:#0369a1;">Time</label><input type="time" id="clinic-slot-time"></div>
            <div><label style="font-size:.78rem;font-weight:600;color:#0369a1;">Max Patients</label><input type="number" id="clinic-slot-max" value="5" min="1" max="50"></div>
          </div>
          <button class="btn-add-slot" onclick="addClinicSlot(${clinic.clinicId})">Add Slot</button>
        </div>
        <div id="clinic-slots-list" style="padding:0 4px;"></div>
      </div>
      <!-- Bookings Tab -->
      <div id="clinic-panel-bookings" style="display:none;">
        <div style="padding:12px 16px 0;">
          <button class="btn-clear-history" onclick="clearClinicBookingHistory()">🗑 Clear All Booking History</button>
        </div>
        <div id="clinic-bookings-list" class="bookings-list"><div class="no-bookings-msg">No bookings yet</div></div>
      </div>`;
}
async function toggleClinicAvailability(id) {
    try{
        await fetch(`${API_URL}/clinics/${id}/availability`,{method:'PATCH',headers:{'Content-Type':'application/json'}});
        renderClinicDashboard(); showToast('✅ Availability updated','success');
    }catch(e){showToast('❌ Error','error');}
}

// ─── CLINIC SLOT MANAGEMENT ───────────────────────────────
async function renderClinicSlots(clinicId) {
    const clinic=await fetchClinicById(clinicId);
    if(!clinic) return;
    const slots=await fetchSlotsForDoctor(clinicId).catch(()=>[]);
    const listEl=document.getElementById('clinic-slots-list');
    if(!listEl) return;
    if(!slots.length){listEl.innerHTML='<p style="color:#94a3b8;text-align:center;padding:20px;">No slots created yet.</p>';return;}
    listEl.innerHTML=slots.map(slot=>{
        const d=new Date(slot.date+'T00:00:00');
        const dateLabel=d.toLocaleDateString('en-IN',{weekday:'short',month:'short',day:'numeric'});
        return `<div class="slot-manage-row">
          <div class="slot-info">
            <div class="slot-date">${dateLabel} — ${fmtTime12(slot.time)}</div>
            <div class="slot-meta">${slot.isActive?'🟢 Active':'🔴 Expired'}</div>
          </div>
          <span class="slot-fill">${slot.currentBookings}/${slot.maxBookings} booked</span>
          <button class="btn-edit-slot" onclick="openEditSlotModal('${slot._id}','${slot.date}','${slot.time}',${slot.maxBookings})">✏️ Edit</button>
          <button class="btn-del-slot" onclick="deleteClinicSlot('${slot._id}',${clinicId})">🗑</button>
        </div>`;
    }).join('');
}
async function addClinicSlot(clinicId) {
    const date=document.getElementById('clinic-slot-date').value;
    const time=document.getElementById('clinic-slot-time').value;
    const max=parseInt(document.getElementById('clinic-slot-max').value)||5;
    if(!date||!time){showToast('Please select date and time.','error');return;}
    try{
        const res=await fetch(`${API_URL}/slots`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({doctorId:clinicId,date,time,maxBookings:max})});
        if(!res.ok){const d=await res.json();showToast(d.error||'Failed to add slot','error');return;}
        showToast('✅ Slot added!','success'); await renderClinicSlots(clinicId);
    }catch(e){showToast('Connection error.','error');}
}
async function deleteClinicSlot(slotId, clinicId) {
    const ok = await showConfirmDialog({ title: 'Delete Slot', message: 'Remove this time slot? Any bookings on it may be affected.', okLabel: 'Delete', okColor: '#ef4444', icon: '🗑️' });
    if (!ok) return;
    await fetch(`${API_URL}/slots/${slotId}`,{method:'DELETE'});
    showToast('Slot removed',''); await renderClinicSlots(clinicId);
}
function switchClinicTab(tab) {
    ['profile','slots','bookings'].forEach(t=>{
        const btn=document.getElementById('clinic-tab-'+t);
        const panel=document.getElementById('clinic-panel-'+t);
        if(btn) btn.classList.toggle('active',t===tab);
        if(panel) panel.style.display=t===tab?'block':'none';
    });
    if(tab==='slots') renderClinicSlots(STATE.currentClinicId);
    if(tab==='bookings') renderBookingsForClinic(STATE.currentClinicId);
}

// ─── DOCTOR CRUD ──────────────────────────────────────────
function showAddDoctorModal() {
    document.getElementById('modal-title').textContent='Add New Doctor';
    document.getElementById('doctor-form').reset();
    document.getElementById('doctor-id').value='';
    document.getElementById('is-editing').value='false';
    document.getElementById('doctor-available').checked=true;
    document.getElementById('doctor-rating').value='4.5';
    document.getElementById('doctor-distance').value='0.5 km';
    document.getElementById('doctor-image').value='https://i.pravatar.cc/300?img=12';
    document.getElementById('doctor-modal').style.display='flex';
}
async function showEditDoctorModal(doctorId) {
    const d=await fetchDoctorById(doctorId);
    if(!d){showToast('❌ Could not load doctor','error');return;}
    document.getElementById('modal-title').textContent='Edit Doctor';
    document.getElementById('doctor-id').value=d.doctorId;
    document.getElementById('is-editing').value='true';
    document.getElementById('doctor-name').value=d.name;
    document.getElementById('doctor-specialization').value=d.specialization;
    document.getElementById('doctor-gender').value=d.gender||'Male';
    document.getElementById('doctor-experience').value=d.experience;
    document.getElementById('doctor-phone').value=d.phone;
    document.getElementById('doctor-email').value=d.email;
    document.getElementById('doctor-distance').value=d.distance;
    document.getElementById('doctor-rating').value=d.rating||4.5;
    document.getElementById('doctor-image').value=d.image;
    document.getElementById('doctor-available').checked=d.available;
    document.getElementById('doctor-modal').style.display='flex';
}
function closeDoctorModal(){document.getElementById('doctor-modal').style.display='none';document.getElementById('doctor-form').reset();}
async function saveDoctorForm(e) {
    e.preventDefault();
    const isEdit=document.getElementById('is-editing').value==='true';
    const doctorId=document.getElementById('doctor-id').value;
    const hosp=STATE.hospitals.find(h=>h.id===STATE.currentHospitalId);
    if(!hosp){showToast('❌ Hospital not found','error');return;}
    const data={
        name:document.getElementById('doctor-name').value,
        specialization:document.getElementById('doctor-specialization').value,
        hospital:hosp.name, hospitalId:STATE.currentHospitalId,
        distance:document.getElementById('doctor-distance').value||'0.5 km',
        available:document.getElementById('doctor-available').checked,
        image:document.getElementById('doctor-image').value||'https://i.pravatar.cc/300?img=12',
        gender:document.getElementById('doctor-gender').value,
        experience:document.getElementById('doctor-experience').value,
        rating:parseFloat(document.getElementById('doctor-rating').value)||4.5,
        phone:document.getElementById('doctor-phone').value,
        email:document.getElementById('doctor-email').value,
        lastUpdated: nowISO()
    };
    try {
        if(isEdit){
            await fetch(`${API_URL}/doctors/${doctorId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
            showToast('✅ Doctor updated!','success');
        } else {
            const allDocs=await apiFetch('/doctors').catch(()=>[]);
            const maxId=allDocs.length?Math.max(...allDocs.map(d=>d.doctorId)):0;
            data.doctorId=maxId+1;
            await fetch(`${API_URL}/doctors`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
            showToast('✅ Doctor added!','success');
        }
        closeDoctorModal(); renderHospitalDashboard();
    } catch(err){showToast('❌ Error saving doctor','error');}
}
function showDeleteDoctorModal(id,name){STATE.deletingDoctorId=id;document.getElementById('delete-doctor-name').textContent=name;document.getElementById('delete-modal').style.display='flex';}
function closeDeleteModal(){document.getElementById('delete-modal').style.display='none';STATE.deletingDoctorId=null;}
async function confirmDeleteDoctor() {
    if(!STATE.deletingDoctorId) return;
    try{
        await fetch(`${API_URL}/doctors/${STATE.deletingDoctorId}`,{method:'DELETE'});
        showToast('✅ Doctor deleted','success'); closeDeleteModal(); renderHospitalDashboard();
    }catch(e){showToast('❌ Error deleting','error');}
}
window.onclick=(e)=>{
    if(e.target===document.getElementById('doctor-modal'))   closeDoctorModal();
    if(e.target===document.getElementById('delete-modal'))   closeDeleteModal();
    if(e.target===document.getElementById('booking-modal'))  closeBookingModal();
    if(e.target===document.getElementById('edit-slot-modal'))closeEditSlotModal();
};

// ─── BOOKING SYSTEM ───────────────────────────────────────
const BOOKINGS_KEY='docavail_bookings';
const HIDDEN_BOOKINGS_KEY='docavail_hidden_bookings';
// Returns true if a booking can be cleared (cancelled OR appointment time has passed)
function isBookingClearable(b) {
    if (b.status === 'cancelled') return true;
    const date = b.date || '';
    const time = b.time || '00:00';
    const [sy, smo, sd] = date.split('-').map(Number);
    const [sh, sm] = time.split(':').map(Number);
    if (!sy) return false;
    return new Date(sy, smo - 1, sd, sh, sm, 0, 0) < new Date();
}
function getAllBookings()      { try{return JSON.parse(localStorage.getItem(BOOKINGS_KEY)||'[]');}catch{return[];} }
function saveAllBookings(arr) { try{localStorage.setItem(BOOKINGS_KEY,JSON.stringify(arr));}catch(e){} }
function getHiddenBookingIds()        { try{return JSON.parse(localStorage.getItem(HIDDEN_BOOKINGS_KEY)||'[]');}catch{return[];} }
function hideServerBookingId(id)      { const h=getHiddenBookingIds(); if(!h.includes(id)){h.push(id);localStorage.setItem(HIDDEN_BOOKINGS_KEY,JSON.stringify(h));} }
function clearHiddenBookingIds(ids)   { const h=getHiddenBookingIds().filter(id=>!ids.includes(id)); localStorage.setItem(HIDDEN_BOOKINGS_KEY,JSON.stringify(h)); }
function clearAllHiddenBookingIds()   { localStorage.setItem(HIDDEN_BOOKINGS_KEY,JSON.stringify([])); }

let BSTATE = { doctor:null, selectedDate:null, selectedTime:null, selectedTime24:null, selectedSlotId:null };

async function openBookingModal(doctor) {
    // Require patient login before booking
    if (!STATE.currentPatient) {
        showToast('⚠️ Please log in to book an appointment', 'error');
        setTimeout(() => navigateToScreen('patient-login'), 600);
        return;
    }
    BSTATE.doctor=doctor; BSTATE.selectedDate=null; BSTATE.selectedTime=null; BSTATE.selectedTime24=null; BSTATE.selectedSlotId=null;
    document.getElementById('booking-doctor-preview').innerHTML=`
      <img src="${doctor.image||'https://i.pravatar.cc/150?img=20'}" alt="${doctor.name}" onerror="this.src='https://i.pravatar.cc/150?img=20'" style="width:54px;height:54px;border-radius:12px;object-fit:cover;flex-shrink:0">
      <div><h4>${doctor.name}</h4><p>${doctor.specialization} • ${doctor.hospital||''}</p></div>
      <span class="avail-badge green">● Available</span>`;
    const pn=document.getElementById('booking-patient-name'), pp=document.getElementById('booking-patient-phone');
    if(pn&&STATE.currentPatient) pn.value=STATE.currentPatient.name||'';
    if(pp&&STATE.currentPatient) pp.value=STATE.currentPatient.phone||'';
    // Check if patient already has a booking with this doctor (show early warning)
    const pid = STATE.currentPatient?.id;
    const dupWarn = document.getElementById('booking-dup-warning');
    if (dupWarn) dupWarn.style.display = 'none';
    if (pid) {
        try {
            const existing = await apiFetch('/bookings/patient/' + pid);
            const docId = doctor.doctorId || doctor.id;
            const alreadyBooked = existing.filter(b => b.doctorId == docId && b.status !== 'cancelled');
            if (alreadyBooked.length && dupWarn) {
                const dates = alreadyBooked.map(b => b.date).join(', ');
                dupWarn.textContent = `⚠️ You already have ${alreadyBooked.length} active booking(s) with this doctor on: ${dates}`;
                dupWarn.style.display = 'block';
            }
        } catch(e) {}
    }
    // Date grid – build next 14 days, load slots to highlight days that have availability
    const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const now=new Date();
    const docId=BSTATE.doctor?.doctorId||BSTATE.doctor?.id;
    // Pre-fetch slots so we know which dates have availability
    let availDates=new Set();
    try{
        const slots=await apiFetch('/slots/doctor/'+docId);
        slots.forEach(s=>{ if(s.isActive) availDates.add(s.date); });
    }catch(e){}
    let dhtml='';
    let firstAvailIdx=-1;
    for(let i=0;i<14;i++){
        const d=new Date(now); d.setDate(now.getDate()+i);
        const dstr=d.toISOString().split('T')[0];
        const hasSlots=availDates.has(dstr);
        if(hasSlots&&firstAvailIdx===-1) firstAvailIdx=i;
        dhtml+=`<button class="booking-date-btn ${i===0&&firstAvailIdx===0?'active':''} ${!hasSlots?'no-slots':''}"
          data-date="${dstr}" onclick="selectBookingDate(this,'${dstr}')">
          <span class="day-name">${days[d.getDay()]}</span>
          <span class="day-num">${d.getDate()}</span>
          <span style="font-size:.6rem;opacity:.7">${months[d.getMonth()]}</span>
          ${hasSlots?`<span style="font-size:.55rem;color:#10b981;font-weight:700">OPEN</span>`:
                     `<span style="font-size:.55rem;opacity:.5">–</span>`}
        </button>`;
    }
    document.getElementById('booking-date-grid').innerHTML=dhtml;
    const startDate=firstAvailIdx>=0
        ? new Date(now.getTime()+firstAvailIdx*86400000).toISOString().split('T')[0]
        : now.toISOString().split('T')[0];
    BSTATE.selectedDate=startDate;
    // Select the first available date visually
    const firstBtn=document.querySelector(`.booking-date-btn[data-date="${startDate}"]`);
    if(firstBtn) firstBtn.classList.add('active');
    renderTimeSlots();
    document.getElementById('booking-reason').value='';
    document.getElementById('booking-modal').style.display='flex';
    document.getElementById('confirm-booking-btn').disabled=true;
}
function selectBookingDate(btn,date){
    document.querySelectorAll('.booking-date-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    BSTATE.selectedDate=date;
    BSTATE.selectedTime=null;
    BSTATE.selectedSlotId=null;
    renderTimeSlots();
    document.getElementById('confirm-booking-btn').disabled=true;
}
async function renderTimeSlots() {
    const grid=document.getElementById('booking-time-grid');
    if(!grid) return;
    grid.innerHTML='<p style="color:#94a3b8;font-size:.82rem;grid-column:1/-1">Loading available slots...</p>';
    const doctor=BSTATE.doctor;
    const docId=doctor?.doctorId||doctor?.id;
    const selectedDate=BSTATE.selectedDate;
    if(!docId||!selectedDate){grid.innerHTML='<p style="color:#94a3b8;font-size:.82rem;grid-column:1/-1">Please select a date.</p>';return;}

    // Fetch real slots from server for this doctor
    let dbSlots=[];
    try{ dbSlots=await apiFetch('/slots/doctor/'+docId); }catch(e){}

    // Filter to the selected date and active/future only
    const now=new Date();
    const todayS=todayStr();
    const slotsForDate=dbSlots.filter(s=>{
        if(s.date!==selectedDate) return false;
        if(!s.isActive) return false;
        // Extra client-side check: must be in the future
        const [h,m]=s.time.split(':').map(Number);
        const slotDt=new Date(now.getFullYear(),now.getMonth(),now.getDate());
        // parse the selected date
        const [sy,smo,sd]=selectedDate.split('-').map(Number);
        const slotDatetime=new Date(sy,smo-1,sd,h,m,0,0);
        return slotDatetime>now;
    });

    // Also check what's already fully booked
    if(!slotsForDate.length){
        if(selectedDate===todayS)
            grid.innerHTML='<p style="color:#94a3b8;font-size:.82rem;grid-column:1/-1">No available slots for today. Try a future date or check with the hospital.</p>';
        else
            grid.innerHTML='<p style="color:#94a3b8;font-size:.82rem;grid-column:1/-1">No slots created by the hospital for this date yet.</p>';
        return;
    }

    grid.innerHTML=slotsForDate.map(s=>{
        const label=fmtTime12(s.time);
        const full=s.currentBookings>=s.maxBookings;
        const remaining=s.maxBookings-s.currentBookings;
        return `<button class="booking-time-btn ${full?'booked':''}"
          onclick="selectBookingTime(this,'${s.time}','${label}','${s._id}')"
          ${full?'disabled':''}>
          ${full?'✗ Full':label}
          ${!full?`<span style="font-size:.65rem;opacity:.7;display:block">${remaining} left</span>`:''}
        </button>`;
    }).join('');
}
function selectBookingTime(btn,time24,label,slotId){
    document.querySelectorAll('.booking-time-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    BSTATE.selectedTime=label;
    BSTATE.selectedTime24=time24;
    BSTATE.selectedSlotId=slotId||null;
    document.getElementById('confirm-booking-btn').disabled=false;
}
async function confirmBooking() {
    if(!BSTATE.selectedDate||!BSTATE.selectedTime){showToast('Please select a date and time','error');return;}
    const doctor = BSTATE.doctor;
    const patientName = document.getElementById('booking-patient-name')?.value.trim() || STATE.currentPatient?.name || '';
    const patientPhone = document.getElementById('booking-patient-phone')?.value.trim() || STATE.currentPatient?.phone || '';
    // ── Validation ─────────────────────────────────────────────────────────
    if (!patientName || patientName.length < 2) {
        showToast('⚠️ Please enter your full name (at least 2 characters)', 'error'); return;
    }
    if (patientPhone && !/^[0-9+\s\-()]{7,15}$/.test(patientPhone)) {
        showToast('⚠️ Please enter a valid phone number', 'error'); return;
    }
    // ── End validation ──────────────────────────────────────────────────────
    const btn = document.getElementById('confirm-booking-btn');
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Booking...</span>';

    try {
        // ── Duplicate booking check ───────────────────────────────────────────
        const pid = STATE.currentPatient?.id;
        if (pid) {
            let existingBookings = [];
            try { existingBookings = await apiFetch('/bookings/patient/' + pid); } catch(e) {}
            const doctorId = doctor.doctorId || doctor.id;
            // Option B: block same doctor on same day only
            const duplicate = existingBookings.find(b =>
                b.doctorId == doctorId &&
                b.date === BSTATE.selectedDate &&
                b.status !== 'cancelled'
            );
            if (duplicate) {
                showToast(`⚠️ You already have a booking with ${doctor.name} on ${BSTATE.selectedDate}. Choose a different date or a different doctor.`, 'error');
                btn.disabled = false; btn.textContent = 'Confirm Booking';
                return;
            }
        }
        // ── End duplicate check ───────────────────────────────────────────────

        const isClinic = !!doctor.isClinic;
        const payload = {
            patientId:   STATE.currentPatient?.id || null,
            patientName,
            patientContact: patientPhone,
            patientAge:     STATE.currentPatient?.age || null,
            patientDescription: document.getElementById('booking-reason')?.value.trim() || '',
            doctorId:   doctor.doctorId || doctor.id,
            // For clinics: store clinicId as doctorId (already is) and hospitalId as 0
            // The /bookings/clinic/:id route finds by doctorId == clinicId
            hospitalId: isClinic ? 0 : (doctor.hospitalId || STATE.currentHospitalId || STATE.selectedHospitalId || 0),
            slotId:     BSTATE.selectedSlotId
        };

        if (!payload.slotId) {
            // No server slot selected — fallback to local save (clinic without slots)
            const booking = {
                id: 'BK'+Date.now(),
                patientId: STATE.currentPatient?.id || STATE.currentPatient?.email || 'guest',
                doctorId: payload.doctorId,
                doctorName: doctor.name,
                specialization: doctor.specialization,
                entityName: doctor.hospital || doctor.entityName || '',
                entityType: doctor.isClinic ? 'clinic' : 'hospital',
                entityId: doctor.isClinic ? doctor.doctorId : payload.hospitalId,
                date: BSTATE.selectedDate,
                time: BSTATE.selectedTime,
                reason: payload.patientDescription || 'General consultation',
                status: 'confirmed',
                createdAt: nowISO(),
                patientName,
                image: doctor.image || ''
            };
            const all = getAllBookings(); all.unshift(booking); saveAllBookings(all);
        } else {
            const result = await fetch(`${API_URL}/bookings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await result.json();
            if (!result.ok) { showToast('❌ ' + (data.error||'Booking failed'), 'error'); btn.disabled=false; btn.textContent='Confirm Booking'; return; }
        }
        closeBookingModal();
        if (STATE.currentScreen==='hospital-dashboard') renderHospitalDashboard();
        if (STATE.currentScreen==='clinic-dashboard')   renderClinicDashboard();
        await renderTimeSlots();
        // Show booking confirmation details
        showBookingConfirmation({
            doctorName: doctor.name,
            specialization: doctor.specialization,
            hospital: doctor.hospital || '',
            date: BSTATE.selectedDate,
            time: BSTATE.selectedTime,
            patientName,
            patientPhone
        });
    } catch(e) {
        showToast('❌ Booking failed. Try again.', 'error');
    }
    btn.disabled = false; btn.innerHTML = 'Confirm Booking';
}
async function renderPatientBookings() {
    const c = document.getElementById('my-bookings-list');
    if (!c) return;
    c.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8">Loading your bookings...</div>';
    const pid = STATE.currentPatient?.id;
    let serverBookings = [];
    if (pid) {
        try { serverBookings = await apiFetch('/bookings/patient/' + pid); } catch(e) {}
    }
    // Also show localStorage bookings for this patient (clinic fallback without slots)
    const localPid = STATE.currentPatient?.id || STATE.currentPatient?.email || 'guest';
    const localBookings = getAllBookings().filter(b => (b.patientId||'guest') === localPid);
    const all = [...serverBookings.map(b=>({
        id: b._id, doctorName: b.doctorName, specialization: b.doctorName,
        entityName: b.hospitalName, date: b.date, time: b.time,
        reason: b.patientDescription, status: b.status,
        patientName: b.patientName, createdAt: b.createdAt,
        _serverId: b._id, image: ''
    })), ...localBookings];
    let header = `<div style="width:100%;margin-bottom:8px;text-align:right">
      <button class="btn-clear-history-subtle" onclick="clearPatientBookingHistory()" title="Remove past and cancelled bookings">🗑 Clear History</button>
    </div>`;
    if (!all.length) { c.innerHTML = header + `<div class="no-bookings-empty">
        <div style="font-size:3.5rem;margin-bottom:12px">🗓️</div>
        <h3 style="font-weight:700;color:var(--dark);margin-bottom:8px">No appointments yet</h3>
        <p style="color:var(--gray-400);font-size:.88rem;max-width:240px;margin:0 auto;line-height:1.5">Browse hospitals or clinics and tap <strong>Book Appointment</strong> to get started.</p>
        <button onclick="switchTab('hospitals')" style="margin-top:18px;padding:10px 24px;background:var(--primary);color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer;font-size:.9rem">Browse Hospitals →</button>
    </div>`; return; }
    // Sort by appointment date ascending (soonest first), cancelled/past at bottom
    const now = new Date();
    const sorted = [...all].sort((a, b) => {
        const isPastA = isBookingClearable(a), isPastB = isBookingClearable(b);
        if (isPastA !== isPastB) return isPastA ? 1 : -1;
        return new Date(a.date + 'T' + (a.time||'00:00')) - new Date(b.date + 'T' + (b.time||'00:00'));
    });
    c.innerHTML = header + sorted.map(b => renderBookingCard(b, 'patient')).join('');
}
async function clearPatientBookingHistory() {
    const ok = await showConfirmDialog({ title: 'Clear Booking History', message: 'Clears cancelled and past bookings. Active upcoming bookings will not be removed.', okLabel: 'Clear History', okColor: '#ef4444', icon: '🗑️' });
    if (!ok) return;
    const pid = STATE.currentPatient?.id;
    if (pid) {
        try {
            const serverBookings = await apiFetch('/bookings/patient/' + pid);
            const clearable = serverBookings.filter(isBookingClearable);
            if (!clearable.length && !getAllBookings().filter(b => (b.patientId || 'guest') === (pid || 'guest') && isBookingClearable(b)).length) {
                showToast('No past or cancelled bookings to clear', ''); return;
            }
            await Promise.all(clearable.map(b => fetch(`${API_URL}/bookings/${b._id}/hard`, { method: 'DELETE' })));
        } catch(e) {}
    }
    // Clear only clearable localStorage bookings for this patient
    const localPid = STATE.currentPatient?.id || STATE.currentPatient?.email || 'guest';
    const remaining = getAllBookings().filter(b => {
        if ((b.patientId || 'guest') !== localPid) return true;
        return !isBookingClearable(b);
    });
    saveAllBookings(remaining);
    renderPatientBookings();
    showToast('🗑 Booking history cleared', 'success');
}
async function renderBookingsForClinic(clinicId) {
    const listEl = document.getElementById('clinic-bookings-list');
    const countEl = document.getElementById('clinic-bookings-count');
    if (!listEl) return;
    listEl.innerHTML = '<div class="no-bookings-msg" style="color:#94a3b8">Loading...</div>';
    let bookings = [];
    try { bookings = await apiFetch('/bookings/clinic/' + clinicId); } catch(e) {}
    const active = bookings.filter(b => b.status !== 'cancelled');
    if (countEl) countEl.textContent = active.length;
    if (!bookings.length) { listEl.innerHTML = '<div class="no-bookings-msg">No bookings yet</div>'; return; }
    listEl.innerHTML = bookings.map(b => {
      const isCancelled = b.status === 'cancelled';
      return `
      <div class="booking-row" style="${isCancelled ? 'opacity:0.6' : ''}">
        <div class="booking-header">
          <span class="booking-id">#${b.bookingId}</span>
          <span class="booking-datetime">${b.date} at ${fmtTime12(b.time)}</span>
          <span class="booking-status-badge ${b.status||'confirmed'}" style="font-size:.7rem;padding:2px 8px">${(b.status||'confirmed').charAt(0).toUpperCase()+(b.status||'confirmed').slice(1)}</span>
        </div>
        <div class="booking-patient" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${b.patientName}
          <button onclick="showPatientHistory('${b.patientName}','${b.patientId||''}')" style="font-size:.7rem;padding:2px 8px;border-radius:8px;border:1px solid #cbd5e1;background:#f8fafc;color:#475569;cursor:pointer;font-weight:600">📋 History</button>
        </div>
        <div class="booking-details">📞 ${b.patientContact||'—'}</div>
        ${b.patientDescription?`<div class="booking-details" style="font-style:italic">📝 ${b.patientDescription}</div>`:''}
        ${!isCancelled ? `<div style="display:flex;justify-content:flex-end;margin-top:8px">
          <button class="btn-cancel-booking" onclick="cancelServerBooking('${b._id}')">Cancel</button>
        </div>` : ''}
      </div>`;
    }).join('');
}
function renderBookingCard(b, context='patient') {
    const d = new Date(b.date + 'T00:00:00');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const sid = b._serverId || b._id || null;
    const lid = b.id || null;
    const cancelFn = sid
        ? `cancelServerBookingAndRefresh('${sid}','${context}')`
        : `cancelBooking('${lid}','${context}')`;
    const removeFn = sid
        ? `removeServerBooking('${sid}','${context}')`
        : `removeBooking('${lid}','${context}')`;
    const status = b.status || 'confirmed';
    const [sh, sm] = (b.time || '00:00').split(':').map(Number);
    const [sy, smo, sdy] = (b.date || '2000-01-01').split('-').map(Number);
    const apptDatetime = new Date(sy, smo - 1, sdy, sh, sm, 0, 0);
    const isPast = apptDatetime < new Date();
    const showRemove = status === 'cancelled' || isPast;
    const now2 = new Date();
    const todayMid = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate());
    const apptMid  = new Date(sy, smo-1, sdy);
    const diffDays = Math.round((apptMid - todayMid) / 86400000);
    let urgencyBadge = '';
    if (status !== 'cancelled' && !isPast) {
        if (diffDays === 0) urgencyBadge = `<span class="appt-urgency-badge today">Today</span>`;
        else if (diffDays === 1) urgencyBadge = `<span class="appt-urgency-badge tomorrow">Tomorrow</span>`;
        else if (diffDays <= 3) urgencyBadge = `<span class="appt-urgency-badge soon">In ${diffDays} days</span>`;
    }
    return `<div class="booking-card" id="bcard-${sid||lid}">
      <div class="booking-card-date">
        <span class="bk-month">${months[d.getMonth()]}</span>
        <span class="bk-day">${d.getDate()}</span>
        ${urgencyBadge}
      </div>
      <div class="booking-card-info">
        <h4>${b.doctorName}</h4>
        <p>${b.specialization||''}</p>
        <span class="booking-time-pill">🕐 ${b.time}</span>
        <p style="margin-top:4px;font-size:.78rem;color:var(--gray-400)">${b.reason||b.patientDescription||''}</p>
        <p style="font-size:.78rem;color:var(--gray-500)">🏥 ${b.entityName||b.hospitalName||''}</p>
        <p style="font-size:.72rem;color:var(--gray-400)">Booked: ${fmtDateTime(b.createdAt)}</p>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
        <span class="booking-status-badge ${status}">${status.charAt(0).toUpperCase()+status.slice(1)}</span>
        ${status !== 'cancelled' && !isPast && sid
            ? `<button class="booking-reschedule-btn" onclick="openRescheduleModal('${sid}')">🔄 Reschedule</button>`
            : ''}
        ${status !== 'cancelled'
            ? `<button class="booking-cancel-btn" onclick="${cancelFn}">Cancel</button>`
            : ''}
        ${showRemove
            ? `<button class="booking-remove-btn" onclick="${removeFn}">🗑 Remove</button>`
            : ''}
      </div>
    </div>`;
}
// ── RESCHEDULE ──────────────────────────────────────────────────────────────
async function openRescheduleModal(serverId) {
    BSTATE.rescheduleBookingId = serverId;
    // Fetch booking details to know which doctor
    let booking = null;
    try {
        const all = await apiFetch('/bookings/patient/' + STATE.currentPatient.id);
        booking = all.find(b => b._id === serverId);
    } catch(e) {}
    if (!booking) { showToast('❌ Could not load booking', 'error'); return; }
    // Reuse booking modal but in reschedule mode
    BSTATE.doctor = {
        doctorId: booking.doctorId,
        name: booking.doctorName,
        specialization: booking.doctorName,
        hospital: booking.hospitalName,
        image: ''
    };
    BSTATE.selectedDate = null; BSTATE.selectedTime = null; BSTATE.selectedSlotId = null;
    document.getElementById('booking-doctor-preview').innerHTML = `
      <div><h4>Reschedule: ${booking.doctorName}</h4><p>Choose a new date and time</p></div>`;
    document.getElementById('booking-modal').dataset.mode = 'reschedule';
    document.getElementById('confirm-booking-btn').textContent = 'Confirm Reschedule';
    document.getElementById('confirm-booking-btn').onclick = () => confirmReschedule(serverId);
    // Build date grid
    const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const now = new Date();
    let availDates = new Set();
    try {
        const slots = await apiFetch('/slots/doctor/' + booking.doctorId);
        slots.forEach(s => { if(s.isActive) availDates.add(s.date); });
    } catch(e) {}
    let dhtml = '', firstAvailIdx = -1;
    for(let i=0;i<14;i++){
        const d=new Date(now); d.setDate(now.getDate()+i);
        const dstr=d.toISOString().split('T')[0];
        const hasSlots=availDates.has(dstr);
        if(hasSlots&&firstAvailIdx===-1) firstAvailIdx=i;
        dhtml+=`<button class="booking-date-btn ${!hasSlots?'no-slots':''}" data-date="${dstr}" onclick="selectBookingDate(this,'${dstr}')">
          <span class="day-name">${days[d.getDay()]}</span>
          <span class="day-num">${d.getDate()}</span>
          <span style="font-size:.6rem;opacity:.7">${months[d.getMonth()]}</span>
          ${hasSlots?`<span style="font-size:.55rem;color:#10b981;font-weight:700">OPEN</span>`:`<span style="font-size:.55rem;opacity:.5">–</span>`}
        </button>`;
    }
    document.getElementById('booking-date-grid').innerHTML = dhtml;
    const startDate = firstAvailIdx>=0 ? new Date(now.getTime()+firstAvailIdx*86400000).toISOString().split('T')[0] : now.toISOString().split('T')[0];
    BSTATE.selectedDate = startDate;
    const firstBtn = document.querySelector(`.booking-date-btn[data-date="${startDate}"]`);
    if(firstBtn) firstBtn.classList.add('active');
    renderTimeSlots();
    document.getElementById('booking-patient-fields').style.display = 'none';
    document.getElementById('booking-reason').value = '';
    document.getElementById('booking-modal').style.display = 'flex';
    document.getElementById('confirm-booking-btn').disabled = true;
}
async function confirmReschedule(serverId) {
    if (!BSTATE.selectedSlotId) { showToast('Please select a new time slot', 'error'); return; }
    const btn = document.getElementById('confirm-booking-btn');
    btn.disabled = true; btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Rescheduling...</span>';
    try {
        const res = await fetch(`${API_URL}/bookings/${serverId}/reschedule`, {
            method: 'PATCH',
            headers: dashHeaders(),
            body: JSON.stringify({ newSlotId: BSTATE.selectedSlotId })
        });
        const data = await res.json();
        if (!res.ok) { showToast('❌ ' + (data.error||'Reschedule failed'), 'error'); btn.disabled=false; btn.innerHTML='Confirm Reschedule'; return; }
        closeBookingModal();
        showToast('✅ Appointment rescheduled!', 'success');
        renderPatientBookings();
    } catch(e) {
        showToast('❌ Reschedule failed. Try again.', 'error');
    }
    btn.disabled = false; btn.innerHTML = 'Confirm Reschedule';
    // Reset modal back to normal booking mode
    document.getElementById('booking-modal').dataset.mode = '';
    document.getElementById('confirm-booking-btn').onclick = confirmBooking;
    document.getElementById('booking-patient-fields').style.display = '';
}
function closeBookingModal(){
    document.getElementById('booking-modal').style.display='none';
    // Reset to normal booking mode
    const btn = document.getElementById('confirm-booking-btn');
    if (btn) { btn.innerHTML = 'Confirm Booking'; btn.onclick = confirmBooking; }
    document.getElementById('booking-patient-fields').style.display = '';
}

// ── PATIENT HISTORY (hospital dashboard) ────────────────────────────────────
async function showPatientHistory(patientName, patientId) {
    let bookings = [];
    try {
        if (patientId) {
            bookings = await apiFetch('/bookings/patient/' + patientId);
        } else {
            // Fallback: search by name in hospital bookings
            const all = await apiFetch('/bookings/hospital/' + STATE.currentHospitalId + '/all');
            bookings = all.filter(b => b.patientName === patientName);
        }
    } catch(e) {}
    const modal = document.getElementById('confirm-dialog');
    const title = document.getElementById('confirm-dialog-title');
    const msg   = document.getElementById('confirm-dialog-msg');
    const icon  = document.getElementById('confirm-dialog-icon');
    const okBtn = document.getElementById('confirm-dialog-ok');
    icon.textContent  = '👤';
    title.textContent = patientName + "'s Booking History";
    if (!bookings.length) {
        msg.innerHTML = '<em style="color:#94a3b8">No booking history found.</em>';
    } else {
        msg.innerHTML = bookings.map(b => `
            <div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:.82rem">
                <strong>${b.date} at ${fmtTime12(b.time)}</strong> — ${b.doctorName}<br>
                <span style="color:#64748b">${b.hospitalName||''}</span>
                <span class="booking-status-badge ${b.status||'confirmed'}" style="font-size:.65rem;padding:1px 6px;margin-left:6px">${(b.status||'confirmed').charAt(0).toUpperCase()+(b.status||'confirmed').slice(1)}</span>
            </div>`).join('');
    }
    okBtn.textContent = 'Close';
    okBtn.style.background = '#3b82f6';
    okBtn.style.color = '#fff';
    // Override ok to just close
    const prev = window._confirmResolve;
    _confirmResolve = () => { document.getElementById('confirm-dialog').style.display='none'; };
    okBtn.onclick = () => { document.getElementById('confirm-dialog').style.display='none'; };
    document.querySelector('#confirm-dialog button:first-of-type').style.display = 'none';
    modal.style.display = 'flex';
}

async function removeBooking(id, context='patient') {
    const ok = await showConfirmDialog({ title: 'Remove Booking', message: 'Remove this booking from your history? This cannot be undone.', okLabel: '🗑 Remove', okColor: '#ef4444', icon: '🗑️' });
    if (!ok) return;
    const all=getAllBookings(), filtered=all.filter(b=>b.id!==id);
    saveAllBookings(filtered);
    if(context==='hospital') renderDashBookings();
    else if(context==='clinic') renderBookingsForClinic(STATE.currentClinicId);
    else renderPatientBookings();
    showToast('🗑 Booking removed','');
}
async function cancelBooking(id, context='patient') {
    const ok = await showConfirmDialog({ title: 'Cancel Booking', message: 'Are you sure you want to cancel this appointment?', okLabel: 'Yes, Cancel', okColor: '#f59e0b', icon: '⚠️' });
    if (!ok) return;
    const all=getAllBookings(), idx=all.findIndex(b=>b.id===id);
    if(idx!==-1){all[idx].status='cancelled';saveAllBookings(all);}
    if(context==='hospital') renderDashBookings();
    else if(context==='clinic') renderBookingsForClinic(STATE.currentClinicId);
    else renderPatientBookings();
    showToast('Booking cancelled','');
}
// Cancel a server booking from patient/hospital/clinic view
async function cancelServerBookingAndRefresh(serverId, context='patient') {
    const ok = await showConfirmDialog({ title: 'Cancel Booking', message: 'Are you sure you want to cancel this appointment?', okLabel: 'Yes, Cancel', okColor: '#f59e0b', icon: '⚠️' });
    if (!ok) return;
    try {
        await fetch(`${API_URL}/bookings/${serverId}`, { method: 'DELETE' });
        showToast('Booking cancelled', '');
    } catch(e) { showToast('❌ Could not cancel. Try again.', 'error'); return; }
    if(context==='hospital') renderDashBookings();
    else if(context==='clinic') renderBookingsForClinic(STATE.currentClinicId);
    else renderPatientBookings();
}
// Remove (hide) a server booking from patient view — cancel on server + refresh
async function removeServerBooking(serverId, context='patient') {
    const ok = await showConfirmDialog({ title: 'Remove Booking', message: 'Remove this booking from your history? This cannot be undone.', okLabel: '🗑 Remove', okColor: '#ef4444', icon: '🗑️' });
    if (!ok) return;
    try {
        await fetch(`${API_URL}/bookings/${serverId}/hard`, { method: 'DELETE' });
    } catch(e) {}
    if(context==='hospital') renderDashBookings();
    else if(context==='clinic') renderBookingsForClinic(STATE.currentClinicId);
    else renderPatientBookings();
    showToast('🗑 Booking removed', '');
}

// ─── BOOKING CONFIRMATION MODAL ──────────────────────────
function showBookingConfirmation({ doctorName, specialization, hospital, date, time, patientName, patientPhone }) {
    const [sy, smo, sd] = date.split('-').map(Number);
    const d = new Date(sy, smo-1, sd);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dateLabel = `${days[d.getDay()]}, ${sd} ${months[smo-1]} ${sy}`;
    const el = document.getElementById('booking-confirm-modal');
    document.getElementById('bc-doctor').textContent = doctorName;
    document.getElementById('bc-spec').textContent   = specialization || '';
    document.getElementById('bc-hosp').textContent   = hospital || '';
    document.getElementById('bc-date').textContent   = dateLabel;
    document.getElementById('bc-time').textContent   = time;
    document.getElementById('bc-name').textContent   = patientName;
    document.getElementById('bc-phone').textContent  = patientPhone || '—';
    el.style.display = 'flex';
}
function closeBookingConfirm() {
    document.getElementById('booking-confirm-modal').style.display = 'none';
}

// ─── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Inject spin animation for loading spinner
    const style = document.createElement('style');
    style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
    setTimeout(()=>navigateToScreen('welcome'), 2500);
});
