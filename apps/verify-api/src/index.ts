import { loadEnv } from './env.js';
import { logger } from './logger.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildServer({ env });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
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
