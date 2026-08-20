"use client";


// Four optional, combinable filters. Plain <select> rather than the chat
// screen's custom popover: these are short, flat, keyboard-navigable lists,
// and the custom dropdown there exists to render two-line client entries
// with status dots, which none of these need.
export interface QueueFilterValues {
  type: string;
  status: string;
  assignee: string;
}

export const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "negation", label: "Negation" },
  { value: "bid_change", label: "Bid change" },
  { value: "harvest_launch", label: "Harvest" },
  { value: "budget", label: "Budget" },
  { value: "placement", label: "Placement" },
  { value: "pause", label: "Pause" },
  { value: "investigate", label: "Investigate" },
];

export const STATUS_OPTIONS = [
  { value: "", label: "Open statuses" },
  { value: "pending", label: "Pending review" },
  { value: "approved", label: "Approved" },
  { value: "blocked", label: "Blocked" },
  { value: "executed", label: "Executed" },
  { value: "verified", label: "Verified" },
  { value: "dismissed", label: "Dismissed" },
  { value: "expired", label: "Expired" },
];

const selectClass =
  "rounded-lg border border-neutral-200 bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink " +
  "transition-colors hover:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-brand/40";

export function QueueFilters({
  values,
  assignees,
  onChange,
}: {
  values: QueueFilterValues;
  assignees: string[];
  onChange: (next: QueueFilterValues) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <select
        aria-label="Filter by type"
        className={selectClass}
        value={values.type}
        onChange={(e) => onChange({ ...values, type: e.target.value })}
      >
        {TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        aria-label="Filter by status"
        className={selectClass}
        value={values.status}
        onChange={(e) => onChange({ ...values, status: e.target.value })}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        aria-label="Filter by assignee"
        className={selectClass}
        value={values.assignee}
        onChange={(e) => onChange({ ...values, assignee: e.target.value })}
      >
        <option value="">All assignees</option>
        {assignees.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>

      {/* Verbatim from the design brief. */}
      <span className="ml-auto text-[11.5px] text-neutral-400">
        sorted by priority ($ impact ÷ minutes)
      </span>
    </div>
  );
}

export function hasActiveFilters(values: QueueFilterValues, clientId: string): boolean {
  return Boolean(values.type || values.status || values.assignee || (clientId && clientId !== "all"));
}

