export const uid = () => Math.random().toString(36).slice(2, 10);

// Gli importi sono annuali e netti, espressi in euro di oggi.
// "growth" è la crescita nominale annua (con crescita = inflazione l'importo resta costante in termini reali).
export const newIncome = () => ({
  id: uid(), name: 'Nuova entrata', amount: 10000, growth: 2,
  startMode: 'now', startAge: null, endMode: 'retirement', endAge: null,
});

export const newExpense = () => ({
  id: uid(), name: 'Nuova spesa', amount: 3000, growth: 2,
  startMode: 'now', startAge: null, endMode: 'death', endAge: null,
});

export const newEvent = (type, age) => {
  if (type === 'kid') return { id: uid(), type, name: 'Figlio', age, annualCost: 8000, years: 22 };
  if (type === 'house') return {
    id: uid(), type, name: 'Casa', age, price: 250000, downPct: 20, rate: 3.5,
    years: 25, appreciation: 2, costPct: 1,
  };
  return { id: uid(), type: 'oneoff', name: 'Evento', age, amount: -10000 };
};

export const defaultPlan = () => ({
  id: uid(),
  name: 'Piano base',
  profile: {
    currentAge: 30,
    lifeExpectancy: 90,
    retirementAge: 65,
    retireAtFI: false,
    swr: 4,
    inflation: 2,
    investReturn: 6,
    investVolatility: 15,
    cashRate: 1,
    cashBufferMonths: 6,
  },
  accounts: { cash: 15000, investments: 20000 },
  incomes: [
    { id: uid(), name: 'Stipendio', amount: 30000, growth: 3, startMode: 'now', startAge: null, endMode: 'retirement', endAge: null },
    { id: uid(), name: 'Stipendio partner', amount: 24000, growth: 2.5, startMode: 'now', startAge: null, endMode: 'retirement', endAge: null },
    { id: uid(), name: 'Pensione', amount: 26000, growth: 2, startMode: 'age', startAge: 67, endMode: 'death', endAge: null },
  ],
  expenses: [
    { id: uid(), name: 'Spese di vita', amount: 22000, growth: 2, startMode: 'now', startAge: null, endMode: 'death', endAge: null },
    { id: uid(), name: 'Affitto', amount: 9600, growth: 2, startMode: 'now', startAge: null, endMode: 'age', endAge: 34 },
    { id: uid(), name: 'Viaggi', amount: 3000, growth: 2, startMode: 'now', startAge: null, endMode: 'age', endAge: 80 },
  ],
  events: [
    { id: uid(), type: 'oneoff', name: 'Matrimonio', age: 32, amount: -20000 },
    { id: uid(), type: 'kid', name: 'Figlio #1', age: 33, annualCost: 8000, years: 22 },
    { id: uid(), type: 'house', name: 'Prima casa', age: 34, price: 280000, downPct: 20, rate: 3.5, years: 25, appreciation: 2, costPct: 1 },
    { id: uid(), type: 'kid', name: 'Figlio #2', age: 36, annualCost: 8000, years: 22 },
    { id: uid(), type: 'oneoff', name: 'Eredità', age: 60, amount: 50000 },
  ],
});
