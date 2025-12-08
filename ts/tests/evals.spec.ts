import { test, expect } from '@playwright/test';

test.describe('Desplega Evals', () => {
  test('should display page title', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('desplega.ai evals')).toBeVisible();
  });
});
