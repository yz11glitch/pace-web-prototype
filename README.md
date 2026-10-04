# Pace — earlier web prototype

An earlier personal-finance web prototype exploring the Pace product direction: quick expense entry, budget visibility and rule-based spending signals.

**This repository is the archived web prototype.** Superseded by [Pace, the native local-first iPhone app](https://github.com/yz11glitch/pace). The native app is under active development; its public repository is a sanitized snapshot.

## What this version does

Built with Next.js 16, React 19 and TypeScript, the prototype provides transaction entry, Home signals, statistics, settings and JSON backup/import. [`app/lib/signals.ts`](app/lib/signals.ts) derives deterministic signals from the stored financial state.

Transactions, settings and theme preferences live in browser `localStorage`. There is no database, authentication or cross-device synchronization. Clearing browser data resets the prototype. It is a web/PWA exploration, not the current native product.

[Open the web prototype](https://pace-nine-xi.vercel.app). Use fictional entries when evaluating it; no native-product demo is published here.

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. No environment variables are required.

```bash
npm run test:signals
npm run lint
npx tsc --noEmit
npm run build
npm run start
```

On 4 October 2026, all **12 signal scenarios** passed their expectations; lint, TypeScript and production build checks passed. The scenario harness covers signal behaviour, not a comprehensive browser test suite. Screenshots of the current native implementation are intentionally not used to represent this prototype.

**Superseded.** The current native, local-first Pace project is under active development in a private repository. A sanitized public snapshot is being reviewed before publication. This repository is archived and kept for reference.
