import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { explicarErrorIA } from '../functions/_lib/errorIA.js';
import { onRequestPost as ai } from '../functions/api/ai.js';
import { onRequestPost as scrape } from '../functions/api/scrape.js';

const anthropic = (tipo, message) => JSON.stringify({ type: 'error', error: { type: tipo, message } });
const sinCredito = anthropic('invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');

afterEach(() => vi.unstubAllGlobals());

describe('explicarErrorIA', () => {
  it('sin crédito dice que hay que cargar saldo', () => {
    expect(explicarErrorIA(400, sinCredito)).toMatch(/sin crédito/i);
  });
  it('clave rechazada (401) apunta a ANTHROPIC_API_KEY', () => {
    expect(explicarErrorIA(401, anthropic('authentication_error', 'invalid x-api-key'))).toContain('ANTHROPIC_API_KEY');
  });
  it('límite de pedidos (429) pide esperar', () => {
    expect(explicarErrorIA(429, anthropic('rate_limit_error', 'slow down'))).toMatch(/esperá/i);
  });
  it('Anthropic caído o saturado (529) lo dice', () => {
    expect(explicarErrorIA(529, anthropic('overloaded_error', 'Overloaded'))).toMatch(/saturad|caíd/i);
  });
  it('un 400 desconocido muestra el mensaje real de Anthropic, sin el JSON alrededor', () => {
    const m = explicarErrorIA(400, anthropic('invalid_request_error', 'messages: text content blocks must be non-empty'));
    expect(m).toBe('Anthropic 400: messages: text content blocks must be non-empty');
  });
  it('una respuesta que no es JSON también se muestra', () => {
    expect(explicarErrorIA(502, '<html>Bad gateway</html>')).toMatch(/saturad|caíd/i);
    expect(explicarErrorIA(418, 'tetera')).toBe('Anthropic 418: tetera');
  });
});

describe('/api/ai', () => {
  it('devuelve la causa ya explicada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sinCredito, { status: 400 })));
    const request = new Request('https://uvstore.shop/api/ai', { method: 'POST', body: JSON.stringify({ prompt: 'p' }) });
    const res = await ai({ env: { ANTHROPIC_API_KEY: 'k' }, request });
    expect((await res.json()).error).toMatch(/sin crédito/i);
  });
});

describe('/api/scrape cuando la IA falla', () => {
  const ficha = readFileSync(new URL('./fixtures/nonasea-ficha.json', import.meta.url), 'utf-8');
  const pedir = (env, anthropicRes) => {
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (String(url).includes('nonasea.com')) return new Response(ficha);
      return anthropicRes();
    }));
    const request = new Request('https://x/api/scrape', { method: 'POST', body: JSON.stringify({ url: 'https://www.nonasea.com/api/customer/shop/product/32755' }) });
    return scrape({ env, request }).then(r => r.json());
  };

  it('trae los datos y la causa', async () => {
    const d = await pedir({ ANTHROPIC_API_KEY: 'k' }, () => new Response(sinCredito, { status: 400 }));
    expect(d.ai_ok).toBe(false);
    expect(d.ai_error).toMatch(/sin crédito/i);
    expect(d.name).toBeTruthy();
  });
  it('sin clave configurada lo dice', async () => {
    const d = await pedir({}, () => new Response('{}'));
    expect(d.ai_error).toContain('ANTHROPIC_API_KEY');
  });
  it('si la IA responde algo ilegible lo dice', async () => {
    const d = await pedir({ ANTHROPIC_API_KEY: 'k' }, () => new Response(JSON.stringify({ content: [{ text: 'no puedo' }] })));
    expect(d.ai_ok).toBe(false);
    expect(d.ai_error).toMatch(/no se pudo leer/i);
  });
  it('si la llamada se corta lo dice', async () => {
    const d = await pedir({ ANTHROPIC_API_KEY: 'k' }, () => { throw new DOMException('aborted', 'AbortError'); });
    expect(d.ai_error).toMatch(/tardó/i);
  });
  it('con la IA funcionando no hay causa', async () => {
    const texto = JSON.stringify({ desc: 'Linda.', categoria: 'Estatuas Premium' });
    const d = await pedir({ ANTHROPIC_API_KEY: 'k' }, () => new Response(JSON.stringify({ content: [{ text: texto }] })));
    expect(d.ai_ok).toBe(true);
    expect(d.ai_error).toBeUndefined();
  });
});

describe('barra de estado del admin', () => {
  const html = readFileSync(new URL('../admin-app.html', import.meta.url), 'utf-8');
  const funcion = nombre => html.split(/\r?\n/).find(l => l.startsWith(`function ${nombre}(`));

  it('el mensaje del scrape incluye la causa', () => {
    const mensajeScrape = new Function(`${funcion('mensajeScrape')}; return mensajeScrape;`)();
    expect(mensajeScrape({ ai_ok: false, ai_error: 'Sin crédito en Anthropic' })).toContain('Sin crédito en Anthropic');
    expect(mensajeScrape({ ai_ok: true })).toBe('Listo — revisa y ajusta');
  });
  it('un mensaje largo no se corta en una línea', () => {
    expect(html.match(/#status-bar\{[^}]*\}/)[0]).not.toContain('nowrap');
  });
  it('el mensaje completo queda al pasar el mouse', () => {
    const el = { style: {} };
    const setStatus = new Function('document', `${funcion('setStatus')}; return setStatus;`)({ getElementById: () => el });
    setStatus('Error IA: x', 'red');
    expect(el.title).toBe('Error IA: x');
  });
});
