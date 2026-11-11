import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { OfflineStatus } from '../../modules/on-device-language';
import { deviceTranslator, useApp } from '../state/AppContext';
import { Theme, useTheme } from '../theme';

// Apple downloads translation models per language. A language is checked (and downloaded)
// paired with English, which gets downloaded together with the first language.
const PIVOT = 'en';
const PIVOT_FALLBACK = 'es';

export default function OfflineLanguagesScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { deviceLanguages } = useApp();
  const [statuses, setStatuses] = useState<Record<string, OfflineStatus>>({});
  const [downloading, setDownloading] = useState<string>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');

  const pairFor = (code: string): [string, string] => [code, code === PIVOT ? PIVOT_FALLBACK : PIVOT];

  const refresh = useCallback(async () => {
    if (!deviceTranslator) return;
    const entries = await Promise.all(
      deviceLanguages.map(async (l) => {
        const [s, t] = pairFor(l.code);
        const status = await deviceTranslator!.languageStatus(s, t).catch(() => 'unsupported' as const);
        return [l.code, status] as const;
      }),
    );
    const next: Record<string, OfflineStatus> = Object.fromEntries(entries);
    // English counts as downloaded once any language is (it comes with every download).
    if (next[PIVOT] !== 'installed' && entries.some(([c, st]) => c !== PIVOT && st === 'installed')) {
      next[PIVOT] = 'installed';
    }
    setStatuses(next);
  }, [deviceLanguages]);

  // Re-check when coming back, e.g. after removing languages in the Settings app.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const download = async (code: string) => {
    if (!deviceTranslator) return;
    setDownloading(code);
    setError(undefined);
    try {
      const [s, t] = pairFor(code);
      await deviceTranslator.downloadLanguages(s, t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(undefined);
      refresh();
    }
  };

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deviceLanguages
      .filter((l) => !q || l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q))
      .sort((a, b) => {
        // Downloaded languages first.
        const da = statuses[a.code] === 'installed' ? 0 : 1;
        const db = statuses[b.code] === 'installed' ? 0 : 1;
        return da - db || a.name.localeCompare(b.name);
      });
  }, [deviceLanguages, statuses, query]);

  if (!deviceTranslator) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Offline languages' }} />
        <Text style={styles.empty}>
          Offline translation needs iOS 18 or later and a development or App Store build of the app (it isn't available in
          Expo Go or on the web).
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Offline languages' }} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.code}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.hint}>
              Download languages to translate them without a connection. Translation runs on this iPhone with Apple's
              models; nothing is sent to your server.
            </Text>
            {error ? <Text style={[styles.hint, { color: theme.danger }]}>{error}</Text> : null}
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search languages"
              placeholderTextColor={theme.muted}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={<ActivityIndicator color={theme.muted} style={{ marginTop: 32 }} />}
        ListFooterComponent={
          <Text style={[styles.hint, { margin: 16 }]}>
            To remove downloaded languages, open the Settings app, then Apps › Translate › Downloaded Languages.{' '}
            <Text style={styles.link} onPress={() => Linking.openSettings()}>
              Open Settings
            </Text>
          </Text>
        }
        renderItem={({ item }) => {
          const status = statuses[item.code];
          return (
            <View style={styles.row}>
              <Text style={styles.name}>{item.name}</Text>
              {downloading === item.code ? (
                <ActivityIndicator color={theme.accent} />
              ) : status === 'installed' ? (
                <Text style={styles.downloaded}>Downloaded</Text>
              ) : status === 'supported' ? (
                <Pressable style={styles.small} onPress={() => download(item.code)} disabled={!!downloading}>
                  <Text style={styles.smallText}>Download</Text>
                </Pressable>
              ) : status === 'unsupported' ? (
                <Text style={styles.code}>Not available</Text>
              ) : (
                <ActivityIndicator color={theme.muted} />
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    center: { justifyContent: 'center', padding: 24 },
    header: { padding: 12, gap: 10 },
    hint: { color: t.muted, fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
    link: { color: t.accent, fontWeight: '600' },
    search: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: t.card, color: t.text, fontSize: 16 },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 52, backgroundColor: t.card },
    name: { flex: 1, color: t.text, fontSize: 16 },
    code: { color: t.muted, fontSize: 13 },
    downloaded: { color: t.success, fontSize: 14, fontWeight: '600' },
    small: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: t.chip },
    smallText: { color: t.accent, fontSize: 14, fontWeight: '600' },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: 16 },
    empty: { color: t.muted, textAlign: 'center', fontSize: 15, lineHeight: 21 },
  });
}
