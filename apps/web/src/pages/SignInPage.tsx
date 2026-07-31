import LockRounded from "@mui/icons-material/LockRounded";
import VisibilityOffRounded from "@mui/icons-material/VisibilityOffRounded";
import VisibilityRounded from "@mui/icons-material/VisibilityRounded";
import {
  Alert,
  Box,
  Button,
  Container,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState, type FormEvent, type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";

interface RedirectState {
  readonly from?: string;
}

/**
 * Signing in lands on the dashboard. The one exception is a link to a specific
 * record: scanning an item's QR code while signed out has to come back to that
 * item once you have signed in, which requirements section 7 asks for. Anything
 * else — including whichever page you happened to be on when you signed out —
 * gives way to the dashboard, so a new session always starts from the top.
 */
const DEEP_LINK_PATTERNS: readonly RegExp[] = [
  /^\/inventory\/[^/]+$/u,
  /^\/jobs\/[^/]+$/u,
  /^\/requests\/[^/]+$/u,
];

export const DEFAULT_SIGNED_IN_PATH = "/dashboard";

/** The query parameter carrying the page a signed-out visitor was trying to reach. */
export const REDIRECT_QUERY_KEY = "next";

/** Returns the candidate if it is a safe in-app deep link, otherwise null. */
function safeDeepLink(candidate: unknown): string | null {
  if (
    typeof candidate !== "string" ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate === "/sign-in"
  ) {
    return null;
  }

  const resolvedUrl = new URL(candidate, window.location.origin);

  if (resolvedUrl.origin !== window.location.origin) {
    return null;
  }

  if (!DEEP_LINK_PATTERNS.some((pattern) => pattern.test(resolvedUrl.pathname))) {
    return null;
  }

  return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
}

/**
 * Where to land after signing in.
 *
 * The destination is read from the query string first and from router history
 * state second. History state does not survive a full page load, which is
 * exactly how someone arrives here from a scanned QR code, so the query string
 * is what makes the deep link dependable; the state branch stays for in-app
 * navigations that predate it.
 */
export function getRedirectPath(state: unknown, search = ""): string {
  const fromQuery = new URLSearchParams(search).get(REDIRECT_QUERY_KEY);
  const fromState =
    typeof state === "object" && state !== null ? (state as RedirectState).from : undefined;

  return safeDeepLink(fromQuery) ?? safeDeepLink(fromState) ?? DEFAULT_SIGNED_IN_PATH;
}

/** Builds the sign-in URL that remembers where the visitor was headed. */
export function signInPathFor(attemptedPath: string): string {
  return safeDeepLink(attemptedPath) === null
    ? "/sign-in"
    : `/sign-in?${REDIRECT_QUERY_KEY}=${encodeURIComponent(attemptedPath)}`;
}

export function SignInPage(): ReactElement {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setErrorMessage(null);

    const normalizedEmail = email.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setErrorMessage("Enter a valid work email address.");
      return;
    }

    if (password.length === 0) {
      setErrorMessage("Enter your password.");
      return;
    }

    setSubmitting(true);

    void signIn(normalizedEmail, password)
      .then(() => {
        void navigate(getRedirectPath(location.state, location.search), { replace: true });
      })
      .catch(() => {
        setErrorMessage("We could not sign you in. Check your details and try again.");
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <Box
      component="main"
      id="main-content"
      tabIndex={-1}
      sx={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "minmax(280px, 0.72fr) minmax(420px, 1.28fr)" },
        bgcolor: "background.default",
        backgroundImage: {
          xs: "radial-gradient(circle at 50% 0%, #FFFFFF 0%, #F7F8FA 58%, #EDF1F6 100%)",
          md: "none",
        },
      }}
    >
      <Box
        sx={{
          display: { xs: "none", md: "flex" },
          minHeight: "100vh",
          alignItems: "center",
          bgcolor: "#071B3A",
          color: "#FFFFFF",
          p: { md: 6, lg: 8 },
        }}
      >
        <Stack spacing={7} sx={{ width: "100%" }}>
          <Brand inverse />
          <Box>
            <Typography component="h1" variant="h1" sx={{ color: "#FFFFFF" }}>
              StockControl
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Container
        maxWidth="xs"
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          py: { xs: 4, sm: 7 },
        }}
      >
        <Box sx={{ width: "100%", maxWidth: 440 }}>
          <Box sx={{ display: { xs: "flex", md: "none" }, justifyContent: "center", mb: 4 }}>
            <Brand />
          </Box>
          <Paper
            component="section"
            aria-labelledby="sign-in-title"
            elevation={0}
            sx={{
              p: { xs: 3, sm: 5 },
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 3,
              boxShadow: "0 20px 50px rgba(28, 45, 78, 0.1), 0 3px 10px rgba(28, 45, 78, 0.05)",
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3.5 }}>
              <Box
                sx={{
                  display: "grid",
                  placeItems: "center",
                  width: 44,
                  height: 44,
                  flexShrink: 0,
                  color: "primary.main",
                  bgcolor: "primary.light",
                  borderRadius: 2,
                }}
              >
                <LockRounded aria-hidden="true" />
              </Box>
              <Box>
                <Typography
                  component="p"
                  sx={{
                    color: "primary.main",
                    fontSize: "0.875rem",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                  }}
                >
                  StockControl
                </Typography>
                <Typography
                  id="sign-in-title"
                  component="h1"
                  variant="h2"
                  sx={{ lineHeight: 1.05 }}
                >
                  Sign in
                </Typography>
              </Box>
            </Stack>

            <Box component="form" noValidate onSubmit={handleSubmit}>
              <Stack spacing={2.5}>
                {errorMessage !== null && (
                  <Alert severity="error" role="alert">
                    {errorMessage}
                  </Alert>
                )}
                <Stack spacing={0.75}>
                  <Typography
                    component="label"
                    htmlFor="email"
                    sx={{ color: "#263247", fontSize: "0.875rem", fontWeight: 600 }}
                  >
                    Work email
                  </Typography>
                  <TextField
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                    fullWidth
                    disabled={submitting}
                    slotProps={{
                      input: { sx: { minHeight: 52 } },
                    }}
                  />
                </Stack>
                <Stack spacing={0.75}>
                  <Typography
                    component="label"
                    htmlFor="password"
                    sx={{ color: "#263247", fontSize: "0.875rem", fontWeight: 600 }}
                  >
                    Password
                  </Typography>
                  <TextField
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                    fullWidth
                    disabled={submitting}
                    slotProps={{
                      input: {
                        sx: { minHeight: 52 },
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              edge="end"
                              onClick={() => setShowPassword((visible) => !visible)}
                              aria-label={showPassword ? "Hide password" : "Show password"}
                            >
                              {showPassword ? <VisibilityOffRounded /> : <VisibilityRounded />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                </Stack>
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  fullWidth
                  disabled={submitting}
                  sx={{
                    mt: 0.5,
                    bgcolor: "primary.main",
                    "&:hover": {
                      bgcolor: "primary.dark",
                      boxShadow: "0 5px 14px rgba(0, 48, 157, 0.22)",
                    },
                    "&:active": {
                      transform: "translateY(1px)",
                    },
                  }}
                >
                  {submitting ? "Signing in…" : "Sign in"}
                </Button>
              </Stack>
            </Box>
            <Box
              sx={{
                mt: 3.5,
                mx: { xs: -3, sm: -5 },
                mb: { xs: -3, sm: -5 },
                px: { xs: 3, sm: 5 },
                py: 1.75,
                borderTop: "1px solid",
                borderColor: "divider",
                bgcolor: "#F7F8FA",
                borderRadius: "0 0 12px 12px",
              }}
            >
              <Typography variant="caption" color="text.secondary">
                Accounts are managed by your StockControl administrator.
              </Typography>
            </Box>
          </Paper>
        </Box>
      </Container>
    </Box>
  );
}
