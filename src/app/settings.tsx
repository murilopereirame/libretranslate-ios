import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { LibreTranslateClient, normalizeBaseUrl } from '../api/libretranslate';
import { DEFAULT_SERVER_URL, useApp } from '../state/AppContext';
import { Theme, useTheme } from '../theme';

type TestResult = { ok: boolean; message: string };

export default function SettingsScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { prefs, apiKey, saveConnection, updatePrefs, status, statusError, languages, serverSettings } = useApp();

  const [url, setUrl] = useState(prefs.serverUrl);
  const [key, setKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult>();
  const [saved, setSaved] = useState(false);

  useEffect(() => setUrl(prefs.serverUrl), [prefs.serverUrl]);
  useEffect(() => setKey(apiKey), [apiKey]);

  const dirty = normalizeBaseUrl(url) !== prefs.serverUrl || key.trim() !== apiKey;

  const runTest = async () => {
    setTesting(true);
    setTest(undefined);
    const client = new LibreTranslateClient({ baseUrl: url, apiKey: key, timeoutMs: 10000 });
    try {
      const langs = await client.getLanguages();
      const settings = await client.getSettings().catch(() => undefined);
      // A tiny translation checks that the API key (if any) is accepted.
      let keyNote = '';
      const pair = langs.find((l) => l.targets.some((t) => t !== l.code));
      if (pair) {
        try {
          await client.translate({ q: 'hello', source: pair.code, target: pair.targets.find((t) => t !== pair.code)! });
          keyNote = ' Test translation worked.';
        } catch (e) {
          setTest({ ok: false, message: `Connected (${langs.length} languages) but translation failed: ${(e as Error).message}` });
          return;
        }
      }
      const limit = settings && settings.charLimit > 0 ? ` Limit: ${settings.charLimit} characters.` : '';
      setTest({ ok: true, message: `Connected. ${langs.length} languages available.${limit}${keyNote}` });
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    await saveConnection(url, key);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.section}>Server</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Server URL</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder={DEFAULT_SERVER_URL}
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
        />
        <View style={styles.divider} />
        <Text style={styles.label}>API key (optional)</Text>
        <View style={styles.keyRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={key}
            onChangeText={setKey}
            placeholder="Leave empty if the server doesn't need one"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showKey}
          />
          <Pressable onPress={() => setShowKey((s) => !s)} hitSlop={8}>
            <Text style={styles.link}>{showKey ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.buttons}>
        <Pressable style={[styles.secondary, testing && { opacity: 0.6 }]} onPress={runTest} disabled={testing}>
          {testing ? <ActivityIndicator color={theme.accent} /> : <Text style={styles.secondaryText}>Test connection</Text>}
        </Pressable>
        <Pressable style={[styles.primary, !dirty && { opacity: 0.5 }]} onPress={save} disabled={!dirty}>
          <Text style={styles.primaryText}>{saved ? 'Saved' : 'Save'}</Text>
        </Pressable>
      </View>

      {test && <Text style={[styles.note, { color: test.ok ? theme.success : theme.danger }]}>{test.message}</Text>}

      <Text style={styles.hint}>
        Use your own self-hosted LibreTranslate server, or a public instance. The official server at libretranslate.com
        needs an API key.{' '}
        <Text style={styles.link} onPress={() => Linking.openURL('https://portal.libretranslate.com')}>
          Get a key
        </Text>
      </Text>

      <Text style={styles.section}>Current connection</Text>
      <View style={styles.card}>
        <Row label="Status" value={statusLabel(status)} styles={styles} />
        {status === 'error' && statusError ? <Text style={[styles.note, { color: theme.danger }]}>{statusError}</Text> : null}
        <Row label="Languages" value={String(languages.length)} styles={styles} />
        {serverSettings && (
          <>
            <Row
              label="Character limit"
              value={serverSettings.charLimit > 0 ? String(serverSettings.charLimit) : 'None'}
              styles={styles}
            />
            <Row label="API key required" value={serverSettings.keyRequired ? 'Yes' : 'No'} styles={styles} />
          </>
        )}
      </View>

      <Text style={styles.section}>Translation</Text>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>Translate as you type</Text>
          <Switch value={prefs.autoTranslate} onValueChange={(v) => updatePrefs({ autoTranslate: v })} />
        </View>
        <View style={styles.divider} />
        <Text style={styles.rowLabel}>Alternative translations</Text>
        <View style={styles.segment}>
          {[0, 1, 2, 3].map((n) => (
            <Pressable
              key={n}
              style={[styles.segmentItem, prefs.alternatives === n && styles.segmentActive]}
              onPress={() => updatePrefs({ alternatives: n })}
            >
              <Text style={[styles.segmentText, prefs.alternatives === n && styles.segmentTextActive]}>
                {n === 0 ? 'Off' : n}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function statusLabel(s: string) {
  return { idle: '—', loading: 'Connecting…', ready: 'Connected', error: 'Error' }[s] ?? s;
}

function Row({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.rowBetween}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { padding: 16, gap: 8, paddingBottom: 48 },
    section: { color: t.muted, fontSize: 13, textTransform: 'uppercase', marginTop: 12, marginLeft: 4 },
    card: { backgroundColor: t.card, borderRadius: 12, padding: 14, gap: 8 },
    label: { color: t.muted, fontSize: 13 },
    input: { color: t.text, fontSize: 16, paddingVertical: 6 },
    keyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginVertical: 4 },
    link: { color: t.accent, fontWeight: '600' },
    buttons: { flexDirection: 'row', gap: 10, marginTop: 4 },
    primary: { flex: 1, backgroundColor: t.accent, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
    primaryText: { color: t.accentText, fontWeight: '700', fontSize: 16 },
    secondary: { flex: 1, backgroundColor: t.chip, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
    secondaryText: { color: t.accent, fontWeight: '700', fontSize: 16 },
    note: { fontSize: 14, marginHorizontal: 4 },
    hint: { color: t.muted, fontSize: 13, marginHorizontal: 4, lineHeight: 18 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
    rowLabel: { color: t.text, fontSize: 16 },
    rowValue: { color: t.muted, fontSize: 16 },
    segment: { flexDirection: 'row', backgroundColor: t.background, borderRadius: 9, padding: 2 },
    segmentItem: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 7 },
    segmentActive: { backgroundColor: t.accent },
    segmentText: { color: t.text, fontSize: 14 },
    segmentTextActive: { color: t.accentText, fontWeight: '700' },
  });
}
