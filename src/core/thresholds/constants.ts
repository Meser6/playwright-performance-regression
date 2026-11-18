// Constants of the thresholds derivation kept in code (10-REQ-04, P-13). Every other setting of
// the formulas is in the config (03-REQ-17, 10-D-17).

/** Minimum gap of maxWilson above the source Wilson lower bound (10-REQ-05, 10-D-04). */
export const WILSON_SELF_GAP = 0.01;

/** Minimum gap of maxErrorRate above the source error-rate lower bound (10-REQ-05). */
export const ERR_SELF_GAP = 0.01;
