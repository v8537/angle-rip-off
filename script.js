// ---- NY-day helpers -------------------------------------------------------

const NY_TZ = 'America/New_York';
const LAUNCH_DATE = '2026-07-29'; // day #1

function nyDateParts() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date())) {
    if (p.type !== 'literal') parts[p.type] = parseInt(p.value, 10);
  }
  // hour12:false can report 24 for midnight in some engines; normalize.
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

function todayKeyNY() {
  const p = nyDateParts();
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

function dayNumber(dateKey) {
  const [ly, lm, ld] = LAUNCH_DATE.split('-').map(Number);
  const [y, m, d] = dateKey.split('-').map(Number);
  const launch = Date.UTC(ly, lm - 1, ld);
  const today = Date.UTC(y, m - 1, d);
  return Math.round((today - launch) / 86400000) + 1;
}

function secondsUntilNYMidnight() {
  const p = nyDateParts();
  return (23 - p.hour) * 3600 + (59 - p.minute) * 60 + (60 - p.second);
}

// ---- Deterministic daily angle --------------------------------------------

function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function angleForDate(dateKey) {
  const seedFn = hashString(`angle-rip-off-${dateKey}`);
  const rand = mulberry32(seedFn());
  const degrees = Math.floor(rand() * 361); // 0..360 inclusive
  const radians = degrees * Math.PI / 180;
  return { degrees, radians };
}

// ---- Game state -------------------------------------------------------------

const MAX_GUESSES = 10;
// Correct means the guess rounds to the same 4-decimal-place radian value as the target,
// i.e. within half the last digit's step (0.0001 / 2).
const TOLERANCE = 0.00005;

// Ordered closest-first; first match wins. Thresholds are max |diff| in radians.
const WARMTH_TIERS = [
  { max: TOLERANCE, label: 'correct', emoji: '✅', className: 'correct' },
  { max: 0.15, label: 'boiling', emoji: '🥵', className: 'boiling' },
  { max: 0.4, label: 'hot', emoji: '🔥', className: 'hot' },
  { max: 0.9, label: 'warm', emoji: '🌤️', className: 'warm' },
  { max: Infinity, label: 'cold', emoji: '🧊', className: 'cold' },
];

function warmthFor(guess) {
  const diff = Math.abs(guess - targetRadians);
  return WARMTH_TIERS.find((t) => diff <= t.max);
}

const todayKey = todayKeyNY();
const { radians: targetRadians } = angleForDate(todayKey);
const storageKey = `angle-rip-off:${todayKey}`;

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { guesses: [], done: false, won: false };
    return JSON.parse(raw);
  } catch {
    return { guesses: [], done: false, won: false };
  }
}

function saveState(state) {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

let state = loadState();

// ---- DOM ----------------------------------------------------------------

const dayNumberEl = document.getElementById('day-number');
const guessInput = document.getElementById('guess-input');
const guessBtn = document.getElementById('guess-btn');
const guessesLeftEl = document.getElementById('guesses-left');
const hintText = document.getElementById('hint-text');
const historyList = document.getElementById('history-list');
const resultPanel = document.getElementById('result-panel');
const resultTitle = document.getElementById('result-title');
const resultDetail = document.getElementById('result-detail');
const shareText = document.getElementById('share-text');
const copyBtn = document.getElementById('copy-btn');
const copyConfirm = document.getElementById('copy-confirm');
const countdownEl = document.getElementById('countdown');

dayNumberEl.textContent = `angle rip-off #${dayNumber(todayKey)}`;

function drawAngle() {
  const R = 80;
  // SVG y grows downward, so flip to measure counter-clockwise like a standard unit circle.
  const tipX = R * Math.cos(targetRadians);
  const tipY = -R * Math.sin(targetRadians);

  document.getElementById('angle-ray').setAttribute('x2', tipX.toFixed(3));
  document.getElementById('angle-ray').setAttribute('y2', tipY.toFixed(3));
  document.getElementById('angle-tip').setAttribute('cx', tipX.toFixed(3));
  document.getElementById('angle-tip').setAttribute('cy', tipY.toFixed(3));

  // Thin sweep track from 0 to the target angle -- an open arc, not a filled wedge or full circle.
  const largeArc = targetRadians > Math.PI ? 1 : 0;
  const d = `M ${R} 0 A ${R} ${R} 0 ${largeArc} 0 ${tipX.toFixed(3)} ${tipY.toFixed(3)}`;
  document.getElementById('angle-arc').setAttribute('d', d);
}

drawAngle();

function directionArrow(guess) {
  if (Math.abs(guess - targetRadians) <= TOLERANCE) return '';
  return guess < targetRadians ? '↑ higher' : '↓ lower';
}

function renderHistory() {
  historyList.innerHTML = '';
  state.guesses.forEach((g, i) => {
    const li = document.createElement('li');
    const warmth = warmthFor(g);
    li.classList.add(warmth.className);
    li.innerHTML = `
      <span class="val">#${i + 1}: ${g.toFixed(4)} rad</span>
      <span class="dir">${warmth.emoji} ${warmth.label}${warmth.className === 'correct' ? '' : ` · ${directionArrow(g)}`}</span>
    `;
    historyList.appendChild(li);
  });
}

function buildShareText() {
  const grid = state.guesses.map((g) => warmthFor(g).emoji).join('');
  const attempts = state.won ? `${state.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  return `angle rip-off #${dayNumber(todayKey)} — ${attempts}\n${grid}\nhttps://v8537.github.io/angle-rip-off/`;
}

function renderResult() {
  resultPanel.hidden = false;
  guessInput.disabled = true;
  guessBtn.disabled = true;

  resultTitle.textContent = state.won
    ? `solved in ${state.guesses.length}/${MAX_GUESSES}`
    : `out of guesses`;
  resultDetail.textContent = `angle was ${targetRadians.toFixed(4)} radians.`;
  shareText.textContent = buildShareText();
}

function renderGuessesLeft() {
  guessesLeftEl.textContent = MAX_GUESSES - state.guesses.length;
}

function submitGuess() {
  if (state.done) return;
  const raw = guessInput.value.trim();
  if (raw === '') return;
  const val = parseFloat(raw);
  if (Number.isNaN(val) || val < 0 || val > 2 * Math.PI + 0.01) {
    hintText.textContent = 'value must be between 0 and 2π (6.2832).';
    hintText.style.color = 'var(--bad)';
    return;
  }
  hintText.style.color = '';

  state.guesses.push(val);
  const correct = Math.abs(val - targetRadians) <= TOLERANCE;

  if (correct) {
    state.won = true;
    state.done = true;
  } else if (state.guesses.length >= MAX_GUESSES) {
    state.done = true;
  }

  saveState(state);
  guessInput.value = '';
  render();
  if (!state.done) guessInput.focus();
}

function render() {
  renderHistory();
  renderGuessesLeft();

  if (state.done) {
    renderResult();
    hintText.hidden = true;
  } else {
    hintText.hidden = false;
    guessInput.disabled = false;
    guessBtn.disabled = false;
  }
}

function tickCountdown() {
  let secs = secondsUntilNYMidnight();
  if (secs < 0) secs = 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  countdownEl.textContent =
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

guessBtn.addEventListener('click', submitGuess);
guessInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitGuess();
});

copyBtn.addEventListener('click', async () => {
  const text = buildShareText();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API unavailable (e.g. non-HTTPS context) -- fall back to a manual selection.
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  copyConfirm.hidden = false;
  setTimeout(() => { copyConfirm.hidden = true; }, 1800);
});

render();
tickCountdown();
setInterval(tickCountdown, 1000);
