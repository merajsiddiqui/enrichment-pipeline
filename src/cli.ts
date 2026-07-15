import 'dotenv/config';
import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';

/**
 * Boots the CLI (currently just the `enrich` command) from the same
 * `AppModule` graph as the HTTP API. Loads `.env` first so provider env vars
 * are set before anything reads them.
 *
 * Log level includes `'log'`, not just `'warn'`/`'error'` — the retry/batch
 * visibility this CLI prints (resolving progress, quick retries, retry
 * rounds) is logged at that level; restricting to warnings-and-up would
 * silently hide it while still showing the one-off "still rejected, retrying
 * as smaller requests" warning, making retries look like they're not
 * happening at all.
 */
async function bootstrap() {
  await CommandFactory.run(AppModule, ['log', 'warn', 'error']);
}

bootstrap();
