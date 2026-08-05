import { healthTokens } from "../../_lib/theme";
import type { ChatStep } from "../../_lib/chat-types";
import { IconCheck } from "./icons";

// TODO(step-detail-expansion): the reference screenshot shows a chevron on
// completed steps to expand and see what that step actually did (e.g. which
// metrics were pulled, how many records). Not built — pending client
// confirmation on whether they want drill-down or just this visible
// progression. If/when it's scoped: each CopilotStep would need a detail
// payload (shape depends on step — e.g. metrics step: client count + date
// range; context step: which sections were included), plus expand/collapse
// state here.
export function StepStack({ steps }: { steps: ChatStep[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="mb-2 flex flex-col gap-1">
      {steps.map((s) => (
        <div key={s.id} className="flex items-center gap-1.5 text-[12px]">
          {s.status === "complete" ? (
            <IconCheck className={`h-3 w-3 shrink-0 ${healthTokens.on_target.text}`} />
          ) : (
            <span
              className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-neutral-300 border-t-neutral-500"
              aria-hidden="true"
            />
          )}
          <span className={s.status === "complete" ? "text-neutral-400" : "font-medium text-neutral-600"}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}
