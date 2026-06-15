import { DEFAULT_SETTINGS, Settings, Transaction } from './data';

export type PaceTheme = 'light' | 'dark' | 'auto';

export interface PaceBackupData {
  transactions: Transaction[];
  settings: Settings;
  theme: PaceTheme;
}

export interface PaceBackup {
  app: 'Pace';
  version: 1;
  exportedAt: string;
  data: PaceBackupData;
}

const TXN_TYPES = new Set<Transaction['type']>(['expense', 'income', 'invest']);
const THEMES = new Set<PaceTheme>(['light', 'dark', 'auto']);
const CURRENCIES = new Set(['RM', '$', 'S$', '€', '£']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseTransaction(value: unknown): Transaction | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.type !== 'string' ||
    !TXN_TYPES.has(value.type as Transaction['type']) ||
    typeof value.cat !== 'string' ||
    !value.cat ||
    typeof value.name !== 'string' ||
    typeof value.note !== 'string' ||
    !isFiniteNumber(value.amt) ||
    value.amt < 0 ||
    typeof value.date !== 'string' ||
    Number.isNaN(Date.parse(value.date))
  ) return null;

  return {
    id: value.id,
    type: value.type as Transaction['type'],
    cat: value.cat,
    name: value.name,
    note: value.note,
    amt: value.amt,
    date: value.date,
  };
}

function parseSettings(value: unknown): Settings | null {
  if (!isRecord(value) || !isRecord(value.budgets)) return null;

  const budgets: Record<string, number> = {};
  for (const [category, amount] of Object.entries(value.budgets)) {
    if (!category || !isFiniteNumber(amount) || amount < 0) return null;
    budgets[category] = amount;
  }
  if (Object.keys(DEFAULT_SETTINGS.budgets).some(category => !(category in budgets))) {
    return null;
  }

  if (
    !isFiniteNumber(value.income) ||
    value.income < 0 ||
    !isFiniteNumber(value.savingTarget) ||
    value.savingTarget < 0 ||
    !isFiniteNumber(value.investTarget) ||
    value.investTarget < 0 ||
    typeof value.currency !== 'string' ||
    !CURRENCIES.has(value.currency) ||
    typeof value.notifications !== 'boolean' ||
    typeof value.roundUps !== 'boolean'
  ) return null;

  return {
    income: value.income,
    savingTarget: value.savingTarget,
    investTarget: value.investTarget,
    currency: value.currency,
    budgets: { ...DEFAULT_SETTINGS.budgets, ...budgets },
    notifications: value.notifications,
    roundUps: value.roundUps,
  };
}

export function createBackup(data: PaceBackupData): PaceBackup {
  return {
    app: 'Pace',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function parseBackup(value: unknown): PaceBackup {
  if (
    !isRecord(value) ||
    value.app !== 'Pace' ||
    value.version !== 1 ||
    typeof value.exportedAt !== 'string' ||
    Number.isNaN(Date.parse(value.exportedAt)) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.transactions) ||
    typeof value.data.theme !== 'string' ||
    !THEMES.has(value.data.theme as PaceTheme)
  ) {
    throw new Error('This file is not a valid Pace backup.');
  }

  const transactions = value.data.transactions.map(parseTransaction);
  const settings = parseSettings(value.data.settings);
  if (transactions.some(transaction => transaction === null) || !settings) {
    throw new Error('This Pace backup contains invalid or incomplete data.');
  }

  const ids = new Set<string>();
  for (const transaction of transactions) {
    if (!transaction || ids.has(transaction.id)) {
      throw new Error('This Pace backup contains duplicate transaction IDs.');
    }
    ids.add(transaction.id);
  }

  return {
    app: 'Pace',
    version: 1,
    exportedAt: value.exportedAt,
    data: {
      transactions: transactions as Transaction[],
      settings,
      theme: value.data.theme as PaceTheme,
    },
  };
}
