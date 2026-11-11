import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AUTO, useApp } from '../state/AppContext';
import { Theme, useTheme } from '../theme';

type Item = { code: string; name: string; disabled?: boolean };

export default function LanguagesScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { side } = useLocalSearchParams<{ side: 'source' | 'target' }>();
  const { languages, prefs, updatePrefs, status } = useApp();
  const [query, setQuery] = useState('');

  const isSource = side !== 'target';
  const selected = isSource ? prefs.source : prefs.target;

  const items = useMemo<Item[]>(() => {
    // For the target list, only show languages the chosen source can translate into.
    const sourceLang = languages.find((l) => l.code === prefs.source);
    const allowed = !isSource && sourceLang ? new Set(sourceLang.targets) : undefined;

    const q = query.trim().toLowerCase();
    const list: Item[] = languages
      .filter((l) => !q || l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q))
      .map((l) => ({ code: l.code, name: l.name, disabled: allowed ? !allowed.has(l.code) : false }))
      .filter((l) => !l.disabled);
    if (isSource && !q) list.unshift({ code: AUTO, name: 'Detect language' });
    return list;
  }, [languages, prefs.source, isSource, query]);

  const choose = (code: string) => {
    if (isSource) {
      const patch: { source: string; target?: string } = { source: code };
      // Keep source and target different, and keep the target valid for the new source.
      const lang = languages.find((l) => l.code === code);
      if (code === prefs.target || (lang && !lang.targets.includes(prefs.target))) {
        const fallback = lang?.targets.find((t) => t !== code);
        if (fallback) patch.target = fallback;
      }
      updatePrefs(patch);
    } else {
      updatePrefs(code === prefs.source ? { target: code, source: AUTO } : { target: code });
    }
    router.back();
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: isSource ? 'Translate from' : 'Translate to' }} />
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
      <FlatList
        data={items}
        keyExtractor={(item) => item.code}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {status === 'ready' ? 'No matching languages.' : 'Languages are not loaded. Check the server in Settings.'}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => choose(item.code)} accessibilityRole="button">
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.code}>{item.code === AUTO ? '' : item.code}</Text>
            <Text style={styles.check}>{item.code === selected ? '✓' : ''}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    search: {
      margin: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: t.card,
      color: t.text,
      fontSize: 16,
    },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: t.card },
    name: { flex: 1, color: t.text, fontSize: 16 },
    code: { color: t.muted, fontSize: 13, marginRight: 12 },
    check: { width: 20, color: t.accent, fontSize: 17, fontWeight: '700' },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: 16 },
    empty: { color: t.muted, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  });
}
