/* ============================================================
   app.js — PhysicsAI Web App
   ============================================================ */

const API = 'https://physicsai-5eih.onrender.com';

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
    const s = Store.get('phy_stats', { questions: 0, topics: [], streak: 0, lastDate: null });
    s.questions = (s.questions || 0) + 1;
    const today = new Date().toDateString();
    if (s.lastDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      s.streak = s.lastDate === yesterday ? (s.streak || 0) + 1 : 1;
      s.lastDate = today;
    }
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
   DASHBOARD
   ============================================================ */
function renderDashboard() {
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
async function loadLibrary() {
  const container = document.getElementById('library-content');
  container.innerHTML = '<div class="loading-state">Loading library…</div>';

  try {
    const resp = await fetch(`${API}/api/sources`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const sources = data.sources || [];

    if (!sources.length) {
      container.innerHTML = '<div class="empty-state">No documents found in the knowledge base.</div>';
      return;
    }

    container.innerHTML = `<div class="library-grid">${sources.map(s => {
      const mod = escapeHtml(s.modality || 'unknown');
      const pages = parseInt(s.page_count, 10) || 1;
      return `
      <div class="library-card">
        <div class="library-card-title" title="${escapeHtml(s.source)}">${escapeHtml(s.source)}</div>
        <div class="library-card-meta">
          <span class="badge badge-${mod}">${mod}</span>
          <span>${pages} page${pages !== 1 ? 's' : ''}</span>
        </div>
      </div>
    `;}).join('')}</div>`;
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:var(--danger)">Could not load library: ${err.message}<br><br>Make sure the backend is running:<br><code style="font-size:12px;color:var(--muted)">uvicorn server:app --reload</code></div>`;
  }
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
          // already showing spinner, nothing extra needed
        } else if (evt.type === 'chunk') {
          // First chunk — swap thinking indicator for AI bubble
          if (!aiBubble) {
            thinkingEl.remove();
            const result = appendAIBubble();
            aiBubble = result.bubble;
            cursor   = result.cursor;
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
};

// Selector button wiring
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
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
  } else {
    btn.classList.add('wrong');
    if (correctIdx >= 0) allBtns[correctIdx].classList.add('correct');
    showFeedback(false, q.explanation);
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

  // Save to stats
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
    } else {
      switchToPastPapersMode();
    }
  });
});

function switchToActiveRecallMode() {
  document.getElementById('quiz-setup').style.display = '';
  document.getElementById('revision-setup').style.display = 'none';
  document.getElementById('revision-active').style.display = 'none';
  document.getElementById('revision-markscheme').style.display = 'none';
}

function switchToPastPapersMode() {
  document.getElementById('quiz-setup').style.display = 'none';
  document.getElementById('quiz-active').style.display = 'none';
  document.getElementById('quiz-results').style.display = 'none';
  document.getElementById('revision-setup').style.display = '';
  document.getElementById('revision-active').style.display = 'none';
  document.getElementById('revision-markscheme').style.display = 'none';
  if (!Revision.papers.length) loadPapers();
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

document.getElementById('start-revision-btn').addEventListener('click', () => {
  const select = document.getElementById('revision-paper-select');
  const name = select.value;
  if (!name) { select.focus(); return; }
  Revision.selectedPaper = Revision.papers.find(p => p.name === name);
  if (!Revision.selectedPaper) return;

  document.getElementById('revision-paper-name').textContent =
    Revision.selectedPaper.name.replace(/_/g, ' ');
  document.getElementById('revision-pdf-iframe').src = `${API}${Revision.selectedPaper.questions_url}`;

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
  document.getElementById('revision-ms-iframe').src = `${API}${Revision.selectedPaper.markscheme_url}`;
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
   INIT
   ============================================================ */
renderDashboard();
