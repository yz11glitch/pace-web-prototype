import {
  CATEGORIES,
  Category,
  Settings,
  Transaction,
  categoryTotals,
  money,
  summary,
} from './data';

export type SignalType = 'good' | 'watch' | 'warning' | 'insight' | 'goal';
type SignalTone = 'warm' | 'green' | 'blue';

export interface Signal {
  id: string;
  type: SignalType;
  tone: SignalTone;
  icon: string;
  cat?: Category;
  title: string;
  sub: string;
  priority: number;
}

interface MerchantStats {
  name: string;
  count: number;
  total: number;
  avg: number;
}

interface SignalContext {
  txns: Transaction[];
  expenses: Transaction[];
  settings: Settings;
  sum: ReturnType<typeof summary>;
  totals: Record<string, number>;
  monthFrac: number;
  merchants: MerchantStats[];
}

const FAST_SPEED = 1.15;
const NEAR_FRAC = 0.85;
const PACE_AHEAD_MULT = 1.10;
const MERCHANT_MIN_N = 4;
const SMALL_TXN_MAX = 25;
const SMALL_ADDS_MIN_N = 5;
const MIN_ELAPSED_DAYS = 3;
const INVEST_CLOSE = 0.80;
const LOW_CAT_FLOOR = 30;

export const HOME_SIGNAL_LIMIT = 4;
export const MAX_WARNINGS = 2;

export function toneFor(type: SignalType): SignalTone {
  if (type === 'good' || type === 'goal') return 'green';
  if (type === 'insight') return 'blue';
  return 'warm';
}

function createSignal(signal: Omit<Signal, 'tone'>): Signal {
  return { ...signal, tone: toneFor(signal.type) };
}

function merchantIndex(expenses: Transaction[]): MerchantStats[] {
  const merchants = new Map<string, Omit<MerchantStats, 'avg'>>();

  expenses.forEach(txn => {
    const current = merchants.get(txn.name) || { name: txn.name, count: 0, total: 0 };
    current.count += 1;
    current.total += txn.amt;
    merchants.set(txn.name, current);
  });

  return [...merchants.values()].map(merchant => ({
    ...merchant,
    avg: merchant.count > 0 ? merchant.total / merchant.count : 0,
  }));
}

export function buildSignalContext(txns: Transaction[], settings: Settings): SignalContext {
  const safeTxns = txns.filter(txn => Number.isFinite(txn.amt) && txn.amt > 0);
  const expenses = safeTxns.filter(txn => txn.type === 'expense');
  const sum = summary(safeTxns, settings);
  const monthFrac = sum.daysInMonth > 0 ? sum.day / sum.daysInMonth : 0;

  return {
    txns: safeTxns,
    expenses,
    settings,
    sum,
    totals: categoryTotals(expenses),
    monthFrac,
    merchants: merchantIndex(expenses),
  };
}

export function catSpeed(spent: number, budget: number, monthFrac: number): number {
  if (spent <= 0 || budget <= 0 || monthFrac <= 0) return 0;
  return (spent / budget) / monthFrac;
}

function amount(ctx: SignalContext, value: number, cents = false): string {
  return money(value, { cents, cur: ctx.settings.currency });
}

function detectWelcome(ctx: SignalContext): Signal | null {
  if (ctx.expenses.length > 0) return null;
  return createSignal({
    id: 'welcome',
    type: 'insight',
    icon: 'sparkle',
    title: 'Add your first expense',
    sub: 'Tap + to start tracking and your signals appear here.',
    priority: 999,
  });
}

function detectSetup(ctx: SignalContext): Signal | null {
  if (ctx.txns.length === 0) return null;

  if (ctx.settings.income <= 0) {
    return createSignal({
      id: 'setup-income',
      type: 'insight',
      icon: 'wallet',
      title: 'Set your monthly income',
      sub: 'It unlocks saving and investing signals.',
      priority: 200,
    });
  }

  if (ctx.sum.totalBudget <= 0) {
    return createSignal({
      id: 'setup-budgets',
      type: 'insight',
      icon: 'target',
      title: 'Set a few budgets',
      sub: 'Pace can then show your spending pace by category.',
      priority: 200,
    });
  }

  return null;
}

function detectBudget(ctx: SignalContext): Signal[] {
  const { sum } = ctx;
  if (sum.totalBudget <= 0) return [];

  if (sum.remaining <= 0) {
    return [createSignal({
      id: 'budget-reached',
      type: 'warning',
      icon: 'wallet',
      title: "You've reached your monthly budget",
      sub: `${amount(ctx, -sum.remaining)} over your total limit so far.`,
      priority: 100,
    })];
  }

  if (
    sum.day >= MIN_ELAPSED_DAYS
    && sum.totalSpent > sum.expectedByNow * PACE_AHEAD_MULT
  ) {
    const paceGap = Math.max(0, sum.pacePct - ctx.monthFrac);
    return [createSignal({
      id: 'pace-ahead',
      type: 'warning',
      icon: 'alert',
      title: 'Spending a little ahead of the month',
      sub: `${amount(ctx, sum.totalSpent)} spent - about ${amount(ctx, sum.totalSpent - sum.expectedByNow)} above your day-${sum.day} pace.`,
      priority: 90 + Math.min(15, paceGap * 30),
    })];
  }

  return [];
}

interface CategoryPace {
  cat: Category;
  spent: number;
  budget: number;
  frac: number;
  speed: number;
  overage: number;
}

function categoryPaces(ctx: SignalContext): CategoryPace[] {
  if (ctx.sum.totalBudget <= 0) return [];

  return CATEGORIES.flatMap(cat => {
    const spent = ctx.totals[cat.id] || 0;
    const budget = ctx.settings.budgets[cat.id] || 0;
    if (budget <= 0 || spent < LOW_CAT_FLOOR) return [];

    return [{
      cat,
      spent,
      budget,
      frac: spent / budget,
      speed: catSpeed(spent, budget, ctx.monthFrac),
      overage: Math.max(0, spent - budget),
    }];
  });
}

function detectCategories(ctx: SignalContext): Signal[] {
  const paces = categoryPaces(ctx);
  const over = paces
    .filter(item => item.overage > 0)
    .sort((a, b) => b.overage - a.overage)[0];
  const fast = ctx.sum.daysLeft <= 2 ? undefined : paces
    .filter(item => item.frac < 1 && item.speed > FAST_SPEED && item.cat.id !== over?.cat.id)
    .sort((a, b) => b.speed - a.speed)[0];

  const signals: Signal[] = [];

  if (over) {
    signals.push(createSignal({
      id: `cat-over:${over.cat.id}`,
      type: 'warning',
      icon: 'alert',
      cat: over.cat,
      title: `${over.cat.name} is above plan`,
      sub: `You're ${amount(ctx, over.overage)} over your ${over.cat.name} budget this month.`,
      priority: 95 + Math.min(20, (over.overage / over.budget) * 40),
    }));
  }

  if (fast) {
    signals.push(createSignal({
      id: `cat-fast:${fast.cat.id}`,
      type: 'watch',
      icon: 'fire',
      cat: fast.cat,
      title: `${fast.cat.name} is moving fast`,
      sub: `${amount(ctx, fast.spent)} of ${amount(ctx, fast.budget)} used - ${Math.round(fast.frac * 100)}% spent, ${Math.round(ctx.monthFrac * 100)}% of the month gone.`,
      priority: 72,
    }));
  }

  if (!over && !fast) {
    const near = paces
      .filter(item => item.frac >= NEAR_FRAC && item.frac < 1)
      .sort((a, b) => b.frac - a.frac)[0];

    if (near) {
      signals.push(createSignal({
        id: `cat-near:${near.cat.id}`,
        type: 'watch',
        icon: 'calendar',
        cat: near.cat,
        title: `${near.cat.name} is close to its budget`,
        sub: `${amount(ctx, near.spent)} of ${amount(ctx, near.budget)} - ${amount(ctx, near.budget - near.spent)} left for ${ctx.sum.daysLeft} days.`,
        priority: 60,
      }));
    }
  }

  return signals;
}

function detectDailyLeft(ctx: SignalContext): Signal | null {
  const { sum } = ctx;
  if (sum.totalBudget <= 0 || sum.remaining <= 0 || sum.daysLeft <= 0) return null;

  if (sum.daysLeft <= 2) {
    return createSignal({
      id: 'daily-left',
      type: 'insight',
      icon: 'calendar',
      title: `Final stretch - ${amount(ctx, sum.remaining)} left`,
      sub: `${sum.daysLeft} ${sum.daysLeft === 1 ? 'day' : 'days'} remain in this month's budget.`,
      priority: 58,
    });
  }

  return createSignal({
    id: 'daily-left',
    type: 'insight',
    icon: 'wallet',
    title: `${amount(ctx, sum.dailyLeft)}/day keeps you on track`,
    sub: `${amount(ctx, sum.remaining)} left across ${sum.daysLeft} days.`,
    priority: 58,
  });
}

function detectInvest(ctx: SignalContext): Signal | null {
  const invested = ctx.sum.totalInvest;
  const target = ctx.settings.investTarget;
  if (invested <= 0) return null;

  if (target <= 0) {
    return createSignal({
      id: 'invest-progress',
      type: 'goal',
      icon: 'invest',
      title: 'Investing progress',
      sub: `You've invested ${amount(ctx, invested)} so far this month.`,
      priority: 50,
    });
  }

  if (invested >= target) {
    return createSignal({
      id: 'invest-hit',
      type: 'good',
      icon: 'check',
      title: 'Investing target reached',
      sub: `${amount(ctx, invested)} invested this month - nice work.`,
      priority: 64,
    });
  }

  if (invested >= target * INVEST_CLOSE) {
    return createSignal({
      id: 'invest-close',
      type: 'goal',
      icon: 'target',
      title: 'Close to your investing target',
      sub: `${amount(ctx, invested)} of ${amount(ctx, target)} invested. Almost there.`,
      priority: 66,
    });
  }

  return createSignal({
    id: 'invest-progress',
    type: 'goal',
    icon: 'invest',
    title: 'Investing progress',
    sub: `You've invested ${amount(ctx, invested)} so far - ${amount(ctx, target - invested)} left to hit your target.`,
    priority: 50,
  });
}

function detectSaving(ctx: SignalContext): Signal | null {
  const { savingTarget, income } = ctx.settings;
  const { saved: remainingAfterTracked, daysLeft } = ctx.sum;
  if (income <= 0 || savingTarget <= 0 || remainingAfterTracked <= 0) return null;

  if (remainingAfterTracked >= savingTarget && daysLeft <= 5) {
    return createSignal({
      id: 'saving-hit',
      type: 'good',
      icon: 'save',
      title: 'Potential savings above target',
      sub: `${amount(ctx, remainingAfterTracked)} remains after tracked spending this month, above your ${amount(ctx, savingTarget)} target.`,
      priority: 62,
    });
  }

  return createSignal({
    id: 'saving-progress',
    type: 'goal',
    icon: 'save',
    title: 'Potential savings',
    sub: `${amount(ctx, remainingAfterTracked)} remains after tracked spending this month.`,
    priority: 48,
  });
}

function detectMerchant(ctx: SignalContext): Signal | null {
  const smallAddsMerchant = ctx.merchants
    .filter(item => item.count >= SMALL_ADDS_MIN_N && item.avg <= SMALL_TXN_MAX)
    .sort((a, b) => b.count - a.count || b.total - a.total)[0];
  const frequentMerchant = ctx.merchants
    .filter(item => item.count >= MERCHANT_MIN_N)
    .sort((a, b) => b.count - a.count || b.total - a.total)[0];
  const merchant = smallAddsMerchant || frequentMerchant;
  if (!merchant) return null;

  const smallAdds = merchant === smallAddsMerchant;
  return createSignal({
    id: `${smallAdds ? 'small-adds' : 'merchant-frequent'}:${merchant.name}`,
    type: 'insight',
    icon: 'repeat',
    title: smallAdds
      ? `Small ${merchant.name} spends are adding up`
      : `${merchant.name} shows up a lot`,
    sub: `${merchant.count} ${merchant.count === 1 ? 'visit' : 'visits'} this month, ${amount(ctx, merchant.total, true)} altogether.`,
    priority: 40,
  });
}

function detectOnTrack(ctx: SignalContext, hasOverBudgetCategory: boolean): Signal | null {
  const { sum } = ctx;
  if (
    sum.totalBudget <= 0
    || sum.day < MIN_ELAPSED_DAYS
    || !sum.onTrack
    || hasOverBudgetCategory
  ) return null;

  return createSignal({
    id: 'pace-ontrack',
    type: 'good',
    icon: 'check',
    title: 'Nicely on pace',
    sub: `${amount(ctx, sum.expectedByNow - sum.totalSpent)} below where day ${sum.day} would expect.`,
    priority: 46,
  });
}

function detectUnderDaily(ctx: SignalContext, hasOnTrack: boolean): Signal | null {
  const { sum } = ctx;
  if (hasOnTrack || sum.totalBudget <= 0 || sum.day < MIN_ELAPSED_DAYS) return null;

  const dailyAverage = sum.day > 0 ? sum.totalSpent / sum.day : 0;
  const plannedDaily = sum.daysInMonth > 0 ? sum.totalBudget / sum.daysInMonth : 0;
  if (plannedDaily <= 0 || dailyAverage >= plannedDaily * 0.9) return null;

  return createSignal({
    id: 'under-daily',
    type: 'good',
    icon: 'leaf',
    title: 'Your daily average is looking steady',
    sub: `${amount(ctx, dailyAverage)}/day spent against a ${amount(ctx, plannedDaily)}/day plan.`,
    priority: 30,
  });
}

function isNegative(signal: Signal): boolean {
  return signal.type === 'warning' || signal.type === 'watch';
}

function categoryKey(signal: Signal): string | null {
  return signal.id.startsWith('cat-') ? signal.id.split(':')[1] || null : null;
}

function merchantKey(signal: Signal): string | null {
  return signal.id.startsWith('small-adds:') || signal.id.startsWith('merchant-frequent:')
    ? signal.id.slice(signal.id.indexOf(':') + 1)
    : null;
}

export function rankSignals(
  candidates: Signal[],
  limit = HOME_SIGNAL_LIMIT,
): Signal[] {
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);
  const selected: Signal[] = [];
  const categories = new Set<string>();
  const merchants = new Set<string>();
  let negativeCount = 0;

  for (const signal of sorted) {
    if (selected.length >= limit) break;

    const negative = isNegative(signal);
    const cat = categoryKey(signal);
    const merchant = merchantKey(signal);
    if (negative && negativeCount >= MAX_WARNINGS) continue;
    if (cat && categories.has(cat)) continue;
    if (merchant && merchants.has(merchant)) continue;

    selected.push(signal);
    if (negative) negativeCount += 1;
    if (cat) categories.add(cat);
    if (merchant) merchants.add(merchant);
  }

  if (selected.some(isNegative) && selected.every(isNegative)) {
    const replacement = sorted.find(signal => !isNegative(signal) && !selected.includes(signal));
    const replaceAt = selected.map((signal, index) => ({ signal, index }))
      .filter(item => isNegative(item.signal))
      .sort((a, b) => a.signal.priority - b.signal.priority)[0]?.index;

    if (replacement && replaceAt !== undefined) selected.splice(replaceAt, 1, replacement);
  }

  return selected.sort((a, b) => b.priority - a.priority);
}

export function computeSignals(txns: Transaction[], settings: Settings): Signal[] {
  const ctx = buildSignalContext(txns, settings);
  const welcome = detectWelcome(ctx);
  if (welcome) return [welcome];

  const setup = detectSetup(ctx);
  const categorySignals = detectCategories(ctx);
  const hasOverBudgetCategory = categorySignals.some(signal => signal.id.startsWith('cat-over:'));
  const onTrack = detectOnTrack(ctx, hasOverBudgetCategory);

  const candidates = [
    setup,
    ...detectBudget(ctx),
    ...categorySignals,
    detectDailyLeft(ctx),
    detectInvest(ctx),
    detectSaving(ctx),
    detectMerchant(ctx),
    onTrack,
    detectUnderDaily(ctx, Boolean(onTrack)),
  ].filter((signal): signal is Signal => signal !== null);

  return rankSignals(candidates);
}
