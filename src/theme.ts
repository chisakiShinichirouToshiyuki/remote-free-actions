import { createTheme } from '@mui/material/styles';

// Material Design 標準値ベースの light theme(ecosystem 内の他 GUI と同じ配色)。
export const theme = createTheme({
  palette: {
    primary: { main: '#3f51b5', light: '#7986cb', dark: '#303f9f', contrastText: '#fff' },
    secondary: { main: '#f50057', light: '#ff5983', dark: '#bb002f', contrastText: '#fff' },
    error: { main: '#d32f2f', light: '#ef5350', dark: '#c62828', contrastText: '#fff' },
    warning: { main: '#ed6c02', light: '#ff9800', dark: '#e65100', contrastText: '#fff' },
    info: { main: '#0288d1', light: '#03a9f4', dark: '#01579b', contrastText: '#fff' },
    success: { main: '#2e7d32', light: '#4caf50', dark: '#1b5e20', contrastText: '#fff' },
    background: { default: '#f5f5f5', paper: '#fff' },
  },
  typography: { fontFamily: "'Roboto', 'Noto Sans JP', sans-serif" },
});
