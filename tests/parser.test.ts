import { describe, it, expect } from 'vitest';
import { parseTrace } from '../src/parser/index.js';
import { ParseError } from '../src/types/index.js';
import { buildLoginTraceZip, buildTraceZipWithoutNetwork } from './fixtures/buildFixture.js';

describe('TraceParser', () => {
  it('parses valid trace.zip and returns actions + networkCalls', async () => {
    const zip = await buildLoginTraceZip();
    const result = await parseTrace(zip);

    expect(result).toHaveProperty('actions');
    expect(result).toHaveProperty('networkCalls');
    expect(Array.isArray(result.actions)).toBe(true);
    expect(Array.isArray(result.networkCalls)).toBe(true);
  });

  it('returns correct count: 4 actions, 2 network calls', async () => {
    const zip = await buildLoginTraceZip();
    const result = await parseTrace(zip);

    expect(result.actions).toHaveLength(4);
    expect(result.networkCalls).toHaveLength(2);
  });

  it('handles missing trace.network file gracefully (returns empty networkCalls)', async () => {
    const zip = await buildTraceZipWithoutNetwork();
    const result = await parseTrace(zip);

    expect(result.actions).toHaveLength(4);
    expect(result.networkCalls).toHaveLength(0);
  });

  it('throws ParseError on corrupt zip input', async () => {
    const corrupt = Buffer.from('this is not a zip file');
    await expect(parseTrace(corrupt)).rejects.toThrow(ParseError);
  });

  it('throws ParseError on empty buffer', async () => {
    const empty = Buffer.alloc(0);
    await expect(parseTrace(empty)).rejects.toThrow(ParseError);
  });
});
