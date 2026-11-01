// Spese del mese: riepilogo per quota, aggiunta, filtri ed eliminazione
(() => {
  const $ = (id) => document.getElementById(id);
  const miniEl = $('mini');
  const expenseForm = $('expense-form');
  const expenseList = $('expense-list');
  const expenseEmpty = $('expense-empty');
  const filterEl = $('filters');
  const targetSelect = $('exp-target');
  const bucketSelect = $('exp-bucket');

  let data = loadData();
  let filter = 'all';

  const SHORT_TARGET = { emergency: 'Fondo', invest: 'Investimenti' };

  function expenseTag(e) {
    if (e.bucket !== 'savings') return `<span class="tag tag-${e.bucket}">${BUCKETS[e.bucket].label}</span>`;
    return `<span class="tag tag-savings">→ ${SHORT_TARGET[e.target || 'emergency']}</span>`;
  }

  function renderMini(month, status) {
    if (month.income === null) {
      miniEl.innerHTML = '<p class="hint">Inserisci lo stipendio nella Panoramica per vedere i limiti di spesa.</p>';
      return;
    }
    miniEl.innerHTML = ['needs', 'wants'].map((key) => {
      const s = status.buckets[key];
      return `
        <div class="stat bucket bucket-${key} ${s.over ? 'is-over' : ''}">
          <span class="stat-label">${BUCKETS[key].label}</span>
          <strong class="stat-value ${s.over ? 'neg' : ''}">${eur.format(s.spent)} <small>/ ${eur.format(s.budget)}</small></strong>
          <div class="bar"><div class="bar-fill" style="width:${s.percent * 100}%"></div></div>
          <span class="stat-sub">${s.over ? `Sforato di ${eur.format(-s.remaining)}` : `Rimangono ${eur.format(s.remaining)}`}</span>
        </div>`;
    }).join('');
  }

  function renderList(expenses) {
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
    data = loadData();
    const key = getSelectedMonth();
    const month = getMonth(data, key);
    const expenses = monthExpenses(data, key);
    const goal = savingsGoalFor(data, key);
    renderMini(month, budgetStatus(month.income ?? 0, expenses, goal));
    renderList(expenses);
  }

  bucketSelect.addEventListener('change', () => {
    targetSelect.hidden = bucketSelect.value !== 'savings';
  });

  expenseForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const desc = $('exp-desc').value.trim();
    const amount = round2(parseFloat($('exp-amount').value));
    const bucket = bucketSelect.value;
    if (!desc || !(amount > 0)) return;
    const expense = { id: newId(), desc, amount, bucket };
    if (bucket === 'savings') expense.target = targetSelect.value;
    getMonth(data, getSelectedMonth()).expenses.push(expense);
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
    const month = getMonth(data, getSelectedMonth());
    month.expenses = month.expenses.filter((e) => e.id !== btn.dataset.id);
    saveData(data);
    render();
  });

  filterEl.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    filter = chip.dataset.filter;
    render();
  });

  initTabs();
  initMonthNav(render);
  render();
})();
