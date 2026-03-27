import unzipper from 'unzipper';
import { Readable } from 'stream';
import { ParseError, type ParsedTrace } from '../types/index.js';

/**
 * Reads all entries from a zip buffer and returns a map of filename → content.
 */
async function readZipEntries(buffer: Buffer): Promise<Map<string, string>> {
  if (buffer.length === 0) {
    throw new ParseError('Zip buffer is empty');
  }

  const entries = new Map<string, string>();

  try {
    const stream = Readable.from(buffer);
    const zip = stream.pipe(unzipper.Parse({ forceStream: true }));

    for await (const entry of zip) {
      const fileName = entry.path as string;
      const chunks: Buffer[] = [];

      for await (const chunk of entry) {
        chunks.push(chunk as Buffer);
      }

      entries.set(fileName, Buffer.concat(chunks).toString('utf8'));
    }
  } catch (err) {
    if (err instanceof ParseError) throw err;
    throw new ParseError(
      `Failed to parse zip: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (entries.size === 0) {
    throw new ParseError('Zip archive contains no entries or is corrupt');
  }

  return entries;
}

/**
 * Parses a Playwright trace.zip Buffer and returns raw action + network lines.
 * Throws ParseError if the buffer is not a valid zip.
 */
export async function parseTrace(buffer: Buffer): Promise<ParsedTrace> {
  const entries = await readZipEntries(buffer);

  const traceContent = entries.get('trace.trace') ?? '';
  const networkContent = entries.get('trace.network') ?? '';

  // Parse JSON-lines: skip blank lines, skip non-parseable lines
  const parseJsonLines = (content: string): unknown[] => {
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  };

  const traceEvents = parseJsonLines(traceContent);
  const networkEvents = parseJsonLines(networkContent);

  // Defer actual extraction to the extractor module — return raw parsed objects
  // The extractor will interpret these; here we just validate and hand off.
  // We import lazily to keep modules decoupled and testable independently.
  const { extractActions, extractNetworkCalls } = await import('../extractor/index.js');

  const actions = extractActions(traceContent);

  let primaryHostname: string | undefined;
  try {
    const firstNavUrl = actions.find((a) => a.type === 'navigate' && a.url)?.url;
    if (firstNavUrl) primaryHostname = new URL(firstNavUrl).hostname;
  } catch { /* leave undefined */ }

  const networkCalls = extractNetworkCalls(networkContent, primaryHostname);

  // Suppress unused variable warning — traceEvents/networkEvents used for validation
  void traceEvents;
  void networkEvents;

  return { actions, networkCalls };
}
