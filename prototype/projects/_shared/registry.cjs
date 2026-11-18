// CJS twin of registry.mjs. Both use the same global symbol, so a value written by one copy is
// visible to the other inside the same process (dual ESM/CJS package hazard).
const KEY = Symbol.for('pw-perf-prototype.registry');
exports.setRegistered = (state) => {
  globalThis[KEY] = state;
};
exports.getRegistered = () => globalThis[KEY];
