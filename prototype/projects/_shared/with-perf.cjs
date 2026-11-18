// Minimal stand-in for withPerf(): only the parts the prototype needs.
// No I/O, no randomness; result depends on arguments and the environment only.
const { setRegistered } = require('./registry.cjs');

function closure(projects, measured) {
  const byName = new Map(projects.map((p) => [p.name, p]));
  const keep = new Set();
  const visit = (name) => {
    if (keep.has(name) || !byName.has(name)) return;
    keep.add(name);
    const p = byName.get(name);
    for (const d of p.dependencies ?? []) visit(d);
    if (p.teardown) visit(p.teardown);
  };
  measured.forEach(visit);
  return keep;
}

exports.withPerf = function withPerf(config, perfConfig) {
  if (!process.env.PW_PERF_MODE) return config;
  setRegistered({ mode: process.env.PW_PERF_MODE, config: perfConfig ?? null });
  // PROTO_KEEP_WORKERS: "1" keeps every workers setting, "project" overrides the global one only.
  const keep = process.env.PROTO_KEEP_WORKERS;
  const overrideWorkers = keep !== '1' && keep !== 'project';
  const out = { ...config, retries: 0 };
  if (keep !== '1') out.workers = 1;
  if (config.projects) {
    let projects = config.projects.map((p) => {
      const copy = { ...p, retries: 0 };
      if (overrideWorkers && p.workers !== undefined) copy.workers = 1;
      return copy;
    });
    const measured = (process.env.PROTO_MEASURED ?? '').split(',').filter(Boolean);
    if (measured.length) {
      const keep = closure(projects, measured);
      projects = projects.filter((p) => keep.has(p.name));
    }
    out.projects = projects;
  }
  return out;
};
