import { useColorScheme } from 'react-native';

const light = {
  background: '#F2F2F7',
  card: '#FFFFFF',
  text: '#111114',
  muted: '#6B6B73',
  border: '#D9D9DE',
  accent: '#0A63D6',
  accentText: '#FFFFFF',
  danger: '#C62828',
  success: '#2E7D32',
  chip: '#E6EEF9',
};

const dark: typeof light = {
  background: '#000000',
  card: '#1C1C1E',
  text: '#F2F2F7',
  muted: '#9A9AA2',
  border: '#38383A',
  accent: '#4C9BFF',
  accentText: '#0B0B0D',
  danger: '#FF6B6B',
  success: '#6BCB77',
  chip: '#1E2A3A',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
