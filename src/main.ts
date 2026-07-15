import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** Boots the HTTP API (the `enrichments` controller). Loads `.env` first so provider config (API keys, etc.) is available before any provider is constructed. */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
