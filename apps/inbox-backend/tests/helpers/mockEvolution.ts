/**
 * In-process Evolution API stand-in. Records every call so integration tests
 * can assert on inbound (sendText, sendDocument) and outbound (getBase64,
 * findMessageJid) traffic.
 */
import type { EvolutionClient } from '../../src/plugins/evolution.js';

export interface SentText {
  jid: string;
  text: string;
}

export interface SentDoc {
  jid: string;
  bytes: Uint8Array;
  filename: string;
  caption?: string;
}

export interface MemoryEvolution extends EvolutionClient {
  sentTexts: SentText[];
  sentDocs: SentDoc[];
  fetchCalls: number;
  /** PDF bytes returned from getBase64FromMediaMessage (mock attachment). */
  pdfBase64: string;
  /** messageId → remoteJid for findMessageJid resolution. */
  jidByMessageId: Map<string, string>;
  /** Connection state reported via getConnectionState. */
  connectionState: string;
}

export function buildMemoryEvolution(
  opts: {
    pdfBase64?: string;
    jidByMessageId?: Record<string, string>;
    connectionState?: string;
  } = {},
): MemoryEvolution {
  const evo: MemoryEvolution = {
    axios: {} as never,
    sentTexts: [],
    sentDocs: [],
    fetchCalls: 0,
    pdfBase64: opts.pdfBase64 ?? '',
    jidByMessageId: new Map(Object.entries(opts.jidByMessageId ?? {})),
    connectionState: opts.connectionState ?? 'open',
    async sendText(jid: string, text: string) {
      this.sentTexts.push({ jid, text });
    },
    async getBase64FromMediaMessage(_message: unknown) {
      this.fetchCalls++;
      return this.pdfBase64;
    },
    async sendDocument(jid: string, bytes: Uint8Array, filename: string, caption?: string) {
      const entry: SentDoc = { jid, bytes: new Uint8Array(bytes), filename };
      if (caption !== undefined) entry.caption = caption;
      this.sentDocs.push(entry);
      return { messageId: `evo-out-${String(this.sentDocs.length)}` };
    },
    async findMessageJid(messageId: string) {
      return this.jidByMessageId.get(messageId) ?? null;
    },
    async getConnectionState() {
      return { state: this.connectionState };
    },
  };
  return evo;
}
