import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export interface PrismaPluginOpts {
  client?: PrismaClient;
}

export default fp<PrismaPluginOpts>(
  async function prismaPlugin(app: FastifyInstance, opts) {
    const prisma = opts.client ?? new PrismaClient();
    app.decorate('prisma', prisma);
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  },
  { name: 'prisma' },
);
