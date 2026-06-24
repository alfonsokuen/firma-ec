import { loadEnv } from './env.js';
import { logger } from './logger.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown initiated');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    logger.info({ host: env.HOST, port: env.PORT }, 'stats-backend listening');
  } catch (err) {
    logger.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
