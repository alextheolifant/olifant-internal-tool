// Manual trigger for anomaly detection.
//
// Usage:
//   pnpm detect:anomalies                    # today
//   pnpm detect:anomalies -- --date=2026-07-15
//
// TODO(temporal): once scheduling is built, a daily workflow (run right
// after the metrics sync completes) should call AnomaliesService.detectAnomalies()
// directly instead of shelling out to this script.
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AnomaliesService } from '../modules/anomalies/anomalies.service';

async function main() {
  const dateArg = process.argv
    .find((a) => a.startsWith('--date='))
    ?.split('=')[1];
  const date = dateArg ?? new Date().toISOString().slice(0, 10);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(AnomaliesService);
    const summary = await service.detectAnomalies(date);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
