// Small typed client for the LibreTranslate HTTP API.
// Reference: https://github.com/LibreTranslate/LibreTranslate (libretranslate/app.py)

export type Language = {
  code: string;
  name: string;
  /** Language codes this language can be translated into. */
  targets: string[];
};

export type DetectedLanguage = {
  language: string;
  confidence: number;
};

export type TextFormat = 'text' | 'html';

export type TranslateParams = {
  q: string;
  /** Source language code, or "auto" to let the server detect it. */
  source: string;
  target: string;
  format?: TextFormat;
  /** Number of alternative translations to request (0 = none). */
  alternatives?: number;
};

export type TranslateResult = {
  translatedText: string;
  /** Only present when source was "auto". */
  detectedLanguage?: DetectedLanguage;
  alternatives?: string[];
};

export type ServerSettings = {
  charLimit: number;
  frontendTimeout?: number;
  apiKeys: boolean;
  keyRequired: boolean;
  suggestions: boolean;
  filesTranslation?: boolean;
  supportedFilesFormat?: string[];
  language?: {
    source: { code: string; name: string };
    target: { code: string; name: string };
  };
};

export type ClientConfig = {
  baseUrl: string;
  apiKey?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class LibreTranslateError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LibreTranslateError';
    this.status = status;
  }
}

export function normalizeBaseUrl(url: string): string {
  let u = url.trim();
  if (!u) return u;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '');
}

export class LibreTranslateClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(config: ClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey?.trim() || undefined;
    this.timeoutMs = config.timeoutMs ?? 20000;
    // Wrap the global so it isn't called with `this` bound to the client ("Illegal invocation" in browsers).
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** GET /languages */
  getLanguages(): Promise<Language[]> {
    return this.request<Language[]>('GET', '/languages');
  }

  /** GET /frontend/settings */
  getSettings(): Promise<ServerSettings> {
    return this.request<ServerSettings>('GET', '/frontend/settings');
  }

  /** POST /translate */
  translate(params: TranslateParams): Promise<TranslateResult> {
    return this.request<TranslateResult>('POST', '/translate', {
      q: params.q,
      source: params.source,
      target: params.target,
      format: params.format ?? 'text',
      ...(params.alternatives ? { alternatives: params.alternatives } : {}),
    });
  }

  /** POST /detect — returns candidates, most likely first. */
  async detect(q: string): Promise<DetectedLanguage[]> {
    const result = await this.request<DetectedLanguage[]>('POST', '/detect', { q });
    return [...result].sort((a, b) => b.confidence - a.confidence);
  }

  /** POST /suggest — submit a better translation (only if the server enables suggestions). */
  suggest(q: string, s: string, source: string, target: string): Promise<{ success: boolean }> {
    return this.request('POST', '/suggest', { q, s, source, target });
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
    if (!this.baseUrl) throw new LibreTranslateError('No server URL configured. Set one in Settings.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = { Accept: 'application/json' };
    let payload: string | undefined;
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(this.apiKey ? { ...body, api_key: this.apiKey } : body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (e: unknown) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      throw new LibreTranslateError(
        aborted ? 'The server took too long to respond.' : `Could not reach ${this.baseUrl}. Check the server URL and your connection.`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let data: unknown = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      // Not JSON (e.g. an HTML error page from a proxy).
    }

    if (!response.ok) {
      const serverMessage =
        data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : undefined;
      throw new LibreTranslateError(serverMessage ?? defaultErrorMessage(response.status), response.status);
    }
    if (data === undefined) {
      throw new LibreTranslateError('The server returned an unexpected response. Is this a LibreTranslate server?', response.status);
    }
    return data as T;
  }
}

function defaultErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Invalid request.';
    case 403:
      return 'Access denied. This server may require a valid API key.';
    case 404:
      return 'Endpoint not found. Is this a LibreTranslate server?';
    case 429:
      return 'Too many requests. Slow down or use an API key.';
    case 500:
      return 'Translation failed on the server.';
    default:
      return `Request failed with status ${status}.`;
  }
}
