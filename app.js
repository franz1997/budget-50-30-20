// Budget mensile: prima i versamenti fissi di risparmio, poi il disponibile
// viene diviso tra necessità e desideri nel rapporto 50:30
const STORAGE_KEY = 'budget-50-30-20-v1';

const NEEDS_SHARE = 5 / 8; // 50 / (50 + 30)

const BUCKETS = {
  needs: { label: 'Necessità' },
  wants: { label: 'Desideri' },
  savings: { label: 'Risparmio' },
};

// Conti: il conto principale riceve lo stipendio e paga tutte le spese;
// le spese di risparmio sono trasferimenti verso uno dei conti di destinazione
const ACCOUNTS = {
  main: { name: 'Conto principale' },
  emergency: { name: 'Fondo emergenza' },
  invest: { name: 'Conto investimenti' },
};

const MONTH_SHORT =['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const eurCompact = new Intl.NumberFormat('it-IT', { notation: 'compact', style: 'currency', currency: 'EUR', maximumFractionDigits: 1 });

// ---------- Logica pura (testabile) ----------

function round2(n) {
  return Math.round(n * 100) / 100;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

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

// Serie mensile di un anno: stipendio e spese per bucket
function yearSeries(data, year) {
  return Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    const month = data.months[key];
    const expenses = monthExpenses(data, key);
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

// "2026-11" -> "Nov 2026"
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

// Sposta una chiave "YYYY-MM" di un certo numero di mesi
function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

// ---------- Stato e persistenza ----------

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
  // I saldi iniziali sono opzionali: i dati salvati prima dei conti restano validi
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

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random());
}

// ---------- Interfaccia ----------

if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  const monthInput = $('month');
  const incomeForm = $('income-form');
  const incomeInput = $('income');
  const incomeHint = $('income-hint');
  const statsEl = $('stats');
  const donutEl = $('donut');
  const splitLegend = $('split-legend');
  const splitEmpty = $('split-empty');
  const bucketsEl = $('buckets');
  const trendEl = $('trend');
  const trendTitle = $('trend-title');
  const topEl = $('top');
  const expenseForm = $('expense-form');
  const expenseList = $('expense-list');
  const expenseEmpty = $('expense-empty');
  const filterEl = $('filters');
  const accountsEl = $('accounts');
  const targetSelect = $('exp-target');
  const recForm = $('recurring-form');
  const recAmount = $('rec-amount');
  const recTarget = $('rec-target');
  const recList = $('rec-list');
  const recEmpty = $('rec-empty');
  const recTotal = $('rec-total');

  let data = loadData();
  let monthKey = currentMonthKey();
  let filter = 'all';

  monthInput.value = monthKey;

  function renderStats(month, status, expenses) {
    const hasIncome = month.income !== null;
    const { buckets: b, totalSpent, leftover } = status;
    const pct = hasIncome && month.income > 0 ? Math.round((totalSpent / month.income) * 100) : null;
    const tiles = [
      {
        label: 'Stipendio',
        value: hasIncome ? eur.format(month.income) : '—',
        sub: `Versamenti fissi ${eur.format(b.savings.budget)}`,
      },
      {
        label: 'Puoi spendere',
        value: hasIncome ? eur.format(status.spendable) : '—',
        sub: hasIncome
          ? `Max necessità ${eur.format(b.needs.budget)} · desideri ${eur.format(b.wants.budget)}`
          : 'Inserisci lo stipendio',
      },
      {
        label: 'Spese totali',
        value: eur.format(totalSpent),
        sub: pct !== null ? `${pct}% dello stipendio` : `${expenses.length} voci`,
      },
      {
        label: 'Saldo rimanente',
        value: hasIncome ? eur.format(leftover) : '—',
        sub: hasIncome && leftover < 0 ? 'Spese superiori allo stipendio' : 'Non ancora speso',
        cls: hasIncome ? (leftover < 0 ? 'neg' : 'pos') : '',
      },
    ];
    statsEl.innerHTML = tiles.map((t) => `
      <div class="stat">
        <span class="stat-label">${t.label}</span>
        <strong class="stat-value ${t.cls || ''}">${t.value}</strong>
        <span class="stat-sub">${t.sub}</span>
      </div>`).join('');
  }

  function renderSplit(month, status) {
    const hasIncome = month.income !== null && month.income > 0;
    splitEmpty.style.display = hasIncome ? 'none' : 'block';
    donutEl.innerHTML = '';
    splitLegend.innerHTML = '';
    bucketsEl.innerHTML = '';
    if (!hasIncome) return;

    const b = status.buckets;
    const segments = [
      { key: 'needs', label: 'Necessità spese', value: b.needs.spent },
      { key: 'wants', label: 'Desideri spesi', value: b.wants.spent },
      { key: 'savings', label: 'Risparmio versato', value: b.savings.spent },
      { key: 'left', label: 'Non speso', value: Math.max(status.leftover, 0) },
    ];
    const total = Math.max(month.income, status.totalSpent);
    const pct = Math.round((status.totalSpent / month.income) * 100);
    donutEl.innerHTML = donutSVG(segments, total, `${pct}%`, 'spesi');

    splitLegend.innerHTML = segments.map((s) => `
      <li><span class="dot seg-${s.key}"></span>${s.label}<strong>${eur.format(s.value)}</strong></li>`).join('');

    bucketsEl.innerHTML = Object.entries(BUCKETS).map(([key, info]) => {
      const s = b[key];
      const metaText = s.over
        ? `Sforato di ${eur.format(-s.remaining)}`
        : `Rimangono ${eur.format(s.remaining)}`;
      return `
        <div class="bucket bucket-${key} ${s.over ? 'is-over' : ''}">
          <div class="bucket-head">
            <span>${info.label}</span>
            <span>${eur.format(s.spent)} <small>/ ${eur.format(s.budget)}</small></span>
          </div>
          <div class="bar"><div class="bar-fill" style="width:${s.percent * 100}%"></div></div>
          <div class="bucket-meta">${metaText}</div>
        </div>`;
    }).join('');
  }

  function renderTrend() {
    const year = monthKey.split('-')[0];
    trendTitle.textContent = `Andamento ${year}`;
    trendEl.innerHTML = trendSVG(yearSeries(data, year), monthKey);
  }

  function renderTop(expenses) {
    const items = topExpenses(expenses);
    if (!items.length) {
      topEl.innerHTML = '<p class="empty">Nessuna spesa da mostrare.</p>';
      return;
    }
    const max = items[0].total;
    topEl.innerHTML = items.map((it) => `
      <div class="top-row bucket-${it.bucket}">
        <div class="top-head">
          <span class="top-name" title="${escapeHtml(it.desc)}">${escapeHtml(it.desc)}</span>
          <strong>${eur.format(it.total)}</strong>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${(it.total / max) * 100}%"></div></div>
      </div>`).join('');
  }

  function renderAccounts() {
    const balances = accountBalances(data);
    accountsEl.innerHTML = Object.entries(ACCOUNTS).map(([key, info]) => `
      <div class="account account-${key}">
        <span class="stat-label">${info.name}</span>
        <strong class="stat-value ${balances[key] < 0 ? 'neg' : ''}">${eur.format(balances[key])}</strong>
        <label class="start-label">
          Saldo iniziale
          <input type="number" step="0.01" data-start="${key}" value="${data.accounts[key].start}">
        </label>
      </div>`).join('');
  }

  function expenseTag(e) {
    if (e.bucket !== 'savings') return `<span class="tag tag-${e.bucket}">${BUCKETS[e.bucket].label}</span>`;
    const target = ACCOUNTS[e.target || 'emergency'].name;
    return `<span class="tag tag-${e.bucket}">Risparmio → ${target}</span>`;
  }

  function renderRecurring() {
    recList.innerHTML = data.recurring.map((r) => `
      <li>
        <span class="tag tag-savings">→ ${ACCOUNTS[r.target].name}</span>
        <span class="exp-desc">Dal ${monthLabel(r.from)}</span>
        <span class="exp-amount">${r.amount > 0 ? `${eur.format(r.amount)} / mese` : '<span class="neg">importo mancante</span>'}</span>
        <button class="delete-btn" data-rule="${r.id}" title="Elimina" aria-label="Elimina">×</button>
      </li>`).join('');
    recEmpty.style.display = data.recurring.length ? 'none' : 'block';

    const total = data.recurring.reduce((s, r) => round2(s + (r.amount || 0)), 0);
    const missing = data.recurring.filter((r) => !(r.amount > 0)).length;
    recTotal.textContent = missing
      ? `Versamenti fissi al mese: ${eur.format(total)}. ${missing} regola/e senza importo: eliminale e ricreale.`
      : `Versamenti fissi al mese: ${eur.format(total)}`;
    recTotal.classList.toggle('is-over', missing > 0);
  }

  function renderExpenses(expenses) {
    filterEl.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.filter === filter);
    });
    const shown = expenses
      .filter((e) => filter === 'all' || e.bucket === filter)
      .slice()
      .reverse();
    expenseList.innerHTML = shown.map((e) => `
      <li>
        ${expenseTag(e)}
        <span class="exp-desc" title="${escapeHtml(e.desc)}">${escapeHtml(e.desc)}</span>
        <span class="exp-amount">${eur.format(e.amount)}</span>
        ${e.recurring
          ? '<span class="rec-mark" title="Versamento automatico mensile">↻</span>'
          : `<button class="delete-btn" data-id="${e.id}" title="Elimina" aria-label="Elimina">×</button>`}
      </li>`).join('');
    expenseEmpty.style.display = shown.length ? 'none' : 'block';
    expenseEmpty.textContent = expenses.length
      ? 'Nessuna spesa in questa categoria.'
      : 'Nessuna spesa per questo mese.';
  }

  function render() {
    const month = getMonth(data, monthKey);
    const income = month.income ?? 0;
    const expenses = monthExpenses(data, monthKey);
    const goal = savingsGoalFor(data, monthKey);
    const status = budgetStatus(income, expenses, goal);

    incomeInput.value = month.income ?? '';
    if (month.income === null) {
      incomeHint.textContent = 'Inserisci lo stipendio per calcolare quanto puoi spendere.';
    } else if (goal > month.income) {
      incomeHint.textContent = `Attenzione: i versamenti fissi (${eur.format(goal)}) superano lo stipendio.`;
    } else {
      incomeHint.textContent = `${eur.format(month.income)} − versamenti fissi ${eur.format(goal)} = disponibile ${eur.format(status.spendable)}`;
    }

    renderStats(month, status, expenses);
    renderAccounts();
    renderSplit(month, status);
    renderTrend();
    renderTop(expenses);
    renderRecurring();
    renderExpenses(expenses);
  }

  // Navigazione mesi
  function goToMonth(key) {
    monthKey = key;
    monthInput.value = key;
    render();
  }

  $('prev').addEventListener('click', () => goToMonth(shiftMonth(monthKey, -1)));
  $('next').addEventListener('click', () => goToMonth(shiftMonth(monthKey, 1)));
  $('today').addEventListener('click', () => goToMonth(currentMonthKey()));
  monthInput.addEventListener('change', () => {
    if (monthInput.value) goToMonth(monthInput.value);
  });

  // Stipendio
  incomeForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const value = parseFloat(incomeInput.value);
    if (!(value >= 0)) return;
    getMonth(data, monthKey).income = round2(value);
    saveData(data);
    render();
  });

  // Azzeramento completo: stipendi, spese, conti e versamenti
  $('reset').addEventListener('click', () => {
    if (!confirm('Cancellare tutti i dati (stipendi, spese, conti e versamenti)? L\'operazione non si può annullare.')) return;
    localStorage.removeItem(STORAGE_KEY);
    data = loadData();
    goToMonth(currentMonthKey());
  });

  // Versamenti ricorrenti
  recForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const amount = round2(parseFloat(recAmount.value));
    if (!(amount > 0)) return;
    data.recurring.push({
      id: newId(),
      desc: 'Versamento mensile',
      amount,
      target: recTarget.value,
      from: currentMonthKey(),
    });
    saveData(data);
    recForm.reset();
    render();
  });

  recList.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.delete-btn');
    if (!btn) return;
    if (!confirm('Eliminare questo versamento automatico da tutti i mesi?')) return;
    data.recurring = data.recurring.filter((r) => r.id !== btn.dataset.rule);
    saveData(data);
    render();
  });

  // Saldi iniziali dei conti
  accountsEl.addEventListener('change', (ev) => {
    const input = ev.target.closest('input[data-start]');
    if (!input) return;
    const value = parseFloat(input.value);
    data.accounts[input.dataset.start].start = round2(Number.isFinite(value) ? value : 0);
    saveData(data);
    render();
  });

  // Spese
  $('exp-bucket').addEventListener('change', () => {
    targetSelect.hidden = $('exp-bucket').value !== 'savings';
  });

  expenseForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const desc = $('exp-desc').value.trim();
    const amount = round2(parseFloat($('exp-amount').value));
    const bucket = $('exp-bucket').value;
    if (!desc || !(amount > 0)) return;
    const expense = { id: newId(), desc, amount, bucket };
    if (bucket === 'savings') expense.target = targetSelect.value;
    getMonth(data, monthKey).expenses.push(expense);
    saveData(data);
    expenseForm.reset();
    targetSelect.hidden = true;
    $('exp-desc').focus();
    render();
  });

  expenseList.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.delete-btn');
    if (!btn) return;
    if (!confirm('Eliminare questa spesa?')) return;
    const month = getMonth(data, monthKey);
    month.expenses = month.expenses.filter((e) => e.id !== btn.dataset.id);
    saveData(data);
    render();
  });

  filterEl.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    filter = chip.dataset.filter;
    renderExpenses(monthExpenses(data, monthKey));
  });

  render();
}

if (typeof module !== 'undefined') {
  module.exports = { splitBudget, spentByBucket, budgetStatus, topExpenses, yearSeries, accountBalances, savingsGoalFor, shiftMonth, round2 };
}
