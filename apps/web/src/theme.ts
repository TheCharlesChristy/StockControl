import { alpha, createTheme } from "@mui/material/styles";

const ink = "#102A2E";
const teal = "#0B6668";
const amber = "#D9822B";

export const stockControlTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    primary: {
      main: teal,
      dark: "#07494B",
      light: "#D7EFEC",
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: amber,
      dark: "#9C5415",
      light: "#FFF0D9",
      contrastText: "#21180F",
    },
    background: {
      default: "#F2F5F3",
      paper: "#FFFFFF",
    },
    text: {
      primary: ink,
      secondary: "#52666A",
    },
    divider: "#D9E1DE",
    success: {
      main: "#237A57",
    },
    warning: {
      main: "#B76512",
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
      fontSize: "clamp(2rem, 5vw, 3.5rem)",
      fontWeight: 760,
      letterSpacing: "-0.035em",
      lineHeight: 1.05,
    },
    h2: {
      fontSize: "clamp(1.65rem, 3vw, 2.25rem)",
      fontWeight: 740,
      letterSpacing: "-0.025em",
      lineHeight: 1.12,
    },
    h3: {
      fontSize: "1.25rem",
      fontWeight: 720,
      letterSpacing: "-0.015em",
    },
    h4: {
      fontSize: "1.05rem",
      fontWeight: 720,
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
          backgroundColor: "#F2F5F3",
        },
        body: {
          minWidth: 320,
          minHeight: "100%",
          margin: 0,
          backgroundColor: "#F2F5F3",
        },
        "#root": {
          minHeight: "100vh",
        },
        "::selection": {
          color: ink,
          backgroundColor: "#B8E0DB",
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          minHeight: 42,
          borderRadius: 9,
          paddingInline: 18,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid",
          borderColor: "#DDE5E2",
          boxShadow: "0 12px 36px rgba(16, 42, 46, 0.06)",
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
            borderColor: teal,
          },
          "&.Mui-focused": {
            boxShadow: `0 0 0 3px ${alpha(teal, 0.12)}`,
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
