import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { buildEvolutionClient } from '../src/services/evolution-client.js';

function fakeAxios(): {
  ax: AxiosInstance;
  posts: Array<{ url: string; body: unknown }>;
  gets: Array<{ url: string }>;
  postReply: unknown;
  getReply: unknown;
} {
  const state = {
    posts: [] as Array<{ url: string; body: unknown }>,
    gets: [] as Array<{ url: string }>,
    postReply: {} as unknown,
    getReply: {} as unknown,
  };
  const ax = {
    post: vi.fn(async (url: string, body: unknown) => {
      state.posts.push({ url, body });
      return { data: state.postReply };
    }),
    get: vi.fn(async (url: string) => {
      state.gets.push({ url });
      return { data: state.getReply };
    }),
  } as unknown as AxiosInstance;
  return Object.assign(state, { ax });
}

describe('buildEvolutionClient', () => {
  it('sendDocument posts base64 + filename and returns messageId', async () => {
    const f = fakeAxios();
    f.postReply = { key: { id: 'evo-msg-1' } };
    const client = buildEvolutionClient({
      baseUrl: 'http://x',
      apiKey: 'k',
      instance: 'firmar-ec-inbox',
      axios: f.ax,
    });
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const out = await client.sendDocument(
      '593989778888@s.whatsapp.net',
      bytes,
      'firmado.pdf',
      'aquí está',
    );
    expect(out.messageId).toBe('evo-msg-1');
    expect(f.posts).toHaveLength(1);
    const p = f.posts[0]!;
    expect(p.url).toBe('/message/sendMedia/firmar-ec-inbox');
    const body = p.body as Record<string, unknown>;
    expect(body['mediatype']).toBe('document');
    expect(body['fileName']).toBe('firmado.pdf');
    expect(body['caption']).toBe('aquí está');
    expect(body['number']).toBe('593989778888@s.whatsapp.net');
    expect(body['media']).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('sendDocument throws on missing messageId', async () => {
    const f = fakeAxios();
    f.postReply = {};
    const client = buildEvolutionClient({
      baseUrl: 'http://x',
      apiKey: 'k',
      instance: 'inst',
      axios: f.ax,
    });
    await expect(
      client.sendDocument('jid', new Uint8Array(), 'a.pdf'),
    ).rejects.toThrow(/messageId/);
  });

  it('findMessageJid extracts remoteJid by message id', async () => {
    const f = fakeAxios();
    f.postReply = [
      { key: { id: 'other', remoteJid: 'wrong@s.whatsapp.net' } },
      { key: { id: 'msg-1', remoteJid: '593989778888@s.whatsapp.net' } },
    ];
    const client = buildEvolutionClient({
      baseUrl: 'http://x',
      apiKey: 'k',
      instance: 'inst',
      axios: f.ax,
    });
    const jid = await client.findMessageJid('msg-1');
    expect(jid).toBe('593989778888@s.whatsapp.net');
    expect(f.posts[0]?.url).toBe('/chat/findMessages/inst');
  });

  it('findMessageJid returns null when not found', async () => {
    const f = fakeAxios();
    f.postReply = [];
    const client = buildEvolutionClient({
      baseUrl: 'http://x',
      apiKey: 'k',
      instance: 'inst',
      axios: f.ax,
    });
    expect(await client.findMessageJid('absent')).toBeNull();
  });

  it('findMessageJid handles {messages:[...]} envelope shape', async () => {
    const f = fakeAxios();
    f.postReply = {
      messages: [{ key: { id: 'm', remoteJid: 'r@s.whatsapp.net' } }],
    };
    const client = buildEvolutionClient({
      baseUrl: 'http://x',
      apiKey: 'k',
      instance: 'inst',
      axios: f.ax,
    });
    expect(await client.findMessageJid('m')).toBe('r@s.whatsapp.net');
  });

  it('getConnectionState returns state from instance.state', async () => {
    const f = fakeAxios();
    f.getReply = { instance: { state: 'open' } };
    const client = buildEvolutionClient({
      baseUrl: 'http://x',
      apiKey: 'k',
      instance: 'inst',
      axios: f.ax,
    });
    expect(await client.getConnectionState()).toEqual({ state: 'open' });
    expect(f.gets[0]?.url).toBe('/instance/connectionState/inst');
  });
});
