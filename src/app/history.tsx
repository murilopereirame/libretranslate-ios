import { Stack, router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '../state/AppContext';
import { Theme, useTheme } from '../theme';

export default function HistoryScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { history, clearHistory, languageName } = useApp();

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () =>
            history.length ? (
              <Pressable onPress={clearHistory} hitSlop={10}>
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            ) : null,
        }}
      />
      <FlatList
        data={history}
        keyExtractor={(h) => h.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={<Text style={styles.empty}>Your translations will show up here.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.item}
            onPress={() => router.navigate({ pathname: '/', params: { historyId: item.id } })}
          >
            <Text style={styles.langs}>
              {languageName(item.source)} → {languageName(item.target)}
            </Text>
            <Text style={styles.input} numberOfLines={2}>
              {item.input}
            </Text>
            <Text style={styles.output} numberOfLines={2}>
              {item.output}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    clear: { color: t.danger, fontSize: 17 },
    empty: { color: t.muted, textAlign: 'center', marginTop: 32 },
    item: { backgroundColor: t.card, borderRadius: 12, padding: 12, gap: 4 },
    langs: { color: t.muted, fontSize: 12 },
    input: { color: t.text, fontSize: 16 },
    output: { color: t.accent, fontSize: 16 },
  });
}
