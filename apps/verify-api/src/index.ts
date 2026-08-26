import { loadEnv } from './env.js';
import { logger } from './logger.js';
import { buildServer } from './server.js';

/**
 * Last-resort handlers.
 *
 * Without these a rejected promise anywhere (a worker terminate that fails, a
 * close() that throws during shutdown) becomes a silent process-level event.
 * We log it and exit non-zero: a supervised service that dies loudly is far
 * better than one that keeps serving from an unknown state.
 */
function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaught exception');
    process.exit(1);
  });
}

async function main(): Promise<void> {
  installProcessGuards();
  const env = loadEnv();
  const app = await buildServer({ env });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
    } catch (err) {
      // Never let a failing close() turn into an unhandled rejection and a
      // process that neither serves nor exits.
      logger.error({ err }, 'error while closing');
      process.exit(1);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err: unknown) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
