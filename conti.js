// Conti: saldi, saldi iniziali, versamenti fissi e azzeramento
(() => {
  const $ = (id) => document.getElementById(id);
  const accountsEl = $('accounts');
  const recForm = $('recurring-form');
  const recAmount = $('rec-amount');
  const recTarget = $('rec-target');
  const recList = $('rec-list');
  const recEmpty = $('rec-empty');
  const recTotal = $('rec-total');

  let data = loadData();

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

  function render() {
    data = loadData();
    renderAccounts();
    renderRecurring();
  }

  accountsEl.addEventListener('change', (ev) => {
    const input = ev.target.closest('input[data-start]');
    if (!input) return;
    const value = parseFloat(input.value);
    data.accounts[input.dataset.start].start = round2(Number.isFinite(value) ? value : 0);
    saveData(data);
    render();
  });

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

  $('reset').addEventListener('click', () => {
    if (!confirm('Cancellare tutti i dati (stipendi, spese, conti e versamenti)? L\'operazione non si può annullare.')) return;
    localStorage.removeItem(STORAGE_KEY);
    data = loadData();
    render();
  });

  initTabs();
  initMonthNav(() => {});
  render();
})();
