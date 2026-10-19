import './style.css';
import { Chart, registerables } from 'chart.js';
import { simulate, monteCarlo } from './sim.js';
import { defaultPlan, newIncome, newExpense, newEvent, uid } from './defaults.js';

Chart.register(...registerables);

const STORE = 'proiezioni-v1';
const $ = (sel) => document.querySelector(sel);

// ---------- Stato ----------

const MODES = ['networth', 'cashflow', 'montecarlo', 'compare'];

function load() {
  const hashMode = MODES.find((m) => location.hash === `#${m}`);
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s?.plans?.length) return { ...s, mode: hashMode ?? s.mode };
  } catch { /* storage non disponibile */ }
  const p = defaultPlan();
  return { plans: [p], activeId: p.id, mode: hashMode ?? 'networth', real: true, selectedAge: null };
}

let state = load();

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* ignora */ }
}

const plan = () => state.plans.find((p) => p.id === state.activeId) ?? state.plans[0];

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

// ---------- Formattazione ----------

const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' });
const eurC = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const shown = (y, v) => (state.real ? v / y.defl : v);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- Editor (barra laterale) ----------

const field = (label, path, value, { suffix = '', step = 'any', disabled = false } = {}) => `
  <label class="field"><span>${label}</span>
    <div class="input-wrap">
      <input type="number" step="${step}" data-path="${path}" value="${esc(value)}" ${disabled ? 'disabled' : ''}>
      ${suffix ? `<em>${suffix}</em>` : ''}
    </div>
  </label>`;

const select = (path, value, options) => `
  <select data-path="${path}">
    ${options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}
  </select>`;

const START_OPTS = [['now', 'Da subito'], ['retirement', 'Alla pensione'], ['age', 'A età']];
const END_OPTS = [['retirement', 'Alla pensione'], ['death', 'Per sempre'], ['age', 'A età']];

const itemHead = (kind, i, name, icon = '') => `
  <div class="item-head">
    ${icon ? `<span class="item-icon">${icon}</span>` : ''}
    <input class="name" data-path="${kind}.${i}.name" value="${esc(name)}" aria-label="Nome">
    <button class="icon-btn" data-remove="${kind}" data-index="${i}" title="Rimuovi">✕</button>
  </div>`;

function flowItem(kind, item, i) {
  const b = `${kind}.${i}`;
  return `
    <div class="item">
      ${itemHead(kind, i, item.name)}
      <div class="grid2">
        ${field('Importo annuo', `${b}.amount`, item.amount, { suffix: '€' })}
        ${field('Crescita annua', `${b}.growth`, item.growth, { suffix: '%' })}
        <label class="field"><span>Inizio</span>
          <div class="combo">
            ${select(`${b}.startMode`, item.startMode, START_OPTS)}
            <input type="number" data-path="${b}.startAge" value="${esc(item.startAge)}" placeholder="età" ${item.startMode !== 'age' ? 'disabled' : ''}>
          </div>
        </label>
        <label class="field"><span>Fine</span>
          <div class="combo">
            ${select(`${b}.endMode`, item.endMode, END_OPTS)}
            <input type="number" data-path="${b}.endAge" value="${esc(item.endAge)}" placeholder="età" ${item.endMode !== 'age' ? 'disabled' : ''}>
          </div>
        </label>
      </div>
    </div>`;
}

function eventItem(ev, i) {
  const b = `events.${i}`;
  if (ev.type === 'kid') {
    return `
      <div class="item">
        ${itemHead('events', i, ev.name, '👶')}
        <div class="grid3">
          ${field('Alla tua età', `${b}.age`, ev.age, { step: 1 })}
          ${field('Costo annuo', `${b}.annualCost`, ev.annualCost, { suffix: '€' })}
          ${field('Per anni', `${b}.years`, ev.years, { step: 1 })}
        </div>
      </div>`;
  }
  if (ev.type === 'house') {
    return `
      <div class="item">
        ${itemHead('events', i, ev.name, '🏠')}
        <div class="grid3">
          ${field('Alla tua età', `${b}.age`, ev.age, { step: 1 })}
          ${field('Prezzo', `${b}.price`, ev.price, { suffix: '€' })}
          ${field('Anticipo', `${b}.downPct`, ev.downPct, { suffix: '%' })}
          ${field('Tasso mutuo', `${b}.rate`, ev.rate, { suffix: '%' })}
          ${field('Durata', `${b}.years`, ev.years, { suffix: 'anni', step: 1 })}
          ${field('Rivalutaz.', `${b}.appreciation`, ev.appreciation, { suffix: '%' })}
          ${field('Costi annui', `${b}.costPct`, ev.costPct, { suffix: '%' })}
        </div>
      </div>`;
  }
  return `
    <div class="item">
      ${itemHead('events', i, ev.name, Number(ev.amount) >= 0 ? '🎁' : '⭐')}
      <div class="grid2">
        ${field('Alla tua età', `${b}.age`, ev.age, { step: 1 })}
        ${field('Importo (+ entrata / − spesa)', `${b}.amount`, ev.amount, { suffix: '€' })}
      </div>
    </div>`;
}

function renderEditor() {
  const p = plan();
  const pr = p.profile;
  $('#editor').innerHTML = `
    <details open>
      <summary>👤 Profilo</summary>
      <div class="grid3">
        ${field('Età attuale', 'profile.currentAge', pr.currentAge, { step: 1 })}
        ${field('Pensione a', 'profile.retirementAge', pr.retirementAge, { step: 1 })}
        ${field('Aspettativa vita', 'profile.lifeExpectancy', pr.lifeExpectancy, { step: 1 })}
      </div>
      <label class="check"><input type="checkbox" data-path="profile.retireAtFI" ${pr.retireAtFI ? 'checked' : ''}>
        Vai in pensione appena raggiungi l'indipendenza finanziaria</label>
      ${field('Tasso di prelievo sicuro (FI = spese ÷ tasso)', 'profile.swr', pr.swr, { suffix: '%' })}
    </details>

    <details open>
      <summary>🏦 Patrimonio attuale</summary>
      <div class="grid2">
        ${field('Liquidità', 'accounts.cash', p.accounts.cash, { suffix: '€' })}
        ${field('Investimenti', 'accounts.investments', p.accounts.investments, { suffix: '€' })}
      </div>
    </details>

    <details>
      <summary>📊 Ipotesi di mercato</summary>
      <div class="grid2">
        ${field('Inflazione', 'profile.inflation', pr.inflation, { suffix: '%' })}
        ${field('Rendimento investimenti', 'profile.investReturn', pr.investReturn, { suffix: '%' })}
        ${field('Volatilità (Monte Carlo)', 'profile.investVolatility', pr.investVolatility, { suffix: '%' })}
        ${field('Interesse liquidità', 'profile.cashRate', pr.cashRate, { suffix: '%' })}
        ${field('Fondo emergenza', 'profile.cashBufferMonths', pr.cashBufferMonths, { suffix: 'mesi', step: 1 })}
      </div>
    </details>

    <details open>
      <summary>💶 Entrate <small>(nette, annue)</small></summary>
      ${p.incomes.map((it, i) => flowItem('incomes', it, i)).join('')}
      <button class="add" data-add="income">＋ Aggiungi entrata</button>
    </details>

    <details open>
      <summary>🧾 Spese <small>(annue)</small></summary>
      ${p.expenses.map((it, i) => flowItem('expenses', it, i)).join('')}
      <button class="add" data-add="expense">＋ Aggiungi spesa</button>
    </details>

    <details open>
      <summary>🌱 Eventi di vita</summary>
      ${p.events.map(eventItem).join('')}
      <div class="add-row">
        <button class="add" data-add="kid">＋ 👶 Figlio</button>
        <button class="add" data-add="house">＋ 🏠 Casa</button>
        <button class="add" data-add="oneoff">＋ ⭐ Una tantum</button>
      </div>
    </details>
    <p class="note">Importi in euro di oggi. Con crescita = inflazione una voce resta costante in potere d'acquisto.</p>`;
}

function renderPlanSelect() {
  $('#plan-select').innerHTML = state.plans
    .map((p) => `<option value="${p.id}" ${p.id === state.activeId ? 'selected' : ''}>${esc(p.name)}</option>`)
    .join('');
}

$('#editor').addEventListener('input', (e) => {
  const el = e.target;
  const path = el.dataset.path;
  if (!path) return;
  let value = el.value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.type === 'number') value = el.value === '' ? null : parseFloat(el.value);
  setPath(plan(), path, value);

  if (el.tagName === 'SELECT') {
    const ageInput = el.parentElement.querySelector('input');
    if (ageInput) {
      ageInput.disabled = el.value !== 'age';
      if (el.value === 'age' && ageInput.value === '') {
        ageInput.value = plan().profile.retirementAge;
        setPath(plan(), ageInput.dataset.path, Number(ageInput.value));
      }
    }
  }
  if (path.endsWith('.amount')) renderEditorIconsLater();
  scheduleUpdate();
});

// L'icona di una spesa una tantum cambia con il segno: la aggiorno senza perdere il focus
let iconTimer;
function renderEditorIconsLater() {
  clearTimeout(iconTimer);
  iconTimer = setTimeout(() => {
    plan().events.forEach((ev, i) => {
      if (ev.type !== 'oneoff') return;
      const icon = document.querySelector(`[data-path="events.${i}.name"]`)?.previousElementSibling;
      if (icon) icon.textContent = Number(ev.amount) >= 0 ? '🎁' : '⭐';
    });
  }, 300);
}

$('#editor').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const p = plan();
  if (btn.dataset.remove) {
    p[btn.dataset.remove].splice(Number(btn.dataset.index), 1);
  } else if (btn.dataset.add) {
    const kind = btn.dataset.add;
    const age = Number(p.profile.currentAge) + 2;
    if (kind === 'income') p.incomes.push(newIncome());
    else if (kind === 'expense') p.expenses.push(newExpense());
    else p.events.push(newEvent(kind, age));
  } else return;
  renderEditor();
  update();
});

// ---------- Gestione piani ----------

document.querySelector('.plans').addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.plan;
  if (!action) return;
  const p = plan();
  if (action === 'new') {
    const np = defaultPlan();
    np.name = `Piano ${state.plans.length + 1}`;
    state.plans.push(np);
    state.activeId = np.id;
  } else if (action === 'dup') {
    const np = structuredClone(p);
    np.id = uid();
    np.name = `${p.name} (copia)`;
    state.plans.push(np);
    state.activeId = np.id;
  } else if (action === 'rename') {
    const name = prompt('Nome del piano', p.name);
    if (!name) return;
    p.name = name;
  } else if (action === 'delete') {
    if (state.plans.length === 1) return alert('Serve almeno un piano.');
    if (!confirm(`Eliminare "${p.name}"?`)) return;
    state.plans = state.plans.filter((x) => x.id !== p.id);
    state.activeId = state.plans[0].id;
  } else if (action === 'export') {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `${p.name.replace(/\W+/g, '-').toLowerCase()}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  state.selectedAge = null;
  renderAll();
});

$('#plan-select').addEventListener('change', (e) => {
  state.activeId = e.target.value;
  state.selectedAge = null;
  renderAll();
});

$('#import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const p = JSON.parse(await file.text());
    if (!p.profile || !p.incomes) throw new Error('formato non valido');
    p.id = uid();
    state.plans.push(p);
    state.activeId = p.id;
    renderAll();
  } catch (err) {
    alert(`Impossibile importare il file: ${err.message}`);
  }
  e.target.value = '';
});

// ---------- Simulazione + output ----------

let result;
let mc;
let mcKey = '';

function getMonteCarlo() {
  const key = JSON.stringify(plan());
  if (key !== mcKey) {
    mc = monteCarlo(plan());
    mcKey = key;
  }
  return mc;
}

let timer;
function scheduleUpdate() {
  clearTimeout(timer);
  timer = setTimeout(update, 120);
}

function update() {
  result = simulate(plan());
  const ages = result.years.map((y) => y.age);
  if (state.selectedAge == null || !ages.includes(state.selectedAge)) {
    state.selectedAge = result.retireAge ?? ages[Math.floor(ages.length / 2)];
  }
  renderKpis();
  renderChart();
  renderMilestones();
  renderDetail();
  renderTable();
  save();
}

function renderKpis() {
  const { years, fiAge, retireAge, shortfallAge } = result;
  const at = (age) => years.find((y) => y.age === age);
  const ry = at(retireAge) ?? years.at(-1);
  const peak = years.reduce((m, y) => (shown(y, y.netWorth) > shown(m, m.netWorth) ? y : m), years[0]);
  const success = getMonteCarlo().successRate;
  const status = success >= 0.85 ? 'good' : success >= 0.6 ? 'warning' : 'critical';
  const statusIcon = { good: '✓', warning: '!', critical: '✕' }[status];

  $('#kpis').innerHTML = `
    <div class="kpi"><span>🚩 Indipendenza finanziaria</span>
      <strong>${fiAge != null ? `${fiAge} anni` : 'Non raggiunta'}</strong>
      <small>${fiAge != null ? `nel ${at(fiAge).year}` : 'aumenta risparmio o rendimento'}</small></div>
    <div class="kpi"><span>🏖️ Pensione</span>
      <strong>${retireAge != null ? `${retireAge} anni` : '—'}</strong>
      <small>patrimonio ${eurC.format(shown(ry, ry.netWorth))}</small></div>
    <div class="kpi"><span>📈 Patrimonio massimo</span>
      <strong>${eurC.format(shown(peak, peak.netWorth))}</strong>
      <small>a ${peak.age} anni (${peak.year})</small></div>
    <div class="kpi"><span>🎲 Probabilità di successo</span>
      <strong class="status-${status}"><i>${statusIcon}</i> ${Math.round(success * 100)}%</strong>
      <small>${shortfallAge != null ? `⚠️ scenario medio: soldi finiti a ${shortfallAge} anni` : 'scenari Monte Carlo senza restare a secco'}</small></div>`;
}

// ---------- Grafico ----------

const milestonePlugin = {
  id: 'milestones',
  afterDatasetsDraw(chart) {
    const items = chart.options.plugins.milestones?.items;
    if (!items?.length) return;
    const { ctx, chartArea, scales } = chart;
    const labels = chart.data.labels;
    const byAge = new Map();
    for (const m of items) byAge.set(m.age, [...(byAge.get(m.age) ?? []), m]);
    const surface = cssVar('--surface');
    const ring = cssVar('--border-strong');
    chart.$msPos = [];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '13px system-ui, sans-serif';
    // Ogni icona va nella prima riga libera, così le età vicine non si sovrappongono
    const rows = [];
    for (const [age, list] of byAge) {
      const idx = labels.indexOf(age);
      if (idx < 0) continue;
      const x = scales.x.getPixelForValue(idx);
      list.forEach((m) => {
        let j = 0;
        while ((rows[j] ?? -Infinity) > x - 24) j++;
        rows[j] = x;
        const y = chartArea.top + 11 + j * 24;
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.fillStyle = surface;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = m.bad ? cssVar('--critical') : ring;
        ctx.stroke();
        ctx.fillText(m.icon, x, y + 1);
        chart.$msPos.push({ x, y, m });
      });
    }
    const h = chart.$msHover;
    if (h) {
      const text = `${h.m.label} · ${h.m.age} anni`;
      ctx.font = '600 12px system-ui, sans-serif';
      const w = ctx.measureText(text).width + 16;
      const bx = Math.min(Math.max(h.x - w / 2, chartArea.left), chartArea.right - w);
      const by = h.y + 15;
      ctx.fillStyle = cssVar('--surface');
      ctx.strokeStyle = cssVar('--border-strong');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, w, 24, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = cssVar('--ink');
      ctx.textAlign = 'left';
      ctx.fillText(text, bx + 8, by + 12.5);
    }
    ctx.restore();
  },
  afterEvent(chart, args) {
    const e = args.event;
    const hit = (chart.$msPos ?? []).find((p) => Math.hypot(p.x - e.x, p.y - e.y) < 13) ?? null;
    if (hit?.m !== chart.$msHover?.m) {
      chart.$msHover = hit;
      args.changed = true;
    }
  },
};

const selectedLinePlugin = {
  id: 'selectedLine',
  beforeDatasetsDraw(chart) {
    const age = chart.options.plugins.selectedLine?.age;
    const idx = chart.data.labels.indexOf(age);
    if (idx < 0) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(idx);
    ctx.save();
    ctx.strokeStyle = cssVar('--ink-muted');
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

let chart;

function baseOptions() {
  const grid = cssVar('--grid');
  const muted = cssVar('--ink-muted');
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 4 } },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        border: { color: cssVar('--axis') },
        ticks: { color: muted, maxRotation: 0, autoSkipPadding: 12 },
        title: { display: true, text: 'Età', color: muted },
      },
      y: {
        stacked: true,
        grace: '18%',
        grid: { color: grid },
        border: { display: false },
        ticks: { color: muted, callback: (v) => eurC.format(v) },
      },
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: cssVar('--ink-2'), usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10 },
      },
      tooltip: {
        backgroundColor: cssVar('--surface'),
        titleColor: cssVar('--ink'),
        bodyColor: cssVar('--ink-2'),
        borderColor: cssVar('--border-strong'),
        borderWidth: 1,
        padding: 10,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: {
          title: (items) => {
            const y = result.years[items[0].dataIndex];
            return y ? `${y.age} anni · ${y.year}${y.retired ? ' · in pensione' : ''}` : '';
          },
          label: (c) => ` ${c.dataset.label}: ${eur.format(Math.abs(c.parsed.y))}`,
        },
      },
      milestones: { items: result.milestones },
      selectedLine: { age: state.selectedAge },
    },
    onClick: (evt, _els, ch) => {
      const idx = ch.scales.x.getValueForPixel(evt.x);
      const age = ch.data.labels[Math.round(idx)];
      if (age != null) {
        state.selectedAge = age;
        ch.options.plugins.selectedLine.age = age;
        ch.update('none');
        renderDetail();
        save();
      }
    },
  };
}

const bar = (label, data, color) => ({
  type: 'bar', label, data, backgroundColor: color, borderColor: cssVar('--surface'),
  borderWidth: { top: 1 }, borderRadius: 2, categoryPercentage: 0.9, barPercentage: 0.92, order: 2,
});
const line = (label, data, color, extra = {}) => ({
  type: 'line', label, data, borderColor: color, backgroundColor: color, borderWidth: 2,
  pointRadius: 0, pointHoverRadius: 4, tension: 0.25, order: 0, ...extra,
});

function renderChart() {
  const { years } = result;
  const labels = years.map((y) => y.age);
  const opts = baseOptions();
  let datasets;
  let hint = 'Clicca sul grafico per vedere il dettaglio di un anno. Passa sulle icone per i traguardi.';

  if (state.mode === 'networth') {
    datasets = [
      bar('Liquidità', years.map((y) => shown(y, y.cash)), cssVar('--c-cash')),
      bar('Investimenti', years.map((y) => shown(y, y.investments)), cssVar('--c-inv')),
      bar('Immobili', years.map((y) => shown(y, y.property)), cssVar('--c-prop')),
      bar('Debiti', years.map((y) => -shown(y, y.debt)), cssVar('--c-debt')),
      line('Patrimonio netto', years.map((y) => shown(y, y.netWorth)), cssVar('--ink'), { stack: 'nw' }),
    ];
  } else if (state.mode === 'cashflow') {
    datasets = [
      bar('Entrate', years.map((y) => shown(y, y.income)), cssVar('--c-inv')),
      bar('Uscite', years.map((y) => -shown(y, y.expenses)), cssVar('--c-debt')),
      line('Risparmio netto', years.map((y) => shown(y, y.net)), cssVar('--ink'), { stack: 'net', tension: 0 }),
    ];
  } else if (state.mode === 'montecarlo') {
    const m = getMonteCarlo();
    const conv = (arr) => arr.map((v, i) => shown(years[i], v));
    const outer = cssVar('--seq-1');
    const inner = cssVar('--seq-2');
    const median = cssVar('--seq-3');
    opts.scales.x.stacked = false;
    opts.scales.y.stacked = false;
    const band = { borderWidth: 1, tension: 0.3 };
    datasets = [
      line('Migliore 10%', conv(m.p90), outer, { ...band, fill: '+4', backgroundColor: alpha(outer, 0.18) }),
      line('Migliore 25%', conv(m.p75), inner, { ...band, fill: '+2', backgroundColor: alpha(inner, 0.22) }),
      line('Mediana', conv(m.p50), median, { borderWidth: 2.5, tension: 0.3 }),
      line('Peggiore 25%', conv(m.p25), inner, band),
      line('Peggiore 10%', conv(m.p10), outer, band),
      line('Scenario medio (rendimento fisso)', years.map((y) => shown(y, y.netWorth)), cssVar('--ink-muted'), { borderDash: [5, 4], borderWidth: 1.5 }),
    ];
    hint = `500 simulazioni con rendimenti casuali (media ${plan().profile.investReturn}%, volatilità ${plan().profile.investVolatility}%). Successo = non finire mai i soldi.`;
  } else {
    opts.scales.x.stacked = false;
    opts.scales.y.stacked = false;
    opts.plugins.milestones.items = [];
    opts.interaction = { mode: 'nearest', axis: 'x', intersect: false };
    const palette = ['--c-inv', '--c-debt', '--c-cash', '--c-prop'].map(cssVar);
    const runs = state.plans.slice(0, 4).map((p) => ({ p, r: simulate(p) }));
    const minAge = Math.min(...runs.map(({ r }) => r.years[0].age));
    const maxAge = Math.max(...runs.map(({ r }) => r.years.at(-1).age));
    labels.length = 0;
    for (let a = minAge; a <= maxAge; a++) labels.push(a);
    datasets = runs.map(({ p, r }, i) => line(
      p.name,
      labels.map((a) => {
        const y = r.years.find((yy) => yy.age === a);
        return y ? shown(y, y.netWorth) : null;
      }),
      palette[i],
      { borderWidth: p.id === state.activeId ? 3 : 2 },
    ));
    opts.plugins.tooltip.callbacks.title = (items) => `${items[0].label} anni`;
    hint = state.plans.length > 1
      ? 'Patrimonio netto dei tuoi piani (max 4). Usa "Duplica" per creare varianti e confrontarle.'
      : 'Hai un solo piano: usa "Duplica" per creare uno scenario alternativo (es. due figli, casa più grande, pensione anticipata).';
  }

  if (chart) chart.destroy();
  chart = new Chart($('#chart'), {
    data: { labels, datasets },
    options: opts,
    plugins: [milestonePlugin, selectedLinePlugin],
  });
  $('#chart-hint').textContent = hint;
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
}

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const mode = e.target.closest('[data-mode]')?.dataset.mode;
  if (!mode) return;
  state.mode = mode;
  renderChart();
  save();
});

$('#real').addEventListener('change', (e) => {
  state.real = e.target.checked;
  update();
});

// ---------- Traguardi, dettaglio anno, tabella ----------

function renderMilestones() {
  const yearOf = (age) => result.years.find((y) => y.age === age)?.year;
  $('#milestones').innerHTML = result.milestones
    .map((m) => `
      <li class="${m.bad ? 'bad' : ''}" data-age="${m.age}">
        <span class="ms-icon">${m.icon}</span>
        <span class="ms-label">${esc(m.label)}</span>
        <span class="ms-when">${m.age} anni · ${yearOf(m.age)}</span>
      </li>`)
    .join('') || '<li>Nessun traguardo nel periodo simulato.</li>';
}

$('#milestones').addEventListener('click', (e) => {
  const li = e.target.closest('[data-age]');
  if (!li) return;
  state.selectedAge = Number(li.dataset.age);
  renderChart();
  renderDetail();
});

function renderDetail() {
  const { years } = result;
  const y = years.find((yy) => yy.age === state.selectedAge) ?? years[0];
  const v = (x) => eur.format(shown(y, x));
  const rows = (items) => items
    .slice()
    .sort((a, b) => b.v - a.v)
    .map((i) => `<li><span>${esc(i.name)}</span><span>${v(i.v)}</span></li>`)
    .join('') || '<li class="muted"><span>Nessuna</span></li>';

  $('#detail').innerHTML = `
    <div class="detail-head">
      <h2>${y.age} anni <small>· ${y.year}${y.retired ? ' · 🏖️ in pensione' : ''}</small></h2>
      <input type="range" id="age-slider" min="${years[0].age}" max="${years.at(-1).age}" value="${y.age}" aria-label="Seleziona età">
    </div>
    <div class="detail-cols">
      <div>
        <h3>Patrimonio netto <b>${v(y.netWorth)}</b></h3>
        <ul class="rows">
          <li><span><i class="sw" style="background:var(--c-cash)"></i>Liquidità</span><span>${v(y.cash)}</span></li>
          <li><span><i class="sw" style="background:var(--c-inv)"></i>Investimenti</span><span>${v(y.investments)}</span></li>
          <li><span><i class="sw" style="background:var(--c-prop)"></i>Immobili</span><span>${v(y.property)}</span></li>
          <li><span><i class="sw" style="background:var(--c-debt)"></i>Debiti</span><span>${y.debt > 0 ? '−' : ''}${v(y.debt)}</span></li>
        </ul>
        <h3>Rendimento investimenti <b>${v(y.invGain)}</b></h3>
        <h3>Risparmio netto <b class="${y.net < 0 ? 'neg' : 'pos'}">${y.net < 0 ? '−' : '+'}${v(Math.abs(y.net))}</b></h3>
      </div>
      <div>
        <h3>Entrate <b>${v(y.income)}</b></h3>
        <ul class="rows">${rows(y.inc)}</ul>
        <h3>Uscite <b>${v(y.expenses)}</b></h3>
        <ul class="rows">${rows(y.exp)}</ul>
      </div>
    </div>`;

  $('#age-slider').addEventListener('input', (e) => {
    state.selectedAge = Number(e.target.value);
    chart.options.plugins.selectedLine.age = state.selectedAge;
    chart.update('none');
    renderDetail();
    $('#age-slider').focus();
  });
}

function renderTable() {
  const c = (y, x) => eur.format(shown(y, x));
  $('#table').innerHTML = `
    <table>
      <thead><tr><th>Età</th><th>Anno</th><th>Entrate</th><th>Uscite</th><th>Risparmio</th>
        <th>Liquidità</th><th>Investimenti</th><th>Immobili</th><th>Debiti</th><th>Patrimonio netto</th></tr></thead>
      <tbody>${result.years.map((y) => `
        <tr class="${y.retired ? 'retired' : ''}"><td>${y.age}</td><td>${y.year}</td><td>${c(y, y.income)}</td><td>${c(y, y.expenses)}</td>
        <td class="${y.net < 0 ? 'neg' : ''}">${c(y, y.net)}</td><td>${c(y, y.cash)}</td><td>${c(y, y.investments)}</td>
        <td>${c(y, y.property)}</td><td>${c(y, y.debt)}</td><td><b>${c(y, y.netWorth)}</b></td></tr>`).join('')}
      </tbody>
    </table>`;
}

// ---------- Avvio ----------

function renderAll() {
  renderPlanSelect();
  renderEditor();
  $('#real').checked = state.real;
  update();
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderChart());
renderAll();
