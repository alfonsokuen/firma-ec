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
  /** Send a PDF (or any document) to a JID. Returns Evolution messageId. */
  sendDocument: (
    jid: string,
    bytes: Uint8Array,
    filename: string,
    caption?: string,
  ) => Promise<{ messageId: string }>;
  /** Resolve the remoteJid of a previously seen message id. */
  findMessageJid: (messageId: string) => Promise<string | null>;
  /** Connection state for /healthz. */
  getConnectionState: () => Promise<{ state: string }>;
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
    async sendDocument(jid, bytes, filename, caption) {
      const media = Buffer.from(bytes).toString('base64');
      const body: Record<string, unknown> = {
        number: jid,
        mediatype: 'document',
        media,
        fileName: filename,
      };
      if (caption !== undefined) body['caption'] = caption;
      const res = await ax.post<{ key?: { id?: string }; messageId?: string }>(
        `/message/sendMedia/${opts.instance}`,
        body,
      );
      const messageId = res.data.key?.id ?? res.data.messageId;
      if (!messageId) {
        throw new Error('evolution: sendDocument response missing messageId');
      }
      return { messageId };
    },
    async findMessageJid(messageId) {
      const res = await ax.post<
        | Array<{ key?: { id?: string; remoteJid?: string } }>
        | { messages?: Array<{ key?: { id?: string; remoteJid?: string } }> }
      >(`/chat/findMessages/${opts.instance}`, {
        where: { key: { id: messageId } },
      });
      const list = Array.isArray(res.data)
        ? res.data
        : (res.data.messages ?? []);
      for (const m of list) {
        if (m.key?.id === messageId && typeof m.key.remoteJid === 'string') {
          return m.key.remoteJid;
        }
      }
      return null;
    },
    async getConnectionState() {
      const res = await ax.get<{ instance?: { state?: string }; state?: string }>(
        `/instance/connectionState/${opts.instance}`,
      );
      const state = res.data.instance?.state ?? res.data.state ?? 'unknown';
      return { state };
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
