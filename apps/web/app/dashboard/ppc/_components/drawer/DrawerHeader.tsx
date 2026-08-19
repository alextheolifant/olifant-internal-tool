import { healthTokens, taskStatusToken, taskTypeToken } from "../../../_lib/theme";
import type { TaskDetail } from "../../_lib/ppc-task-detail-api";

function Pill({ bg, text, children }: { bg: string; text: string; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${bg} ${text}`}>{children}</span>
  );
}

export function DrawerHeader({ detail }: { detail: TaskDetail }) {
  const status = taskStatusToken(detail.status);
  const type = taskTypeToken(detail.type);

  return (
    <div className="border-b border-neutral-200 px-5 py-4">
      <p className="font-mono text-[11px] text-neutral-400">
        {detail.id} · rule {detail.ruleId} · {detail.clientName}
      </p>
      <h2 className="mt-1 text-[14px] font-bold leading-snug text-ink">{detail.title}</h2>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Pill bg={status.bg} text={status.text}>{status.label}</Pill>
        <Pill bg="bg-neutral-100" text={type.text}>{type.label}</Pill>
        <Pill bg="bg-neutral-100" text="text-neutral-600">
          {detail.confidence.charAt(0).toUpperCase() + detail.confidence.slice(1)} confidence
        </Pill>

        {/* Caution, not error: this flags human judgement is needed before
            acting, which is different from something being wrong. Amber
            (watch) rather than red (act_now). */}
        {detail.requiresReview && (
          <Pill bg={healthTokens.watch.bg} text={healthTokens.watch.text}>Requires review</Pill>
        )}
      </div>
    </div>
  );
}
