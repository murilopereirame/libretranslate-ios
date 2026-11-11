import { DetectedLanguage, LibreTranslateError, TranslateParams, TranslateResult } from '../api/libretranslate';
import type { OfflineStatus } from '../../modules/on-device-language';

export const AUTO = 'auto';

export type Engine = 'server' | 'device';

export type RoutedResult = TranslateResult & { engine: Engine };

/** The on-device functions the router needs (the native module, or a mock in tests). */
export type DeviceTranslator = {
  detectLanguage(text: string): Promise<{ language: string; confidence: number } | null>;
  languageStatus(source: string, target: string): Promise<OfflineStatus>;
  translate(text: string, source: string, target: string): Promise<string>;
};

export type OfflineOptions = {
  /** Translate on the device when the server can't be reached. */
  fallback: boolean;
  /** Use the device first whenever the languages are downloaded, and the server otherwise. */
  preferDevice: boolean;
};

/** Thrown when on-device translation can't handle the request. */
export class OfflineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfflineUnavailableError';
  }
}

/**
 * True when the request failed because the server couldn't be reached (no connection,
 * timeout, or a gateway error), as opposed to the server rejecting the request.
 */
export function isConnectivityError(e: unknown): boolean {
  if (!(e instanceof LibreTranslateError)) return e instanceof TypeError;
  return e.status === undefined || e.status === 502 || e.status === 503 || e.status === 504;
}

export async function translateOnDevice(device: DeviceTranslator, params: TranslateParams): Promise<RoutedResult> {
  let source = params.source;
  let detectedLanguage: DetectedLanguage | undefined;
  if (source === AUTO) {
    const detected = await device.detectLanguage(params.q);
    if (!detected) throw new OfflineUnavailableError("Couldn't detect the language. Pick the source language instead.");
    source = detected.language;
    detectedLanguage = detected;
  }
  if (source === params.target) {
    return { translatedText: params.q, detectedLanguage, engine: 'device' };
  }
  const status = await device.languageStatus(source, params.target);
  if (status !== 'installed') {
    throw new OfflineUnavailableError(
      status === 'unsupported'
        ? "This language pair can't be translated on the device."
        : 'These languages are not downloaded. Download them in Settings > Offline languages.',
    );
  }
  const translatedText = await device.translate(params.q, source, params.target);
  return { translatedText, detectedLanguage, engine: 'device' };
}

/**
 * Picks the server or the device for a translation:
 * - preferDevice: device when the pair is downloaded, otherwise the server.
 * - fallback: server first, and the device when the server can't be reached.
 */
export async function translateRouted(
  params: TranslateParams,
  server: (p: TranslateParams) => Promise<TranslateResult>,
  device: DeviceTranslator | null,
  options: OfflineOptions,
): Promise<RoutedResult> {
  if (device && options.preferDevice) {
    try {
      return await translateOnDevice(device, params);
    } catch {
      // Not downloaded (or failed): use the server.
    }
  }

  try {
    return { ...(await server(params)), engine: 'server' };
  } catch (serverError) {
    if (!device || !options.fallback || !isConnectivityError(serverError)) throw serverError;
    try {
      return await translateOnDevice(device, params);
    } catch (deviceError) {
      const reason = deviceError instanceof Error ? deviceError.message : String(deviceError);
      throw new OfflineUnavailableError(`Can't reach the server, and offline translation isn't possible: ${reason}`);
    }
  }
}
