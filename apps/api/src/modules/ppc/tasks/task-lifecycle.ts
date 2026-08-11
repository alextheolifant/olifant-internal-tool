import type { TaskStatus } from './task.types';

// ─── Status state machine ───────────────────────────────────────────────────
// pending → approved → executed → verified is the brief's stated happy path.
// approved is a required gate — pending cannot jump straight to executed.
// dismissed/expired are reachable from any open (non-terminal) state;
// executed/verified/dismissed/expired are all terminal — nothing leaves them.
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['approved', 'blocked', 'dismissed', 'expired'],
  approved: ['executed', 'blocked', 'dismissed', 'expired'],
  blocked: ['pending', 'approved', 'dismissed', 'expired'],
  executed: ['verified'],
  verified: [],
  dismissed: [],
  expired: [],
};

export class InvalidTaskTransitionError extends Error {
  constructor(
    public readonly from: TaskStatus,
    public readonly to: TaskStatus,
  ) {
    super(`Invalid task status transition: ${from} → ${to}`);
    this.name = 'InvalidTaskTransitionError';
  }
}

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidTransition(from: TaskStatus, to: TaskStatus): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidTaskTransitionError(from, to);
  }
}

// Terminal statuses may still hold a task's evidence/instructions steady,
// but nothing about the task itself should ever change status again.
export function isTerminal(status: TaskStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0;
}

// The three "still needs doing" statuses — what dedup, the 45-day ceiling,
// and expiry-on-clear all scope themselves to.
export const OPEN_STATUSES: TaskStatus[] = ['pending', 'approved', 'blocked'];
