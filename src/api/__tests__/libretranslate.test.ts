import { LibreTranslateClient, LibreTranslateError, normalizeBaseUrl } from '../libretranslate';

type Call = { url: string; init: RequestInit };

function mockFetch(status: number, body: unknown, calls: Call[] = []) {
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as Response;
  }) as unknown as typeof fetch;
  return impl;
}

describe('normalizeBaseUrl', () => {
  it('adds https and strips trailing slashes', () => {
    expect(normalizeBaseUrl(' translate.example.com/ ')).toBe('https://translate.example.com');
    expect(normalizeBaseUrl('http://192.168.1.5:5000//')).toBe('http://192.168.1.5:5000');
  });
});

describe('LibreTranslateClient', () => {
  it('GETs /languages without a body', async () => {
    const calls: Call[] = [];
    const langs = [{ code: 'en', name: 'English', targets: ['es'] }];
    const client = new LibreTranslateClient({ baseUrl: 'http://lt.local/', fetchImpl: mockFetch(200, langs, calls) });
    await expect(client.getLanguages()).resolves.toEqual(langs);
    expect(calls[0].url).toBe('http://lt.local/languages');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('POSTs /translate as JSON with api_key and alternatives', async () => {
    const calls: Call[] = [];
    const client = new LibreTranslateClient({
      baseUrl: 'http://lt.local',
      apiKey: ' secret ',
      fetchImpl: mockFetch(200, { translatedText: 'Hola', detectedLanguage: { language: 'en', confidence: 90 } }, calls),
    });
    const res = await client.translate({ q: 'Hello', source: 'auto', target: 'es', alternatives: 2 });
    expect(res.translatedText).toBe('Hola');
    expect(calls[0].url).toBe('http://lt.local/translate');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      q: 'Hello',
      source: 'auto',
      target: 'es',
      format: 'text',
      alternatives: 2,
      api_key: 'secret',
    });
  });

  it('omits api_key when none is set', async () => {
    const calls: Call[] = [];
    const client = new LibreTranslateClient({ baseUrl: 'http://lt.local', fetchImpl: mockFetch(200, [], calls) });
    await client.detect('Bonjour');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ q: 'Bonjour' });
  });

  it('sorts /detect results by confidence', async () => {
    const client = new LibreTranslateClient({
      baseUrl: 'http://lt.local',
      fetchImpl: mockFetch(200, [
        { language: 'es', confidence: 20 },
        { language: 'fr', confidence: 95 },
      ]),
    });
    expect((await client.detect('Bonjour'))[0].language).toBe('fr');
  });

  it('surfaces the server error message', async () => {
    const client = new LibreTranslateClient({
      baseUrl: 'http://lt.local',
      fetchImpl: mockFetch(403, { error: 'Invalid API key' }),
    });
    await expect(client.translate({ q: 'a', source: 'en', target: 'es' })).rejects.toMatchObject({
      message: 'Invalid API key',
      status: 403,
    });
  });

  it('gives a readable error for non-JSON responses', async () => {
    const client = new LibreTranslateClient({ baseUrl: 'http://lt.local', fetchImpl: mockFetch(502, '<html>Bad gateway</html>') });
    await expect(client.getLanguages()).rejects.toThrow('Request failed with status 502.');
  });

  it('reports network failures', async () => {
    const failing = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const client = new LibreTranslateClient({ baseUrl: 'http://lt.local', fetchImpl: failing });
    await expect(client.getLanguages()).rejects.toBeInstanceOf(LibreTranslateError);
    await expect(client.getLanguages()).rejects.toThrow(/Could not reach/);
  });

  it('requires a server URL', async () => {
    const client = new LibreTranslateClient({ baseUrl: '  ' });
    await expect(client.getLanguages()).rejects.toThrow(/No server URL/);
  });
});
