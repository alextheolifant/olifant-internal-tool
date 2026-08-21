// Manual/cron trigger for the rule engine. Run after the day's Amazon syncs
// have completed — see runForDate's own freshness guard, which skips (and
// Slack-alerts on) any client whose synced data isn't fresh enough to trust,
// rather than evaluating rules against stale or missing data.
//
// Usage:
//   pnpm rules:run                    # today, UTC
//   pnpm rules:run -- --date=2026-07-15
//
// Production (compiled): node dist/scripts/run-rules.js --date=2026-07-15
//
// TODO(temporal): once the sync -> rules -> promote chain is a real
// workflow, a scheduled step should call RuleRunnerService.runForDate()
// directly instead of shelling out to this script — and should invoke it
// only once its upstream sync step has actually succeeded, making the
// in-service freshness guard a defensive backstop rather than the only line
// of defense against stale data.
import { NestFactory } from '@nestjs/core';
import { CliModule } from './cli.module';
import { RuleRunnerService } from '../modules/ppc/rules/rule-runner.service';

async function main() {
  const dateArg = process.argv
    .find((a) => a.startsWith('--date='))
    ?.split('=')[1];
  const date = dateArg ?? new Date().toISOString().slice(0, 10);

  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(RuleRunnerService);
    const summary = await service.runForDate(date);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
