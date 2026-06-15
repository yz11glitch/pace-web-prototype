# Pace — Home Signal Logic Spec

> Implementation spec for the rule-based Home "finance coach" signal system.
> No AI, no API calls — everything derives from local data (`txns` + `settings`).
> Tone: calm, encouraging, practical. Never shaming. Never "advice."
>
> Philosophy: **Track spending quickly. See your money signals. Stay on pace.**

This spec extends the existing `computeSignals()` in `app/lib/data.ts`. It does **not**
change app architecture, UI, or storage backend. The only optional addition is a small
localStorage snapshot for month-over-month signals (Section 6 + 7, gated and degradable).

---

## 0. What we have to work with (grounding facts)

From `app/lib/data.ts` — the spec is written against these, not assumptions:

- **Date model:** `TODAY` is fixed at 11 June 2026, `DAYS_IN_MONTH = 30`, so
  `DAY = 11`, `DAYS_LEFT = 19`, `monthFrac = DAY / DAYS_IN_MONTH ≈ 0.367`.
  All detectors must read day/daysLeft/monthFrac **from `summary()`** — never recompute dates.
- **`summary(txns, settings)`** already returns: `totalSpent, totalInvest, totalIncome,
  totalBudget, expectedByNow, remaining, dailyLeft, pacePct, investRate, saved, day,
  daysInMonth, daysLeft, onTrack`.
- **`categoryTotals(txns)`** returns expense totals per category id.
- **`Signal`** shape today: `{ id, tone: 'warm'|'green'|'blue', icon, cat?, title, sub }`.
- **`TONE` map** (in `shared.tsx`) only knows `warm | green | blue`. We keep these three
  visual tones and layer a semantic `type` on top for ranking (Section 4).
- **Available icons** (from `Icon.tsx`): `home stats settings plus minus food groc tpt shop
  bill ent hlth edu misc inc inv bank coin gift fire alert wallet invest repeat check chevron
  back close trash target save bell moon sun auto currency palette sparkle calendar note leaf
  tag edit download upload`. **Do not invent icon names** — pick from this list.
- **No historical data exists yet.** Seed `INITIAL_TXNS` are all June 2026. Any
  "vs last month" signal (Section 1.D) requires the optional history snapshot and must
  degrade silently to "no signal" when history is absent (first-month behavior).

---

## 1. Signal categories & exact rule conditions

Each signal is a pure detector: `(ctx) => Signal | null`. `ctx` is built once
(Section 7) and bundles `summary`, `categoryTotals`, merchant index, and optional history.

Shared constants (tune in one place):

```
FAST_SPEED       = 1.15   // spend pace ÷ time pace that counts as "moving fast"
NEAR_FRAC        = 0.85   // category budget used that counts as "close"
PACE_AHEAD_MULT  = 1.10   // totalSpent vs expectedByNow tolerance band
IMPROVE_DELTA    = 0.15   // ≥15% slower than last month at same point = "improving"
MERCHANT_MIN_N   = 4      // same merchant name appears ≥ N times
SMALL_TXN_MAX    = 25     // a "small" transaction (RM)
SMALL_ADDS_MIN_N = 5      // small txns of one merchant before "adding up"
MIN_ELAPSED_DAYS = 3      // suppress pace/positive verdicts before day 3 (too little signal)
INVEST_CLOSE     = 0.80   // ≥80% of invest target = "close"
LOW_CAT_FLOOR    = 30     // ignore categories whose spend < RM30 for warnings (noise)
```

### A. Onboarding (state-gated — overrides everything else)

When the user has essentially no data, **return only onboarding signals** (1–2 max) and skip
all other detectors.

| id | needs | triggers when | does NOT trigger | type |
|----|-------|---------------|------------------|------|
| `welcome` | txns | `expenses.length === 0` | any expense exists | insight |
| `setup-income` | settings | `income <= 0` and txns exist | income set | insight |
| `setup-budgets` | settings | `totalBudget <= 0` and txns exist | any budget set | insight |

`setup-income` / `setup-budgets` may co-exist with normal signals (they unlock other detectors),
but cap at one setup nudge per render. `welcome` is exclusive.

### B. Budget pace (whole month)

| id | triggers when | example calc (seed data) | does NOT trigger | type |
|----|---------------|--------------------------|------------------|------|
| `budget-reached` | `remaining <= 0` | spent 3300 vs budget 3200 → RM100 over | `remaining > 0` | warning |
| `pace-ahead` | `totalSpent > expectedByNow * PACE_AHEAD_MULT` AND `remaining > 0` AND `day >= MIN_ELAPSED_DAYS` | spent 1974 > 1173×1.10=1290 → fires | within band, or budget reached (that wins) | warning |
| `daily-left` | `remaining > 0 && daysLeft > 0` | 1226 / 19 = **RM64/day** | over budget | insight |
| `pace-ontrack` | `onTrack` AND `totalBudget > 0` AND `day >= MIN_ELAPSED_DAYS` AND no over-budget category | spent ≤ expectedByNow | spending ahead of time | good |

`budget-reached` and `pace-ahead` are mutually exclusive (reached wins). `pace-ontrack` and
`pace-ahead` are mutually exclusive by construction.

### C. Category overspending / watch

Evaluate per category over `CATEGORIES`. Skip categories with `budget <= 0` or
`spent < LOW_CAT_FLOOR`. **One signal per category max** — collapse in priority order
`over > fast > near` so Food never shows two cards.

| id | triggers when | example (seed) | does NOT trigger | type |
|----|---------------|----------------|------------------|------|
| `cat-over:<id>` | `spent > budget` | Shopping 420 > 300 → RM120 over | spent ≤ budget | warning |
| `cat-fast:<id>` | `speed > FAST_SPEED` AND `frac < 1` | Food 383/800 frac .48, speed 1.31 → fires | not over time-pace, or already over (over wins) | watch |
| `cat-near:<id>` | `frac >= NEAR_FRAC` AND `frac < 1` AND not already `fast` | Transport 334/400 frac .84 (just under) | far from budget | watch |

`speed = frac / monthFrac` where `frac = spent / budget`. Pick the **single worst**
`cat-over` (largest RM overage) and the **single fastest** `cat-fast` to avoid flooding;
`cat-near` only surfaces if no `cat-over`/`cat-fast` was emitted (it's the gentlest tier).

### D. Category improvement (needs history — degrades to nothing without it)

| id | needs | triggers when | example | type |
|----|-------|---------------|---------|------|
| `cat-lower:<id>` | history snapshot | this-month spend at this day-of-month is `≥ IMPROVE_DELTA` below last month's spend **at the same day-of-month** | Transport RM334 vs RM410 last month by day 11 → 18% lower | good |

Compare like-for-like: use last month's cumulative spend **as of the same day index**, not its
full-month total (otherwise every early-month comparison looks "improved"). If no history, or
last-month value `< LOW_CAT_FLOOR`, return null. Emit at most one (largest % improvement).

### E. Daily spending pace

Covered by `daily-left` (B). Optional gentle positive:

| id | triggers when | example | type |
|----|---------------|---------|------|
| `under-daily` | average daily spend so far `< (totalBudget / daysInMonth)` by ≥10% AND `day >= MIN_ELAPSED_DAYS` AND not already showing `pace-ontrack` | avg 179/day < 107/day? (no here) | good |

Low priority; mostly a tie-breaker filler. Skip if `pace-ontrack` already fired (redundant).

### F. Saving / investing progress (goals)

| id | needs | triggers when | example (seed) | does NOT trigger | type |
|----|-------|---------------|----------------|------------------|------|
| `invest-hit` | investTarget>0 | `totalInvest >= investTarget` | invest 800 ≥ 800 | below target | good |
| `invest-close` | investTarget>0 | `totalInvest >= investTarget*INVEST_CLOSE` AND `< investTarget` | 700 ≥ 640 | not yet 80% / already hit | goal |
| `invest-progress` | — | `totalInvest > 0` AND not `close`/`hit` | 300 → 37% of 800 | nothing invested | goal |
| `invest-rate` | income>0 | `totalInvest > 0` (shown only if `invest-progress` not already chosen) | 300/6500 → "5% of income" | income unset | insight |
| `saving-hit` | income & savingTarget>0 | `saved >= savingTarget` AND `day` near month end (`daysLeft <= 5`) so it's meaningful | saved 4226 — but gate on month-end | mid-month (saved is volatile) | good |
| `saving-progress` | income & savingTarget>0 | `saved > 0` AND not hit-near-end | "RM900 of RM1,500 saved so far" | income unset, or saved ≤ 0 | goal |

`invest-hit > invest-close > invest-progress` are mutually exclusive (one invest card).
`invest-rate` is an alternate framing — only use it as a low-priority filler, never alongside
another invest card. Saving cards: `saved` mid-month is noisy (bills not all paid), so keep
`saving-hit` gated to month-end and keep `saving-progress` worded as "so far" (Section 5).

### G. Recurring / frequent spending (insights)

Build a merchant index: group expenses by `name` → `{ count, total, avg }`.

| id | triggers when | example (seed) | does NOT trigger | type |
|----|---------------|----------------|------------------|------|
| `small-adds:<name>` | `count >= SMALL_ADDS_MIN_N` AND `avg <= SMALL_TXN_MAX` | Grab ×9, avg ~23.7, total RM214 → "small rides adding up" | few or large txns | insight |
| `merchant-frequent:<name>` | `count >= MERCHANT_MIN_N` AND not already `small-adds` | a merchant ×4 that isn't "small" | count < 4 | insight |

Prefer `small-adds` framing when the avg is small (it's the more delightful insight). Emit at
most one merchant card total.

### H. Positive reinforcement

Not a separate detector — it's the set `{ pace-ontrack, invest-hit, saving-hit, cat-lower,
under-daily }`. The ranking layer (Section 3) guarantees at least one positive/neutral appears
whenever any warning is shown, so the feed never reads as pure nagging.

---

## 2. Signal types → tone, icon, wording (severity model)

We add a semantic `type` field used **only for ranking + icon/tone derivation**. The rendered
`tone` is derived from `type`, so `SignalCard` and the existing `TONE` map need no change.

| type | derived tone | icon direction | color feel | wording tone |
|--------|-------------|----------------|------------|--------------|
| `good` | `green` | `check`, `leaf`, `sparkle` | calm money-green | warm congratulation, light |
| `goal` | `green` | `target`, `invest`, `save`, `coin` | money-green | forward-looking, "x left to go" |
| `insight` | `blue` | `wallet`, `repeat`, `calendar`, `note` | neutral teal/blue | observational, factual, no judgment |
| `watch` | `warm` | `fire` (fast), `calendar` (near) | soft terracotta | gentle heads-up, "moving fast", curious not alarmed |
| `warning` | `warm` | `alert`, `wallet` | terracotta | matter-of-fact, specific number, no scolding |

Derivation helper: `toneFor(type)` → `good|goal → 'green'`, `insight → 'blue'`,
`watch|warning → 'warm'`. `watch` and `warning` share the warm tone but differ in icon and
priority, which is enough visual + ordering distinction without a UI change.

---

## 3. Priority, ranking & mixing

### 3.1 Base priority (higher = earlier)

```
budget-reached      100
cat-over             95   (+ scaled by RM overage, see below)
pace-ahead           90
cat-fast             72
cat-near             60
daily-left           58
invest-close         66
invest-hit           64
saving-hit           62
cat-lower            56   (positive, but newsworthy)
invest-progress      50
saving-progress      48
pace-ontrack         46
merchant/small-adds  40
invest-rate          34
under-daily          30
onboarding setup     200  (always top when present)
welcome              999  (exclusive)
```

Add a small **magnitude bonus** so the worst real problem leads: e.g.
`cat-over` priority `+= min(20, overageRM / budget * 40)`, `pace-ahead += min(15, (pacePct - monthFrac) * 30)`. This keeps ordering meaningful when two warnings compete.

### 3.2 Selection algorithm

```
1. If welcome → return [welcome].                       // exclusive onboarding
2. Run all detectors → candidates[].
3. Collapse per-category (over > fast > near) and per-merchant (one card).
4. Sort candidates by priority desc.
5. Apply diversity caps while filling up to HOME_SIGNAL_LIMIT (= 4):
     - MAX_WARNINGS = 2   (warning+watch combined counts toward "negative")
     - If ≥1 negative selected, GUARANTEE ≥1 of {good, goal, insight} in the final set:
       if none made the cut, swap the lowest-priority negative beyond the first
       for the highest-priority positive/neutral available.
     - Never show two cards for the same category or same merchant.
6. Return final list (already ordered; render top-to-bottom).
```

### 3.3 How many show on Home

- **Target 3, hard cap 4** (`HOME_SIGNAL_LIMIT = 4`). Fewer is fine — quality over quantity.
- Typical healthy month: 1 warning + 1 insight + 1 positive.
- If literally nothing triggers (rare, mid setup), fall back to the existing `EmptyState`
  ("No signals yet") already wired in `HomeScreen`.

### 3.4 Avoiding warning overload

- Hard cap of 2 negatives (Section 3.2). The 3rd+ warning is dropped, not shown.
- Positive guarantee rule ensures the feed always has at least one encouraging card when
  there's bad news.
- Per-category and per-merchant collapse prevents three Food cards.

### Seed-data worked example (sanity check the ranking)

Candidates from `INITIAL_TXNS`: `pace-ahead` (warning, ~90), `cat-over:shop` RM120 over
(warning, ~95+bonus), `cat-fast:food` (watch, ~72), `daily-left` RM64/day (insight, 58),
`invest-progress` 37% (goal, 50), `small-adds:Grab` ×9 (insight, 40).
After sort + caps (limit 4, max 2 negatives, ≥1 positive guaranteed):
1. `cat-over:shop` (warning) 2. `pace-ahead` (warning) 3. `invest-progress` (goal, forced positive)
4. `daily-left` (insight). `cat-fast:food` and `small-adds:Grab` drop. Feels like a coach, not a dashboard. ✅

---

## 4. Example wording (2–3 variants each)

Keep `title` ≤ ~42 chars, `sub` one specific line with the real number. Use `money()` for all
amounts and `settings.currency`.

**budget-reached** (warning)
- "You've reached your monthly budget" / "RM100 over your total limit so far."
- "Budget's all spoken for" / "You're RM100 past your RM3,200 plan with 19 days left."

**pace-ahead** (warning)
- "Spending a little ahead of the month" / "RM1,974 spent — about RM680 above your day-11 pace."
- "You're moving faster than the calendar" / "61% of budget used, 37% of the month gone."

**daily-left** (insight)
- "RM64/day keeps you on track" / "RM1,226 left across 19 days."
- "You've got RM64 a day to play with" / "Spend under that and you'll land within budget."

**pace-ontrack** (good)
- "Nicely on pace" / "RM120 below where day 11 would expect."
- "Comfortably within budget" / "You're pacing under plan this month."

**cat-over** (warning)
- "Shopping is above plan" / "You're RM120 over your Shopping budget this month."
- "Shopping's past its budget" / "RM420 spent against a RM300 plan."

**cat-fast** (watch)
- "Food is moving fast" / "RM383 of RM800 used — 48% spent, 37% of the month gone."
- "Food's picking up pace" / "Running about 1.3× the usual speed for this point."

**cat-near** (watch)
- "Transport is close to its budget" / "RM334 of RM400 — RM66 left for 19 days."

**cat-lower** (good)
- "Transport is lighter than last month" / "RM334 so far vs RM410 by this day last month."
- "Nice — Transport's down" / "About 18% lower than the same point last month."

**invest-progress / invest-close / invest-hit** (goal / good)
- "Investing progress" / "You've invested RM300 so far — RM500 left to hit your target."
- "Close to your investing target" / "RM700 of RM800 invested. Almost there."
- "Investing target reached" / "RM800 invested this month — nice work."

**invest-rate** (insight)
- "You invested 5% of income" / "RM300 set aside out of RM6,500 earned."

**saving-progress / saving-hit** (goal / good)
- "Saving is building up" / "RM900 of your RM1,500 goal set aside so far."
- "Saving goal reached" / "RM1,500 saved this month — target hit."

**small-adds** (insight)
- "Small Grab rides are adding up" / "9 rides this month, RM214 altogether."
- "Lots of little Grab trips" / "RM214 across 9 rides — easy to miss one by one."

**merchant-frequent** (insight)
- "GrabFood shows up a lot" / "4 orders this month, RM148 total."

**Onboarding**
- `welcome`: "Add your first expense" / "Tap + to start tracking and your signals appear here."
- `setup-income`: "Set your monthly income" / "It unlocks saving and investing signals."
- `setup-budgets`: "Set a few budgets" / "Pace can then show your spending pace by category."

---

## 5. Edge cases & data safety

| case | behavior |
|------|----------|
| **No transactions** | `welcome` only. No other cards. |
| **No income set** (`income<=0`) | Skip `invest-rate`, all saving signals. Show `setup-income` nudge (1×). Budget/category signals still work. |
| **No budgets** (`totalBudget<=0`) | Skip all pace + category signals. Show `setup-budgets` nudge. Invest/saving/merchant signals still work. |
| **Single category has no budget** | Skip that category in C/D (guard `budget>0`). |
| **No invest target** (`investTarget<=0`) | `invest-progress`/`close`/`hit` can't show % — fall back to `invest-rate` framing or "You've invested RMx so far" with no target line. |
| **First month / no history** | All `cat-lower` detectors return null silently. Never show "vs last month" with fabricated data. |
| **Very low-spend category** (`spent<LOW_CAT_FLOOR`) | Excluded from warnings/watch (noise). A RM5 category at 200% speed is not a signal. |
| **End of month** (`daysLeft<=2`) | `daily-left` divides by small N → cap displayed RM/day, or switch copy to "Final stretch — RM x left." Enable `saving-hit`/month summary tone. Don't show `cat-fast` (the month is basically over; use `cat-over` only). |
| **Day 0–2** (`day<MIN_ELAPSED_DAYS`) | Suppress pace verdicts (`pace-ahead`, `pace-ontrack`, `under-daily`) — too little data. Over-budget + invest + merchant can still show. |
| **Negative / NaN amounts** | Clamp: ignore `amt<=0` expenses in totals; guard every divide (`bud>0`, `daysLeft>0`, `income>0`). Never render `NaN%` or `Infinity/day`. |
| **Budget exactly 0 spent** | `frac=0`, speed `0/x=0` → no fast/near. Fine. |
| **Spent but `monthFrac=0`** (day 0) | Guard speed calc against div-by-zero; treat as no pace signal. |
| **Currency** | Always pass `settings.currency` into `money()`; never hardcode "RM" in titles. |

---

## 6. Optional month-over-month history (for `cat-lower` / improvement)

Comparison signals need prior-month data, which doesn't exist today. Keep it **local and
optional** — no architecture change:

- Store `pace.history` in localStorage alongside existing state:
  `{ [yyyymm: string]: { byDay: Record<catId, number[]>, totalSpent, totalInvest, saved } }`
  where `byDay[cat][d]` = cumulative spend in that category through day `d`. (Cumulative-by-day
  is what enables fair same-day-of-month comparison.)
- On store init, if the current month differs from the latest stored month, **finalize** the
  prior month into `history` once. Building this snapshot can be a thin helper; it's pure
  derivation from existing txns.
- Every comparison detector is **gated**: `if (!ctx.history) return null;`. So the feature ships
  dark and lights up automatically once a second month exists. Phase this after the core signals.

If you'd rather not touch storage at all in v1, **skip Section 1.D entirely** — the rest of the
system is fully functional without history.

---

## 7. Implementation guidance for Codex

### 7.1 File structure

- Create `app/lib/signals.ts`. Move `Signal`, `computeSignals` out of `data.ts` into it
  (re-export from `data.ts` if other imports depend on the old path — check `HomeScreen.tsx`
  imports `computeSignals` from `../lib/data`, so keep a re-export to avoid touching callers).
- `data.ts` keeps `summary`, `categoryTotals`, `money`, dates — `signals.ts` imports them.
- Read `node_modules/next/dist/docs/` only if you touch anything Next-specific (you shouldn't —
  this is pure TS logic). Per `AGENTS.md`, this is a modified Next.js; signal logic stays
  framework-agnostic.

### 7.2 New helper functions

```
buildSignalContext(txns, settings): SignalContext   // compute everything once
  → { summary, totals, monthFrac, merchants, history?, settings }

merchantIndex(txns): Record<name, { count, total, avg }>   // extracted from current inline code
catSpeed(spent, budget, monthFrac): number                 // frac / monthFrac, guarded
toneFor(type): 'warm'|'green'|'blue'                        // type → existing tone token
rankSignals(candidates, limit=4): Signal[]                 // Section 3.2 algorithm
finalizeMonthHistory(...)                                  // Section 6, optional/phase 2
```

Each detector is `(ctx: SignalContext) => Signal | Signal[] | null`. Keep them in an ordered
**registry array** so adding/removing a signal is a one-line change:

```
const DETECTORS = [ detectWelcome, detectSetup, detectBudgetReached, detectPaceAhead,
                    detectCatOverspend, detectCatFast, detectCatNear, detectDailyLeft,
                    detectInvest, detectSaving, detectMerchant, detectCatLower, detectOnTrack ];
```

`computeSignals` becomes: build ctx → if welcome short-circuit → run detectors → flatten,
collapse per-category/merchant → `rankSignals`.

### 7.3 Data transformations

- Filter `amt > 0` expenses once when building `totals` and `merchants` (safety).
- Precompute `monthFrac`, `expectedFrac` in ctx (don't recompute per detector).
- Per-category collapse + per-merchant collapse happen **before** ranking.

### 7.4 Signal object shape (extended, backward compatible)

```ts
interface Signal {
  id: string;                 // unique incl. cat/merchant, e.g. 'cat-over:shop'
  type: 'good'|'watch'|'warning'|'insight'|'goal';
  tone: 'warm'|'green'|'blue';// = toneFor(type); keeps SignalCard unchanged
  icon: string;               // from the real Icon registry only
  cat?: Category;
  title: string;
  sub: string;
  priority: number;           // ranking only, not rendered
}
```

`SignalCard` already reads `tone`, `icon`, `cat`, `title`, `sub` — set `tone = toneFor(type)`
in each detector (or in a post-map) and nothing in the UI changes.

### 7.5 Ranking/sorting logic

Implement exactly Section 3.2: collapse → sort by `priority` desc → fill to `HOME_SIGNAL_LIMIT`
honoring `MAX_WARNINGS = 2` and the "guarantee ≥1 positive/neutral when any negative shown"
swap rule. Keep `HOME_SIGNAL_LIMIT`, `MAX_WARNINGS`, and all thresholds as named constants at
the top of `signals.ts`.

### 7.6 Manual test scenarios (run against seed `INITIAL_TXNS`, day 11)

1. **Seed data** → expect (after caps): `cat-over:shop`, `pace-ahead`, `invest-progress`,
   `daily-left`. NOT two Shopping/Food cards; NOT >2 warnings. (See §3 worked example.)
2. **Empty txns** → only `welcome`. Nothing else.
3. **income = 0** → no saving signals, no `invest-rate`; `setup-income` nudge appears once;
   Shopping over-budget still shows.
4. **All budgets = 0** → no pace/category signals; `setup-budgets` nudge; invest/merchant ok.
5. **investTarget = 0, totalInvest = 300** → invest card shows RM with no "% of target"/no NaN.
6. **day = 1 (override)** → no `pace-ahead`/`pace-ontrack`; over-budget category (if any) still shows.
7. **daysLeft = 1** → `daily-left` uses month-end copy, no divide blow-up; no `cat-fast`.
8. **Negative amt injected** → ignored in totals; no NaN in any card.
9. **Healthy month** (spend well under expected, nothing over) → `pace-ontrack` + an invest/insight
   card; zero warnings; feed still has 2–3 encouraging cards.
10. **No history** → zero `cat-lower` cards (silent), everything else normal.

---

### Out of scope (per request)
No full code, no UI redesign, no Supabase/auth, no architecture change. The only new storage is
the optional, gated `pace.history` snapshot in Section 6 — skip it for a v1 that excludes
month-over-month signals.
