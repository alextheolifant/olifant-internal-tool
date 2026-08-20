import { EM_DASH } from "../../../_lib/format";
import type { TaskDetailAction } from "../../_lib/ppc-task-detail-api";

// Before/after pairing. The left card is neutral and bordered; the right is
// yellow-soft so the eye lands on what will change.
export function ChangeCards({ action }: { action: TaskDetailAction }) {
  const scope = action.adGroupId ? "ad group level" : "campaign level";

  return (
    <div className="flex gap-2">
      <div className="flex-1 rounded-lg border border-neutral-200 bg-surface px-3 py-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">Current</p>
        <p className="mt-0.5 font-mono text-[12.5px] text-ink">
          {action.oldValue === null || action.oldValue === "" ? EM_DASH : String(action.oldValue)}
        </p>
      </div>
      <div className="flex-1 rounded-lg bg-yellow-200 px-3 py-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-amber-800">Change to</p>
        <p className="mt-0.5 font-mono text-[12.5px] text-amber-800">
          {action.newValue === null || action.newValue === "" ? EM_DASH : String(action.newValue)}
          {action.newValue !== null && <span className="text-amber-700"> · {scope}</span>}
        </p>
      </div>
    </div>
  );
}
