import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import axios, { type AxiosInstance } from 'axios';

declare module 'fastify' {
  interface FastifyInstance {
    evolution: EvolutionClient;
  }
}

export interface EvolutionClient {
  /** Send plain text to a JID. */
  sendText: (jid: string, text: string) => Promise<void>;
  /** Fetch a media (PDF) message body as base64. */
  getBase64FromMediaMessage: (message: unknown) => Promise<string>;
  /** Underlying axios for advanced flows / tests. */
  axios: AxiosInstance;
}

export interface EvolutionPluginOpts {
  baseUrl: string;
  apiKey: string;
  instance: string;
  /** Override (mock) for tests. */
  client?: EvolutionClient;
}

function buildClient(opts: EvolutionPluginOpts): EvolutionClient {
  const ax = axios.create({
    baseURL: opts.baseUrl,
    timeout: 15_000,
    headers: { apikey: opts.apiKey, 'Content-Type': 'application/json' },
  });
  return {
    axios: ax,
    async sendText(jid, text) {
      await ax.post(`/message/sendText/${opts.instance}`, {
        number: jid,
        text,
      });
    },
    async getBase64FromMediaMessage(message) {
      const res = await ax.post<{ base64: string }>(
        `/chat/getBase64FromMediaMessage/${opts.instance}`,
        { message },
      );
      return res.data.base64;
    },
  };
}

export default fp<EvolutionPluginOpts>(async function evolutionPlugin(
  app: FastifyInstance,
  opts,
) {
  const client = opts.client ?? buildClient(opts);
  app.decorate('evolution', client);
}, { name: 'evolution' });
