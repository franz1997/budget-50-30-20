// Panoramica: stipendio, disponibile, ripartizione
(() => {
  const $ = (id) => document.getElementById(id);
  const statsEl = $('stats');
  const incomeInput = $('income');
  const incomeHint = $('income-hint');
  const donutEl = $('donut');
  const splitLegend = $('split-legend');
  const splitEmpty = $('split-empty');
  const bucketsEl = $('buckets');

  let data = loadData();

  function renderStats(month, status, goal) {
    const hasIncome = month.income !== null;
    const { buckets: b, totalSpent, leftover } = status;
    const pct = hasIncome && month.income > 0 ? Math.round((totalSpent / month.income) * 100) : null;
    const tiles = [
      {
        label: 'Stipendio',
        value: hasIncome ? eur.format(month.income) : '—',
        sub: `Versamenti fissi ${eur.format(goal)}`,
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
        sub: pct !== null ? `${pct}% dello stipendio` : 'Versamenti inclusi',
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

  function render() {
    data = loadData();
    const key = getSelectedMonth();
    const month = getMonth(data, key);
    const expenses = monthExpenses(data, key);
    const goal = savingsGoalFor(data, key);
    const status = budgetStatus(month.income ?? 0, expenses, goal);

    incomeInput.value = month.income ?? '';
    if (month.income === null) {
      incomeHint.textContent = 'Inserisci lo stipendio per calcolare quanto puoi spendere.';
    } else if (goal > month.income) {
      incomeHint.textContent = `Attenzione: i versamenti fissi (${eur.format(goal)}) superano lo stipendio.`;
    } else {
      incomeHint.textContent = `${eur.format(month.income)} − versamenti fissi ${eur.format(goal)} = disponibile ${eur.format(status.spendable)}`;
    }

    renderStats(month, status, goal);
    renderSplit(month, status);
  }

  registerView('panoramica', {
    init() {
      $('income-form').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const value = parseFloat(incomeInput.value);
        if (!(value >= 0)) return;
        data = loadData();
        getMonth(data, getSelectedMonth()).income = round2(value);
        saveData(data);
        render();
      });
    },
    render,
  });
})();
