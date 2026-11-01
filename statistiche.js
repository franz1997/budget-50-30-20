// Statistiche: totali dell'anno, andamento mensile e spese principali
(() => {
  const $ = (id) => document.getElementById(id);
  const yearStatsEl = $('year-stats');
  const trendEl = $('trend');
  const trendTitle = $('trend-title');
  const topEl = $('top');

  let data = loadData();

  function renderYearStats(series) {
    const income = round2(series.reduce((s, m) => round2(s + m.income), 0));
    const spent = round2(series.reduce((s, m) => round2(s + m.total), 0));
    const saved = round2(series.reduce((s, m) => round2(s + m.savings), 0));
    const left = round2(income - spent);
    const tiles = [
      { label: 'Stipendi dell\'anno', value: eur.format(income), sub: `${series.filter((m) => m.income > 0).length} mesi con stipendio` },
      { label: 'Spese dell\'anno', value: eur.format(spent), sub: income ? `${Math.round((spent / income) * 100)}% degli stipendi` : '' },
      { label: 'Risparmio versato', value: eur.format(saved), sub: 'Versamenti e risparmi manuali' },
      { label: 'Saldo dell\'anno', value: eur.format(left), sub: 'Stipendi meno spese', cls: left < 0 ? 'neg' : 'pos' },
    ];
    yearStatsEl.innerHTML = tiles.map((t) => `
      <div class="stat">
        <span class="stat-label">${t.label}</span>
        <strong class="stat-value ${t.cls || ''}">${t.value}</strong>
        <span class="stat-sub">${t.sub}</span>
      </div>`).join('');
  }

  function renderTop(key) {
    const items = topExpenses(monthExpenses(data, key));
    if (!items.length) {
      topEl.innerHTML = '<p class="empty">Nessuna spesa da mostrare per questo mese.</p>';
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

  function render() {
    data = loadData();
    const key = getSelectedMonth();
    const year = key.split('-')[0];
    const series = yearSeries(data, year);
    trendTitle.textContent = `Andamento ${year}`;
    trendEl.innerHTML = trendSVG(series, key);
    renderYearStats(series);
    renderTop(key);
  }

  initTabs();
  initMonthNav(render);
  render();
})();
