/**
 * Governance-tier error signalling a baseline/debt-accounting regression: an
 * update or merge that would worsen recorded debt without an explicit
 * `--allow-worse` acknowledgement. Thrown by the update-apply and
 * debt-accounting operations and caught by the adapter that renders the gate
 * failure. Portable: no repo bindings, so an adopter's adapter catches the same
 * type.
 */
export class WorseBaselineError extends Error {}
