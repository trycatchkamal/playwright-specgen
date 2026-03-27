/**
 * Records a GitHub PR review flow as a Playwright trace.
 * Output: samples/github-pr-review.zip
 *
 * Flow: issues list → click issue → PRs list → click PR → Files Changed tab
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

mkdirSync('samples', { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
});

await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

const page = await context.newPage();

// 1. Issues list
await page.goto('https://github.com/microsoft/TypeScript/issues', {
  waitUntil: 'networkidle',
  timeout: 30000,
});

// 2. Click first issue link
const issueLink = page.locator('a[data-hovercard-type="issue"]').first();
await issueLink.waitFor({ timeout: 10000 });
await issueLink.click();
await page.waitForLoadState('networkidle', { timeout: 15000 });

// 3. Navigate to PRs list
await page.goto('https://github.com/microsoft/TypeScript/pulls', {
  waitUntil: 'networkidle',
  timeout: 30000,
});

// 4. Click first PR link
const prLink = page.locator('a[data-hovercard-type="pull_request"]').first();
await prLink.waitFor({ timeout: 10000 });
await prLink.click();
await page.waitForLoadState('networkidle', { timeout: 15000 });

// 5. Click "Files changed" tab
const filesTab = page
  .locator('[data-tab-item="files-tab"], a[href*="/files"]')
  .first();
await filesTab.waitFor({ timeout: 10000 });
await filesTab.click();
await page.waitForLoadState('networkidle', { timeout: 15000 });

await context.tracing.stop({ path: 'samples/github-pr-review.zip' });
await browser.close();

console.log('Trace saved to samples/github-pr-review.zip');
