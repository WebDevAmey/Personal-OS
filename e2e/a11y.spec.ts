// e2e/a11y.spec.ts — axe on the main pages (0 serious/critical), the command
// bar open, and reduced-motion rendering without errors (docs/09 §5 row 17).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { USERS } from './support/config';
import { openPalette, signIn } from './support/helpers';

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

/** Waits for entrance animations to settle so axe sees final colours. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

test.describe('public pages', () => {
  for (const path of ['/', '/sign-in']) {
    test(`axe: ${path}`, async ({ page }) => {
      await page.goto(path);
      await settle(page);
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
});

test.describe('signed-in pages', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.alpha);
  });

  for (const path of ['/today', '/tasks', '/settings']) {
    test(`axe: ${path}`, async ({ page }) => {
      await page.goto(path);
      await settle(page);
      expect(await seriousViolations(page)).toEqual([]);
    });
  }

  test('axe: command bar open', async ({ page }) => {
    await page.goto('/today');
    await settle(page);
    await openPalette(page);
    await page.waitForTimeout(400);
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('reduced motion: pages render without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const path of ['/', '/today', '/tasks', '/settings']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main').first()).toBeVisible();
    }
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await openPalette(page);
    expect(errors).toEqual([]);
  });
});
