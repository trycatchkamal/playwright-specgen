import { test, expect } from '@playwright/test';

test('github-pr-review flow', async ({ page }) => {
  await page.goto('https://github.com/microsoft/TypeScript/issues');
  await page.click('a[data-hovercard-type="issue"] >> nth=0');
  await page.click('a[data-hovercard-type="pull_request"] >> nth=0');
  await page.click('[data-tab-item="files-tab"], a[href*="/files"] >> nth=0');
  await expect(page).toHaveURL('/microsoft/TypeScript/pull/63248/files');
});
