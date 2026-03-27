export type ActionType = 'fill' | 'click' | 'navigate';
export type StepRole = 'precondition' | 'goal_action';
export type ComponentType = 'form' | 'navigation' | 'action';

export interface TraceAction {
  type: ActionType;
  selector?: string;
  value?: string;
  url?: string;
  timestamp: number;
}

export interface NetworkCall {
  method: string;
  path: string;
  status: number;
  timestamp: number;
}

export interface ParsedTrace {
  actions: TraceAction[];
  networkCalls: NetworkCall[];
}

export interface ApiTrigger {
  method: string;
  path: string;
  status: number;
}

export interface FlowStep {
  action: ActionType;
  selector?: string;
  value?: string;
  url?: string;
  triggers?: ApiTrigger[];
  role?: StepRole;
}

export interface Flow {
  name: string;
  steps: FlowStep[];
}

export interface GeneratedOutput {
  flowYaml: string;
  apiYaml: string;
  testTs: string;
  evidenceJson: string;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}
