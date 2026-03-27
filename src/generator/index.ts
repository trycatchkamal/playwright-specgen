import yaml from 'js-yaml';
import type { Flow, NetworkCall, ParsedTrace, ComponentType } from '../types/index.js';

const PASSWORD_HINTS = /password|passwd|pwd|secret|token|auth|credential/i;

/** Derive a human-readable intent string from the flow name. */
function inferIntent(name: string): string {
  return `User performs ${name.replace(/[-_]/g, ' ')}`;
}

/** Infer the component type from the steps in the flow. */
function inferComponentType(flow: Flow): ComponentType {
  if (flow.steps.some((s) => s.action === 'fill')) return 'form';
  if (flow.steps.some((s) => s.action === 'navigate')) return 'navigation';
  return 'action';
}

/** Derive a field hint from a CSS selector.
 * Handles: #email → "email", [name="x"] → "x", [data-test="x"] → "x",
 *          [data-testid="x"] → "x", [data-cy="x"] → "x"
 */
function inferFieldHint(selector: string): string | undefined {
  const idMatch = selector.match(/^#([\w-]+)/);
  if (idMatch) return idMatch[1].replace(/-(input|field|box)$/, '');
  const attrMatch = selector.match(/\[(?:name|data-test(?:id)?|data-cy)=["']?([\w-]+)["']?\]/);
  if (attrMatch) return attrMatch[1];
  return undefined;
}

/** Scrub a fill value if the selector suggests a sensitive field. */
function scrubValue(selector: string | undefined, value: string): string {
  if (selector && PASSWORD_HINTS.test(selector)) return '{{REDACTED}}';
  return value;
}

/** Determine outcome for a goal_action step based on its trigger statuses. */
function inferOutcome(triggers: Array<{ status: number }>): 'success' | 'failure' {
  return triggers.every((t) => t.status >= 200 && t.status < 300) ? 'success' : 'failure';
}

/**
 * Generates an AI-agent-optimised YAML string for a flow definition.
 *
 * Enrichments over the raw trace data:
 *   - intent: human-readable description of what the user is doing
 *   - component_type: form | navigation | action
 *   - field_hint: semantic name derived from the CSS selector
 *   - value scrubbing: password/token fields replaced with {{REDACTED}}
 *   - role: precondition | goal_action per step
 *   - outcome: success | failure on goal_action steps
 *   - triggers: structured objects { method, path, status } instead of strings
 */
/** Infer roles for steps that don't have them set (mirrors mapper logic). */
function resolveRole(steps: Flow['steps'], idx: number): string {
  if (steps[idx].role) return steps[idx].role!;
  // SPA fallback: if no click has triggers, last click overall is goal_action
  const hasAnyTriggers = steps.some((s) => s.triggers);
  let goalIdx = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    const isClick = steps[i].action === 'click';
    if (hasAnyTriggers ? (isClick && steps[i].triggers) : isClick) {
      goalIdx = i;
      break;
    }
  }
  return idx === goalIdx ? 'goal_action' : 'precondition';
}

export function generateFlowYaml(flow: Flow): string {
  const doc = {
    flow: flow.name,
    intent: inferIntent(flow.name),
    component_type: inferComponentType(flow),
    steps: flow.steps.map((step, idx) => {
      const entry: Record<string, unknown> = { action: step.action };

      if (step.selector !== undefined) entry.selector = step.selector;

      if (step.action === 'fill' && step.selector) {
        const hint = inferFieldHint(step.selector);
        if (hint) entry.field_hint = hint;
      }

      if (step.value !== undefined) entry.value = scrubValue(step.selector, step.value);
      if (step.url !== undefined) entry.url = step.url;
      const role = resolveRole(flow.steps, idx);
      entry.role = role;
      if (step.triggers && step.triggers.length > 0) {
        entry.triggers = step.triggers;
        if (role === 'goal_action') entry.outcome = inferOutcome(step.triggers);
      }

      return entry;
    }),
  };

  return yaml.dump(doc, { lineWidth: -1, quotingType: '"' });
}

/**
 * Generates a YAML string for an API sequence.
 *
 * Output shape:
 *   api_sequence:
 *     - method: POST
 *       path: /auth/login
 *       status: 200
 */
export function generateApiYaml(networkCalls: NetworkCall[]): string {
  const doc = {
    // Exclude 4xx/5xx responses — error calls are not meaningful in a flow API sequence
    api_sequence: networkCalls
      .filter((c) => c.status < 400)
      .map((c) => ({ method: c.method, path: c.path, status: c.status })),
  };

  return yaml.dump(doc, { lineWidth: -1, quotingType: '"' });
}

/** Escape a string for embedding inside single-quoted JavaScript/TypeScript. */
function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function urlToPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Determines the final URL path to assert in the generated test.
 *
 * Priority:
 * 1. Navigate step immediately after the goal_action click (terminal redirect)
 * 2. Last navigate step in the flow (covers multi-step flows without explicit roles)
 * 3. The last GET trigger on the last click (HTTP redirect captured in network)
 * 4. '/unknown' fallback
 */
function resolveFinalPath(flow: Flow): string {
  // Priority 1: navigate step after the goal_action click
  const goalIdx = flow.steps.findIndex((s) => s.role === 'goal_action');
  if (goalIdx !== -1) {
    const postGoalNav = flow.steps.slice(goalIdx + 1).find((s) => s.action === 'navigate' && s.url);
    if (postGoalNav?.url) return urlToPath(postGoalNav.url);
  }

  // Priority 2: last navigate step overall (handles multi-step and nav-only flows)
  const navSteps = flow.steps.filter((s) => s.action === 'navigate' && s.url);
  const lastNav = navSteps[navSteps.length - 1];
  if (lastNav?.url) return urlToPath(lastNav.url);

  // Priority 3: last GET trigger on the last click (HTTP redirect captured in network)
  const lastClick = [...flow.steps].reverse().find((s) => s.action === 'click');
  if (lastClick?.triggers) {
    for (const trigger of [...lastClick.triggers].reverse()) {
      if (trigger.method === 'GET') return trigger.path;
    }
  }

  return '/unknown';
}

/**
 * Generates an executable Playwright test file as a string.
 *
 * - Navigate steps BEFORE any fill/click emit page.goto() calls.
 * - Navigate steps AFTER interactions are captured in the toHaveURL assertion.
 * - Falls back to GET triggers from the last click, then '/unknown'.
 */
export function generateTestTs(flow: Flow): string {
  const lines: string[] = ["import { test, expect } from '@playwright/test';", ''];

  lines.push(`test('${flow.name} flow', async ({ page }) => {`);

  const firstInteractionIdx = flow.steps.findIndex(
    (s) => s.action === 'fill' || s.action === 'click'
  );

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const isBeforeInteraction = firstInteractionIdx === -1 || i < firstInteractionIdx;

    if (step.action === 'navigate' && step.url && isBeforeInteraction) {
      lines.push(`  await page.goto('${escapeStr(step.url)}');`);
    } else if (step.action === 'fill' && step.selector && step.value !== undefined) {
      const safe = scrubValue(step.selector, step.value);
      if (safe === '{{REDACTED}}') {
        const hint = inferFieldHint(step.selector) ?? 'SECRET';
        const envName = hint.toUpperCase().replace(/-/g, '_');
        lines.push(`  await page.fill('${escapeStr(step.selector)}', process.env.${envName} ?? '');`);
      } else {
        lines.push(`  await page.fill('${escapeStr(step.selector)}', '${escapeStr(safe)}');`);
      }
    } else if (step.action === 'click' && step.selector) {
      lines.push(`  await page.click('${escapeStr(step.selector)}');`);
    }
    // Post-interaction navigate steps are reflected in the toHaveURL assertion
  }

  lines.push(`  await expect(page).toHaveURL('${escapeStr(resolveFinalPath(flow))}');`);
  lines.push('});');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generates a JSON evidence file documenting trace provenance.
 *
 * Output shape:
 *   { "source": "trace.zip", "actions": [...], "network": [...] }
 */
export function generateEvidenceJson(sourceName: string, parsed: ParsedTrace): string {
  const doc = {
    source: sourceName,
    actions: parsed.actions,
    network: parsed.networkCalls,
  };

  return JSON.stringify(doc, null, 2);
}
