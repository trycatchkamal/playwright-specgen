import { describe, it, expect } from 'vitest';
import { mapFlowToApis } from '../src/mapper/index.js';
import type { TraceAction, NetworkCall } from '../src/types/index.js';

const BASE_ACTIONS: TraceAction[] = [
  { type: 'fill', selector: '#email', value: 'test@example.com', timestamp: 1000 },
  { type: 'fill', selector: '#password', value: 'password', timestamp: 2000 },
  { type: 'click', selector: '#login-button', timestamp: 3000 },
  { type: 'navigate', url: 'http://localhost:3000/dashboard', timestamp: 3500 },
];

const BASE_NETWORK: NetworkCall[] = [
  { method: 'POST', path: '/auth/login', status: 200, timestamp: 3100 },
  { method: 'GET', path: '/user/profile', status: 200, timestamp: 3200 },
];

describe('mapFlowToApis', () => {
  it('attaches API triggers to click action within 2000ms window', () => {
    const steps = mapFlowToApis(BASE_ACTIONS, BASE_NETWORK);
    const click = steps.find((s) => s.action === 'click');

    expect(click?.triggers).toHaveLength(2);
  });

  it('formats trigger as structured object with method, path, status', () => {
    const steps = mapFlowToApis(BASE_ACTIONS, BASE_NETWORK);
    const click = steps.find((s) => s.action === 'click');

    expect(click?.triggers).toContainEqual({ method: 'POST', path: '/auth/login', status: 200 });
    expect(click?.triggers).toContainEqual({ method: 'GET', path: '/user/profile', status: 200 });
  });

  it('does not attach API calls that happen before the click', () => {
    const earlyNetwork: NetworkCall[] = [
      { method: 'GET', path: '/early', status: 200, timestamp: 500 }, // before click at 3000
      ...BASE_NETWORK,
    ];

    const steps = mapFlowToApis(BASE_ACTIONS, earlyNetwork);
    const click = steps.find((s) => s.action === 'click');

    expect(click?.triggers).not.toContain('GET /early → 200');
    expect(click?.triggers).toHaveLength(2);
  });

  it('does not attach API calls outside the 2000ms window after click', () => {
    const lateNetwork: NetworkCall[] = [
      ...BASE_NETWORK,
      { method: 'GET', path: '/late', status: 200, timestamp: 6000 }, // 3000ms after click
    ];

    const steps = mapFlowToApis(BASE_ACTIONS, lateNetwork);
    const click = steps.find((s) => s.action === 'click');

    expect(click?.triggers).not.toContain('GET /late → 200');
    expect(click?.triggers).toHaveLength(2);
  });

  it('navigate action gets no triggers', () => {
    const steps = mapFlowToApis(BASE_ACTIONS, BASE_NETWORK);
    const nav = steps.find((s) => s.action === 'navigate');

    expect(nav?.triggers).toBeUndefined();
  });

  it('fill actions get no triggers', () => {
    const steps = mapFlowToApis(BASE_ACTIONS, BASE_NETWORK);
    const fills = steps.filter((s) => s.action === 'fill');

    for (const fill of fills) {
      expect(fill.triggers).toBeUndefined();
    }
  });

  it('returns all steps in original order', () => {
    const steps = mapFlowToApis(BASE_ACTIONS, BASE_NETWORK);

    expect(steps[0].action).toBe('fill');
    expect(steps[0].selector).toBe('#email');
    expect(steps[1].action).toBe('fill');
    expect(steps[1].selector).toBe('#password');
    expect(steps[2].action).toBe('click');
    expect(steps[3].action).toBe('navigate');
  });

  it('handles actions with no subsequent API calls (no triggers key)', () => {
    const steps = mapFlowToApis(BASE_ACTIONS, []);
    const click = steps.find((s) => s.action === 'click');

    expect(click?.triggers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Structured ApiTrigger format
// ---------------------------------------------------------------------------

describe('mapFlowToApis - structured triggers', () => {
  it('triggers are objects with method, path, status fields', () => {
    const steps = mapFlowToApis(BASE_ACTIONS, BASE_NETWORK);
    const click = steps.find((s) => s.action === 'click');

    expect(click?.triggers?.[0]).toEqual({ method: 'POST', path: '/auth/login', status: 200 });
    expect(click?.triggers?.[1]).toEqual({ method: 'GET', path: '/user/profile', status: 200 });
  });

  it('trigger objects are not strings', () => {
    const steps = mapFlowToApis(BASE_ACTIONS, BASE_NETWORK);
    const click = steps.find((s) => s.action === 'click');

    for (const trigger of click?.triggers ?? []) {
      expect(typeof trigger).not.toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// Role assignment
// ---------------------------------------------------------------------------

describe('mapFlowToApis - step role assignment', () => {
  it('last click with triggers is assigned role: goal_action', () => {
    const steps = mapFlowToApis(BASE_ACTIONS, BASE_NETWORK);
    const click = steps.find((s) => s.action === 'click');

    expect(click?.role).toBe('goal_action');
  });

  it('fill steps are assigned role: precondition', () => {
    const steps = mapFlowToApis(BASE_ACTIONS, BASE_NETWORK);
    const fills = steps.filter((s) => s.action === 'fill');

    for (const fill of fills) {
      expect(fill.role).toBe('precondition');
    }
  });

  it('navigate steps are assigned role: precondition', () => {
    const steps = mapFlowToApis(BASE_ACTIONS, BASE_NETWORK);
    const nav = steps.find((s) => s.action === 'navigate');

    expect(nav?.role).toBe('precondition');
  });

  it('when no network at all, last click is still goal_action (SPA fallback)', () => {
    const steps = mapFlowToApis(BASE_ACTIONS, []);
    const click = steps.find((s) => s.action === 'click');

    expect(click?.role).toBe('goal_action');
  });

  it('when multiple clicks, only the last one with triggers is goal_action', () => {
    const twoClickActions: TraceAction[] = [
      { type: 'click', selector: '#btn-1', timestamp: 1000 },
      { type: 'click', selector: '#btn-2', timestamp: 3000 },
    ];
    const network: NetworkCall[] = [
      { method: 'POST', path: '/api/action', status: 200, timestamp: 3100 },
    ];

    const steps = mapFlowToApis(twoClickActions, network);
    expect(steps[0].role).toBe('precondition');
    expect(steps[1].role).toBe('goal_action');
  });

  it('SPA fallback: when no click has triggers, last click is goal_action', () => {
    const spaActions: TraceAction[] = [
      { type: 'click', selector: '[data-test="add-to-cart"]', timestamp: 1000 },
      { type: 'click', selector: '[data-test="checkout"]', timestamp: 2000 },
      { type: 'click', selector: '[data-test="finish"]', timestamp: 3000 },
    ];

    const steps = mapFlowToApis(spaActions, []);
    expect(steps[0].role).toBe('precondition');
    expect(steps[1].role).toBe('precondition');
    expect(steps[2].role).toBe('goal_action');
  });
});
