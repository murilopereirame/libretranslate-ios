import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DetectedLanguage } from '../api/libretranslate';
import { linesToText } from '../offline/ocrText';
import { Engine } from '../offline/translator';
import { AUTO, deviceTranslator, textRecognizer, useApp } from '../state/AppContext';
import { Theme, useTheme } from '../theme';

const DEBOUNCE_MS = 600;

export default function TranslateScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { translate: translateText, prefs, updatePrefs, languageName, serverSettings, status, statusError, addHistory, history, reloadServer } =
    useApp();
  const { historyId } = useLocalSearchParams<{ historyId?: string }>();

  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [detected, setDetected] = useState<DetectedLanguage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [engine, setEngine] = useState<Engine>();
  const [photo, setPhoto] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const requestId = useRef(0);

  const charLimit = serverSettings?.charLimit ?? -1;
  const overLimit = charLimit > 0 && input.length > charLimit;

  // Load an entry picked on the History screen.
  useEffect(() => {
    if (!historyId) return;
    const entry = history.find((h) => h.id === historyId);
    if (entry) {
      updatePrefs({ source: entry.source, target: entry.target });
      setInput(entry.input);
      setOutput(entry.output);
      setAlternatives([]);
      setDetected(undefined);
    }
    router.setParams({ historyId: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyId]);

  const translate = useCallback(
    async (text: string) => {
      const q = text.trim();
      const id = ++requestId.current;
      if (!q) {
        setOutput('');
        setAlternatives([]);
        setDetected(undefined);
        setError(undefined);
        setBusy(false);
        return;
      }
      if (charLimit > 0 && q.length > charLimit) {
        setError(`Text is longer than this server's limit of ${charLimit} characters.`);
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const result = await translateText({
          q,
          source: prefs.source,
          target: prefs.target,
          alternatives: prefs.alternatives,
        });
        if (id !== requestId.current) return; // a newer request superseded this one
        setOutput(result.translatedText);
        setAlternatives(result.alternatives ?? []);
        setDetected(result.detectedLanguage);
        setEngine(result.engine);
        addHistory({
          source: prefs.source === AUTO ? (result.detectedLanguage?.language ?? AUTO) : prefs.source,
          target: prefs.target,
          input: q,
          output: result.translatedText,
        });
      } catch (e) {
        if (id !== requestId.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    },
    [translateText, prefs.source, prefs.target, prefs.alternatives, charLimit, addHistory],
  );

  // Auto-translate while typing, and re-translate when languages or server change.
  useEffect(() => {
    if (!prefs.autoTranslate) return;
    const t = setTimeout(() => translate(input), input.trim() ? DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [input, translate, prefs.autoTranslate]);

  const swap = () => {
    const from = prefs.source === AUTO ? detected?.language : prefs.source;
    if (!from) return;
    updatePrefs({ source: prefs.target, target: from });
    setInput(output);
    setOutput(input);
    setAlternatives([]);
    setDetected(undefined);
  };

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setInput(text);
  };

  const copy = async () => {
    await Clipboard.setStringAsync(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const scanImage = async (from: 'camera' | 'library') => {
    if (!textRecognizer) return;
    try {
      const permission =
        from === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          from === 'camera' ? 'Camera access is off' : 'Photo access is off',
          'Allow access in the Settings app to translate text from photos.',
        );
        return;
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
      const picked =
        from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (picked.canceled || !picked.assets[0]) return;

      const uri = picked.assets[0].uri;
      setScanning(true);
      setError(undefined);
      setPhoto(uri);
      const lines = await textRecognizer.recognizeText(uri, prefs.source === AUTO ? [] : [prefs.source]);
      const text = linesToText(lines);
      if (!text) {
        setError('No text found in this photo.');
        return;
      }
      setInput(text);
      // With auto-translate off, translate right away: the user picked a photo to translate it.
      if (!prefs.autoTranslate) translate(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const pickImageSource = () => {
    const choices = ['Take Photo', 'Choose from Library', 'Cancel'];
    const onChoice = (i: number) => {
      if (i === 0) scanImage('camera');
      if (i === 1) scanImage('library');
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: choices, cancelButtonIndex: 2, title: 'Translate text in a photo' },
        onChoice,
      );
    } else {
      Alert.alert('Translate text in a photo', undefined, [
        { text: choices[0], onPress: () => onChoice(0) },
        { text: choices[1], onPress: () => onChoice(1) },
        { text: choices[2], style: 'cancel' },
      ]);
    }
  };

  const clear = () => {
    setPhoto(undefined);
    setEngine(undefined);
    setInput('');
    setOutput('');
    setAlternatives([]);
    setDetected(undefined);
    setError(undefined);
  };

  const canSwap = prefs.source !== AUTO || !!detected;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Link href="/history" asChild>
              <Pressable hitSlop={10} accessibilityRole="button">
                <Text style={styles.headerButton}>History</Text>
              </Pressable>
            </Link>
          ),
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable hitSlop={10} accessibilityRole="button">
                <Text style={styles.headerButton}>Settings</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {status === 'error' && (
          <Pressable style={styles.banner} onPress={() => router.push('/settings')}>
            <Text style={styles.bannerTitle}>Can't connect to the server</Text>
            <Text style={styles.bannerText}>{statusError}</Text>
            {deviceTranslator && prefs.offlineFallback && (
              <Text style={styles.bannerText}>Downloaded languages still translate on this device.</Text>
            )}
            <Text style={styles.bannerLink}>Open Settings</Text>
          </Pressable>
        )}
        {status === 'loading' && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.muted} />
            <Text style={styles.muted}>Loading languages…</Text>
          </View>
        )}

        <View style={styles.langRow}>
          <LangButton
            label={languageName(prefs.source)}
            onPress={() => router.push({ pathname: '/languages', params: { side: 'source' } })}
            styles={styles}
          />
          <Pressable
            onPress={swap}
            disabled={!canSwap}
            style={[styles.swap, !canSwap && { opacity: 0.35 }]}
            accessibilityLabel="Swap languages"
            hitSlop={8}
          >
            <Text style={styles.swapText}>⇄</Text>
          </Pressable>
          <LangButton
            label={languageName(prefs.target)}
            onPress={() => router.push({ pathname: '/languages', params: { side: 'target' } })}
            styles={styles}
          />
        </View>

        <View style={styles.card}>
          {photo && (
            <View style={styles.photoRow}>
              <Image source={{ uri: photo }} style={styles.photo} accessibilityLabel="Scanned photo" />
              <Text style={[styles.muted, { flex: 1 }]}>{scanning ? 'Reading text…' : 'Text from photo'}</Text>
              {scanning ? (
                <ActivityIndicator color={theme.muted} />
              ) : (
                <SmallButton label="Remove" onPress={() => setPhoto(undefined)} styles={styles} />
              )}
            </View>
          )}
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Enter text"
            placeholderTextColor={theme.muted}
            multiline
            textAlignVertical="top"
            autoCorrect
          />
          <View style={styles.cardFooter}>
            <Text style={[styles.muted, overLimit && { color: theme.danger }]}>
              {charLimit > 0 ? `${input.length} / ${charLimit}` : `${input.length}`}
            </Text>
            <View style={styles.actions}>
              {textRecognizer && (
                <SmallButton label={scanning ? 'Reading…' : 'Photo'} onPress={pickImageSource} styles={styles} />
              )}
              {input ? (
                <SmallButton label="Clear" onPress={clear} styles={styles} />
              ) : (
                <SmallButton label="Paste" onPress={paste} styles={styles} />
              )}
              {!prefs.autoTranslate && (
                <Pressable
                  style={[styles.primary, (!input.trim() || busy) && { opacity: 0.5 }]}
                  onPress={() => translate(input)}
                  disabled={!input.trim() || busy}
                >
                  <Text style={styles.primaryText}>Translate</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {prefs.source === AUTO && detected && (
          <Text style={styles.detected}>
            Detected: {languageName(detected.language)} ({Math.round(detected.confidence)}%)
          </Text>
        )}

        <View style={[styles.card, styles.outputCard]}>
          {busy && !output ? (
            <ActivityIndicator color={theme.muted} style={{ marginVertical: 24 }} />
          ) : (
            <Text selectable style={[styles.output, !output && styles.placeholder]}>
              {output || 'Translation'}
            </Text>
          )}
          <View style={styles.cardFooter}>
            <View style={styles.actions}>
              {busy && output ? <ActivityIndicator size="small" color={theme.muted} /> : null}
              {!busy && output && engine === 'device' ? <Text style={styles.muted}>Translated on device</Text> : null}
            </View>
            {output ? <SmallButton label={copied ? 'Copied' : 'Copy'} onPress={copy} styles={styles} /> : null}
          </View>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            {status === 'error' && (
              <Pressable onPress={reloadServer}>
                <Text style={styles.bannerLink}>Retry</Text>
              </Pressable>
            )}
          </View>
        )}

        {alternatives.length > 0 && (
          <View style={styles.altSection}>
            <Text style={styles.sectionLabel}>Alternatives</Text>
            {alternatives.map((alt, i) => (
              <Pressable
                key={`${i}-${alt}`}
                style={styles.altItem}
                onPress={() => {
                  // Tap an alternative to make it the main translation.
                  setAlternatives((prev) => [output, ...prev.filter((_, j) => j !== i)]);
                  setOutput(alt);
                }}
              >
                <Text style={styles.altText}>{alt}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function LangButton({ label, onPress, styles }: { label: string; onPress: () => void; styles: Styles }) {
  return (
    <Pressable style={styles.langButton} onPress={onPress} accessibilityRole="button">
      <Text style={styles.langButtonText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SmallButton({ label, onPress, styles }: { label: string; onPress: () => void; styles: Styles }) {
  return (
    <Pressable style={styles.small} onPress={onPress} hitSlop={6} accessibilityRole="button">
      <Text style={styles.smallText}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { padding: 16, gap: 12 },
    photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    photo: { width: 48, height: 48, borderRadius: 8, backgroundColor: t.chip },
    headerButton: { color: t.accent, fontSize: 17 },
    banner: { backgroundColor: t.card, borderRadius: 12, padding: 14, borderLeftWidth: 4, borderLeftColor: t.danger, gap: 4 },
    bannerTitle: { color: t.text, fontWeight: '600', fontSize: 15 },
    bannerText: { color: t.muted, fontSize: 14 },
    bannerLink: { color: t.accent, fontSize: 15, fontWeight: '600', marginTop: 4 },
    loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    langRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    langButton: {
      flex: 1,
      backgroundColor: t.card,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 12,
      alignItems: 'center',
    },
    langButtonText: { color: t.accent, fontSize: 16, fontWeight: '600' },
    swap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.card },
    swapText: { color: t.accent, fontSize: 20 },
    card: { backgroundColor: t.card, borderRadius: 14, padding: 14, gap: 10 },
    outputCard: { minHeight: 120 },
    input: { color: t.text, fontSize: 20, minHeight: 120, padding: 0 },
    output: { color: t.text, fontSize: 20, lineHeight: 28 },
    placeholder: { color: t.muted },
    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
    actions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    muted: { color: t.muted, fontSize: 13 },
    small: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: t.chip },
    smallText: { color: t.accent, fontSize: 14, fontWeight: '600' },
    primary: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: t.accent },
    primaryText: { color: t.accentText, fontSize: 15, fontWeight: '700' },
    detected: { color: t.muted, fontSize: 13, marginLeft: 4 },
    errorBox: { backgroundColor: t.card, borderRadius: 12, padding: 12, borderLeftWidth: 4, borderLeftColor: t.danger },
    errorText: { color: t.danger, fontSize: 14 },
    altSection: { gap: 8 },
    sectionLabel: { color: t.muted, fontSize: 13, textTransform: 'uppercase', marginLeft: 4 },
    altItem: { backgroundColor: t.card, borderRadius: 12, padding: 12 },
    altText: { color: t.text, fontSize: 16 },
  });
}
