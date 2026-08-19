import { Injectable, Logger } from '@nestjs/common';

// ─── Slack alerting ──────────────────────────────────────────────────────────
// The task doc assumes "the existing Slack alerting from the observability
// layer" — no such layer exists anywhere in this codebase (confirmed:
// grep -rli "slack" apps/api/src returned nothing before this file). This is
// the minimal real thing: a plain incoming-webhook POST, gated on
// SLACK_WEBHOOK_URL being set. Not a queue, not retries, not a generic
// notification service — just enough to satisfy "and this alerts" for
// verify_failed. No SLACK_WEBHOOK_URL is configured anywhere in this dev
// environment (checked .env, packages/config — nothing), so in dev this logs
// what it would have sent and returns without making a network call, rather
// than either crashing or silently pretending to have delivered something.
@Injectable()
export class SlackNotifierService {
  private readonly logger = new Logger(SlackNotifierService.name);

  async send(text: string): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      this.logger.warn(`SLACK_WEBHOOK_URL not set — would have sent: ${text}`);
      return;
    }

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        this.logger.error(
          `Slack webhook returned ${res.status}: ${await res.text()}`,
        );
      }
    } catch (err) {
      this.logger.error(`Slack webhook call failed: ${(err as Error).message}`);
    }
  }
}
