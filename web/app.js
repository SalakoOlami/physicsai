/* ============================================================
   app.js — PhysicsAI Web App
   ============================================================ */

const API = 'https://physicsai-5eih.onrender.com';

/* ============================================================
   AUTH + FREE TRIAL
   ============================================================ */
const AUTH_KEY   = 'phy_auth';
const TRIAL_KEY  = 'phy_trial_start';
const TRIAL_DAYS = 7;

const Auth = {
  get()        { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; } },
  set(data)    { localStorage.setItem(AUTH_KEY, JSON.stringify(data)); },
  clear()      { localStorage.removeItem(AUTH_KEY); },
  isLoggedIn() {
    const s = Auth.get();
    if (!s || !s.token || !s.name) return false;
    if (s.token === 'owner') return true;
    if (s.expires_at && new Date().toISOString() > s.expires_at) {
      Auth.clear();
      return false;
    }
    return true;
  },
};

const Trial = {
  start() {
    if (!localStorage.getItem(TRIAL_KEY)) {
      localStorage.setItem(TRIAL_KEY, Date.now().toString());
    }
  },
  isActive() {
    const ts = parseInt(localStorage.getItem(TRIAL_KEY) || '0', 10);
    if (!ts) return false;
    return (Date.now() - ts) < TRIAL_DAYS * 24 * 60 * 60 * 1000;
  },
  daysLeft() {
    const ts = parseInt(localStorage.getItem(TRIAL_KEY) || '0', 10);
    if (!ts) return 0;
    const msLeft = (TRIAL_DAYS * 24 * 60 * 60 * 1000) - (Date.now() - ts);
    return Math.max(0, Math.floor(msLeft / (24 * 60 * 60 * 1000)));
  },
};

function showAuthGate() {
  document.getElementById('auth-gate').style.display     = 'flex';
  document.getElementById('sidebar').style.visibility   = 'hidden';
  document.getElementById('main').style.visibility      = 'hidden';
}

function hideAuthGate() {
  document.getElementById('auth-gate').style.display     = 'none';
  document.getElementById('sidebar').style.visibility   = '';
  document.getElementById('main').style.visibility      = '';
  const btn = document.getElementById('auth-logout-btn');
  if (btn) btn.style.display = 'flex';
  const session = Auth.get();
  if (session && session.name && session.name !== 'Owner') {
    const el = document.querySelector('#page-dashboard .page-title');
    if (el) el.textContent = `Welcome back, ${session.name}`;
  } else if (Trial.isActive()) {
    const sub = document.querySelector('#page-dashboard .page-sub');
    if (sub) sub.textContent = `Free trial · ${Trial.daysLeft()} day${Trial.daysLeft() !== 1 ? 's' : ''} remaining`;
  }
}

function _setAuthMsg(elId, text, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent   = text;
  el.className     = `auth-msg ${type}`;
  el.style.display = text ? 'block' : 'none';
}

function _setLoading(btnId, loading, defaultText) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading ? 'Please wait…' : defaultText;
}

function _initAuthTabs() {
  document.getElementById('tab-register').addEventListener('click', () => {
    document.getElementById('tab-register').classList.add('active');
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('auth-panel-register').style.display = '';
    document.getElementById('auth-panel-login').style.display    = 'none';
    _setAuthMsg('auth-register-msg', '', '');
  });
  document.getElementById('tab-login').addEventListener('click', () => {
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('tab-register').classList.remove('active');
    document.getElementById('auth-panel-login').style.display    = '';
    document.getElementById('auth-panel-register').style.display = 'none';
    _setAuthMsg('auth-login-msg', '', '');
  });
}

async function _handleRegister() {
  const name  = document.getElementById('auth-name').value.trim();
  const email = document.getElementById('auth-email').value.trim();
  if (!name)  { _setAuthMsg('auth-register-msg', 'Please enter your name.', 'error'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    _setAuthMsg('auth-register-msg', 'Please enter a valid email address.', 'error'); return;
  }
  _setLoading('auth-register-btn', true, 'Request Access');
  _setAuthMsg('auth-register-msg', '', '');
  try {
    const resp = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    });
    const data = await resp.json();
    if (!resp.ok) { _setAuthMsg('auth-register-msg', data.detail || 'Registration failed.', 'error'); return; }
    if (data.message === 'already_active') {
      _setAuthMsg('auth-register-msg', 'This email already has an active code. Use "Enter Code".', 'info'); return;
    }
    if (data.message === 'already_registered') {
      _setAuthMsg('auth-register-msg', 'Already registered! Once you have paid and received your code, enter it in "Enter Code".', 'info'); return;
    }
    _setAuthMsg('auth-register-msg', 'Registration received! Once you have paid and received your code, click "Enter Code" above.', 'success');
    document.getElementById('auth-name').value  = '';
    document.getElementById('auth-email').value = '';
  } catch { _setAuthMsg('auth-register-msg', 'Network error. Try again.', 'error'); }
  finally  { _setLoading('auth-register-btn', false, 'Request Access'); }
}

async function _handleLogin() {
  const rawCode = document.getElementById('auth-code').value.trim().toUpperCase();
  if (rawCode.length !== 8) {
    _setAuthMsg('auth-login-msg', 'Code must be exactly 8 characters (e.g. A3F9B2K1).', 'error'); return;
  }
  _setLoading('auth-login-btn', true, 'Enter App');
  _setAuthMsg('auth-login-msg', '', '');
  try {
    const resp = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: rawCode }),
    });
    const data = await resp.json();
    if (resp.status === 401) { _setAuthMsg('auth-login-msg', 'Invalid code. Double-check and try again.', 'error'); return; }
    if (resp.status === 403) { _setAuthMsg('auth-login-msg', 'Code not yet activated. Complete payment first.', 'error'); return; }
    if (!resp.ok)            { _setAuthMsg('auth-login-msg', data.detail || 'Login failed.', 'error'); return; }
    Auth.set({ token: data.token, name: data.name, email: data.email, expires_at: data.expires_at });
    hideAuthGate();
  } catch { _setAuthMsg('auth-login-msg', 'Network error. Try again.', 'error'); }
  finally  { _setLoading('auth-login-btn', false, 'Enter App'); }
}

function _handleLogout() {
  Auth.clear();
  const el = document.querySelector('#page-dashboard .page-title');
  if (el) el.textContent = 'Welcome back';
  const btn = document.getElementById('auth-logout-btn');
  if (btn) btn.style.display = 'none';
  showAuthGate();
}

function _gateCheck() {
  if (Auth.isLoggedIn() || Trial.isActive()) {
    hideAuthGate();
  } else {
    showAuthGate();
  }
}

function initAuth() {
  Trial.start();
  _initAuthTabs();
  document.getElementById('auth-register-btn').addEventListener('click', _handleRegister);
  document.getElementById('auth-login-btn').addEventListener('click', _handleLogin);
  document.getElementById('auth-code').addEventListener('keydown',  (e) => { if (e.key === 'Enter') _handleLogin(); });
  document.getElementById('auth-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') _handleRegister(); });
  const logoutBtn = document.getElementById('auth-logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', _handleLogout);

  // Owner bypass — visit with ?key=ADMIN_SECRET for permanent access
  const urlKey = new URLSearchParams(window.location.search).get('key');
  if (urlKey) {
    fetch(`${API}/api/admin/users?key=${encodeURIComponent(urlKey)}`)
      .then(r => {
        if (r.ok) {
          Auth.set({ token: 'owner', name: 'Owner', email: 'owner' });
          window.history.replaceState({}, '', window.location.pathname);
          hideAuthGate();
        } else {
          _gateCheck();
        }
      })
      .catch(() => _gateCheck());
    return;
  }

  _gateCheck();
}

/* ============================================================
   WEBGL LIGHTNING BACKGROUND
   ============================================================ */
(function initLightning() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
  resize();
  window.addEventListener('resize', resize);

  const gl = canvas.getContext('webgl');
  if (!gl) return;

  const vert = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const frag = `
    precision mediump float;
    uniform vec2 iRes;
    uniform float iTime;
    #define OCT 10
    vec3 hsv2rgb(vec3 c) {
      vec3 rgb = clamp(abs(mod(c.x*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.);
      return c.z*mix(vec3(1.),rgb,c.y);
    }
    float h12(vec2 p) {
      vec3 p3=fract(vec3(p.xyx)*.1031);
      p3+=dot(p3,p3.yzx+33.33);
      return fract((p3.x+p3.y)*p3.z);
    }
    float h11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}
    mat2 rot(float t){float c=cos(t),s=sin(t);return mat2(c,-s,s,c);}
    float noise(vec2 p){
      vec2 i=floor(p),f=fract(p);
      float a=h12(i),b=h12(i+vec2(1,0)),c=h12(i+vec2(0,1)),d=h12(i+vec2(1,1));
      vec2 t=smoothstep(0.,1.,f);
      return mix(mix(a,b,t.x),mix(c,d,t.x),t.y);
    }
    float fbm(vec2 p){
      float v=0.,a=.5;
      for(int i=0;i<OCT;i++){v+=a*noise(p);p=rot(.45)*p*2.;a*=.5;}
      return v;
    }
    void main(){
      vec2 uv=gl_FragCoord.xy/iRes.xy;
      uv=2.*uv-1.; uv.x*=iRes.x/iRes.y;
      uv+=2.*fbm(uv*2.+.8*iTime*1.4)-1.;
      float dist=abs(uv.x);
      vec3 base=hsv2rgb(vec3(0.66,0.7,0.8));
      vec3 col=base*pow(mix(0.,0.07,h11(iTime*1.4))/dist,1.0)*0.55;
      gl_FragColor=vec4(col,1.0);
    }
  `;

  function compile(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    return s;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(vert, gl.VERTEX_SHADER));
  gl.attachShader(prog, compile(frag, gl.FRAGMENT_SHADER));
  gl.linkProgram(prog); gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes  = gl.getUniformLocation(prog, 'iRes');
  const uTime = gl.getUniformLocation(prog, 'iTime');
  const t0 = performance.now();

  (function render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (performance.now() - t0) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
  })();
})();

/* ============================================================
   STORAGE HELPERS
   ============================================================ */
const Store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },

  getHistory()   { return Store.get('phy_history', []); },
  addQuestion(q) {
    const history = Store.getHistory();
    history.unshift({ q, ts: Date.now() });
    if (history.length > 100) history.pop();
    Store.set('phy_history', history);
  },
  getStats() {
    return Store.get('phy_stats', { questions: 0, topics: new Set(), streak: 0, lastDate: null });
  },
  bumpQuestion() {
    const s = Store.get('phy_stats', { questions: 0, topics: [], streak: 0, lastDate: null, xp: 0 });
    s.questions = (s.questions || 0) + 1;
    const today = new Date().toDateString();
    if (s.lastDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      s.streak = s.lastDate === yesterday ? (s.streak || 0) + 1 : 1;
      s.lastDate = today;
        s.xp = (s.xp || 0) + 20; // daily streak bonus
      const studyDays = Store.get('phy_study_days', []);
      if (!studyDays.includes(today)) {
        studyDays.push(today);
        if (studyDays.length > 90) studyDays.shift();
        Store.set('phy_study_days', studyDays);
      }
    }
    s.xp = (s.xp || 0) + 10; // per question XP
    Store.set('phy_stats', s);
  },
  addTopic(topic) {
    const s = Store.get('phy_stats', { questions: 0, topics: [], streak: 0, lastDate: null });
    if (!Array.isArray(s.topics)) s.topics = [];
    if (!s.topics.includes(topic)) s.topics.push(topic);
    Store.set('phy_stats', s);
  },
};

/* ============================================================
   XP / LEVEL SYSTEM
   ============================================================ */
const XP_LEVELS = [
  { level: 1,  name: 'Beginner',    xp: 0    },
  { level: 2,  name: 'Learner',     xp: 100  },
  { level: 3,  name: 'Student',     xp: 250  },
  { level: 4,  name: 'Scholar',     xp: 500  },
  { level: 5,  name: 'Physicist',   xp: 900  },
  { level: 6,  name: 'Expert',      xp: 1400 },
  { level: 7,  name: 'Master',      xp: 2000 },
  { level: 8,  name: 'Grandmaster', xp: 3000 },
  { level: 9,  name: 'Legend',      xp: 5000 },
  { level: 10, name: 'Einstein',    xp: 8000 },
];

function getLevelInfo(totalXP) {
  let current = XP_LEVELS[0], next = XP_LEVELS[1];
  for (let i = XP_LEVELS.length - 1; i >= 0; i--) {
    if (totalXP >= XP_LEVELS[i].xp) {
      current = XP_LEVELS[i];
      next = XP_LEVELS[i + 1] || null;
      break;
    }
  }
  const progressXP = totalXP - current.xp;
  const rangeXP    = next ? next.xp - current.xp : 1;
  const pct        = next ? Math.min(100, Math.round((progressXP / rangeXP) * 100)) : 100;
  return { level: current.level, name: current.name, totalXP, progressXP, rangeXP, pct, next };
}

function addXP(amount) {
  const stats = Store.get('phy_stats', { questions: 0, topics: [], streak: 0, lastDate: null, xp: 0 });
  stats.xp = (stats.xp || 0) + amount;
  Store.set('phy_stats', stats);
}

function renderStreakCalendar() {
  const calEl = document.getElementById('streak-calendar');
  if (!calEl) return;

  const studyDays = new Set(Store.get('phy_study_days', []));
  const stats     = Store.get('phy_stats', { streak: 0 });
  const today     = new Date();
  const year      = today.getFullYear();
  const month     = today.getMonth();

  // Month label
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const monthEl = document.getElementById('cal-month-label');
  if (monthEl) monthEl.textContent = `${MONTHS[month]} ${year}`;

  // Streak count
  const streakEl = document.getElementById('streak-count');
  if (streakEl) streakEl.textContent = stats.streak || 0;

  // Days in month
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  // Day headers
  const headers = ['Su','Mo','Tu','We','Th','Fr','Sa']
    .map(d => `<div class="cal-header">${d}</div>`).join('');

  // Empty padding cells
  let cells = Array(firstDayOfWeek).fill('<div class="cal-day cal-empty"></div>').join('');

  for (let day = 1; day <= daysInMonth; day++) {
    const d       = new Date(year, month, day);
    const ds      = d.toDateString();
    const active  = studyDays.has(ds);
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    cells += `<div class="cal-day${active ? ' cal-active' : ''}${isToday ? ' cal-today' : ''}" title="${ds}">${day}</div>`;
  }

  calEl.innerHTML = headers + cells;
}

function renderXPBar() {
  const stats = Store.get('phy_stats', { xp: 0 });
  const info  = getLevelInfo(stats.xp || 0);
  document.getElementById('xp-level-num').textContent  = info.level;
  document.getElementById('xp-level-name').textContent = info.name;
  document.getElementById('xp-current').textContent    = `${info.totalXP} XP`;
  document.getElementById('xp-bar-fill').style.width   = `${info.pct}%`;
  document.getElementById('xp-next-label').textContent = info.next
    ? `${info.next.xp} XP to Level ${info.level + 1}`
    : 'Max Level!';
}

/* ============================================================
   ROUTER
   ============================================================ */
function navigate(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const page = document.getElementById(`page-${pageId}`);
  if (page) page.classList.add('active');

  const link = document.querySelector(`.nav-link[data-page="${pageId}"]`);
  if (link) link.classList.add('active');

  if (pageId === 'dashboard') renderDashboard();
  if (pageId === 'library')   loadLibrary();
  if (pageId === 'progress')  renderProgress();
}

// Wire up all nav links and CTA buttons
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-page]');
  if (link) {
    e.preventDefault();
    navigate(link.dataset.page);
  }
});

/* ============================================================
   DAILY MOTIVATIONAL BANNER
   ============================================================ */
const MOTIV_CACHE_KEY    = 'phy_motiv_v2';
const LAST_QUOTE_IDX_KEY = 'phy_last_quote_idx';

const MOTIV_QUOTES = [
  { text: 'Grind now, shine later.',                                  author: 'Gary Vee' },
  { text: "Turn your \"I can't\" into \"watch me.\"",                 author: 'Will Smith' },
  { text: 'Energy flows where focus goes.',                           author: 'Tony Robbins' },
  { text: 'Stress is temporary, results are permanent.',              author: 'The Rock' },
  { text: 'Your future self will thank you for not giving up.',       author: 'Michelle Obama' },
  { text: "Don't compete with others, compete with yesterday's you.", author: 'Jay Shetty' },
  { text: 'Study like a student, hustle like a boss.',                author: 'Casey Neistat' },
  { text: 'Sleep is important… but so is the bag.',                   author: 'Naval Ravikant' },
  { text: "If it's hard, it's worth it.",                             author: 'Robert Kiyosaki' },
  { text: 'Stop wishing, start doing.',                               author: 'Tony Robbins' },
  { text: 'Focused > busy.',                                          author: 'Tim Ferriss' },
  { text: 'One small win a day = massive glow-up.',                   author: 'Rachel Hollis' },
  { text: 'Progress, not perfection.',                                author: 'Marie Forleo' },
  { text: 'Make your goals bigger than your excuses.',                author: 'Les Brown' },
  { text: 'Your vibe attracts your tribe… and your grades.',          author: 'Simon Sinek' },
  { text: "Don't let distractions win.",                              author: 'James Clear' },
  { text: 'Sacrifice now, flex later.',                               author: 'Gary Vee' },
  { text: 'Energy spent complaining = energy wasted.',                author: 'Jay Shetty' },
  { text: "Today's struggle = tomorrow's story.",                     author: 'Brené Brown' },
  { text: 'Your grind will inspire someone.',                         author: 'Eric Thomas' },
  { text: 'Eat, sleep, study, repeat… dominate.',                     author: 'Kobe Bryant' },
  { text: "Don't scroll, build.",                                     author: 'Gary Vee' },
  { text: 'Hustle in silence, let results make noise.',               author: 'Frank Ocean' },
  { text: 'Invest in yourself. ROI: unlimited.',                      author: 'Naval Ravikant' },
  { text: 'Mindset > circumstances.',                                 author: 'Robin Sharma' },
  { text: 'Fail fast, learn faster.',                                 author: 'Reid Hoffman' },
  { text: 'Clout fades, skills stay.',                                author: 'Naval Ravikant' },
  { text: 'Outwork everyone, even on your worst days.',               author: 'Jocko Willink' },
  { text: 'Your 5-year self will thank you.',                         author: 'James Clear' },
  { text: "Legends aren't born—they're made.",                        author: 'Michael Jordan' },
];

function _pickQuote() {
  const last = parseInt(localStorage.getItem(LAST_QUOTE_IDX_KEY) ?? '-1', 10);
  let idx;
  do { idx = Math.floor(Math.random() * MOTIV_QUOTES.length); } while (idx === last && MOTIV_QUOTES.length > 1);
  localStorage.setItem(LAST_QUOTE_IDX_KEY, idx.toString());
  return MOTIV_QUOTES[idx];
}

function _buildMotivData(stats) {
  const today     = new Date().toDateString();
  const streak    = stats.streak || 0;
  const doneToday = stats.lastDate === today;
  const q         = _pickQuote();

  let feature;
  if (streak >= 2)  feature = `🔥 Keep your ${streak}-day streak alive!`;
  else if (!doneToday) feature = `🎯 Take today's challenge — ask your first question of the day!`;
  else              feature = `🏆 You're building something great — stay consistent!`;

  return { feature, quote: `"${q.text}" — ${q.author}` };
}

function renderMotivBanner() {
  const bannerEl = document.getElementById('motiv-banner');
  const quoteEl  = document.getElementById('motiv-quote');
  if (!bannerEl && !quoteEl) return;

  const today = new Date().toDateString();
  const cache = (() => { try { return JSON.parse(localStorage.getItem(MOTIV_CACHE_KEY)); } catch { return null; } })();
  let feature, quote;
  if (cache && cache.date === today) {
    ({ feature, quote } = cache);
  } else {
    const stats = Store.get('phy_stats', { questions: 0, topics: [], streak: 0, lastDate: null });
    ({ feature, quote } = _buildMotivData(stats));
    localStorage.setItem(MOTIV_CACHE_KEY, JSON.stringify({ date: today, feature, quote }));
  }

  if (bannerEl) { bannerEl.textContent = feature; bannerEl.style.display = ''; }
  if (quoteEl)  { quoteEl.textContent  = quote;   quoteEl.style.display  = ''; }
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
  renderXPBar();
  renderMotivBanner();
  const stats = Store.get('phy_stats', { questions: 0, topics: [], streak: 0 });
  document.getElementById('stat-questions').textContent = stats.questions || 0;
  document.getElementById('stat-topics').textContent = (stats.topics || []).length;
  document.getElementById('stat-streak').textContent = stats.streak || 0;

  const history = Store.getHistory().slice(0, 5);
  const container = document.getElementById('recent-list');

  if (!history.length) {
    container.innerHTML = '<div class="text-muted text-sm" style="padding:12px 0;">No questions yet. Ask your first one!</div>';
    return;
  }

  container.innerHTML = history.map(item => `
    <div class="recent-item" data-question="${escapeHtml(item.q)}">
      <span class="recent-item-icon">❓</span>
      <span class="recent-item-text">${escapeHtml(item.q)}</span>
      <span class="recent-item-time">${timeAgo(item.ts)}</span>
    </div>
  `).join('');

  container.querySelectorAll('.recent-item').forEach(el => {
    el.addEventListener('click', () => {
      const q = el.dataset.question;
      navigate('tutor');
      setTimeout(() => submitQuestion(q), 50);
    });
  });
}

/* ============================================================
   LIBRARY
   ============================================================ */
let _librarySources = null;
let _libraryActiveModality = 'all';

async function loadLibrary() {
  const container = document.getElementById('library-content');
  if (_librarySources !== null) { filterLibrary(); return; }

  container.innerHTML = '<div class="loading-state">Loading library…</div>';
  try {
    const resp = await fetch(`${API}/api/sources`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    _librarySources = data.sources || [];

    if (!_librarySources.length) {
      container.innerHTML = '<div class="empty-state">No documents found in the knowledge base.</div>';
      return;
    }

    _initLibraryControls();
    document.getElementById('library-toolbar').style.display = '';
    filterLibrary();
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:var(--danger)">Could not load library: ${err.message}<br><br>Make sure the backend is running:<br><code style="font-size:12px;color:var(--muted)">uvicorn server:app --reload</code></div>`;
  }
}

function _initLibraryControls() {
  document.getElementById('library-search').addEventListener('input', filterLibrary);
  document.getElementById('library-filter-pills').addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    _libraryActiveModality = pill.dataset.modality;
    filterLibrary();
  });
}

function filterLibrary() {
  const container = document.getElementById('library-content');
  const query = (document.getElementById('library-search').value || '').trim().toLowerCase();
  const modality = _libraryActiveModality;

  let filtered = _librarySources;
  if (modality !== 'all') filtered = filtered.filter(s => (s.modality || 'unknown') === modality);
  if (query) filtered = filtered.filter(s => (s.source || '').toLowerCase().includes(query));

  if (!filtered.length) {
    const hasFilter = query || modality !== 'all';
    container.innerHTML = `<div class="empty-state">${hasFilter ? 'No documents match your search.' : 'No documents found in the knowledge base.'}</div>`;
    return;
  }

  container.innerHTML = `<div class="library-grid">${filtered.map(s => {
    const mod = escapeHtml(s.modality || 'unknown');
    const pages = parseInt(s.page_count, 10) || 1;
    const openBtn = s.url
      ? `<button class="btn-sm" onclick="openResource('${escapeHtml(s.url)}')">Open</button>`
      : '';
    return `
    <div class="library-card">
      <div class="library-card-title" title="${escapeHtml(s.source)}">${escapeHtml(s.source)}</div>
      <div class="library-card-meta">
        <span class="badge badge-${mod}">${mod}</span>
        <span>${pages} page${pages !== 1 ? 's' : ''}</span>
        ${openBtn}
      </div>
    </div>`;
  }).join('')}</div>`;
}

function openResource(url) {
  window.open(url, '_blank');
}

/* ============================================================
   PROGRESS
   ============================================================ */
const BADGES = [
  { id: 'first',    icon: '🎯', name: 'First Step',    desc: 'Ask your first question',   threshold: 1 },
  { id: 'five',     icon: '⚡', name: 'Getting Going',  desc: 'Ask 5 questions',            threshold: 5 },
  { id: 'ten',      icon: '🔬', name: 'Curious Mind',  desc: 'Ask 10 questions',           threshold: 10 },
  { id: 'twenty',   icon: '🚀', name: 'On a Roll',     desc: 'Ask 20 questions',           threshold: 20 },
  { id: 'streak3',  icon: '🔥', name: 'Hot Streak',    desc: '3-day streak',               streakThreshold: 3 },
  { id: 'topics5',  icon: '📖', name: 'Wide Reader',   desc: 'Explore 5 topics',           topicThreshold: 5 },
];

function renderProgress() {
  renderStreakCalendar();
  const stats  = Store.get('phy_stats', { questions: 0, topics: [], streak: 0 });
  const history = Store.getHistory();

  // Badges
  const badgesGrid = document.getElementById('badges-grid');
  badgesGrid.innerHTML = BADGES.map(b => {
    let earned = false;
    if (b.threshold)        earned = (stats.questions || 0) >= b.threshold;
    if (b.streakThreshold)  earned = (stats.streak || 0) >= b.streakThreshold;
    if (b.topicThreshold)   earned = ((stats.topics || []).length) >= b.topicThreshold;
    return `
      <div class="badge-card ${earned ? 'earned' : 'locked'}">
        <div class="badge-icon">${b.icon}</div>
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>
      </div>`;
  }).join('');

  // History
  const historyList = document.getElementById('history-list');
  if (!history.length) {
    historyList.innerHTML = '<div class="text-muted text-sm">No questions yet.</div>';
    return;
  }
  historyList.innerHTML = history.map(item => `
    <div class="history-item">
      <div class="history-q">${escapeHtml(item.q)}</div>
      <div class="history-meta">${new Date(item.ts).toLocaleString()}</div>
    </div>
  `).join('');
}

/* ============================================================
   AI TUTOR — CHAT
   ============================================================ */
const form     = document.getElementById('input-form');
const input    = document.getElementById('question-input');
const sendBtn  = document.getElementById('send-btn');
const messages = document.getElementById('messages');
const conceptsList = document.getElementById('concepts-list');

let isStreaming = false;
let chatHistory = []; // tracks conversation for context

// Auto-resize textarea
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
});

// Submit on Enter (Shift+Enter = new line)
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.dispatchEvent(new Event('submit'));
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q || isStreaming) return;
  submitQuestion(q);
  input.value = '';
  input.style.height = 'auto';
});

document.getElementById('clear-btn').addEventListener('click', () => {
  chatHistory = [];
  messages.innerHTML = `
    <div class="chat-welcome">
      <span class="chat-welcome-icon">⚛</span>
      <h2>What would you like to revise?</h2>
      <p>Ask me anything from your A-Level Physics syllabus. I'll answer using your actual study materials.</p>
      <div class="welcome-chips">
        <div class="welcome-chip" data-q="Explain Young's modulus">Young's modulus</div>
        <div class="welcome-chip" data-q="How does radioactive decay work?">Radioactive decay</div>
        <div class="welcome-chip" data-q="Explain wave superposition">Wave superposition</div>
        <div class="welcome-chip" data-q="What is electric field strength?">Electric fields</div>
      </div>
    </div>`;
  conceptsList.innerHTML = '<div class="concepts-empty">Concepts appear as you chat.</div>';
  wireChips();
});

function wireChips() {
  document.querySelectorAll('.welcome-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.q;
      navigate('tutor');
      setTimeout(() => submitQuestion(q), 50);
    });
  });
}
wireChips();

async function submitQuestion(question) {
  if (isStreaming) return;

  // Remove welcome message if present
  const welcome = messages.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  // User bubble
  appendMessage('user', question);
  scrollToBottom();

  // Save to history
  Store.addQuestion(question);
  Store.bumpQuestion();

  // Show thinking indicator immediately
  const thinkingEl = appendThinking();
  isStreaming = true;
  sendBtn.disabled = true;

  let aiBubble = null;
  let cursor = null;
  let fullText = '';
  let sources  = [];

  try {
    const resp = await fetch(`${API}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, top_k: 5, language: document.getElementById('lang-select').value, history: chatHistory.slice(-6) }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
      throw new Error(err.detail || `HTTP ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        let evt;
        try { evt = JSON.parse(raw); } catch { continue; }

        if (evt.type === 'thinking') {
          setBuddyState('thinking');
        } else if (evt.type === 'chunk') {
          // First chunk — swap thinking indicator for AI bubble
          if (!aiBubble) {
            thinkingEl.remove();
            const result = appendAIBubble();
            aiBubble = result.bubble;
            cursor   = result.cursor;
            setBuddyState('responding');
          }
          fullText += evt.content;
          aiBubble.textContent = fullText;
          aiBubble.appendChild(cursor);
          scrollToBottom();
        } else if (evt.type === 'sources') {
          sources = evt.sources || [];
        } else if (evt.type === 'error') {
          throw new Error(evt.message);
        }
      }
    }
  } catch (err) {
    thinkingEl.remove();
    if (!aiBubble) {
      const result = appendAIBubble();
      aiBubble = result.bubble;
      cursor   = result.cursor;
    }
    fullText = `Error: ${err.message}\n\nMake sure the backend is running:\n  python -m uvicorn server:app --reload`;
    aiBubble.textContent = fullText;
  } finally {
    if (cursor) cursor.remove();
    // Render markdown + math now that streaming is complete
    if (aiBubble && fullText && !fullText.startsWith('Error:')) {
      renderMarkdown(aiBubble, fullText);
    }
    isStreaming = false;
    sendBtn.disabled = false;
    setBuddyState('idle');
  }

  // Save to conversation history
  if (fullText && !fullText.startsWith('Error:')) {
    chatHistory.push({ role: 'user', content: question });
    chatHistory.push({ role: 'assistant', content: fullText });
    if (chatHistory.length > 12) chatHistory = chatHistory.slice(-12);
  }

  // Render sources
  if (sources.length && aiBubble) {
    const section = buildSourcesSection(sources);
    aiBubble.parentElement.appendChild(section);
  }

  // Extract key concepts
  if (fullText) extractConcepts(fullText);
  scrollToBottom();
}

function appendThinking() {
  const div = document.createElement('div');
  div.className = 'message message-ai';
  div.innerHTML = `
    <div class="message-bubble" style="display:flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;">
      <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
      Thinking…
    </div>`;
  messages.appendChild(div);
  scrollToBottom();
  return div;
}

function appendMessage(role, text) {
  const div = document.createElement('div');
  div.className = `message message-${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  div.appendChild(bubble);
  div.appendChild(meta);
  messages.appendChild(div);
  return bubble;
}

function appendAIBubble() {
  const div = document.createElement('div');
  div.className = 'message message-ai';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const cursor = document.createElement('span');
  cursor.className = 'cursor';

  bubble.appendChild(cursor);
  div.appendChild(bubble);
  messages.appendChild(div);
  return { div, bubble, cursor };
}

function buildSourcesSection(sources) {
  const section = document.createElement('div');
  section.className = 'sources-section';

  const toggle = document.createElement('div');
  toggle.className = 'sources-toggle';
  toggle.innerHTML = `<span class="sources-toggle-icon">▶</span> ${sources.length} source${sources.length !== 1 ? 's' : ''} used`;

  const list = document.createElement('div');
  list.className = 'sources-list';

  sources.forEach(s => {
    const card = document.createElement('div');
    card.className = 'source-card';

    const score = Math.round((s.score || 0) * 100);
    const modality = escapeHtml(s.modality || 'unknown');
    const pageNum = s.page_number ? parseInt(s.page_number, 10) : null;

    card.innerHTML = `
      <div class="source-card-header">
        <span class="badge badge-${modality}">${modality}</span>
        <span style="color:var(--muted);font-size:12px;">${escapeHtml(s.source || '')}${pageNum ? ` · p.${pageNum}` : ''}</span>
        <span class="source-score">${score}%</span>
      </div>
      <div class="source-text">${escapeHtml((s.text || '').slice(0, 200))}</div>
    `;
    list.appendChild(card);
  });

  toggle.addEventListener('click', () => {
    const open = list.classList.toggle('open');
    toggle.querySelector('.sources-toggle-icon').classList.toggle('open', open);
  });

  section.appendChild(toggle);
  section.appendChild(list);
  return section;
}

function extractConcepts(text) {
  // Pull out CAPITALISED terms (A-Level style key terms) and common physics terms
  const capsMatches = [...text.matchAll(/\b([A-Z][A-Z]+(?:\s[A-Z][A-Z]+)?)\b/g)]
    .map(m => m[1])
    .filter(t => t.length > 2 && !['THE', 'AND', 'FOR', 'WITH', 'FROM', 'THIS', 'THAT', 'ARE', 'TL;DR', 'NOT', 'ONLY'].includes(t));

  const unique = [...new Set(capsMatches)].slice(0, 8);

  if (!unique.length) return;

  // Save to topics
  unique.forEach(t => Store.addTopic(t));

  conceptsList.innerHTML = unique.map(t => `
    <div class="concept-item">
      <span class="concept-dot"></span>${escapeHtml(t)}
    </div>
  `).join('');
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

/* ============================================================
   MARKDOWN + MATH RENDERING
   ============================================================ */
function preprocessMath(text) {
  // Convert display math: [ ... ] containing LaTeX (not already \[ \])
  text = text.replace(/(?<!\\)\[ *((?:[^\[\]]|\n)*?) *\](?!\])/g, (match, inner) => {
    if (/[\\^_={}]/.test(inner) && inner.trim().length > 0) return '\\[' + inner + '\\]';
    return match;
  });

  // Convert inline math: ( ... ) with balanced parens containing LaTeX
  // Uses character scan so nested parens like \cos(\theta) are handled correctly
  let result = '';
  let i = 0;
  while (i < text.length) {
    const prev = i > 0 ? text[i - 1] : '';
    if (text[i] === '(' && prev !== '\\') {
      // Find matching closing paren (balanced)
      let depth = 1, j = i + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '(' && text[j - 1] !== '\\') depth++;
        else if (text[j] === ')' && text[j - 1] !== '\\') depth--;
        j++;
      }
      if (depth === 0) {
        const inner = text.slice(i + 1, j - 1);
        if (inner.length <= 600 && /[\\^_{}]/.test(inner)) {
          result += '\\(' + inner + '\\)';
          i = j;
          continue;
        }
      }
    }
    result += text[i];
    i++;
  }
  return result;
}

function renderMarkdown(el, text) {
  // Fix LLM using ( ) and [ ] instead of \( \) and \[ \] for math
  text = preprocessMath(text);

  // Protect math from marked.js — replace with placeholders before parsing
  const mathBlocks = [];
  const placeholder = (i) => `\x02MATH${i}\x03`;

  // Display math first (longer delimiters)
  text = text.replace(/\\\[[\s\S]*?\\\]/g, (match) => {
    mathBlocks.push(match);
    return placeholder(mathBlocks.length - 1);
  });
  // Inline math
  text = text.replace(/\\\([\s\S]*?\\\)/g, (match) => {
    mathBlocks.push(match);
    return placeholder(mathBlocks.length - 1);
  });

  // Parse markdown (won't touch the placeholders)
  marked.setOptions({ breaks: true, gfm: true });
  el.innerHTML = marked.parse(text);

  // Restore math blocks into the rendered HTML
  el.innerHTML = el.innerHTML.replace(/\x02MATH(\d+)\x03/g, (_, i) => mathBlocks[+i]);

  // Render math with KaTeX
  if (window.renderMathInElement) {
    renderMathInElement(el, {
      delimiters: [
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true },
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ],
      throwOnError: false,
    });
  }
}

/* ============================================================
   UTILS
   ============================================================ */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000)  return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/* ============================================================
   QUIZ
   ============================================================ */
const Quiz = {
  difficulty: 'medium',
  numQuestions: 10,
  timerSeconds: 0,
  questions: [],
  current: 0,
  score: 0,
  timerInterval: null,
  timeLeft: 0,
  source: 'library',
};

// Source toggle (Study Library / My Notes)
document.querySelectorAll('[data-source]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-source]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Quiz.source = btn.dataset.source;
    document.getElementById('custom-notes-wrap').style.display =
      Quiz.source === 'notes' ? '' : 'none';
  });
});

// Selector button wiring (scoped to quiz-setup only)
document.querySelectorAll('#quiz-setup .diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#quiz-setup .diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Quiz.difficulty = btn.dataset.diff;
  });
});

document.querySelectorAll('.num-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.num-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Quiz.numQuestions = parseInt(btn.dataset.num);
  });
});

document.querySelectorAll('.timer-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Quiz.timerSeconds = parseInt(btn.dataset.timer);
  });
});

document.getElementById('start-quiz-btn').addEventListener('click', startQuiz);
document.getElementById('quit-quiz-btn').addEventListener('click', showSetup);
document.getElementById('next-q-btn').addEventListener('click', nextQuestion);
document.getElementById('retry-quiz-btn').addEventListener('click', () => {
  showSetup();
  // Re-use same questions
  setTimeout(() => beginActiveQuiz(Quiz.questions), 50);
});
document.getElementById('new-quiz-btn').addEventListener('click', showSetup);

function showSetup() {
  clearTimerInterval();
  document.getElementById('quiz-setup').style.display = '';
  document.getElementById('quiz-active').style.display = 'none';
  document.getElementById('quiz-results').style.display = 'none';
}

async function startQuiz() {
  const topic = document.getElementById('quiz-topic').value.trim();
  if (!topic) {
    document.getElementById('quiz-topic').focus();
    return;
  }

  let custom_context = null;
  if (Quiz.source === 'notes') {
    custom_context = document.getElementById('custom-notes').value.trim();
    if (!custom_context) {
      alert('Please paste your notes first.');
      return;
    }
  }

  const loading = document.getElementById('quiz-loading');
  const startBtn = document.getElementById('start-quiz-btn');
  loading.style.display = '';
  startBtn.disabled = true;

  try {
    const resp = await fetch(`${API}/api/quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        difficulty: Quiz.difficulty,
        num_questions: Quiz.numQuestions,
        language: document.getElementById('lang-select').value,
        custom_context,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    Quiz.questions = data.questions || [];
    if (!Quiz.questions.length) throw new Error('No questions returned');

    beginActiveQuiz(Quiz.questions);
  } catch (err) {
    alert(`Could not generate quiz: ${err.message}`);
  } finally {
    loading.style.display = 'none';
    startBtn.disabled = false;
  }
}

function beginActiveQuiz(questions) {
  Quiz.questions = questions;
  Quiz.current = 0;
  Quiz.score = 0;

  document.getElementById('quiz-setup').style.display = 'none';
  document.getElementById('quiz-active').style.display = '';
  document.getElementById('quiz-results').style.display = 'none';
  document.getElementById('q-total').textContent = questions.length;

  showQuestion();
}

function showQuestion() {
  clearTimerInterval();
  const q = Quiz.questions[Quiz.current];
  const total = Quiz.questions.length;

  document.getElementById('q-current').textContent = Quiz.current + 1;
  document.getElementById('quiz-progress-fill').style.width = `${((Quiz.current) / total) * 100}%`;
  document.getElementById('question-text').textContent = q.question;
  document.getElementById('question-feedback').style.display = 'none';
  document.getElementById('next-q-btn').style.display = 'none';

  // Render options
  const optList = document.getElementById('options-list');
  optList.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => selectAnswer(btn, i, q));
    optList.appendChild(btn);
  });

  // Timer
  const timerDisplay = document.getElementById('quiz-timer-display');
  if (Quiz.timerSeconds > 0) {
    Quiz.timeLeft = Quiz.timerSeconds;
    timerDisplay.style.display = '';
    timerDisplay.classList.remove('danger');
    document.getElementById('timer-val').textContent = Quiz.timeLeft;
    Quiz.timerInterval = setInterval(() => {
      Quiz.timeLeft--;
      document.getElementById('timer-val').textContent = Quiz.timeLeft;
      if (Quiz.timeLeft <= 10) timerDisplay.classList.add('danger');
      if (Quiz.timeLeft <= 0) {
        clearTimerInterval();
        // Time's up — mark wrong
        autoSelectWrong(q);
      }
    }, 1000);
  } else {
    timerDisplay.style.display = 'none';
  }
}

function selectAnswer(btn, idx, q) {
  clearTimerInterval();
  const allBtns = document.querySelectorAll('.option-btn');
  allBtns.forEach(b => b.disabled = true);

  const correctLetter = q.answer.trim().toUpperCase(); // "A", "B", "C", or "D"
  const correctIdx = ['A','B','C','D'].indexOf(correctLetter);

  if (idx === correctIdx) {
    btn.classList.add('correct');
    Quiz.score++;
    showFeedback(true, q.explanation);
    setBuddyState('celebrating');
  } else {
    btn.classList.add('wrong');
    if (correctIdx >= 0) allBtns[correctIdx].classList.add('correct');
    showFeedback(false, q.explanation);
    setBuddyState('wrong');
  }

  document.getElementById('next-q-btn').style.display = '';
}

function autoSelectWrong(q) {
  const allBtns = document.querySelectorAll('.option-btn');
  allBtns.forEach(b => b.disabled = true);
  const correctLetter = q.answer.trim().toUpperCase();
  const correctIdx = ['A','B','C','D'].indexOf(correctLetter);
  if (correctIdx >= 0) allBtns[correctIdx].classList.add('correct');
  showFeedback(false, `Time's up! ${q.explanation}`);
  document.getElementById('next-q-btn').style.display = '';
}

function showFeedback(correct, explanation) {
  const fb = document.getElementById('question-feedback');
  fb.style.display = '';
  fb.className = `question-feedback${correct ? '' : ' wrong'}`;
  fb.textContent = (correct ? '✓ Correct! ' : '✗ Wrong. ') + (explanation || '');
}

function nextQuestion() {
  Quiz.current++;
  if (Quiz.current >= Quiz.questions.length) {
    showResults();
  } else {
    showQuestion();
  }
}

function showResults() {
  clearTimerInterval();
  document.getElementById('quiz-active').style.display = 'none';
  document.getElementById('quiz-results').style.display = '';

  const total = Quiz.questions.length;
  const score = Quiz.score;
  const pct = Math.round((score / total) * 100);

  let emoji, msg;
  if (pct >= 80) { emoji = '🏆'; msg = 'Excellent work! You really know your stuff.'; }
  else if (pct >= 60) { emoji = '👍'; msg = 'Good effort! Review the ones you missed.'; }
  else if (pct >= 40) { emoji = '📖'; msg = 'Keep studying — you\'re getting there!'; }
  else { emoji = '💪'; msg = 'Don\'t give up — go through the material again.'; }

  document.getElementById('results-emoji').textContent = emoji;
  document.getElementById('results-score').textContent = `${score} / ${total} (${pct}%)`;
  document.getElementById('results-msg').textContent = msg;

  // Review
  const reviewList = document.getElementById('review-list');
  reviewList.innerHTML = '';
  // We need to track user answers — for now show all questions with correct answers
  Quiz.questions.forEach((q, i) => {
    const card = document.createElement('div');
    card.className = 'review-card';
    card.innerHTML = `
      <div class="review-q">${i + 1}. ${escapeHtml(q.question)}</div>
      <div class="review-ans">Correct answer: <strong>${escapeHtml(q.answer)}</strong> — ${escapeHtml(q.options[['A','B','C','D'].indexOf(q.answer.trim().toUpperCase())] || '')}</div>
      <div class="review-exp">${escapeHtml(q.explanation || '')}</div>
    `;
    reviewList.appendChild(card);
  });

  // Save to stats + award XP
  addXP(10 + Quiz.score * 5);
  Store.bumpQuestion();
}

function clearTimerInterval() {
  if (Quiz.timerInterval) {
    clearInterval(Quiz.timerInterval);
    Quiz.timerInterval = null;
  }
}

/* ============================================================
   REVISION MODE — PAST PAPERS
   ============================================================ */
const Revision = {
  papers: [],
  selectedPaper: null,
  timeLimitMinutes: 45,
  timerInterval: null,
  secondsRemaining: 0,
};

// Mode toggle tabs
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    if (tab.dataset.mode === 'active-recall') {
      switchToActiveRecallMode();
    } else if (tab.dataset.mode === 'past-papers') {
      switchToPastPapersMode();
    } else if (tab.dataset.mode === 'ta-practice') {
      switchToTAPracticeMode();
    }
  });
});

function switchToActiveRecallMode() {
  document.getElementById('quiz-setup').style.display = '';
  document.getElementById('revision-setup').style.display = 'none';
  document.getElementById('revision-active').style.display = 'none';
  document.getElementById('revision-markscheme').style.display = 'none';
  _hideTASections();
}

function switchToPastPapersMode() {
  document.getElementById('quiz-setup').style.display = 'none';
  document.getElementById('quiz-active').style.display = 'none';
  document.getElementById('quiz-results').style.display = 'none';
  document.getElementById('revision-setup').style.display = '';
  document.getElementById('revision-active').style.display = 'none';
  document.getElementById('revision-markscheme').style.display = 'none';
  _hideTASections();
  if (!Revision.papers.length) loadPapers();
}

function _hideTASections() {
  document.getElementById('ta-setup').style.display = 'none';
  document.getElementById('ta-view-paper').style.display = 'none';
  document.getElementById('ta-mcq-active').style.display = 'none';
  document.getElementById('ta-mcq-results').style.display = 'none';
  document.getElementById('ta-theory-active').style.display = 'none';
}

// Reset to Active Recall tab whenever the quiz page becomes active
new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.attributeName === 'class' && m.target.classList.contains('active')) {
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-active-recall').classList.add('active');
      switchToActiveRecallMode();
      revisionClearTimer();
    }
  }
}).observe(document.getElementById('page-quiz'), { attributes: true });

// Time limit selector
document.querySelectorAll('.time-limit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.time-limit-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Revision.timeLimitMinutes = parseInt(btn.dataset.minutes, 10);
  });
});

async function loadPapers() {
  const select = document.getElementById('revision-paper-select');
  const errDiv = document.getElementById('revision-papers-error');
  select.innerHTML = '<option value="">Loading…</option>';
  errDiv.style.display = 'none';
  try {
    const resp = await fetch(`${API}/api/papers`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    Revision.papers = data.papers || [];
    if (!Revision.papers.length) {
      select.innerHTML = '<option value="">No papers found — add PDFs to ./papers/</option>';
      return;
    }
    select.innerHTML = '<option value="">Select a paper…</option>' +
      Revision.papers.map(p =>
        `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name.replace(/_/g, ' '))}</option>`
      ).join('');
  } catch (err) {
    select.innerHTML = '<option value="">Failed to load</option>';
    errDiv.textContent = `Could not load papers: ${err.message}`;
    errDiv.style.display = '';
  }
}

// Preload iframes as soon as user picks a paper so Google Drive is ready by the time they click Start
document.getElementById('revision-paper-select').addEventListener('change', () => {
  const select = document.getElementById('revision-paper-select');
  const name = select.value;
  if (!name) return;
  const paper = Revision.papers.find(p => p.name === name);
  if (!paper) return;
  const qUrl = paper.questions_url;
  const msUrl = paper.markscheme_url;
  document.getElementById('revision-pdf-iframe').src = qUrl.startsWith('http') ? qUrl : `${API}${qUrl}`;
  document.getElementById('revision-ms-iframe').src = msUrl.startsWith('http') ? msUrl : `${API}${msUrl}`;
});

document.getElementById('start-revision-btn').addEventListener('click', () => {
  const select = document.getElementById('revision-paper-select');
  const name = select.value;
  if (!name) { select.focus(); return; }
  Revision.selectedPaper = Revision.papers.find(p => p.name === name);
  if (!Revision.selectedPaper) return;

  document.getElementById('revision-paper-name').textContent =
    Revision.selectedPaper.name.replace(/_/g, ' ');
  const qUrl = Revision.selectedPaper.questions_url;
  // Only update src if not already preloaded
  const iframe = document.getElementById('revision-pdf-iframe');
  const expectedSrc = qUrl.startsWith('http') ? qUrl : `${API}${qUrl}`;
  if (iframe.src !== expectedSrc) iframe.src = expectedSrc;

  document.getElementById('revision-setup').style.display = 'none';
  document.getElementById('revision-active').style.display = '';

  const timerDisplay = document.getElementById('revision-timer-display');
  if (Revision.timeLimitMinutes > 0) {
    Revision.secondsRemaining = Revision.timeLimitMinutes * 60;
    timerDisplay.style.display = '';
    timerDisplay.classList.remove('danger');
    updateRevisionTimerDisplay();
    Revision.timerInterval = setInterval(() => {
      Revision.secondsRemaining--;
      updateRevisionTimerDisplay();
      if (Revision.secondsRemaining <= 300) timerDisplay.classList.add('danger');
      if (Revision.secondsRemaining <= 0) { revisionClearTimer(); showMarkScheme(); }
    }, 1000);
  } else {
    timerDisplay.style.display = 'none';
  }
});

function updateRevisionTimerDisplay() {
  const mins = Math.floor(Math.max(0, Revision.secondsRemaining) / 60);
  const secs = Math.max(0, Revision.secondsRemaining) % 60;
  document.getElementById('revision-timer-val').textContent =
    `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function revisionClearTimer() {
  if (Revision.timerInterval) { clearInterval(Revision.timerInterval); Revision.timerInterval = null; }
}

document.getElementById('revision-submit-btn').addEventListener('click', showMarkScheme);

function showMarkScheme() {
  revisionClearTimer();
  if (!Revision.selectedPaper) return;
  document.getElementById('revision-ms-paper-name').textContent =
    Revision.selectedPaper.name.replace(/_/g, ' ') + ' — Mark Scheme';
  const msUrl = Revision.selectedPaper.markscheme_url;
  const msIframe = document.getElementById('revision-ms-iframe');
  const expectedMsSrc = msUrl.startsWith('http') ? msUrl : `${API}${msUrl}`;
  if (msIframe.src !== expectedMsSrc) msIframe.src = expectedMsSrc;
  document.getElementById('revision-active').style.display = 'none';
  document.getElementById('revision-markscheme').style.display = '';
}

function requestFullscreen(el) {
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (fn) fn.call(el);
}

document.getElementById('revision-expand-btn').addEventListener('click', () => {
  requestFullscreen(document.getElementById('revision-pdf-iframe'));
});

document.getElementById('revision-ms-expand-btn').addEventListener('click', () => {
  requestFullscreen(document.getElementById('revision-ms-iframe'));
});

document.getElementById('revision-done-btn').addEventListener('click', () => {
  revisionClearTimer();
  document.getElementById('revision-pdf-iframe').src = '';
  document.getElementById('revision-ms-iframe').src = '';
  Revision.selectedPaper = null;
  document.getElementById('revision-markscheme').style.display = 'none';
  document.getElementById('revision-setup').style.display = '';
});

/* ============================================================
   TA PRACTICE
   ============================================================ */
const TA = {
  tas: [],
  selectedTA: null,
  mode: 'view',            // 'view' | 'practice'
  difficulty: 'medium',
  numQuestions: 8,
  questions: [],
  current: 0,
  score: 0,
  timerInterval: null,
  timeLeft: 0,
  viewTimerInterval: null,
  viewSecondsRemaining: 0,
};

function switchToTAPracticeMode() {
  document.getElementById('quiz-setup').style.display = 'none';
  document.getElementById('quiz-active').style.display = 'none';
  document.getElementById('quiz-results').style.display = 'none';
  document.getElementById('revision-setup').style.display = 'none';
  document.getElementById('revision-active').style.display = 'none';
  document.getElementById('revision-markscheme').style.display = 'none';
  document.getElementById('ta-setup').style.display = '';
  document.getElementById('ta-view-paper').style.display = 'none';
  document.getElementById('ta-mcq-active').style.display = 'none';
  document.getElementById('ta-mcq-results').style.display = 'none';
  if (!TA.tas.length) loadTAs();
}

async function loadTAs() {
  const select = document.getElementById('ta-select');
  select.innerHTML = '<option value="">Loading…</option>';
  try {
    const resp = await fetch(`${API}/api/tas`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    TA.tas = data.tas || [];
    select.innerHTML = '<option value="">— Choose a TA —</option>';
    TA.tas.forEach(ta => {
      const opt = document.createElement('option');
      opt.value = ta.id;
      opt.textContent = ta.name;
      select.appendChild(opt);
    });
  } catch (err) {
    select.innerHTML = '<option value="">Failed to load TAs</option>';
  }
}

document.getElementById('ta-select').addEventListener('change', () => {
  const id = document.getElementById('ta-select').value;
  const banner = document.getElementById('ta-info-banner');
  if (!id) { banner.style.display = 'none'; TA.selectedTA = null; return; }
  TA.selectedTA = TA.tas.find(t => t.id === id) || null;
  if (!TA.selectedTA) { banner.style.display = 'none'; return; }
  document.getElementById('ta-info-chapter').textContent = TA.selectedTA.chapter;
  document.getElementById('ta-info-topic').textContent = TA.selectedTA.topic;
  banner.style.display = '';
  // Preload PDF
  if (TA.selectedTA.pdf_url) {
    const iframe = document.getElementById('ta-pdf-iframe');
    if (iframe.src !== TA.selectedTA.pdf_url) iframe.src = TA.selectedTA.pdf_url;
  }
});

// TA mode toggle (View / Practice)
document.querySelectorAll('[data-ta-mode]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-ta-mode]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    TA.mode = btn.dataset.taMode;
    document.getElementById('ta-practice-options').style.display = TA.mode === 'practice' ? '' : 'none';
  });
});

// TA difficulty buttons (scoped to ta-setup)
document.querySelectorAll('#ta-setup [data-diff]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#ta-setup [data-diff]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    TA.difficulty = btn.dataset.diff;
  });
});

// TA num-questions slider
document.getElementById('ta-num-slider').addEventListener('input', function () {
  TA.numQuestions = parseInt(this.value);
  document.getElementById('ta-num-label').textContent = this.value;
});

document.getElementById('ta-start-btn').addEventListener('click', startTA);

const THEORY_TYPE_META = {
  concept:    { color: '#6c63ff', bg: 'rgba(108,99,255,0.08)',  label: '💡' },
  formula:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  label: '📐' },
  definition: { color: '#00c48c', bg: 'rgba(0,196,140,0.08)',   label: '📖' },
  tip:        { color: '#ec4899', bg: 'rgba(236,72,153,0.08)',  label: '⭐' },
};

async function startTATheory() {
  const ta = TA.selectedTA;
  document.getElementById('ta-theory-title').textContent = ta.name;
  document.getElementById('ta-setup').style.display = 'none';
  document.getElementById('ta-theory-active').style.display = '';
  document.getElementById('ta-theory-loading').style.display = '';
  document.getElementById('ta-theory-content').style.display = 'none';
  document.getElementById('ta-theory-content').innerHTML = '';
  try {
    const r = await fetch(`${API}/api/theory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: ta.topic, chapter: ta.chapter }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    document.getElementById('ta-theory-loading').style.display = 'none';
    renderTheorySections(data.sections || []);
    document.getElementById('ta-theory-content').style.display = '';
    addXP(15);
  } catch {
    document.getElementById('ta-theory-loading').textContent = 'Failed to load theory notes. Try again.';
  }
}

function renderTheorySections(sections) {
  const container = document.getElementById('ta-theory-content');
  container.innerHTML = sections.map(sec => {
    const meta = THEORY_TYPE_META[sec.type] || THEORY_TYPE_META.concept;
    const cards = sec.items.map(item => `
      <div class="theory-card" style="border-color:${meta.color}20;background:${meta.bg};">
        <div class="theory-card-title" style="color:${meta.color};">${meta.label} ${escapeHtml(item.title)}</div>
        <div class="theory-card-body">${escapeHtml(item.body)}</div>
      </div>
    `).join('');
    return `
      <div class="theory-section">
        <h3 class="theory-section-title" style="color:${meta.color};">${escapeHtml(sec.title)}</h3>
        <div class="theory-grid">${cards}</div>
      </div>
    `;
  }).join('');
}

function startTA() {
  if (!TA.selectedTA) { alert('Please select a TA first.'); return; }
  if (TA.mode === 'view')        startTAViewPaper();
  else if (TA.mode === 'theory') startTATheory();
  else                           startTAPractice();
}

function startTAViewPaper() {
  const ta = TA.selectedTA;
  document.getElementById('ta-view-paper-name').textContent = ta.name;
  const iframe = document.getElementById('ta-pdf-iframe');
  if (ta.pdf_url && iframe.src !== ta.pdf_url) iframe.src = ta.pdf_url;
  document.getElementById('ta-setup').style.display = 'none';
  document.getElementById('ta-view-paper').style.display = '';
  // 45-min countdown
  TA.viewSecondsRemaining = 45 * 60;
  taViewClearTimer();
  updateTAViewTimer();
  TA.viewTimerInterval = setInterval(() => {
    TA.viewSecondsRemaining--;
    updateTAViewTimer();
    if (TA.viewSecondsRemaining <= 0) taViewClearTimer();
  }, 1000);
}

function updateTAViewTimer() {
  const mins = Math.floor(Math.max(0, TA.viewSecondsRemaining) / 60);
  const secs = Math.max(0, TA.viewSecondsRemaining) % 60;
  document.getElementById('ta-view-timer').textContent =
    `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function taViewClearTimer() {
  if (TA.viewTimerInterval) { clearInterval(TA.viewTimerInterval); TA.viewTimerInterval = null; }
}

async function startTAPractice() {
  const ta = TA.selectedTA;
  const startBtn = document.getElementById('ta-start-btn');
  startBtn.disabled = true;
  startBtn.textContent = 'Generating…';
  try {
    const resp = await fetch(`${API}/api/quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: ta.topic,
        difficulty: TA.difficulty,
        num_questions: TA.numQuestions,
        language: document.getElementById('lang-select').value,
      }),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.detail || `HTTP ${resp.status}`); }
    const data = await resp.json();
    TA.questions = data.questions || [];
    if (!TA.questions.length) throw new Error('No questions returned');
    beginTAQuiz(TA.questions);
  } catch (err) {
    alert(`Could not generate TA quiz: ${err.message}`);
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = 'Start';
  }
}

function beginTAQuiz(questions) {
  TA.questions = questions;
  TA.current = 0;
  TA.score = 0;
  document.getElementById('ta-setup').style.display = 'none';
  document.getElementById('ta-mcq-active').style.display = '';
  document.getElementById('ta-mcq-results').style.display = 'none';
  showTAQuestion();
}

function showTAQuestion() {
  clearTATimerInterval();
  const q = TA.questions[TA.current];
  const total = TA.questions.length;
  document.getElementById('ta-progress-text').textContent = `${TA.current + 1} / ${total}`;
  document.getElementById('ta-progress-fill').style.width = `${(TA.current / total) * 100}%`;
  document.getElementById('ta-question-text').textContent = q.question;
  document.getElementById('ta-next-btn').style.display = 'none';
  const optList = document.getElementById('ta-options');
  optList.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => selectTAAnswer(btn, i, q));
    optList.appendChild(btn);
  });
}

function selectTAAnswer(btn, idx, q) {
  clearTATimerInterval();
  const allBtns = document.querySelectorAll('#ta-options .option-btn');
  allBtns.forEach(b => b.disabled = true);
  const correctLetter = q.answer.trim().toUpperCase();
  const correctIdx = ['A','B','C','D'].indexOf(correctLetter);
  if (idx === correctIdx) {
    btn.classList.add('correct');
    TA.score++;
    setBuddyState('celebrating');
  } else {
    btn.classList.add('wrong');
    if (correctIdx >= 0) allBtns[correctIdx].classList.add('correct');
    setBuddyState('wrong');
  }
  document.getElementById('ta-next-btn').style.display = '';
}

document.getElementById('ta-next-btn').addEventListener('click', () => {
  TA.current++;
  if (TA.current >= TA.questions.length) {
    showTAResults();
  } else {
    showTAQuestion();
  }
});

function showTAResults() {
  clearTATimerInterval();
  document.getElementById('ta-mcq-active').style.display = 'none';
  document.getElementById('ta-mcq-results').style.display = '';
  const total = TA.questions.length;
  const pct = Math.round((TA.score / total) * 100);
  document.getElementById('ta-score-fraction').textContent = `${TA.score} / ${total}`;
  document.getElementById('ta-score-pct').textContent = `${pct}%`;
  let msg;
  if (pct >= 80) msg = 'Excellent work!';
  else if (pct >= 60) msg = 'Good effort — review what you missed.';
  else if (pct >= 40) msg = 'Keep studying — you\'re getting there!';
  else msg = 'Go through the material again.';
  document.getElementById('ta-results-message').textContent = msg;
  const breakdown = document.getElementById('ta-results-breakdown');
  breakdown.innerHTML = '';
  TA.questions.forEach((q, i) => {
    const card = document.createElement('div');
    card.className = 'review-card';
    card.innerHTML = `<div class="review-q">${i + 1}. ${escapeHtml(q.question)}</div>
      <div class="review-ans">Answer: <strong>${escapeHtml(q.answer)}</strong> — ${escapeHtml(q.options[['A','B','C','D'].indexOf(q.answer.trim().toUpperCase())] || '')}</div>
      <div class="review-exp">${escapeHtml(q.explanation || '')}</div>`;
    breakdown.appendChild(card);
  });
  addXP(10 + TA.score * 5);
  Store.bumpQuestion();
}

function clearTATimerInterval() {
  if (TA.timerInterval) { clearInterval(TA.timerInterval); TA.timerInterval = null; }
}

document.getElementById('ta-view-done-btn').addEventListener('click', () => {
  taViewClearTimer();
  document.getElementById('ta-pdf-iframe').src = '';
  document.getElementById('ta-view-paper').style.display = 'none';
  document.getElementById('ta-setup').style.display = '';
});

document.getElementById('ta-view-expand-btn').addEventListener('click', () => {
  requestFullscreen(document.getElementById('ta-pdf-iframe'));
});

document.getElementById('ta-expand-btn').addEventListener('click', () => {
  requestFullscreen(document.getElementById('ta-mcq-active'));
});

document.getElementById('ta-retry-btn').addEventListener('click', () => {
  beginTAQuiz(TA.questions);
});

document.getElementById('ta-new-ta-btn').addEventListener('click', () => {
  document.getElementById('ta-mcq-results').style.display = 'none';
  document.getElementById('ta-setup').style.display = '';
});

document.getElementById('ta-theory-done-btn').addEventListener('click', () => {
  document.getElementById('ta-theory-active').style.display = 'none';
  document.getElementById('ta-setup').style.display = '';
});

/* ============================================================
   STUDY BUDDY
   ============================================================ */
const Buddy = {
  name: '',
  colour: '#6c63ff',
  state: 'idle',
  _revertTimer: null,
};

function buddySVG(colour) {
  const c = colour || Buddy.colour;
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <!-- Hair spikes (behind face) -->
  <polygon points="50,2 43,22 57,22" fill="${c}" stroke="#1a1a1a" stroke-width="2" stroke-linejoin="round"/>
  <polygon points="28,6 27,28 40,24" fill="${c}" stroke="#1a1a1a" stroke-width="2" stroke-linejoin="round"/>
  <polygon points="72,6 60,24 73,28" fill="${c}" stroke="#1a1a1a" stroke-width="2" stroke-linejoin="round"/>
  <polygon points="12,18 17,40 28,32" fill="${c}" stroke="#1a1a1a" stroke-width="2" stroke-linejoin="round"/>
  <polygon points="88,18 83,40 72,32" fill="${c}" stroke="#1a1a1a" stroke-width="2" stroke-linejoin="round"/>
  <polygon points="6,38 14,56 22,46" fill="${c}" stroke="#1a1a1a" stroke-width="2" stroke-linejoin="round"/>
  <polygon points="94,38 86,56 78,46" fill="${c}" stroke="#1a1a1a" stroke-width="2" stroke-linejoin="round"/>
  <!-- Hair base blob -->
  <ellipse cx="50" cy="44" rx="35" ry="27" fill="${c}" stroke="#1a1a1a" stroke-width="2.5"/>
  <!-- Face -->
  <circle cx="50" cy="65" r="26" fill="#e8c99a" stroke="#1a1a1a" stroke-width="2.5"/>
  <!-- Sunglasses left lens -->
  <circle cx="38" cy="61" r="11" fill="#111111" stroke="#1a1a1a" stroke-width="1.5"/>
  <!-- Sunglasses right lens -->
  <circle cx="62" cy="61" r="11" fill="#111111" stroke="#1a1a1a" stroke-width="1.5"/>
  <!-- Bridge -->
  <rect x="47" y="58" width="6" height="3" fill="#1a1a1a"/>
  <!-- Tongue -->
  <ellipse cx="50" cy="81" rx="6" ry="5" fill="#ffb3c6"/>
  <line x1="50" y1="78" x2="50" y2="84" stroke="#ff7aa2" stroke-width="1.5"/>
</svg>`;
}

function renderBuddySVG(colour) {
  const wrap = document.getElementById('buddy-svg-wrap');
  if (wrap) wrap.innerHTML = buddySVG(colour || Buddy.colour);
  const modalSvg = document.getElementById('buddy-modal-svg');
  if (modalSvg) modalSvg.innerHTML = buddySVG(colour || Buddy.colour);
}

function setBuddyState(state) {
  const wrap = document.getElementById('buddy-svg-wrap');
  const thought = document.getElementById('buddy-thought');
  if (!wrap) return;
  if (Buddy._revertTimer) { clearTimeout(Buddy._revertTimer); Buddy._revertTimer = null; }
  wrap.className = `buddy-svg-wrap ${state}`;
  Buddy.state = state;
  if (thought) thought.style.display = state === 'thinking' ? 'flex' : 'none';
  if (state === 'celebrating' || state === 'wrong') {
    Buddy._revertTimer = setTimeout(() => setBuddyState('idle'), 2200);
  }
}

function initBuddy() {
  const name = localStorage.getItem('phy_buddy_name') || '';
  const colour = localStorage.getItem('phy_buddy_colour') || '#6c63ff';
  Buddy.colour = colour;
  const picker = document.getElementById('buddy-colour-picker');
  if (picker) picker.value = colour;
  renderBuddySVG(colour);
  if (!name) {
    document.getElementById('buddy-modal').style.display = 'flex';
  } else {
    Buddy.name = name;
    document.getElementById('buddy-name-label').textContent = name;
    document.getElementById('buddy-widget').style.display = 'flex';
    setBuddyState('idle');
  }
}

document.getElementById('buddy-name-save-btn').addEventListener('click', () => {
  const name = document.getElementById('buddy-name-input').value.trim();
  if (!name) { document.getElementById('buddy-name-input').focus(); return; }
  localStorage.setItem('phy_buddy_name', name);
  Buddy.name = name;
  document.getElementById('buddy-modal').style.display = 'none';
  document.getElementById('buddy-name-label').textContent = name;
  document.getElementById('buddy-widget').style.display = 'flex';
  setBuddyState('celebrating');
});

document.getElementById('buddy-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('buddy-name-save-btn').click();
});

document.getElementById('buddy-colour-picker').addEventListener('input', function () {
  Buddy.colour = this.value;
  localStorage.setItem('phy_buddy_colour', this.value);
  renderBuddySVG(this.value);
});

/* ============================================================
   INIT
   ============================================================ */
initAuth();
renderDashboard();
initBuddy();
