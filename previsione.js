// Previsione: quanto rimane a fine mese e totale progressivo dei conti
(() => {
  const $ = (id) => document.getElementById(id);
  const summaryEl = $('summary');
  const rowsEl = $('rows');
  const emptyEl = $('proj-empty');
  const titleEl = $('projection-title');

  function render() {
    const data = loadData();
    const key = getSelectedMonth();
    const year = key.split('-')[0];
    const now = currentMonthKey();
    const rows = monthlyProjection(data, `${year}-12`);

    titleEl.textContent = `Fine mese · ${year}`;
    emptyEl.style.display = rows.length ? 'none' : 'block';
    rowsEl.innerHTML = rows.map((r) => {
      const cls = [
        r.key === now ? 'is-current' : '',
        r.future ? 'is-future' : '',
      ].join(' ').trim();
      const leftCls = r.left < 0 ? 'neg' : '';
      const totalCls = r.total < 0 ? 'neg' : '';
      return `
        <tr class="${cls}">
          <td>${monthLabel(r.key)}${r.estimated ? '<span class="est" title="Stipendio stimato come l\'ultimo inserito">stimato</span>' : ''}</td>
          <td class="num">${eur.format(r.income)}</td>
          <td class="num">${eur.format(r.spent)}</td>
          <td class="num ${leftCls}">${eur.format(r.left)}</td>
          <td class="num total ${totalCls}">${eur.format(r.total)}</td>
        </tr>`;
    }).join('');

    const current = rows.find((r) => r.key === now);
    const yearEnd = rows[rows.length - 1];
    const tiles = [
      {
        label: 'Conti oggi',
        value: current ? eur.format(current.total) : '—',
        sub: current ? `Fine ${monthLabel(now)}` : 'Nessun dato',
        cls: current && current.total < 0 ? 'neg' : '',
      },
      {
        label: `Fine ${year}`,
        value: yearEnd ? eur.format(yearEnd.total) : '—',
        sub: 'Stima con i versamenti attuali',
        cls: yearEnd && yearEnd.total < 0 ? 'neg' : '',
      },
    ];
    summaryEl.innerHTML = tiles.map((t) => `
      <div class="stat">
        <span class="stat-label">${t.label}</span>
        <strong class="stat-value ${t.cls}">${t.value}</strong>
        <span class="stat-sub">${t.sub}</span>
      </div>`).join('');
  }

  registerView('previsione', { render });
})();
