/**
 * Standalone Evolution client factory.
 *
 * The Fastify plugin (`plugins/evolution.ts`) is the production wiring; this
 * module exists for testability — callers can build a client around an arbitrary
 * AxiosInstance (e.g. one wrapped by nock/msw) without going through Fastify.
 */
import axios, { type AxiosInstance } from 'axios';
import type { EvolutionClient } from '../plugins/evolution.js';

export interface BuildEvolutionOpts {
  baseUrl: string;
  apiKey: string;
  instance: string;
  /** Override axios for tests (preferred). */
  axios?: AxiosInstance;
  timeoutMs?: number;
}

export function buildEvolutionClient(opts: BuildEvolutionOpts): EvolutionClient {
  const ax =
    opts.axios ??
    axios.create({
      baseURL: opts.baseUrl,
      timeout: opts.timeoutMs ?? 15_000,
      headers: { apikey: opts.apiKey, 'Content-Type': 'application/json' },
    });
  const inst = opts.instance;

  return {
    axios: ax,
    async sendText(jid, text) {
      await ax.post(`/message/sendText/${inst}`, { number: jid, text });
    },
    async getBase64FromMediaMessage(message) {
      const res = await ax.post<{ base64: string }>(`/chat/getBase64FromMediaMessage/${inst}`, {
        message,
      });
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
      const res = await ax.post<{
        key?: { id?: string };
        messageId?: string;
      }>(`/message/sendMedia/${inst}`, body);
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
      >(`/chat/findMessages/${inst}`, {
        where: { key: { id: messageId } },
      });
      const list = Array.isArray(res.data) ? res.data : (res.data.messages ?? []);
      for (const m of list) {
        if (m.key?.id === messageId && typeof m.key.remoteJid === 'string') {
          return m.key.remoteJid;
        }
      }
      return null;
    },
    async getConnectionState() {
      const res = await ax.get<{
        instance?: { state?: string };
        state?: string;
      }>(`/instance/connectionState/${inst}`);
      const state = res.data.instance?.state ?? res.data.state ?? 'unknown';
      return { state };
    },
  };
}
