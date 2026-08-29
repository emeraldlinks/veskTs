# Experiment (A/B Testing)

Want to know whether a green button beats a blue one? `<Experiment>`
shows different variants to different visitors consistently: each visitor
lands in a variant, keeps seeing it across visits (sticky assignment),
and every exposure is recorded so your analytics can compare results.
Exported from both runtime barrels.

```vsk
import { Experiment } from '@vesk/runtime';

component Pricing() {
	return <Experiment name="cta"
		variants={[
			{ name: 'blue', weight: 50, content: 'Start — blue button' },
			{ name: 'green', weight: 50, content: 'Start — green button' },
		]} />;
}
```

> Literal JSX cannot appear inside object literals today (see
> [Expression Mode](../../language/expression-mode/doc.md)), so variant
> `content`/`children` accept strings, numbers and nested arrays — not
> inline elements. For rich variant UI, branch on a tracked value
> yourself (statement-mode `if`) and use `Experiment` for string/data
> variants; assignments are exposed via `window.__vsk_experiments`.

```ts
/**
 * A/B test component. Variant selection hashes the seed to r∈[0,1) and
 * walks normalized cumulative weights:
 *   - SSR seed   = name            (consistent per render)
 *   - Client seed = name + userId  (userId persisted in sessionStorage)
 * With sticky (default true) the chosen variant persists in a cookie
 * vsk_exp_<name> for 30 days.
 * When track (default true), pushes { experiment, variant } onto
 * window.__vsk_experiments for your analytics layer.
 *
 * @example
 * <Experiment name="hero" default="classic"
 *   variants={[
 *     { name: 'classic', children: <HeroA /> },
 *     { name: 'bold',    children: <HeroB /> },
 *   ]} />
 */
function Experiment(props: {
	name: string;                       // required — also the cookie/storage key
	variants?: Array<{
		name?: string;
		weight?: number;                  // default 1 (relative)
		children?: unknown;
		content?: unknown;                // alias for children
	}>;
	default?: unknown;                  // fallback when no variants match
	sticky?: boolean;                   // default true
	track?: boolean;                    // default true
}): unknown;
```

## Behavior details

- Renders `variant.children ?? variant.content ?? null`; falls back to
  `props.default` when nothing matches.
- Weights normalize by total, so `{50, 50}` and `{1, 1}` are equivalent.
- SSR and client agree via sticky cookies — users don't flip variants
  between server HTML and hydration.

## Reading assignments in analytics

```ts
// after load, e.g. in a {#client} block or island effect
const seen = window.__vsk_experiments ?? [];
seen.forEach(({ experiment, variant }) => analytics.track('experiment_view', { experiment, variant }));
```
