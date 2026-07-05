import {
  ThemeProvider as AmplifyThemeProvider,
  Authenticator,
  type Theme as AmplifyTheme,
  translations,
} from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { I18n } from 'aws-amplify/utils';
import { theme } from './theme';

// 日本語化: Amplify UI 公式 translations は ja を含む。未定義 key は英語 fallback。
I18n.putVocabularies(translations);
I18n.setLanguage('ja');

// Amplify UI theme — 背景紫グラデを白に上書きし、brand を MUI palette と揃える。
const amplifyTheme: AmplifyTheme = {
  name: 'app-amplify-theme',
  tokens: {
    colors: {
      background: {
        primary: { value: '#ffffff' },
        secondary: { value: '#ffffff' },
      },
      brand: {
        primary: {
          10: { value: '#e8eaf6' },
          80: { value: '#3f51b5' },
          90: { value: '#303f9f' },
          100: { value: '#1a237e' },
        },
      },
    },
  },
};

export function Providers({ children }: { children: (signOut?: () => void) => React.ReactNode }) {
  // hideSignUp: self sign-up 無効(operator は admin 発行)のため sign-in 専用 UX。
  return (
    <AmplifyThemeProvider theme={amplifyTheme}>
      <Authenticator hideSignUp>
        {({ signOut }) => (
          <ThemeProvider theme={theme}>
            <CssBaseline />
            {children(signOut)}
          </ThemeProvider>
        )}
      </Authenticator>
    </AmplifyThemeProvider>
  );
}
