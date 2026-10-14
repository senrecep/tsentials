/**
 * Controls how a {@link RuleChain} behaves after a validation failure.
 *
 * - `Stop` (default) — skip every later validator on the chain once one fails. Right for
 *   guard checks (`notNull`, `notEmpty`) where further checks on a missing value are noise.
 * - `Continue` — keep running later validators and accumulate every error. Switch to it
 *   after a guard check to report all constraint violations of a property at once.
 */
export const CascadeMode = {
  Stop: 'Stop',
  Continue: 'Continue',
} as const;

export type CascadeMode = (typeof CascadeMode)[keyof typeof CascadeMode];
