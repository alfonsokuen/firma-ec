import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

let _prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (_prisma === undefined) {
    _prisma = new PrismaClient({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
    _prisma.$on('error' as never, (e: unknown) => {
      logger.error({ err: e }, 'prisma error');
    });
    _prisma.$on('warn' as never, (e: unknown) => {
      logger.warn({ event: e }, 'prisma warn');
    });
  }
  return _prisma;
}

export async function closePrisma(): Promise<void> {
  if (_prisma !== undefined) {
    await _prisma.$disconnect();
    _prisma = undefined;
  }
}
