import type { TraceAction, NetworkCall } from '../types/index.js';

// ---------------------------------------------------------------------------
// Real Playwright trace format types (type: 'before' / 'resource-snapshot')
// ---------------------------------------------------------------------------
type RealTraceEvent = {
  type: 'before';
  callId?: string;
  class: string;
  method: string;
  startTime: number;
  params?: { selector?: string; value?: string; url?: string };
};

type FrameSnapshotEvent = {
  type: 'frame-snapshot';
  snapshot: {
    callId: string;
    snapshotName: string; // 'before@call@N' | 'after@call@N' | 'input@call@N'
    frameUrl: string;
  };
};

type AfterEvent = {
  type: 'after';
  callId: string;
  endTime: number;
};

type RealNetworkSnapshot = {
  type: 'resource-snapshot';
  snapshot: {
    request: { method: string; url: string };
    response: { status: number };
    _monotonicTime: number;
  };
};

// ---------------------------------------------------------------------------
// Simplified fixture format types (used in tests)
// ---------------------------------------------------------------------------
type FixtureTraceEvent = {
  type: 'action' | 'navigation';
  metadata?: { startTime?: number };
  action?: { type?: string; selector?: string; value?: string };
  url?: string;
};

type FixtureNetworkEvent = {
  type: 'request';
  timestamp: number;
  method: string;
  url: string;
  status: number;
};

// Static asset extensions to filter out from real trace network calls
const STATIC_EXT = /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map|dat|json\.map)$/i;

function isRelevantUrl(url: string): boolean {
  try {
    // Decode URI and strip any query string embedded in the path (e.g. woff%3Fv=3.2.1 → woff)
    const cleanPath = decodeURIComponent(new URL(url).pathname).split('?')[0];
    return !STATIC_EXT.test(cleanPath);
  } catch {
    return true;
  }
}

function pathFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

// URLs that indicate no real page is loaded yet — skip navigation injection for these.
const SKIP_URL = /^about:|^javascript:/i;

function parseLines(content: string): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      result.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      /* skip */
    }
  }
  return result;
}

/**
 * Parses JSON-lines trace content and extracts typed TraceAction objects.
 * Supports both the real Playwright trace format (type: 'before') and
 * the simplified fixture format (type: 'action' / 'navigation').
 *
 * When the trace includes frame-snapshot events (recorded with snapshots:true),
 * SPA route changes after click actions are automatically injected as navigate
 * actions using the URL from the after-snapshot.
 */
export function extractActions(traceContent: string): TraceAction[] {
  const lines = parseLines(traceContent);

  // ── Pass 1: build URL-change and end-time maps from snapshot events ───────
  const snapBefore = new Map<string, string>(); // callId → URL before action
  const snapAfter = new Map<string, string>();  // callId → URL after action
  const endTimes = new Map<string, number>();   // callId → action endTime

  for (const obj of lines) {
    if (obj.type === 'frame-snapshot') {
      const e = obj as unknown as FrameSnapshotEvent;
      const { callId, snapshotName, frameUrl } = e.snapshot ?? {};
      if (!callId || !snapshotName || !frameUrl) continue;
      // Use only the FIRST snapshot per callId — Playwright records snapshots for all frames
      // (main page first, then iframes). Later entries would overwrite the correct main-page URL.
      if (snapshotName.startsWith('before@') && !snapBefore.has(callId)) snapBefore.set(callId, frameUrl);
      else if (snapshotName.startsWith('after@') && !snapAfter.has(callId)) snapAfter.set(callId, frameUrl);
    }

    if (obj.type === 'after') {
      const e = obj as unknown as AfterEvent;
      if (e.callId && typeof e.endTime === 'number') endTimes.set(e.callId, e.endTime);
    }
  }

  // ── Pass 2: extract actions, injecting navigate for URL-changing clicks ───
  const actions: TraceAction[] = [];

  for (const obj of lines) {
    // --- Real Playwright format: type='before', class='Frame' ---
    if (obj.type === 'before' && obj.class === 'Frame') {
      const event = obj as unknown as RealTraceEvent;
      const callId = event.callId;
      const timestamp = event.startTime ?? 0;
      const params = event.params ?? {};

      if (event.method === 'fill' && params.selector) {
        actions.push({ type: 'fill', selector: params.selector, value: params.value, timestamp });
      } else if (event.method === 'click' && params.selector) {
        actions.push({ type: 'click', selector: params.selector, timestamp });

        // SPA navigation: inject navigate when URL changes after this click
        if (callId) {
          const before = snapBefore.get(callId);
          const after = snapAfter.get(callId);
          if (before && after && before !== after && !SKIP_URL.test(before)) {
            const navTs = endTimes.get(callId) ?? timestamp + 1;
            actions.push({ type: 'navigate', url: after, timestamp: navTs });
          }
        }
      } else if (event.method === 'goto' && params.url) {
        actions.push({ type: 'navigate', url: params.url, timestamp });
      }
      continue;
    }

    // --- Simplified fixture format ---
    if (obj.type === 'action') {
      const event = obj as unknown as FixtureTraceEvent;
      const timestamp = event.metadata?.startTime ?? 0;
      const a = event.action;
      if (!a?.type) continue;

      if (a.type === 'fill') {
        actions.push({ type: 'fill', selector: a.selector, value: a.value, timestamp });
      } else if (a.type === 'click') {
        actions.push({ type: 'click', selector: a.selector, timestamp });
      }
    } else if (obj.type === 'navigation') {
      const event = obj as unknown as FixtureTraceEvent;
      const timestamp = event.metadata?.startTime ?? 0;
      actions.push({ type: 'navigate', url: event.url, timestamp });
    }
  }

  return actions.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Parses JSON-lines network content and extracts typed NetworkCall objects.
 * Supports both the real Playwright trace format (type: 'resource-snapshot')
 * and the simplified fixture format (type: 'request').
 * Static assets (.js, .css, images, fonts) are filtered out from real traces.
 * When primaryHost is provided, requests to other hosts are also filtered out.
 */
export function extractNetworkCalls(networkContent: string, primaryHost?: string): NetworkCall[] {
  const calls: NetworkCall[] = [];

  for (const line of networkContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    // --- Real Playwright format: type='resource-snapshot' ---
    if (obj.type === 'resource-snapshot') {
      const event = obj as unknown as RealNetworkSnapshot;
      const snap = event.snapshot;
      if (!snap?.request || !snap?.response) continue;

      const status = snap.response.status;
      if (!status || status <= 0) continue; // skip failed/pending requests

      const url = snap.request.url;
      if (!url || !isRelevantUrl(url)) continue; // skip static assets
      if (primaryHost) {
        try { if (new URL(url).hostname !== primaryHost) continue; } catch { /* keep */ }
      }

      calls.push({
        method: snap.request.method,
        path: pathFromUrl(url),
        status,
        timestamp: snap._monotonicTime ?? 0,
      });
      continue;
    }

    // --- Simplified fixture format: type='request' ---
    if (obj.type === 'request') {
      const event = obj as unknown as FixtureNetworkEvent;
      if (!event.method || !event.url || event.status === undefined) continue;

      calls.push({
        method: event.method,
        path: pathFromUrl(event.url),
        status: event.status,
        timestamp: event.timestamp,
      });
    }
  }

  return calls;
}
