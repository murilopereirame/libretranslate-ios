import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export type RecognizedLine = {
  text: string;
  /** Normalized bounding box, 0-1, origin at the top-left of the image. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OfflineStatus = 'installed' | 'supported' | 'unsupported';

type NativeModule = {
  isTranslationAvailable(): boolean;
  recognizeText(uri: string, languages: string[]): Promise<RecognizedLine[]>;
  detectLanguage(text: string): Promise<{ language: string; confidence: number } | null>;
  supportedLanguages(): Promise<{ code: string; name: string }[]>;
  languageStatus(source: string, target: string): Promise<OfflineStatus>;
  downloadLanguages(source: string, target: string): Promise<OfflineStatus>;
  translate(text: string, source: string, target: string): Promise<string>;
};

/**
 * The native module, or null where it isn't compiled in (web, Expo Go, Android).
 * Callers must check before using it.
 */
export const OnDeviceLanguage: NativeModule | null =
  Platform.OS === 'ios' ? requireOptionalNativeModule<NativeModule>('OnDeviceLanguage') : null;
