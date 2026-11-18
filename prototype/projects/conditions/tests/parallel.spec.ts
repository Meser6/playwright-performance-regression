import { test } from '../../_shared/fixtures.mjs';

for (let i = 0; i < 4; i++) {
  test(`parallel ${i}`, async () => {
    await new Promise((r) => setTimeout(r, 1000));
  });
}
