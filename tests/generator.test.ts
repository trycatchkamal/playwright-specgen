import { describe, it, expect } from 'vitest';
import { load as yamlLoad } from 'js-yaml';
import ts from 'typescript';
import {
  generateFlowYaml,
  generateApiYaml,
  generateTestTs,
  generateEvidenceJson,
} from '../src/generator/index.js';
import type { Flow, NetworkCall, ParsedTrace } from '../src/types/index.js';

const SAMPLE_FLOW: Flow = {
  name: 'login',
  steps: [
    { action: 'fill', selector: '#email', value: 'test@example.com' },
    { action: 'fill', selector: '#password', value: 'password' },
    {
      action: 'click',
      selector: '#login-button',
      triggers: [
        { method: 'POST', path: '/auth/login', status: 200 },
        { method: 'GET', path: '/user/profile', status: 200 },
      ],
    },
    { action: 'navigate', url: 'http://localhost:3000/dashboard' },
  ],
};

const SAMPLE_NETWORK: NetworkCall[] = [
  { method: 'POST', path: '/auth/login', status: 200, timestamp: 3100 },
  { method: 'GET', path: '/user/profile', status: 200, timestamp: 3200 },
];

const SAMPLE_PARSED: ParsedTrace = {
  actions: [
    { type: 'fill', selector: '#email', value: 'test@example.com', timestamp: 1000 },
    { type: 'click', selector: '#login-button', timestamp: 3000 },
  ],
  networkCalls: SAMPLE_NETWORK,
};

describe('generateFlowYaml', () => {
  it('produces a non-empty string', () => {
    const yaml = generateFlowYaml(SAMPLE_FLOW);
    expect(typeof yaml).toBe('string');
    expect(yaml.length).toBeGreaterThan(0);
  });

  it('produces valid YAML (parseable)', () => {
    const yaml = generateFlowYaml(SAMPLE_FLOW);
    expect(() => yamlLoad(yaml)).not.toThrow();
  });

  it('flow name is correct', () => {
    const yaml = generateFlowYaml(SAMPLE_FLOW);
    const parsed = yamlLoad(yaml) as Record<string, unknown>;
    expect(parsed.flow).toBe('login');
  });

  it('all 4 steps are present', () => {
    const yaml = generateFlowYaml(SAMPLE_FLOW);
    const parsed = yamlLoad(yaml) as { steps: unknown[] };
    expect(parsed.steps).toHaveLength(4);
  });

  it('click step includes triggers array', () => {
    const yaml = generateFlowYaml(SAMPLE_FLOW);
    const parsed = yamlLoad(yaml) as {
      steps: Array<{ action: string; triggers?: Array<{ method: string; path: string; status: number }> }>;
    };
    const click = parsed.steps.find((s) => s.action === 'click');

    expect(click?.triggers).toBeDefined();
    expect(click?.triggers).toHaveLength(2);
    expect(click?.triggers).toContainEqual({ method: 'POST', path: '/auth/login', status: 200 });
  });

  it('selectors are preserved exactly', () => {
    const yaml = generateFlowYaml(SAMPLE_FLOW);
    const parsed = yamlLoad(yaml) as { steps: Array<{ selector?: string }> };

    expect(parsed.steps[0].selector).toBe('#email');
    expect(parsed.steps[1].selector).toBe('#password');
    expect(parsed.steps[2].selector).toBe('#login-button');
  });
});

describe('generateApiYaml', () => {
  it('produces a non-empty string', () => {
    const yaml = generateApiYaml(SAMPLE_NETWORK);
    expect(typeof yaml).toBe('string');
    expect(yaml.length).toBeGreaterThan(0);
  });

  it('produces valid YAML (parseable)', () => {
    const yaml = generateApiYaml(SAMPLE_NETWORK);
    expect(() => yamlLoad(yaml)).not.toThrow();
  });

  it('api_sequence contains correct entries', () => {
    const yaml = generateApiYaml(SAMPLE_NETWORK);
    const parsed = yamlLoad(yaml) as { api_sequence: Array<{ method: string; path: string; status: number }> };

    expect(parsed.api_sequence).toHaveLength(2);
    expect(parsed.api_sequence[0]).toEqual({ method: 'POST', path: '/auth/login', status: 200 });
    expect(parsed.api_sequence[1]).toEqual({ method: 'GET', path: '/user/profile', status: 200 });
  });

  it('filters out 4xx error responses from the sequence', () => {
    const withErrors: NetworkCall[] = [
      { method: 'GET', path: '/api/users', status: 200, timestamp: 100 },
      { method: 'GET', path: '/routeInfo.json', status: 400, timestamp: 200 },
      { method: 'GET', path: '/api/posts', status: 404, timestamp: 300 },
      { method: 'POST', path: '/api/items', status: 201, timestamp: 400 },
    ];
    const yaml = generateApiYaml(withErrors);
    const parsed = yamlLoad(yaml) as { api_sequence: Array<{ method: string; path: string; status: number }> };
    expect(parsed.api_sequence).toHaveLength(2);
    expect(parsed.api_sequence[0]).toEqual({ method: 'GET', path: '/api/users', status: 200 });
    expect(parsed.api_sequence[1]).toEqual({ method: 'POST', path: '/api/items', status: 201 });
  });

  it('filters out 5xx error responses from the sequence', () => {
    const withServerError: NetworkCall[] = [
      { method: 'POST', path: '/api/order', status: 500, timestamp: 100 },
      { method: 'GET', path: '/api/status', status: 200, timestamp: 200 },
    ];
    const yaml = generateApiYaml(withServerError);
    const parsed = yamlLoad(yaml) as { api_sequence: Array<{ method: string; path: string; status: number }> };
    expect(parsed.api_sequence).toHaveLength(1);
    expect(parsed.api_sequence[0]).toEqual({ method: 'GET', path: '/api/status', status: 200 });
  });
});

describe('generateTestTs', () => {
  it('output is a string', () => {
    const ts = generateTestTs(SAMPLE_FLOW);
    expect(typeof ts).toBe('string');
  });

  it('contains test function with flow name', () => {
    const ts = generateTestTs(SAMPLE_FLOW);
    expect(ts).toContain("test('login flow'");
  });

  it('contains page.fill for #email', () => {
    const ts = generateTestTs(SAMPLE_FLOW);
    expect(ts).toContain("page.fill('#email'");
    expect(ts).toContain("'test@example.com'");
  });

  it('contains page.fill for #password with env var (not plain text)', () => {
    const ts = generateTestTs(SAMPLE_FLOW);
    expect(ts).toContain("page.fill('#password'");
    expect(ts).toContain("process.env.PASSWORD ?? ''");
    expect(ts).not.toContain("'password'");
  });

  it('contains page.click with original selector', () => {
    const ts = generateTestTs(SAMPLE_FLOW);
    expect(ts).toContain("page.click('#login-button')");
  });

  it('contains navigation URL assertion', () => {
    const ts = generateTestTs(SAMPLE_FLOW);
    expect(ts).toContain("expect(page).toHaveURL('/dashboard')");
  });

  it('imports from @playwright/test', () => {
    const ts = generateTestTs(SAMPLE_FLOW);
    expect(ts).toContain("from '@playwright/test'");
  });
});

describe('generateEvidenceJson', () => {
  it('returns a valid JSON string', () => {
    const json = generateEvidenceJson('trace.zip', SAMPLE_PARSED);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('contains source key with filename', () => {
    const json = generateEvidenceJson('trace.zip', SAMPLE_PARSED);
    const parsed = JSON.parse(json);
    expect(parsed.source).toBe('trace.zip');
  });

  it('contains actions key', () => {
    const json = generateEvidenceJson('trace.zip', SAMPLE_PARSED);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty('actions');
    expect(Array.isArray(parsed.actions)).toBe(true);
  });

  it('contains network key', () => {
    const json = generateEvidenceJson('trace.zip', SAMPLE_PARSED);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty('network');
    expect(Array.isArray(parsed.network)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gap 1: TypeScript syntax validation of generated .spec.ts
// ---------------------------------------------------------------------------

function getParseErrors(code: string): ts.Diagnostic[] {
  const sourceFile = ts.createSourceFile('generated.spec.ts', code, ts.ScriptTarget.ESNext, true);
  return (sourceFile as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics ?? [];
}

describe('generateTestTs - syntax validation', () => {
  it('generated code has no TypeScript parse errors', () => {
    const code = generateTestTs(SAMPLE_FLOW);
    expect(getParseErrors(code)).toHaveLength(0);
  });

  it('every playwright action call is preceded by await', () => {
    const code = generateTestTs(SAMPLE_FLOW);
    const actionLines = code
      .split('\n')
      .filter((l) => l.includes('page.fill') || l.includes('page.click') || l.includes('expect(page)'));
    for (const line of actionLines) {
      expect(line.trim()).toMatch(/^await /);
    }
  });

  it('test function uses async arrow function with page destructuring', () => {
    const code = generateTestTs(SAMPLE_FLOW);
    expect(code).toContain('async ({ page }) =>');
  });

  it('flow without navigate step uses /unknown as URL fallback', () => {
    const noNavFlow: Flow = {
      name: 'search',
      steps: [
        { action: 'fill', selector: '#q', value: 'hello' },
        { action: 'click', selector: '#search-btn' },
      ],
    };
    const code = generateTestTs(noNavFlow);
    expect(code).toContain("toHaveURL('/unknown')");
    expect(getParseErrors(code)).toHaveLength(0);
  });

  it('flow with only a navigate step produces valid test without fill/click lines', () => {
    const navOnlyFlow: Flow = {
      name: 'home',
      steps: [{ action: 'navigate', url: 'http://localhost:3000/home' }],
    };
    const code = generateTestTs(navOnlyFlow);
    expect(code).toContain("test('home flow'");
    expect(code).toContain("toHaveURL('/home')");
    expect(code).not.toContain('page.fill');
    expect(code).not.toContain('page.click');
    expect(getParseErrors(code)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Gap 2: Multiple flow scenarios — checkout flow
// ---------------------------------------------------------------------------

const CHECKOUT_FLOW: Flow = {
  name: 'checkout',
  steps: [
    { action: 'fill', selector: '#shipping-address', value: '123 Main St' },
    { action: 'fill', selector: '#card-number', value: '4111111111111111' },
    { action: 'click', selector: '#place-order', triggers: [{ method: 'POST', path: '/orders', status: 201 }] },
    { action: 'navigate', url: 'http://localhost:3000/order/confirm' },
  ],
};

const CHECKOUT_NETWORK: NetworkCall[] = [
  { method: 'POST', path: '/orders', status: 201, timestamp: 3100 },
];

describe('multiple flow scenarios - checkout generateFlowYaml', () => {
  it('flow name is checkout', () => {
    const yaml = generateFlowYaml(CHECKOUT_FLOW);
    const parsed = yamlLoad(yaml) as Record<string, unknown>;
    expect(parsed.flow).toBe('checkout');
  });

  it('all 4 steps are present', () => {
    const yaml = generateFlowYaml(CHECKOUT_FLOW);
    const parsed = yamlLoad(yaml) as { steps: unknown[] };
    expect(parsed.steps).toHaveLength(4);
  });

  it('click step has POST /orders 201 trigger', () => {
    const yaml = generateFlowYaml(CHECKOUT_FLOW);
    const parsed = yamlLoad(yaml) as {
      steps: Array<{ action: string; triggers?: Array<{ method: string; path: string; status: number }> }>;
    };
    const click = parsed.steps.find((s) => s.action === 'click');
    expect(click?.triggers).toContainEqual({ method: 'POST', path: '/orders', status: 201 });
  });

  it('checkout selectors are preserved exactly', () => {
    const yaml = generateFlowYaml(CHECKOUT_FLOW);
    const parsed = yamlLoad(yaml) as { steps: Array<{ selector?: string }> };
    expect(parsed.steps[0].selector).toBe('#shipping-address');
    expect(parsed.steps[1].selector).toBe('#card-number');
    expect(parsed.steps[2].selector).toBe('#place-order');
  });
});

describe('multiple flow scenarios - checkout generateApiYaml', () => {
  it('api_sequence contains POST /orders entry', () => {
    const yaml = generateApiYaml(CHECKOUT_NETWORK);
    const parsed = yamlLoad(yaml) as { api_sequence: Array<{ method: string; path: string; status: number }> };
    expect(parsed.api_sequence).toHaveLength(1);
    expect(parsed.api_sequence[0]).toEqual({ method: 'POST', path: '/orders', status: 201 });
  });
});

// ---------------------------------------------------------------------------
// AI Agent enrichment — new fields in generateFlowYaml
// ---------------------------------------------------------------------------

describe('generateFlowYaml - AI agent enrichment', () => {
  it('includes an intent field as a non-empty string', () => {
    const yaml = generateFlowYaml(SAMPLE_FLOW);
    const parsed = yamlLoad(yaml) as Record<string, unknown>;
    expect(typeof parsed.intent).toBe('string');
    expect((parsed.intent as string).length).toBeGreaterThan(0);
  });

  it('includes component_type: form when fill steps are present', () => {
    const yaml = generateFlowYaml(SAMPLE_FLOW);
    const parsed = yamlLoad(yaml) as Record<string, unknown>;
    expect(parsed.component_type).toBe('form');
  });

  it('includes component_type: navigation for nav-only flow', () => {
    const navFlow: Flow = {
      name: 'home',
      steps: [{ action: 'navigate', url: 'http://localhost:3000/home' }],
    };
    const yaml = generateFlowYaml(navFlow);
    const parsed = yamlLoad(yaml) as Record<string, unknown>;
    expect(parsed.component_type).toBe('navigation');
  });

  it('fill step has field_hint derived from #id selector', () => {
    const yaml = generateFlowYaml(SAMPLE_FLOW);
    const parsed = yamlLoad(yaml) as { steps: Array<{ action: string; field_hint?: string; selector?: string }> };
    const emailStep = parsed.steps.find((s) => s.selector === '#email');
    expect(emailStep?.field_hint).toBe('email');
  });

  it('fill step has field_hint derived from [data-test="..."] selector', () => {
    const flow: Flow = {
      name: 'signup',
      steps: [
        { action: 'fill', selector: '[data-test="firstName"]', value: 'Jane' },
        { action: 'fill', selector: '[data-test="postalCode"]', value: '10001' },
        { action: 'click', selector: '[data-test="submit"]' },
      ],
    };
    const yaml = generateFlowYaml(flow);
    const parsed = yamlLoad(yaml) as { steps: Array<{ selector?: string; field_hint?: string }> };
    const firstNameStep = parsed.steps.find((s) => s.selector?.includes('firstName'));
    const postalStep = parsed.steps.find((s) => s.selector?.includes('postalCode'));
    expect(firstNameStep?.field_hint).toBe('firstName');
    expect(postalStep?.field_hint).toBe('postalCode');
  });

  it('[data-test] password selector is scrubbed to {{REDACTED}}', () => {
    const flow: Flow = {
      name: 'login',
      steps: [{ action: 'fill', selector: '[data-test="password"]', value: 'secret_sauce' }],
    };
    const yaml = generateFlowYaml(flow);
    const parsed = yamlLoad(yaml) as { steps: Array<{ value?: string }> };
    expect(parsed.steps[0].value).toBe('{{REDACTED}}');
  });

  it('SPA flow with no triggers: last click is goal_action in YAML', () => {
    const spaFlow: Flow = {
      name: 'checkout',
      steps: [
        { action: 'click', selector: '[data-test="add-to-cart"]' },
        { action: 'click', selector: '[data-test="checkout"]' },
        { action: 'click', selector: '[data-test="finish"]' },
      ],
    };
    const yaml = generateFlowYaml(spaFlow);
    const parsed = yamlLoad(yaml) as { steps: Array<{ role: string; selector?: string }> };
    expect(parsed.steps[0].role).toBe('precondition');
    expect(parsed.steps[1].role).toBe('precondition');
    expect(parsed.steps[2].role).toBe('goal_action');
  });

  it('fill step with #password selector has value scrubbed to {{REDACTED}}', () => {
    const yaml = generateFlowYaml(SAMPLE_FLOW);
    const parsed = yamlLoad(yaml) as { steps: Array<{ selector?: string; value?: string }> };
    const pwdStep = parsed.steps.find((s) => s.selector === '#password');
    expect(pwdStep?.value).toBe('{{REDACTED}}');
  });

  it('every step has a role field', () => {
    const yaml = generateFlowYaml(SAMPLE_FLOW);
    const parsed = yamlLoad(yaml) as { steps: Array<{ role?: string }> };
    for (const step of parsed.steps) {
      expect(step.role).toBeDefined();
    }
  });

  it('goal_action step with all 2xx triggers has outcome: success', () => {
    const flow: Flow = {
      name: 'login',
      steps: [
        {
          action: 'click',
          selector: '#login-button',
          role: 'goal_action',
          triggers: [{ method: 'POST', path: '/auth/login', status: 200 }],
        },
      ],
    };
    const yaml = generateFlowYaml(flow);
    const parsed = yamlLoad(yaml) as { steps: Array<{ outcome?: string }> };
    expect(parsed.steps[0].outcome).toBe('success');
  });

  it('goal_action step with a 4xx trigger has outcome: failure', () => {
    const flow: Flow = {
      name: 'login',
      steps: [
        {
          action: 'click',
          selector: '#login-button',
          role: 'goal_action',
          triggers: [{ method: 'POST', path: '/auth/login', status: 401 }],
        },
      ],
    };
    const yaml = generateFlowYaml(flow);
    const parsed = yamlLoad(yaml) as { steps: Array<{ outcome?: string }> };
    expect(parsed.steps[0].outcome).toBe('failure');
  });

  it('triggers in YAML are structured objects not strings', () => {
    const flow: Flow = {
      name: 'login',
      steps: [
        {
          action: 'click',
          selector: '#login-button',
          triggers: [{ method: 'POST', path: '/auth/login', status: 200 }],
        },
      ],
    };
    const yaml = generateFlowYaml(flow);
    const parsed = yamlLoad(yaml) as {
      steps: Array<{ triggers?: Array<{ method: string; path: string; status: number }> }>;
    };
    expect(parsed.steps[0].triggers?.[0]).toEqual({ method: 'POST', path: '/auth/login', status: 200 });
  });
});

describe('multiple flow scenarios - checkout generateTestTs', () => {
  it('test name is checkout flow', () => {
    const code = generateTestTs(CHECKOUT_FLOW);
    expect(code).toContain("test('checkout flow'");
  });

  it('uses #shipping-address and #card-number selectors', () => {
    const code = generateTestTs(CHECKOUT_FLOW);
    expect(code).toContain("page.fill('#shipping-address', '123 Main St')");
    expect(code).toContain("page.fill('#card-number', '4111111111111111')");
  });

  it('uses #place-order selector for click', () => {
    const code = generateTestTs(CHECKOUT_FLOW);
    expect(code).toContain("page.click('#place-order')");
  });

  it('asserts /order/confirm URL', () => {
    const code = generateTestTs(CHECKOUT_FLOW);
    expect(code).toContain("toHaveURL('/order/confirm')");
  });

  it('generated checkout test has no TypeScript parse errors', () => {
    const code = generateTestTs(CHECKOUT_FLOW);
    expect(getParseErrors(code)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Regression: resolveFinalPath — multi-navigate flows must return last URL
// Bug: previously returned first navigate after first fill, not last navigate
// ---------------------------------------------------------------------------

describe('resolveFinalPath regression — multi-navigate flows', () => {
  it('multi-step SPA flow with explicit goal_action role returns navigate after goal', () => {
    const flow: Flow = {
      name: 'checkout',
      steps: [
        { action: 'fill', selector: '#username', value: 'user' },
        { action: 'click', selector: '#login', role: 'precondition' },
        { action: 'navigate', url: 'http://localhost/inventory' },
        { action: 'click', selector: '#checkout', role: 'precondition' },
        { action: 'navigate', url: 'http://localhost/checkout-step-1' },
        { action: 'click', selector: '#finish', role: 'goal_action' },
        { action: 'navigate', url: 'http://localhost/checkout-complete' },
      ],
    };
    const code = generateTestTs(flow);
    expect(code).toContain("toHaveURL('/checkout-complete')");
    expect(code).not.toContain("toHaveURL('/inventory')");
  });

  it('multi-step flow without explicit roles returns last navigate (not first)', () => {
    const flow: Flow = {
      name: 'checkout',
      steps: [
        { action: 'fill', selector: '#username', value: 'user' },
        { action: 'click', selector: '#login' },
        { action: 'navigate', url: 'http://localhost/inventory' },
        { action: 'click', selector: '#checkout' },
        { action: 'navigate', url: 'http://localhost/complete' },
      ],
    };
    const code = generateTestTs(flow);
    expect(code).toContain("toHaveURL('/complete')");
    expect(code).not.toContain("toHaveURL('/inventory')");
  });

  it('goal_action with no following navigate falls back to last navigate in flow', () => {
    const flow: Flow = {
      name: 'search',
      steps: [
        { action: 'navigate', url: 'http://localhost/home' },
        { action: 'fill', selector: '#q', value: 'test' },
        { action: 'click', selector: '#submit', role: 'goal_action' },
        // no navigate after goal_action
      ],
    };
    const code = generateTestTs(flow);
    expect(code).toContain("toHaveURL('/home')");
  });
});

// ---------------------------------------------------------------------------
// Regression: generateTestTs — sensitive fields must not appear as plain text
// Bug: previously emitted page.fill(..., 'secret_sauce') without scrubbing
// ---------------------------------------------------------------------------

describe('generateTestTs regression — sensitive field scrubbing', () => {
  it('password selector emits process.env var, not plain value', () => {
    const flow: Flow = {
      name: 'login',
      steps: [{ action: 'fill', selector: '[data-test="password"]', value: 'secret_sauce' }],
    };
    const code = generateTestTs(flow);
    expect(code).toContain('process.env.PASSWORD');
    expect(code).not.toContain('secret_sauce');
  });

  it('#password selector emits process.env.PASSWORD', () => {
    const flow: Flow = {
      name: 'login',
      steps: [{ action: 'fill', selector: '#password', value: 'hunter2' }],
    };
    const code = generateTestTs(flow);
    expect(code).toContain('process.env.PASSWORD');
    expect(code).not.toContain('hunter2');
  });

  it('non-sensitive selector emits plain value', () => {
    const flow: Flow = {
      name: 'search',
      steps: [{ action: 'fill', selector: '#username', value: 'john' }],
    };
    const code = generateTestTs(flow);
    expect(code).toContain("'john'");
  });
});

// ---------------------------------------------------------------------------
// String escaping in generated test code
// Bug class: single quotes or backslashes in selectors/values/URLs would
// produce invalid JavaScript syntax
// ---------------------------------------------------------------------------

describe('generateTestTs — string escaping', () => {
  it('value with apostrophe produces valid JS (no syntax error)', () => {
    const flow: Flow = {
      name: 'form',
      steps: [{ action: 'fill', selector: '#name', value: "O'Reilly" }],
    };
    const code = generateTestTs(flow);
    expect(code).toContain("\\'");               // escaped in output
    expect(code).not.toMatch(/fill\('#name', 'O'Reilly'\)/); // raw quote absent
    expect(getParseErrors(code)).toHaveLength(0);
  });

  it('selector with single quote produces valid JS', () => {
    const flow: Flow = {
      name: 'form',
      steps: [{ action: 'click', selector: "[aria-label=\"it's a button\"]" }],
    };
    const code = generateTestTs(flow);
    expect(getParseErrors(code)).toHaveLength(0);
  });

  it('value with backslash is double-escaped in output', () => {
    const flow: Flow = {
      name: 'form',
      steps: [{ action: 'fill', selector: '#path', value: 'C:\\Users\\file' }],
    };
    const code = generateTestTs(flow);
    expect(code).toContain('C:\\\\Users\\\\file');
    expect(getParseErrors(code)).toHaveLength(0);
  });

  it('goto URL with single quote produces valid JS', () => {
    const flow: Flow = {
      name: 'nav',
      steps: [{ action: 'navigate', url: "http://localhost/it's" }],
    };
    const code = generateTestTs(flow);
    expect(code).toContain("\\'");
    expect(getParseErrors(code)).toHaveLength(0);
  });
});
