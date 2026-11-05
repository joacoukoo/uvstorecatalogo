import { describe, it, expect, vi, afterEach } from 'vitest';
import { callClaudeForDesc } from '../functions/api/scrape.js';

const respuestaIA = { desc: 'Una figura increíble.', specs: '- Escala: 1:6', nombre: 'Young Link', marca: 'Dream Studio', categoria: 'Estatuas Premium' };
const ok = () => new Response(JSON.stringify({ content: [{ text: JSON.stringify(respuestaIA) }] }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('callClaudeForDesc', () => {
  it('si Anthropic no puede bajar la foto (400), reintenta sin foto en vez de dejar la figura sin descripción', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"Unable to download the file"}}', { status: 400 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);
    const r = await callClaudeForDesc({ ANTHROPIC_API_KEY: 'k' }, { name: 'Young Link', foto: 'https://cdn11.bigcommerce.com/x.jpg' });
    expect(r?.desc).toContain('Una figura increíble.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const segundo = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(typeof segundo.messages[0].content).toBe('string');
  });

  it('con la foto funcionando hace una sola llamada', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
    const r = await callClaudeForDesc({ ANTHROPIC_API_KEY: 'k' }, { name: 'Young Link', foto: 'https://x/y.jpg' });
    expect(r?.desc).toContain('Una figura increíble.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
