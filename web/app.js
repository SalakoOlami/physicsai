/* ============================================================
   app.js — PhysicsAI Web App
   ============================================================ */

const API = 'http://localhost:8000';

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
  messages.innerHTML = `
    <div class="chat-welcome">
      <span class="chat-welcome-icon">🔬</span>
      <h2>What would you like to revise?</h2>
      <p>Ask me anything from Chapters 9–12. I'll answer using your actual study materials.</p>
    </div>`;
  conceptsList.innerHTML = '<div class="concepts-empty">Concepts will appear here as you chat.</div>';
});

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
      body: JSON.stringify({ question, top_k: 5, language: document.getElementById('lang-select').value }),
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
    isStreaming = false;
    sendBtn.disabled = false;
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
   INIT
   ============================================================ */
renderDashboard();
