import { alpha, createTheme } from "@mui/material/styles";

const brandBlue = "#00309D";
const brandBlueDark = "#002477";
const brandBlueDeep = "#071B3A";
const brandBluePale = "#EAF0FC";
const ink = "#172033";
const body = "#3F4858";
const border = "#DCE2EA";

export const stockControlTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    primary: {
      main: brandBlue,
      dark: brandBlueDark,
      light: brandBluePale,
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: brandBlueDeep,
      dark: "#051329",
      light: brandBluePale,
      contrastText: "#FFFFFF",
    },
    background: {
      default: "#F7F8FA",
      paper: "#FFFFFF",
    },
    text: {
      primary: ink,
      secondary: body,
    },
    divider: border,
    success: {
      main: "#18794E",
    },
    warning: {
      main: "#B45309",
    },
    error: {
      main: "#B42318",
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: {
      fontFamily: '"DM Serif Display", Georgia, serif',
      fontSize: "clamp(2rem, 5vw, 3.5rem)",
      fontWeight: 400,
      letterSpacing: "-0.015em",
      lineHeight: 1.1,
    },
    h2: {
      fontFamily: '"DM Serif Display", Georgia, serif',
      fontSize: "clamp(1.65rem, 3vw, 2.25rem)",
      fontWeight: 400,
      letterSpacing: "-0.01em",
      lineHeight: 1.15,
    },
    h3: {
      fontFamily: '"DM Serif Display", Georgia, serif',
      fontSize: "1.25rem",
      fontWeight: 400,
      letterSpacing: "-0.005em",
    },
    h4: {
      fontSize: "1.05rem",
      fontWeight: 720,
    },
    body1: {
      lineHeight: 1.6,
    },
    body2: {
      lineHeight: 1.6,
    },
    button: {
      fontWeight: 700,
      textTransform: "none",
    },
    overline: {
      fontWeight: 800,
      letterSpacing: "0.12em",
      lineHeight: 1.7,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ":root": {
          colorScheme: "light",
        },
        html: {
          minWidth: 320,
          minHeight: "100%",
          backgroundColor: "#F7F8FA",
        },
        body: {
          minWidth: 320,
          minHeight: "100%",
          margin: 0,
          backgroundColor: "#F7F8FA",
          color: body,
        },
        "#root": {
          minHeight: "100vh",
        },
        "::selection": {
          color: "#FFFFFF",
          backgroundColor: brandBlue,
        },
        "*:focus-visible": {
          outline: `3px solid ${alpha(brandBlue, 0.35)}`,
          outlineOffset: 2,
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: 9,
          paddingInline: 18,
          minHeight: 48,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid",
          borderColor: border,
          boxShadow: "0 8px 24px rgba(16, 24, 40, 0.06)",
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 700,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: "#FFFFFF",
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: brandBlue,
          },
          "&.Mui-focused": {
            boxShadow: `0 0 0 3px ${alpha(brandBlue, 0.14)}`,
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 9,
        },
      },
    },
    MuiTooltip: {
      defaultProps: {
        arrow: true,
      },
    },
  },
});
