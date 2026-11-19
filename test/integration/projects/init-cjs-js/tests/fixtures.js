const base = require('@playwright/test');

exports.test = base.test.extend({
  api: async ({ page }, use) => {
    await use((path) => page.evaluate((p) => fetch(p).then((r) => r.text()), path));
  },
});
exports.expect = base.expect;
