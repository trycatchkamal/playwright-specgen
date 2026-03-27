import type { TraceAction, NetworkCall, FlowStep } from '../types/index.js';

const TRIGGER_WINDOW_MS = 2000;

/**
 * Correlates UI actions with API calls that occurred within TRIGGER_WINDOW_MS
 * after a 'click' action. Only click actions get triggers; fill and navigate do not.
 *
 * Assigns role: 'goal_action' to the last click that has triggers; all other
 * steps get role: 'precondition'.
 *
 * Returns FlowStep array preserving original action order.
 */
export function mapFlowToApis(actions: TraceAction[], networkCalls: NetworkCall[]): FlowStep[] {
  const steps: FlowStep[] = actions.map((action): FlowStep => {
    const step: FlowStep = { action: action.type };

    if (action.selector) step.selector = action.selector;
    if (action.value !== undefined) step.value = action.value;
    if (action.url) step.url = action.url;

    // Only click actions get API triggers
    if (action.type !== 'click') return step;

    const windowStart = action.timestamp;
    const windowEnd = action.timestamp + TRIGGER_WINDOW_MS;

    const triggered = networkCalls.filter(
      (call) => call.timestamp >= windowStart && call.timestamp <= windowEnd
    );

    if (triggered.length > 0) {
      step.triggers = triggered.map((call) => ({
        method: call.method,
        path: call.path,
        status: call.status,
      }));
    }

    return step;
  });

  // Assign roles: last click with triggers → goal_action.
  // SPA fallback: if no click has triggers, last click overall → goal_action.
  const hasAnyTriggers = steps.some((s) => s.triggers);
  let goalIdx = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    const isClick = steps[i].action === 'click';
    if (hasAnyTriggers ? (isClick && steps[i].triggers) : isClick) {
      goalIdx = i;
      break;
    }
  }

  for (let i = 0; i < steps.length; i++) {
    steps[i].role = i === goalIdx ? 'goal_action' : 'precondition';
  }

  return steps;
}
