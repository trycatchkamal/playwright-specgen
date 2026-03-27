import archiver from 'archiver';
import { Writable } from 'stream';

// Realistic Playwright trace.trace JSON-lines
// Timestamps are in milliseconds
const TRACE_LINES = [
  JSON.stringify({
    type: 'action',
    metadata: { startTime: 1000 },
    action: { type: 'fill', selector: '#email', value: 'test@example.com' },
  }),
  JSON.stringify({
    type: 'action',
    metadata: { startTime: 2000 },
    action: { type: 'fill', selector: '#password', value: 'password' },
  }),
  JSON.stringify({
    type: 'action',
    metadata: { startTime: 3000 },
    action: { type: 'click', selector: '#login-button' },
  }),
  JSON.stringify({
    type: 'navigation',
    metadata: { startTime: 3500 },
    url: 'http://localhost:3000/dashboard',
  }),
].join('\n');

// Realistic trace.network JSON-lines
// POST /auth/login fires at t=3100 (100ms after click at t=3000) — within window
// GET /user/profile fires at t=3200 — within window
const NETWORK_LINES = [
  JSON.stringify({
    type: 'request',
    timestamp: 3100,
    method: 'POST',
    url: 'http://localhost:3000/auth/login',
    status: 200,
  }),
  JSON.stringify({
    type: 'request',
    timestamp: 3200,
    method: 'GET',
    url: 'http://localhost:3000/user/profile',
    status: 200,
  }),
].join('\n');

/**
 * Builds an in-memory Buffer containing a realistic Playwright trace.zip.
 * Contains trace.trace (4 action lines) and trace.network (2 network lines).
 */
export function buildLoginTraceZip(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const sink = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
        chunks.push(chunk);
        callback();
      },
    });

    sink.on('finish', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(sink);

    archive.append(TRACE_LINES, { name: 'trace.trace' });
    archive.append(NETWORK_LINES, { name: 'trace.network' });

    archive.finalize();
  });
}

/**
 * Builds a trace.zip with only trace.trace (no trace.network file).
 * Used to test graceful handling of missing network data.
 */
export function buildTraceZipWithoutNetwork(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const sink = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
        chunks.push(chunk);
        callback();
      },
    });

    sink.on('finish', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(sink);

    archive.append(TRACE_LINES, { name: 'trace.trace' });

    archive.finalize();
  });
}

// Checkout flow: fill address, fill card, click submit, navigate to /order/confirm
// POST /orders fires at t=3100 (100ms after click at t=3000) — within window
const CHECKOUT_TRACE_LINES = [
  JSON.stringify({
    type: 'action',
    metadata: { startTime: 1000 },
    action: { type: 'fill', selector: '#shipping-address', value: '123 Main St' },
  }),
  JSON.stringify({
    type: 'action',
    metadata: { startTime: 2000 },
    action: { type: 'fill', selector: '#card-number', value: '4111111111111111' },
  }),
  JSON.stringify({
    type: 'action',
    metadata: { startTime: 3000 },
    action: { type: 'click', selector: '#place-order' },
  }),
  JSON.stringify({
    type: 'navigation',
    metadata: { startTime: 3500 },
    url: 'http://localhost:3000/order/confirm',
  }),
].join('\n');

const CHECKOUT_NETWORK_LINES = [
  JSON.stringify({
    type: 'request',
    timestamp: 3100,
    method: 'POST',
    url: 'http://localhost:3000/orders',
    status: 201,
  }),
].join('\n');

/**
 * Builds an in-memory Buffer containing a checkout Playwright trace.zip.
 * Contains trace.trace (4 action lines) and trace.network (1 network line).
 */
export function buildCheckoutTraceZip(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const sink = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
        chunks.push(chunk);
        callback();
      },
    });

    sink.on('finish', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(sink);

    archive.append(CHECKOUT_TRACE_LINES, { name: 'trace.trace' });
    archive.append(CHECKOUT_NETWORK_LINES, { name: 'trace.network' });

    archive.finalize();
  });
}

/** Raw trace lines exported for use in extractor/mapper tests (no zip needed) */
export const RAW_TRACE_LINES = TRACE_LINES;
export const RAW_NETWORK_LINES = NETWORK_LINES;
export const RAW_CHECKOUT_TRACE_LINES = CHECKOUT_TRACE_LINES;
export const RAW_CHECKOUT_NETWORK_LINES = CHECKOUT_NETWORK_LINES;
