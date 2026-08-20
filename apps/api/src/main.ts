import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap().catch((err) => {
  // Without this, a startup failure (bad DATABASE_URL, port in use, etc.)
  // surfaces only as an unhandled-rejection warning with no clear signal
  // that the app never came up — this logs it plainly and exits non-zero
  // so an orchestrator (docker/systemd) sees the failure.
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
