// The demo page is not needed: step durations come from the step tree of each result.
import { expect, test } from './fixtures.ts';

test.beforeEach(async () => {
  await test.step('open app', async () => {});
});

test('nested steps', async ({ seeded }) => {
  expect(seeded).toBe('ok');
  await test.step('a', async () => {
    await test.step('b', async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  });
  await test.step('boxed', async () => {}, { box: true });
  await test.step.skip('skipped', async () => {});
  try {
    await test.step('caught', async () => {
      throw new Error('handled in the test');
    });
  } catch {
    // The test passes; the step error counts for the errors rule (06-AC-19).
  }
});

test('private titles', async () => {
  await test.step('Login as jan.kowalski@example.com', async () => {});
  await test.step('Open https://app.example/?token=SECRET123TOKEN456', async () => {});
  await test.step('Use eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', async () => {});
  await test.step(`Open order ${4700 + test.info().repeatEachIndex}`, async () => {});
});
