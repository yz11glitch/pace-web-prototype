import {
  DEFAULT_SETTINGS,
  Settings,
  Transaction,
  summary,
} from '../app/lib/data';
import {
  HOME_SIGNAL_LIMIT,
  Signal,
  computeSignals,
} from '../app/lib/signals';

interface Scenario {
  name: string;
  description: string;
  txns: Transaction[];
  settings?: Settings;
}

interface ScenarioResult {
  scenario: Scenario;
  settings: Settings;
  signals: Signal[];
}

let transactionId = 0;

function txn(
  type: Transaction['type'],
  cat: string,
  name: string,
  amt: number,
  day = 5,
): Transaction {
  transactionId += 1;
  return {
    id: `stress-${transactionId}`,
    type,
    cat,
    name,
    note: 'Signal stress test',
    amt,
    date: new Date(2026, 5, day).toISOString(),
  };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    budgets: {
      ...DEFAULT_SETTINGS.budgets,
      ...overrides.budgets,
    },
  };
}

function zeroBudgets(): Record<string, number> {
  return Object.fromEntries(
    Object.keys(DEFAULT_SETTINGS.budgets).map(category => [category, 0]),
  );
}

function expenses(entries: Array<[string, string, number, number?]>): Transaction[] {
  return entries.map(([cat, name, amt, day]) => txn('expense', cat, name, amt, day));
}

const balancedExpenses = expenses([
  ['food', 'Kopitiam', 180, 3],
  ['groc', 'Jaya Grocer', 220, 5],
  ['tpt', 'Rapid KL', 90, 6],
  ['bill', 'Utilities', 180, 7],
  ['ent', 'Cinema', 45, 9],
]);

const grabExpenses = Array.from(
  { length: 7 },
  (_, index) => txn('expense', 'tpt', 'Grab', 14 + index, index + 1),
);

const validSafetyExpense = txn('expense', 'food', 'Valid lunch', 40, 4);
const invalidSafetyTxns = [
  validSafetyExpense,
  txn('expense', 'food', 'Negative amount', -100, 5),
  txn('expense', 'food', 'Zero amount', 0, 6),
  txn('expense', 'food', 'NaN amount', Number.NaN, 7),
  txn('expense', 'food', 'Infinite amount', Number.POSITIVE_INFINITY, 8),
];

const scenarios: Scenario[] = [
  {
    name: 'Empty new user',
    description: 'No transactions yet; should show the onboarding welcome signal.',
    txns: [],
  },
  {
    name: 'Normal balanced month',
    description: 'Moderate spending spread across everyday categories.',
    txns: balancedExpenses,
  },
  {
    name: 'Food-heavy month',
    description: 'Food spending is consuming its budget much faster than the month.',
    txns: expenses([
      ['food', 'Restaurants', 520, 8],
      ['groc', 'Groceries', 80, 4],
      ['tpt', 'Transit', 60, 6],
    ]),
  },
  {
    name: 'Groceries over budget',
    description: 'Groceries exceed their category budget while other spending stays light.',
    txns: expenses([
      ['groc', 'Weekly groceries', 675, 8],
      ['food', 'Lunches', 90, 5],
    ]),
  },
  {
    name: 'Shopping overspend',
    description: 'Shopping is deliberately above its monthly category budget.',
    txns: expenses([
      ['shop', 'Online shopping', 380, 9],
      ['food', 'Meals', 100, 5],
    ]),
  },
  {
    name: 'Transport/Grab frequent small transactions',
    description: 'Seven low-value Grab rides should trigger repeated-merchant insight.',
    txns: grabExpenses,
  },
  {
    name: 'Strong investing month',
    description: 'Investing exceeds the default monthly target.',
    txns: [
      txn('invest', 'robo', 'Robo portfolio', 900, 2),
      ...expenses([['food', 'Meals', 180, 7]]),
    ],
  },
  {
    name: 'No income set',
    description: 'Transactions exist, but configured monthly income is zero.',
    txns: expenses([['food', 'Lunch', 45, 4]]),
    settings: settings({ income: 0 }),
  },
  {
    name: 'No budgets set',
    description: 'All category budgets are zero; the engine should stay stable.',
    txns: expenses([['food', 'Lunch', 45, 4]]),
    settings: settings({ budgets: zeroBudgets() }),
  },
  {
    name: 'No investing target',
    description: 'Investing activity exists without a configured target.',
    txns: [
      txn('invest', 'stocks', 'Index fund', 300, 2),
      ...expenses([['groc', 'Groceries', 120, 6]]),
    ],
    settings: settings({ investTarget: 0 }),
  },
  {
    name: 'End-of-month tight budget',
    description: 'Late-dated spending leaves little budget; output also shows the engine snapshot day.',
    txns: expenses([
      ['food', 'Month-end meals', 760, 28],
      ['groc', 'Month-end groceries', 560, 29],
      ['tpt', 'Month-end transport', 360, 29],
      ['shop', 'Month-end shopping', 270, 30],
      ['bill', 'Month-end bills', 480, 30],
      ['ent', 'Month-end entertainment', 175, 30],
      ['hlth', 'Month-end health', 130, 30],
      ['edu', 'Month-end education', 85, 30],
      ['misc', 'Month-end other', 135, 30],
    ]),
  },
  {
    name: 'Invalid/negative/zero amounts safety',
    description: 'Invalid, negative, zero, NaN, and infinite amounts accompany one valid expense.',
    txns: invalidSafetyTxns,
  },
];

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  const marker = condition ? 'PASS' : 'FAIL';
  console.log(`  [${marker}] ${message}`);
  if (!condition) failures.push(message);
}

function printScenario(scenario: Scenario): ScenarioResult {
  const scenarioSettings = scenario.settings ?? settings();
  const validTxns = scenario.txns.filter(transaction => (
    Number.isFinite(transaction.amt) && transaction.amt > 0
  ));
  const totals = summary(validTxns, scenarioSettings);
  const signals = computeSignals(scenario.txns, scenarioSettings);

  console.log(`\n${'='.repeat(78)}`);
  console.log(`Scenario: ${scenario.name}`);
  console.log(`Description: ${scenario.description}`);
  console.log(
    `Totals: spent=${totals.totalSpent}, invested=${totals.totalInvest}, `
    + `budget=${totals.totalBudget}, remaining=${totals.remaining}`,
  );
  console.log(
    `Inputs: ${scenario.txns.length} transactions, `
    + `${scenario.txns.length - validTxns.length} invalid amounts ignored`,
  );
  console.log(
    `Engine snapshot: day ${totals.day}/${totals.daysInMonth}, `
    + `${totals.daysLeft} days left`,
  );
  console.log(`Signals (${signals.length}/${HOME_SIGNAL_LIMIT} max):`);

  if (signals.length === 0) console.log('  (none)');

  signals.forEach(signal => {
    console.log(`  - id: ${signal.id}`);
    console.log(`    title: ${signal.title}`);
    console.log(`    body/description: ${signal.sub}`);
    console.log(`    severity: ${signal.type}`);
    console.log(`    tone: ${signal.tone}`);
    console.log(`    priority: ${signal.priority}`);
  });

  return { scenario, settings: scenarioSettings, signals };
}

function findResult(results: ScenarioResult[], name: string): ScenarioResult {
  const result = results.find(item => item.scenario.name === name);
  if (!result) throw new Error(`Missing scenario result: ${name}`);
  return result;
}

console.log('Pace Home signal stress tester');
console.log('Scenario dates are deterministic; signal summary currently uses its app snapshot date.');

const results = scenarios.map(printScenario);

console.log(`\n${'='.repeat(78)}`);
console.log('Expectation checks:');

const empty = findResult(results, 'Empty new user');
check(
  empty.signals.some(signal => signal.id === 'welcome'),
  'Empty user shows the welcome/onboarding signal.',
);

const foodHeavy = findResult(results, 'Food-heavy month');
check(
  foodHeavy.signals.some(signal => signal.id.endsWith(':food')),
  'Food-heavy month produces a food category signal.',
);

const shopping = findResult(results, 'Shopping overspend');
check(
  shopping.signals.some(signal => signal.id === 'cat-over:shop'),
  'Shopping overspend produces the shopping over-budget signal.',
);

const frequentGrab = findResult(results, 'Transport/Grab frequent small transactions');
check(
  frequentGrab.signals.some(signal => (
    signal.id === 'small-adds:Grab' || signal.id === 'merchant-frequent:Grab'
  )),
  'Frequent Grab spending produces a merchant/frequent-spending signal.',
);

const noIncome = findResult(results, 'No income set');
check(
  Array.isArray(noIncome.signals),
  'No income configuration completes without crashing.',
);

const noBudgets = findResult(results, 'No budgets set');
check(
  Array.isArray(noBudgets.signals),
  'No budgets configuration completes without crashing.',
);

const invalid = findResult(results, 'Invalid/negative/zero amounts safety');
const validOnlySignals = computeSignals([validSafetyExpense], invalid.settings);
check(
  JSON.stringify(invalid.signals) === JSON.stringify(validOnlySignals),
  'Invalid amounts are ignored and do not change signal output.',
);

for (const result of results) {
  check(
    result.signals.length <= HOME_SIGNAL_LIMIT,
    `${result.scenario.name} stays within the Home signal limit.`,
  );
}

console.log(`\n${'='.repeat(78)}`);
if (failures.length > 0) {
  console.error(`Signal stress test failed with ${failures.length} expectation failure(s).`);
  process.exitCode = 1;
} else {
  console.log(`All ${results.length} scenarios and expectations passed.`);
}
