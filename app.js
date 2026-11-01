// Budget mensile: logica e dati condivisi da tutte le pagine.
// Prima i versamenti fissi di risparmio, poi il disponibile viene diviso
// tra necessità e desideri nel rapporto 50:30.
const STORAGE_KEY = 'budget-50-30-20-v1';
const MONTH_KEY = 'budget-selected-month';

const NEEDS_SHARE = 5 / 8; // 50 / (50 + 30)

const BUCKETS = {
  needs: { label: 'Necessità' },
  wants: { label: 'Desideri' },
  savings: { label: 'Risparmio' },
};

const ACCOUNTS = {
  main: { name: 'Conto principale' },
  emergency: { name: 'Fondo emergenza' },
  invest: { name: 'Conto investimenti' },
};

const MONTH_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const eurCompact = new Intl.NumberFormat('it-IT', { notation: 'compact', style: 'currency', currency: 'EUR', maximumFractionDigits: 1 });

// ---------- Utilità ----------

function round2(n) {
  return Math.round(n * 100) / 100;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random());
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Sposta una chiave "YYYY-MM" di un certo numero di mesi
function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// "2026-11" -> "Nov 2026"
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

// ---------- Logica del budget ----------

// Dal disponibile (stipendio meno versamenti di risparmio) ricava il massimo
// che si può spendere in necessità e desideri
function splitBudget(income, savingsGoal) {
  const spendable = Math.max(round2(income - savingsGoal), 0);
  return {
    needs: round2(spendable * NEEDS_SHARE),
    wants: round2(spendable * (1 - NEEDS_SHARE)),
    savings: round2(savingsGoal),
    spendable,
  };
}

// Somma le spese per bucket
function spentByBucket(expenses) {
  const totals = { needs: 0, wants: 0, savings: 0 };
  for (const e of expenses) {
    totals[e.bucket] = round2(totals[e.bucket] + e.amount);
  }
  return totals;
}

// Confronta budget e spese per ogni bucket
function budgetStatus(income, expenses, savingsGoal) {
  const budget = splitBudget(income, savingsGoal);
  const spent = spentByBucket(expenses);
  const status = {};
  for (const key of ['needs', 'wants', 'savings']) {
    const remaining = round2(budget[key] - spent[key]);
    status[key] = {
      budget: budget[key],
      spent: spent[key],
      remaining,
      over: remaining < 0,
      percent: budget[key] > 0 ? Math.min(spent[key] / budget[key], 1) : (spent[key] > 0 ? 1 : 0),
    };
  }
  const totalSpent = round2(spent.needs + spent.wants + spent.savings);
  return {
    buckets: status,
    totalSpent,
    leftover: round2(income - totalSpent),
    spendable: budget.spendable,
  };
}

// Le spese più frequenti per descrizione, ordinate per importo
function topExpenses(expenses, limit = 6) {
  const map = new Map();
  for (const e of expenses) {
    const name = e.desc.trim();
    const key = name.toLowerCase();
    const item = map.get(key) || { desc: name, bucket: e.bucket, total: 0 };
    item.total = round2(item.total + e.amount);
    map.set(key, item);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

// ---------- Versamenti ricorrenti e conti ----------

// Versamenti ricorrenti: ogni regola genera una spesa di risparmio di importo fisso in ogni mese da "from" in poi
function recurringFor(data, key) {
  return data.recurring
    .filter((r) => r.from <= key)
    .map((r) => ({ id: `rec-${r.id}-${key}`, desc: r.desc, amount: r.amount, bucket: 'savings', target: r.target, recurring: true }))
    .filter((e) => e.amount > 0);
}

// Totale dei versamenti fissi di un mese: è l'obiettivo di risparmio
function savingsGoalFor(data, key) {
  return round2(recurringFor(data, key).reduce((s, e) => round2(s + e.amount), 0));
}

// Spese di un mese: quelle inserite a mano più i versamenti ricorrenti
function monthExpenses(data, key) {
  const month = data.months[key];
  return (month ? month.expenses : []).concat(recurringFor(data, key));
}

// Saldo attuale di ogni conto, considerando tutti i mesi
function accountBalances(data) {
  const start = (k) => (data.accounts[k] && data.accounts[k].start) || 0;
  // I versamenti ricorrenti contano fino al mese corrente, quelli a mano per tutti i mesi salvati
  const now = currentMonthKey();
  const keys = new Set(Object.keys(data.months));
  for (const r of data.recurring) {
    for (let k = r.from; k <= now; k = shiftMonth(k, 1)) keys.add(k);
  }
  const months = [...keys].map((k) => {
    const month = data.months[k];
    const manual = month ? month.expenses : [];
    return {
      income: month ? month.income || 0 : 0,
      expenses: k <= now ? manual.concat(recurringFor(data, k)) : manual,
    };
  });
  const income = months.reduce((s, m) => round2(s + m.income), 0);
  const expenses = months.flatMap((m) => m.expenses);
  const spent = expenses.reduce((s, e) => round2(s + e.amount), 0);
  const transfersTo = (k) => expenses
    .filter((e) => e.bucket === 'savings' && (e.target || 'emergency') === k)
    .reduce((s, e) => round2(s + e.amount), 0);
  return {
    main: round2(start('main') + income - spent),
    emergency: round2(start('emergency') + transfersTo('emergency')),
    invest: round2(start('invest') + transfersTo('invest')),
  };
}

// Previsione mese per mese fino a endKey: quanto rimane a fine mese e il totale progressivo.
// Il totale parte dai saldi iniziali dei conti. Per i mesi futuri lo stipendio è
// quello dell'ultimo mese inserito, e i versamenti fissi valgono in ogni mese.
function monthlyProjection(data, endKey) {
  const now = currentMonthKey();
  const keys = new Set(Object.keys(data.months));
  for (const r of data.recurring) keys.add(r.from);
  keys.add(now);
  const startKey = [...keys].sort()[0];

  let running = Object.values(data.accounts).reduce((s, a) => round2(s + ((a && a.start) || 0)), 0);
  let lastIncome = 0;
  const rows = [];
  for (let k = startKey; k <= endKey; k = shiftMonth(k, 1)) {
    const month = data.months[k];
    const hasIncome = !!(month && month.income);
    if (hasIncome) lastIncome = month.income;
    const future = k > now;
    const income = hasIncome ? month.income : (future ? lastIncome : 0);
    // I versamenti di risparmio spostano denaro tra i conti: restano nel totale, quindi non sono spese
    const spent = round2(monthExpenses(data, k)
      .filter((e) => e.bucket !== 'savings')
      .reduce((s, e) => round2(s + e.amount), 0));
    const left = round2(income - spent);
    running = round2(running + left);
    rows.push({ key: k, income, spent, left, total: running, future, estimated: future && !hasIncome });
  }
  return rows;
}

// Serie mensile di un anno: stipendio e spese per bucket.
// Come per i saldi, i versamenti fissi contano solo fino al mese corrente.
function yearSeries(data, year) {
  const now = currentMonthKey();
  return Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    const month = data.months[key];
    const expenses = key <= now ? monthExpenses(data, key) : (month ? month.expenses : []);
    const spent = spentByBucket(expenses);
    return {
      key,
      label: MONTH_SHORT[i],
      income: month && month.income ? month.income : 0,
      needs: spent.needs,
      wants: spent.wants,
      savings: spent.savings,
      total: round2(spent.needs + spent.wants + spent.savings),
    };
  });
}

// ---------- Grafici SVG ----------

// Ciambella: segmenti con value > 0, total è il valore del giro completo
function donutSVG(segments, total, centerValue, centerLabel) {
  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = segments.filter((s) => s.value > 0).map((s) => {
    const len = (s.value / total) * C;
    const arc = `<circle class="seg seg-${s.key}" r="${R}" cx="70" cy="70"
      stroke-dasharray="${Math.max(len - 1, 0)} ${C}" stroke-dashoffset="${-offset}">
      <title>${escapeHtml(s.label)}: ${eur.format(s.value)}</title></circle>`;
    offset += len;
    return arc;
  }).join('');
  return `
    <svg viewBox="0 0 140 140" class="donut" role="img" aria-label="${escapeHtml(centerLabel)}">
      <circle class="seg-track" r="${R}" cx="70" cy="70"></circle>
      <g transform="rotate(-90 70 70)">${arcs}</g>
      <text x="70" y="68" text-anchor="middle" class="donut-value">${centerValue}</text>
      <text x="70" y="85" text-anchor="middle" class="donut-label">${centerLabel}</text>
    </svg>`;
}

// Barre impilate per mese con linea dello stipendio
function trendSVG(series, selectedKey) {
  const W = 640;
  const H = 240;
  const padL = 52;
  const padR = 8;
  const padT = 12;
  const padB = 26;
  const chartH = H - padT - padB;
  const chartW = W - padL - padR;

  const maxVal = Math.max(...series.map((m) => Math.max(m.income, m.total)));
  const top = Math.max(100, Math.ceil(maxVal / 100) * 100);
  const yOf = (v) => padT + chartH * (1 - v / top);
  const baseline = padT + chartH;
  const slot = chartW / 12;
  const barW = slot * 0.56;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = (top * i) / 4;
    grid += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${yOf(v)}" y2="${yOf(v)}"></line>
      <text class="axis-label" x="${padL - 6}" y="${yOf(v) + 4}" text-anchor="end">${eurCompact.format(v)}</text>`;
  }

  let bars = '';
  series.forEach((m, i) => {
    const x0 = padL + i * slot;
    if (m.key === selectedKey) {
      bars += `<rect class="slot-active" x="${x0}" y="${padT}" width="${slot}" height="${chartH}" rx="6"></rect>`;
    }
    let yCur = baseline;
    for (const key of ['needs', 'wants', 'savings']) {
      const h = (m[key] / top) * chartH;
      if (h <= 0) continue;
      yCur -= h;
      bars += `<rect class="tbar tbar-${key}" x="${x0 + (slot - barW) / 2}" y="${yCur}" width="${barW}" height="${h}" rx="3">
        <title>${MONTH_SHORT[i]} · ${BUCKETS[key].label}: ${eur.format(m[key])}</title></rect>`;
    }
    if (m.income > 0) {
      bars += `<line class="income-line" x1="${x0 + slot * 0.1}" x2="${x0 + slot * 0.9}" y1="${yOf(m.income)}" y2="${yOf(m.income)}">
        <title>${MONTH_SHORT[i]} · Stipendio: ${eur.format(m.income)}</title></line>`;
    }
    bars += `<text class="axis-label" x="${x0 + slot / 2}" y="${H - 8}" text-anchor="middle">${MONTH_SHORT[i]}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Andamento annuale">
    ${grid}${bars}
    <line class="axis" x1="${padL}" x2="${W - padR}" y1="${baseline}" y2="${baseline}"></line>
  </svg>`;
}

// ---------- Dati e mese selezionato ----------

function loadData() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    data = null;
  }
  data = data || {};
  data.months = data.months || {};
  data.recurring = data.recurring || [];
  data.accounts = {
    main: { start: 0 },
    emergency: { start: 0 },
    invest: { start: 0 },
    ...(data.accounts || {}),
  };
  return data;
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getMonth(data, monthKey) {
  if (!data.months[monthKey]) {
    data.months[monthKey] = { income: null, expenses: [] };
  }
  return data.months[monthKey];
}

// Il mese scelto resta lo stesso passando da una pagina all'altra
function getSelectedMonth() {
  return localStorage.getItem(MONTH_KEY) || currentMonthKey();
}

function setSelectedMonth(key) {
  localStorage.setItem(MONTH_KEY, key);
}

// "2026-11" -> "Novembre 2026"
function monthLongLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const text = new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Frecce e nome del mese; toccando il nome si torna al mese corrente.
// Al cambio mese si ridisegna la vista visibile.
function initMonthNav() {
  const label = document.getElementById('month');
  const show = () => {
    label.textContent = monthLongLabel(getSelectedMonth());
  };
  const go = (key) => {
    setSelectedMonth(key);
    show();
    renderCurrentView();
  };
  document.getElementById('prev').addEventListener('click', () => go(shiftMonth(getSelectedMonth(), -1)));
  document.getElementById('next').addEventListener('click', () => go(shiftMonth(getSelectedMonth(), 1)));
  label.addEventListener('click', () => go(currentMonthKey()));
  show();
}

// ---------- Viste: una sola pagina, cambio scheda senza ricaricare ----------

const VIEW_TITLES = {
  panoramica: 'Panoramica',
  spese: 'Spese',
  conti: 'Conti',
  previsione: 'Previsione',
  statistiche: 'Statistiche',
};

const controllers = {};
let currentView = 'panoramica';

// Ogni vista registra init (una volta, collega gli eventi) e render (ad ogni visita o cambio mese)
function registerView(name, controller) {
  controllers[name] = controller;
}

function renderCurrentView() {
  if (controllers[currentView]) controllers[currentView].render();
}

function showView(name) {
  if (!VIEW_TITLES[name]) name = 'panoramica';
  currentView = name;
  document.querySelectorAll('.view').forEach((v) => {
    v.hidden = v.id !== `view-${name}`;
  });
  document.querySelectorAll('.tabbar a').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === name);
  });
  document.getElementById('page-title').textContent = VIEW_TITLES[name];
  renderCurrentView();
  window.scrollTo(0, 0);
}

// Avvio: collega gli eventi di tutte le viste, il mese e la navigazione
function initRouter() {
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
  Object.values(controllers).forEach((c) => {
    if (c.init) c.init();
  });
  initMonthNav();
  showView(location.hash.slice(1));
}

if (typeof module !== 'undefined') {
  module.exports = { splitBudget, spentByBucket, budgetStatus, topExpenses, yearSeries, accountBalances, savingsGoalFor, monthExpenses, monthlyProjection, shiftMonth, round2 };
}
