// Manual/cron trigger for task promotion. Run after run-rules.ts for the
// same date — converts every not-yet-promoted task_candidates row into a
// real task (create, or dedup-update an existing open one). Safe to re-run:
// already-promoted candidates are never revisited.
//
// Usage:
//   pnpm tasks:promote
//
// Production (compiled): node dist/scripts/promote-tasks.js
//
// TODO(temporal): once the sync -> rules -> promote chain is a real
// workflow, a scheduled step should call
// TaskPromotionService.promoteNewCandidates() directly instead of shelling
// out to this script.
import { NestFactory } from '@nestjs/core';
import { CliModule } from './cli.module';
import { TaskPromotionService } from '../modules/ppc/tasks/task-promotion.service';

async function main() {
  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(TaskPromotionService);
    const summary = await service.promoteNewCandidates();
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
