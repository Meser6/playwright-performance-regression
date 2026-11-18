const KEY = Symbol.for('pw-perf-prototype.registry');
export const setRegistered = (state) => {
  globalThis[KEY] = state;
};
export const getRegistered = () => globalThis[KEY];
