// ---- NY-day helpers -------------------------------------------------------

const NY_TZ = 'America/New_York';
const LAUNCH_DATE = '2026-07-28';

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

const SEED_SALT = 'v2';

function angleForDate(dateKey) {
  const seedFn = hashString(`angle-rip-off-${SEED_SALT}-${dateKey}`);
  const rand = mulberry32(seedFn());
  const degrees = Math.floor(rand() * 361); // 0..360 inclusive
  const radians = degrees * Math.PI / 180;
  return { degrees, radians };
}

// ---- Game state -------------------------------------------------------------

const MAX_GUESSES = 1;
// Correct means the guess rounds to the same 4-decimal-place radian value as the target,
// i.e. within half the last digit's step (0.0001 / 2).
const TOLERANCE = 0.00005;

// Post-game grading only -- ordered closest-first, first match wins. Thresholds are max
// |diff| in radians. Never shown while guesses are still in progress.
const WARMTH_TIERS = [
  { max: TOLERANCE, label: 'exact', className: 'correct' },
  { max: 0.15, label: 'boiling', className: 'boiling' },
  { max: 0.4, label: 'hot', className: 'hot' },
  { max: 0.9, label: 'warm', className: 'warm' },
  { max: Infinity, label: 'cold', className: 'cold' },
];

function warmthFor(guess) {
  const diff = Math.abs(guess - targetRadians);
  return WARMTH_TIERS.find((t) => diff <= t.max);
}

// Score scales linearly from 100 (exact) to 0 (diff >= pi, i.e. no better than the worst
// possible case on a 0..2*pi range).
function baseScoreFor(diff) {
  return Math.round(Math.max(0, 1 - diff / Math.PI) * 100);
}

function bestGuessDiff(guesses) {
  return Math.min(...guesses.map((g) => Math.abs(g - targetRadians)));
}

// Regional score adjustment: any visitor IP geolocated to Europe gets scaled down.
const EUROPE_SCORE_MULTIPLIER = 0.9;

function applyRegionMultiplier(score, continentCode) {
  if (continentCode !== 'EU') return score;
  return Math.min(100, Math.round(score * EUROPE_SCORE_MULTIPLIER));
}

// Looks up the visitor's continent from their IP via a third-party geolocation API (the request
// goes browser -> API, so the API sees the visitor's real IP even for a static site with no
// backend). Resolves to null on any failure so scoring degrades to the unscaled base score.
async function fetchContinentCode() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://ipwho.is/', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.success && data.continent_code ? data.continent_code : null;
  } catch {
    return null;
  }
}

const continentCodePromise = fetchContinentCode();

const todayKey = todayKeyNY();
const { radians: targetRadians } = angleForDate(todayKey);
const storageKey = `angle-rip-off:${todayKey}`;

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { guesses: [], done: false };
    return JSON.parse(raw);
  } catch {
    return { guesses: [], done: false };
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
  // 0 rad points to 12 o'clock, increasing angle sweeps clockwise (a compass/clock-face
  // convention, rather than the standard math convention of 0 = 3 o'clock, counter-clockwise).
  const tipX = R * Math.sin(targetRadians);
  const tipY = -R * Math.cos(targetRadians);

  document.getElementById('angle-ray').setAttribute('x2', tipX.toFixed(3));
  document.getElementById('angle-ray').setAttribute('y2', tipY.toFixed(3));
  document.getElementById('angle-tip').setAttribute('cx', tipX.toFixed(3));
  document.getElementById('angle-tip').setAttribute('cy', tipY.toFixed(3));

  // Filled pie wedge from the origin, from 12 o'clock to the target angle -- makes the region
  // being guessed unambiguous, rather than just an outline arc along the rim.
  const largeArc = targetRadians > Math.PI ? 1 : 0;
  const d = `M 0 0 L 0 ${-R} A ${R} ${R} 0 ${largeArc} 1 ${tipX.toFixed(3)} ${tipY.toFixed(3)} Z`;
  document.getElementById('angle-arc').setAttribute('d', d);

  // "?" mark on the wedge's bisector -- reinforces which region is being guessed without
  // revealing the target value itself.
  const labelR = R * 0.55;
  const labelAngle = targetRadians / 2;
  const labelX = labelR * Math.sin(labelAngle);
  const labelY = -labelR * Math.cos(labelAngle);
  document.getElementById('angle-label').setAttribute('x', labelX.toFixed(3));
  document.getElementById('angle-label').setAttribute('y', labelY.toFixed(3));
}

drawAngle();

// While guesses remain, only the raw values entered are listed -- no distance, direction,
// or grading. Grading only appears once all guesses are used (renderResult).
function renderHistory() {
  historyList.innerHTML = '';
  state.guesses.forEach((g, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="val">#${i + 1}: ${g.toFixed(4)} rad</span>`;
    historyList.appendChild(li);
  });
}

function renderGradedHistory() {
  historyList.innerHTML = '';
  state.guesses.forEach((g, i) => {
    const li = document.createElement('li');
    const warmth = warmthFor(g);
    li.classList.add(warmth.className);
    li.innerHTML = `
      <span class="val">#${i + 1}: ${g.toFixed(4)} rad</span>
      <span class="dir">${warmth.label}</span>
    `;
    historyList.appendChild(li);
  });
}

function buildShareText() {
  const label = warmthFor(state.guesses[0]).label;
  const score = state.finalScore ?? baseScoreFor(bestGuessDiff(state.guesses));
  return `angle rip-off #${dayNumber(todayKey)} — ${score}/100 (${label})\nhttps://v8537.github.io/angle-rip-off/`;
}

function renderResult() {
  resultPanel.hidden = false;
  guessInput.disabled = true;
  guessBtn.disabled = true;

  renderGradedHistory();

  const score = state.finalScore ?? baseScoreFor(bestGuessDiff(state.guesses));
  resultTitle.textContent = `score: ${score}/100`;
  resultDetail.textContent = `angle was ${targetRadians.toFixed(4)} radians.`;
  shareText.textContent = buildShareText();
}

async function submitGuess() {
  if (state.done) return;
  const raw = guessInput.value.trim().replace(',', '.');
  if (raw === '') return;
  const val = parseFloat(raw);
  if (Number.isNaN(val) || val < 0 || val > 2 * Math.PI + 0.01) {
    hintText.textContent = 'value must be between 0 and 2π (6.2832).';
    hintText.style.color = 'var(--bad)';
    return;
  }
  hintText.style.color = '';

  state.guesses.push(val);
  guessInput.value = '';

  if (state.guesses.length >= MAX_GUESSES) {
    guessInput.disabled = true;
    guessBtn.disabled = true;
    hintText.hidden = false;
    hintText.textContent = 'scoring...';

    const continentCode = await continentCodePromise;
    const base = baseScoreFor(bestGuessDiff(state.guesses));

    state.done = true;
    state.continentCode = continentCode;
    state.finalScore = applyRegionMultiplier(base, continentCode);

    saveState(state);
    render();
  } else {
    saveState(state);
    render();
    guessInput.focus();
  }
}

function render() {
  renderHistory();

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
