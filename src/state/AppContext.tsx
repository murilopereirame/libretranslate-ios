import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { Language, LibreTranslateClient, ServerSettings, normalizeBaseUrl } from '../api/libretranslate';
import { getJSON, getJSONArray, getSecret, setJSON, setSecret } from './storage';

export const AUTO = 'auto';
export const DEFAULT_SERVER_URL = 'https://libretranslate.com';
const MAX_HISTORY = 50;

export type Preferences = {
  serverUrl: string;
  /** Translate automatically while typing (debounced). */
  autoTranslate: boolean;
  /** Number of alternative translations to ask for (0-3). */
  alternatives: number;
  source: string;
  target: string;
};

export type HistoryEntry = {
  id: string;
  source: string;
  target: string;
  input: string;
  output: string;
  at: number;
};

const DEFAULT_PREFS: Preferences = {
  serverUrl: DEFAULT_SERVER_URL,
  autoTranslate: true,
  alternatives: 0,
  source: AUTO,
  target: 'en',
};

const PREFS_KEY = 'lt.prefs';
const HISTORY_KEY = 'lt.history';
const API_KEY_KEY = 'lt.apiKey';

type ServerStatus = 'idle' | 'loading' | 'ready' | 'error';

type AppState = {
  hydrated: boolean;
  prefs: Preferences;
  apiKey: string;
  client: LibreTranslateClient;
  languages: Language[];
  serverSettings?: ServerSettings;
  status: ServerStatus;
  statusError?: string;
  history: HistoryEntry[];
  updatePrefs: (patch: Partial<Preferences>) => void;
  saveConnection: (serverUrl: string, apiKey: string) => Promise<void>;
  reloadServer: () => Promise<void>;
  addHistory: (entry: Omit<HistoryEntry, 'id' | 'at'>) => void;
  clearHistory: () => void;
  languageName: (code: string) => string;
};

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [apiKey, setApiKey] = useState('');
  const [languages, setLanguages] = useState<Language[]>([]);
  const [serverSettings, setServerSettings] = useState<ServerSettings>();
  const [status, setStatus] = useState<ServerStatus>('idle');
  const [statusError, setStatusError] = useState<string>();
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Load saved settings once at startup.
  useEffect(() => {
    (async () => {
      const [p, key, h] = await Promise.all([
        getJSON(PREFS_KEY, DEFAULT_PREFS),
        getSecret(API_KEY_KEY),
        getJSONArray<HistoryEntry>(HISTORY_KEY),
      ]);
      setPrefs(p);
      setApiKey(key ?? '');
      setHistory(h);
      setHydrated(true);
    })();
  }, []);

  const client = useMemo(
    () => new LibreTranslateClient({ baseUrl: prefs.serverUrl, apiKey }),
    [prefs.serverUrl, apiKey],
  );

  const reloadServer = useCallback(async () => {
    setStatus('loading');
    setStatusError(undefined);
    try {
      const [langs, settings] = await Promise.all([
        client.getLanguages(),
        // Older servers may not expose /frontend/settings; that's fine.
        client.getSettings().catch(() => undefined),
      ]);
      setLanguages([...langs].sort((a, b) => a.name.localeCompare(b.name)));
      setServerSettings(settings);
      setStatus('ready');
    } catch (e) {
      setLanguages([]);
      setServerSettings(undefined);
      setStatusError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [client]);

  useEffect(() => {
    if (hydrated) reloadServer();
  }, [hydrated, reloadServer]);

  const updatePrefs = useCallback((patch: Partial<Preferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      setJSON(PREFS_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const saveConnection = useCallback(
    async (serverUrl: string, key: string) => {
      await setSecret(API_KEY_KEY, key.trim());
      setApiKey(key.trim());
      updatePrefs({ serverUrl: normalizeBaseUrl(serverUrl) });
    },
    [updatePrefs],
  );

  const addHistory = useCallback((entry: Omit<HistoryEntry, 'id' | 'at'>) => {
    setHistory((prev) => {
      const last = prev[0];
      // While the user keeps typing, auto-translate fires repeatedly. Replace the latest
      // entry instead of stacking every partial sentence.
      const isContinuation =
        last &&
        last.target === entry.target &&
        Date.now() - last.at < 60_000 &&
        (entry.input.startsWith(last.input) || last.input.startsWith(entry.input));
      const base = isContinuation ? prev.slice(1) : prev;
      const next = [{ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, at: Date.now() }, ...base].slice(
        0,
        MAX_HISTORY,
      );
      setJSON(HISTORY_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setJSON(HISTORY_KEY, []).catch(() => {});
  }, []);

  const languageName = useCallback(
    (code: string) => {
      if (code === AUTO) return 'Detect language';
      return languages.find((l) => l.code === code)?.name ?? code.toUpperCase();
    },
    [languages],
  );

  const value: AppState = {
    hydrated,
    prefs,
    apiKey,
    client,
    languages,
    serverSettings,
    status,
    statusError,
    history,
    updatePrefs,
    saveConnection,
    reloadServer,
    addHistory,
    clearHistory,
    languageName,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
