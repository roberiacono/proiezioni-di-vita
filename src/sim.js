const pct = (v) => (Number(v) || 0) / 100;
const num = (v) => Number(v) || 0;
const sum = (items) => items.reduce((s, i) => s + i.v, 0);

function isActive(item, age, retired) {
  const started =
    item.startMode === 'retirement' ? retired :
    item.startMode === 'age' ? age >= num(item.startAge) : true;
  const ended =
    item.endMode === 'retirement' ? retired :
    item.endMode === 'age' ? age >= num(item.endAge) : false;
  return started && !ended;
}

const NW_TARGETS = [
  [100_000, '💰', 'Primi 100k'],
  [500_000, '💎', 'Mezzo milione'],
  [1_000_000, '🎉', 'Primo milione'],
];

/**
 * Simula anno per anno dall'età attuale all'aspettativa di vita.
 * `returns` (opzionale) è un array di rendimenti annui per il Monte Carlo;
 * se assente si usa il rendimento medio atteso.
 * Tutti i valori restituiti sono nominali; `defl` converte in euro di oggi.
 */
export function simulate(plan, returns = null) {
  const p = plan.profile;
  const a0 = Math.round(num(p.currentAge));
  const aEnd = Math.max(a0, Math.round(num(p.lifeExpectancy)));
  const infl = pct(p.inflation);
  const mu = pct(p.investReturn);
  const cashRate = pct(p.cashRate);
  const swr = pct(p.swr) || 0.04;
  const nowYear = new Date().getFullYear();

  let cash = num(plan.accounts.cash);
  let inv = num(plan.accounts.investments);
  const houses = plan.events
    .filter((e) => e.type === 'house')
    .map((h) => ({ ...h, owned: false, value: 0, loan: 0, payment: 0 }));

  let retired = false;
  let retireAge = null, fiAge = null, shortfallAge = null;
  const nwHit = new Set();
  const milestones = [];
  const years = [];

  for (let age = a0, t = 0; age <= aEnd; age++, t++) {
    const defl = (1 + infl) ** t;

    if (!retired && (age >= num(p.retirementAge) || (p.retireAtFI && fiAge !== null))) {
      retired = true;
      retireAge = age;
      milestones.push({ age, icon: '🏖️', label: 'Pensione' });
    }

    // Rendimenti sui saldi di inizio anno
    const r = returns ? returns[t] : mu;
    const invGain = inv > 0 ? inv * r : 0;
    inv += invGain;
    if (cash > 0) cash += cash * cashRate;

    const inc = [];
    const exp = [];
    for (const i of plan.incomes) {
      if (isActive(i, age, retired)) inc.push({ name: i.name, v: num(i.amount) * (1 + pct(i.growth)) ** t });
    }
    for (const e of plan.expenses) {
      if (isActive(e, age, retired)) exp.push({ name: e.name, v: num(e.amount) * (1 + pct(e.growth)) ** t });
    }

    for (const ev of plan.events) {
      const evAge = num(ev.age);
      if (ev.type === 'kid' && age >= evAge && age < evAge + num(ev.years)) {
        exp.push({ name: ev.name, v: num(ev.annualCost) * defl });
      } else if (ev.type === 'oneoff' && age === evAge) {
        const v = num(ev.amount) * defl;
        (v >= 0 ? inc : exp).push({ name: ev.name, v: Math.abs(v), oneoff: true });
      }
    }

    for (const h of houses) {
      if (age === num(h.age)) {
        const price = num(h.price) * defl;
        const down = price * pct(h.downPct);
        const rate = pct(h.rate);
        const n = Math.max(1, num(h.years));
        h.owned = true;
        h.value = price;
        h.loan = price - down;
        h.payment = rate ? (h.loan * rate) / (1 - (1 + rate) ** -n) : h.loan / n;
        exp.push({ name: `${h.name} – anticipo`, v: down, oneoff: true });
        continue;
      }
      if (!h.owned) continue;
      h.value *= 1 + pct(h.appreciation);
      if (h.loan > 0) {
        const interest = h.loan * pct(h.rate);
        const pay = Math.min(h.payment, h.loan + interest);
        h.loan = h.loan + interest - pay;
        exp.push({ name: `${h.name} – rata mutuo`, v: pay });
        if (h.loan < 1) {
          h.loan = 0;
          milestones.push({ age, icon: '✅', label: `${h.name}: mutuo estinto` });
        }
      }
      exp.push({ name: `${h.name} – manutenzione e tasse`, v: h.value * pct(h.costPct) });
    }

    const income = sum(inc);
    const expenses = sum(exp);
    const recurringExp = sum(exp.filter((e) => !e.oneoff));
    const net = income - expenses;

    // Il surplus riempie prima il fondo di emergenza, poi va investito.
    // Il deficit si copre prima con la liquidità, poi vendendo investimenti.
    if (net >= 0) {
      const target = (recurringExp / 12) * num(p.cashBufferMonths);
      const toCash = Math.max(0, Math.min(net, target - cash));
      cash += toCash;
      inv += net - toCash;
    } else {
      let need = -net;
      const fromCash = Math.min(need, Math.max(cash, 0));
      cash -= fromCash;
      need -= fromCash;
      const fromInv = Math.min(need, Math.max(inv, 0));
      inv -= fromInv;
      need -= fromInv;
      cash -= need; // scoperto
    }

    // Ricostituisce il fondo di emergenza vendendo investimenti (es. in pensione)
    const buffer = (recurringExp / 12) * num(p.cashBufferMonths);
    if (cash < buffer && inv > 0) {
      const move = Math.min(buffer - cash, inv);
      cash += move;
      inv -= move;
    }

    if (cash < -1 && shortfallAge === null) {
      shortfallAge = age;
      milestones.push({ age, icon: '⚠️', label: 'Soldi finiti', bad: true });
    }

    const property = houses.reduce((s, h) => s + (h.owned ? h.value : 0), 0);
    const mortgage = houses.reduce((s, h) => s + h.loan, 0);
    const overdraft = cash < 0 ? -cash : 0;
    const debt = mortgage + overdraft;
    const liquid = Math.max(cash, 0) + inv;
    const netWorth = liquid + property - debt;

    if (fiAge === null && recurringExp > 0 && liquid >= recurringExp / swr) {
      fiAge = age;
      milestones.push({ age, icon: '🚩', label: 'Indipendenza finanziaria' });
    }
    for (const [target, icon, label] of NW_TARGETS) {
      if (!nwHit.has(target) && netWorth / defl >= target) {
        nwHit.add(target);
        milestones.push({ age, icon, label });
      }
    }

    years.push({
      age, year: nowYear + t, defl, retired,
      inc, exp, income, expenses, net, invGain,
      cash: Math.max(cash, 0), investments: inv, property, mortgage, overdraft, debt,
      liquid, netWorth,
    });
  }

  for (const ev of plan.events) {
    const age = num(ev.age);
    if (age < a0 || age > aEnd) continue;
    const icon = ev.type === 'kid' ? '👶' : ev.type === 'house' ? '🏠' : num(ev.amount) >= 0 ? '🎁' : '⭐';
    milestones.push({ age, icon, label: ev.name });
  }
  milestones.sort((a, b) => a.age - b.age);

  return { years, milestones, retireAge, fiAge, shortfallAge, success: shortfallAge === null };
}

// PRNG deterministico: stessi input → stesso grafico Monte Carlo a ogni ridisegno
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function monteCarlo(plan, runs = 500) {
  const p = plan.profile;
  const n = Math.max(0, Math.round(num(p.lifeExpectancy)) - Math.round(num(p.currentAge))) + 1;
  const mu = pct(p.investReturn);
  const sd = pct(p.investVolatility);
  const rand = mulberry32(42);
  const normal = () => {
    const u = 1 - rand();
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const series = Array.from({ length: n }, () => new Float64Array(runs));
  let ok = 0;
  for (let k = 0; k < runs; k++) {
    const returns = Array.from({ length: n }, () => Math.max(-0.9, mu + sd * normal()));
    const res = simulate(plan, returns);
    if (res.success) ok++;
    res.years.forEach((y, i) => { series[i][k] = y.netWorth; });
  }

  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(f * arr.length))];
  const out = { p10: [], p25: [], p50: [], p75: [], p90: [], successRate: ok / runs };
  for (const col of series) {
    col.sort();
    out.p10.push(q(col, 0.1));
    out.p25.push(q(col, 0.25));
    out.p50.push(q(col, 0.5));
    out.p75.push(q(col, 0.75));
    out.p90.push(q(col, 0.9));
  }
  return out;
}
