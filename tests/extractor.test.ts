import { describe, it, expect } from 'vitest';
import { extractActions, extractNetworkCalls } from '../src/extractor/index.js';
import { RAW_TRACE_LINES, RAW_NETWORK_LINES } from './fixtures/buildFixture.js';

describe('extractActions', () => {
  it('extracts fill action with selector and value', () => {
    const actions = extractActions(RAW_TRACE_LINES);
    const fill = actions.find((a) => a.type === 'fill' && a.selector === '#email');

    expect(fill).toBeDefined();
    expect(fill?.selector).toBe('#email');
    expect(fill?.value).toBe('test@example.com');
  });

  it('extracts second fill action with password selector', () => {
    const actions = extractActions(RAW_TRACE_LINES);
    const fill = actions.find((a) => a.type === 'fill' && a.selector === '#password');

    expect(fill).toBeDefined();
    expect(fill?.value).toBe('password');
  });

  it('extracts click action with selector and no value', () => {
    const actions = extractActions(RAW_TRACE_LINES);
    const click = actions.find((a) => a.type === 'click');

    expect(click).toBeDefined();
    expect(click?.selector).toBe('#login-button');
    expect(click?.value).toBeUndefined();
  });

  it('extracts navigate action with url', () => {
    const actions = extractActions(RAW_TRACE_LINES);
    const nav = actions.find((a) => a.type === 'navigate');

    expect(nav).toBeDefined();
    expect(nav?.url).toBe('http://localhost:3000/dashboard');
    expect(nav?.selector).toBeUndefined();
  });

  it('filters out unknown event types', () => {
    const withUnknown = [
      RAW_TRACE_LINES,
      JSON.stringify({ type: 'unknown_event', metadata: { startTime: 9999 } }),
      JSON.stringify({ type: 'screenshot', metadata: { startTime: 9999 } }),
    ].join('\n');

    const actions = extractActions(withUnknown);
    expect(actions).toHaveLength(4);
  });

  it('preserves timestamp on each action', () => {
    const actions = extractActions(RAW_TRACE_LINES);

    const emailFill = actions.find((a) => a.selector === '#email');
    const clickAction = actions.find((a) => a.type === 'click');
    const navAction = actions.find((a) => a.type === 'navigate');

    expect(emailFill?.timestamp).toBe(1000);
    expect(clickAction?.timestamp).toBe(3000);
    expect(navAction?.timestamp).toBe(3500);
  });

  it('returns actions in chronological order', () => {
    const actions = extractActions(RAW_TRACE_LINES);
    const timestamps = actions.map((a) => a.timestamp);

    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });
});

// ---------------------------------------------------------------------------
// SPA navigation: frame-snapshot URL changes → injected navigate actions
// ---------------------------------------------------------------------------

// Minimal real-format trace with frame-snapshot events.
// Two clicks: login-button (URL changes) and add-to-cart (URL stays the same).
const SPA_TRACE = [
  // click → URL changes: / → /inventory.html
  JSON.stringify({ type: 'before', callId: 'call@14', startTime: 4357, class: 'Frame', method: 'click', params: { selector: '[data-test="login-button"]' } }),
  JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'call@14', snapshotName: 'before@call@14', frameUrl: 'https://www.saucedemo.com/' } }),
  JSON.stringify({ type: 'after', callId: 'call@14', endTime: 4430 }),
  JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'call@14', snapshotName: 'after@call@14', frameUrl: 'https://www.saucedemo.com/inventory.html' } }),

  // click → URL stays the same (add-to-cart SPA mutation, no navigation)
  JSON.stringify({ type: 'before', callId: 'call@18', startTime: 4433, class: 'Frame', method: 'click', params: { selector: '[data-test="add-to-cart-sauce-labs-backpack"]' } }),
  JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'call@18', snapshotName: 'before@call@18', frameUrl: 'https://www.saucedemo.com/inventory.html' } }),
  JSON.stringify({ type: 'after', callId: 'call@18', endTime: 4467 }),
  JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'call@18', snapshotName: 'after@call@18', frameUrl: 'https://www.saucedemo.com/inventory.html' } }),

  // click → URL changes: /inventory.html → /cart.html
  JSON.stringify({ type: 'before', callId: 'call@20', startTime: 4513, class: 'Frame', method: 'click', params: { selector: '[data-test="shopping-cart-link"]' } }),
  JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'call@20', snapshotName: 'before@call@20', frameUrl: 'https://www.saucedemo.com/inventory.html' } }),
  JSON.stringify({ type: 'after', callId: 'call@20', endTime: 4567 }),
  JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'call@20', snapshotName: 'after@call@20', frameUrl: 'https://www.saucedemo.com/cart.html' } }),
].join('\n');

describe('extractActions - SPA navigation from frame-snapshot', () => {
  it('injects navigate action after click when URL changes', () => {
    const actions = extractActions(SPA_TRACE);
    const navs = actions.filter((a) => a.type === 'navigate');
    expect(navs).toHaveLength(2);
  });

  it('injected navigate has the after-URL from the frame-snapshot', () => {
    const actions = extractActions(SPA_TRACE);
    const navUrls = actions.filter((a) => a.type === 'navigate').map((a) => a.url);
    expect(navUrls).toContain('https://www.saucedemo.com/inventory.html');
    expect(navUrls).toContain('https://www.saucedemo.com/cart.html');
  });

  it('injected navigate timestamp is the endTime of the after event', () => {
    const actions = extractActions(SPA_TRACE);
    const inventoryNav = actions.find((a) => a.type === 'navigate' && a.url?.includes('inventory'));
    expect(inventoryNav?.timestamp).toBe(4430);
  });

  it('does not inject navigate when URL does not change after click', () => {
    const actions = extractActions(SPA_TRACE);
    // add-to-cart click (call@18) should not produce a navigate
    const addToCartClick = actions.find((a) => a.type === 'click' && a.selector?.includes('backpack'));
    expect(addToCartClick).toBeDefined();
    // no navigate at timestamp 4467 (the endTime of add-to-cart)
    const navAt4467 = actions.find((a) => a.type === 'navigate' && a.timestamp === 4467);
    expect(navAt4467).toBeUndefined();
  });

  it('injected navigate sorts after its triggering click', () => {
    const actions = extractActions(SPA_TRACE);
    const loginClick = actions.find((a) => a.type === 'click' && a.selector?.includes('login-button'));
    const inventoryNav = actions.find((a) => a.type === 'navigate' && a.url?.includes('inventory'));
    expect(loginClick).toBeDefined();
    expect(inventoryNav).toBeDefined();
    expect(inventoryNav!.timestamp).toBeGreaterThan(loginClick!.timestamp);
  });

  it('trace without frame-snapshot data still works (backward compatible)', () => {
    const actions = extractActions(RAW_TRACE_LINES);
    // Original fixture has 4 actions, still 4 with no snapshots
    expect(actions).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Regression: multi-frame iframe overwrite bug
// Bug: Playwright records frame-snapshot events for ALL frames (main + iframes).
// Later iframe snapshots (e.g. ReCaptcha) overwrote the correct main-page URL.
// Fix: only the FIRST snapshot per callId is used.
// ---------------------------------------------------------------------------

const MULTI_FRAME_TRACE = [
  // click → URL changes: / → /about (main page), then iframes overwrite
  JSON.stringify({ type: 'before', callId: 'call@26', startTime: 5000, class: 'Frame', method: 'click', params: { selector: 'a:text("About")' } }),
  // FIRST before snapshot = main page (correct)
  JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'call@26', snapshotName: 'before@call@26', frameUrl: 'https://pokeapi.co/' } }),
  // Subsequent before snapshots from iframes (should be ignored)
  JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'call@26', snapshotName: 'before@call@26', frameUrl: 'https://www.google.com/recaptcha/api2/aframe' } }),
  JSON.stringify({ type: 'after', callId: 'call@26', endTime: 5500 }),
  // FIRST after snapshot = main page (correct)
  JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'call@26', snapshotName: 'after@call@26', frameUrl: 'https://pokeapi.co/about' } }),
  // Subsequent after snapshots from iframes (should be ignored)
  JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'call@26', snapshotName: 'after@call@26', frameUrl: 'https://googleads.g.doubleclick.net/pagead/html' } }),
  JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'call@26', snapshotName: 'after@call@26', frameUrl: 'about:blank' } }),
  JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'call@26', snapshotName: 'after@call@26', frameUrl: 'https://www.google.com/recaptcha/api2/aframe' } }),
].join('\n');

describe('extractActions - multi-frame iframe overwrite regression', () => {
  it('injects navigate with the main-page URL, not the iframe URL', () => {
    const actions = extractActions(MULTI_FRAME_TRACE);
    const navs = actions.filter((a) => a.type === 'navigate');
    expect(navs).toHaveLength(1);
    expect(navs[0].url).toBe('https://pokeapi.co/about');
  });

  it('does not use the last iframe URL (ReCaptcha aframe) as the navigate target', () => {
    const actions = extractActions(MULTI_FRAME_TRACE);
    const navs = actions.filter((a) => a.type === 'navigate');
    expect(navs[0].url).not.toContain('recaptcha');
    expect(navs[0].url).not.toContain('doubleclick');
    expect(navs[0].url).not.toBe('about:blank');
  });

  it('navigate timestamp is the endTime of the after event', () => {
    const actions = extractActions(MULTI_FRAME_TRACE);
    const nav = actions.find((a) => a.type === 'navigate');
    expect(nav?.timestamp).toBe(5500);
  });
});

describe('extractNetworkCalls', () => {
  it('strips base URL: http://localhost:3000/auth/login → /auth/login', () => {
    const calls = extractNetworkCalls(RAW_NETWORK_LINES);
    const login = calls.find((c) => c.method === 'POST');

    expect(login?.path).toBe('/auth/login');
  });

  it('extracts method, path, and status correctly', () => {
    const calls = extractNetworkCalls(RAW_NETWORK_LINES);

    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toBe('/auth/login');
    expect(calls[0].status).toBe(200);

    expect(calls[1].method).toBe('GET');
    expect(calls[1].path).toBe('/user/profile');
    expect(calls[1].status).toBe(200);
  });

  it('preserves timestamp on each network call', () => {
    const calls = extractNetworkCalls(RAW_NETWORK_LINES);

    expect(calls[0].timestamp).toBe(3100);
    expect(calls[1].timestamp).toBe(3200);
  });

  it('ignores non-request lines (malformed JSON, other types)', () => {
    const withNoise = [
      RAW_NETWORK_LINES,
      'not valid json at all',
      JSON.stringify({ type: 'response', timestamp: 9999 }),
    ].join('\n');

    const calls = extractNetworkCalls(withNoise);
    expect(calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Regression: cross-domain filtering in real resource-snapshot format
// Bug: third-party requests (Google Fonts /css2) leaked into API sequence
// because only static file extensions were filtered, not cross-origin hosts
// ---------------------------------------------------------------------------

const makeResourceSnapshot = (url: string, status: number, ts: number) =>
  JSON.stringify({
    type: 'resource-snapshot',
    snapshot: {
      request: { method: 'GET', url },
      response: { status },
      _monotonicTime: ts,
    },
  });

describe('extractNetworkCalls — cross-domain filtering (real resource-snapshot format)', () => {
  const APP_URL = 'https://www.saucedemo.com/';
  const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Roboto';
  const CDN_URL = 'https://cdn.jsdelivr.net/npm/some-lib.min.js';

  const lines = [
    makeResourceSnapshot(APP_URL, 200, 100),
    makeResourceSnapshot(FONTS_URL, 200, 200),
    makeResourceSnapshot(CDN_URL, 200, 300),
  ].join('\n');

  it('without primaryHost: all non-static non-extension calls are kept', () => {
    // Google Fonts /css2 has no static extension → passes through without primaryHost
    const calls = extractNetworkCalls(lines);
    const paths = calls.map((c) => c.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/css2');    // no filtering without primaryHost
  });

  it('with primaryHost: only same-origin requests are kept', () => {
    const calls = extractNetworkCalls(lines, 'www.saucedemo.com');
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/');
  });

  it('with primaryHost: Google Fonts and CDN requests are filtered out', () => {
    const calls = extractNetworkCalls(lines, 'www.saucedemo.com');
    const paths = calls.map((c) => c.path);
    expect(paths).not.toContain('/css2');
    expect(paths).not.toContain('/npm/some-lib.min.js');
  });

  it('URL-encoded extension (woff%3Fv=3.2.1) is filtered as a static font asset', () => {
    // books.toscrape.com serves fonts with an encoded query string in the path:
    // /fonts/fontawesome-webfont.woff%3Fv=3.2.1
    // Without decoding, the raw path ends in ".1" so STATIC_EXT misses it.
    const line = makeResourceSnapshot(
      'https://books.toscrape.com/static/oscar/fonts/fontawesome-webfont.woff%3Fv=3.2.1',
      200, 150
    );
    const calls = extractNetworkCalls(line, 'books.toscrape.com');
    expect(calls).toHaveLength(0);
  });

  it('fixture format (type: request) is unaffected by primaryHost', () => {
    // Fixture format uses simplified type:'request', no URL object processing
    const fixtureLine = JSON.stringify({
      type: 'request',
      method: 'POST',
      url: 'http://localhost:3000/api/login',
      status: 200,
      timestamp: 500,
    });
    const calls = extractNetworkCalls(fixtureLine, 'differenthost.com');
    // Fixture format bypasses primaryHost filtering — all fixture calls kept
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/login');
  });
});
