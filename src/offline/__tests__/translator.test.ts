import { LibreTranslateError } from '../../api/libretranslate';
import {
  DeviceTranslator,
  OfflineUnavailableError,
  isConnectivityError,
  translateRouted,
} from '../translator';

function device(status: 'installed' | 'supported' | 'unsupported' = 'installed'): DeviceTranslator & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    detectLanguage: jest.fn(async () => ({ language: 'es', confidence: 92 })),
    languageStatus: jest.fn(async (s: string, t: string) => {
      calls.push(`status ${s}-${t}`);
      return status;
    }),
    translate: jest.fn(async (text: string, s: string, t: string) => {
      calls.push(`translate ${s}-${t}`);
      return `[device] ${text}`;
    }),
  };
}

const params = { q: 'hola', source: 'es', target: 'en' };
const offline = () => Promise.reject(new LibreTranslateError('Could not reach server'));
const online = async () => ({ translatedText: 'hello' });

describe('isConnectivityError', () => {
  it('treats missing status and gateway errors as connectivity problems', () => {
    expect(isConnectivityError(new LibreTranslateError('timeout'))).toBe(true);
    expect(isConnectivityError(new LibreTranslateError('bad gateway', 502))).toBe(true);
    expect(isConnectivityError(new LibreTranslateError('forbidden', 403))).toBe(false);
    expect(isConnectivityError(new LibreTranslateError('bad request', 400))).toBe(false);
  });
});

describe('translateRouted', () => {
  it('uses the server when it is reachable', async () => {
    const d = device();
    await expect(translateRouted(params, online, d, { fallback: true, preferDevice: false })).resolves.toEqual({
      translatedText: 'hello',
      engine: 'server',
    });
    expect(d.translate).not.toHaveBeenCalled();
  });

  it('falls back to the device when offline and the pair is downloaded', async () => {
    const d = device();
    const result = await translateRouted(params, offline, d, { fallback: true, preferDevice: false });
    expect(result).toEqual({ translatedText: '[device] hola', engine: 'device', detectedLanguage: undefined });
  });

  it('detects the source language on the device for "auto"', async () => {
    const d = device();
    const result = await translateRouted({ ...params, source: 'auto' }, offline, d, { fallback: true, preferDevice: false });
    expect(result.detectedLanguage).toEqual({ language: 'es', confidence: 92 });
    expect(d.calls).toEqual(['status es-en', 'translate es-en']);
  });

  it('explains when offline and the languages are not downloaded', async () => {
    const d = device('supported');
    await expect(translateRouted(params, offline, d, { fallback: true, preferDevice: false })).rejects.toThrow(
      /not downloaded/,
    );
    expect(d.translate).not.toHaveBeenCalled();
  });

  it('does not fall back for server errors such as a bad API key', async () => {
    const d = device();
    const forbidden = () => Promise.reject(new LibreTranslateError('Access denied', 403));
    await expect(translateRouted(params, forbidden, d, { fallback: true, preferDevice: false })).rejects.toThrow(
      'Access denied',
    );
  });

  it('keeps the server error when fallback is off or there is no device', async () => {
    await expect(translateRouted(params, offline, device(), { fallback: false, preferDevice: false })).rejects.toThrow(
      'Could not reach server',
    );
    await expect(translateRouted(params, offline, null, { fallback: true, preferDevice: false })).rejects.toBeInstanceOf(
      LibreTranslateError,
    );
  });

  it('prefers the device for downloaded pairs and uses the server for the rest', async () => {
    const server = jest.fn(online);
    const preferred = await translateRouted(params, server, device(), { fallback: true, preferDevice: true });
    expect(preferred.engine).toBe('device');
    expect(server).not.toHaveBeenCalled();

    const notDownloaded = await translateRouted(params, server, device('supported'), { fallback: true, preferDevice: true });
    expect(notDownloaded.engine).toBe('server');
  });

  it('wraps device failures in OfflineUnavailableError', async () => {
    const d = device('unsupported');
    await expect(translateRouted(params, offline, d, { fallback: true, preferDevice: false })).rejects.toBeInstanceOf(
      OfflineUnavailableError,
    );
  });
});
