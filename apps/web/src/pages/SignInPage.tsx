import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
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

function getRedirectPath(state: unknown): string {
  if (typeof state !== "object" || state === null) {
    return "/dashboard";
  }

  const redirectState = state as RedirectState;
  const redirectPath = redirectState.from;

  if (
    typeof redirectPath !== "string" ||
    !redirectPath.startsWith("/") ||
    redirectPath.startsWith("//") ||
    redirectPath.includes("\\") ||
    redirectPath === "/sign-in"
  ) {
    return "/dashboard";
  }

  const resolvedUrl = new URL(redirectPath, window.location.origin);

  if (resolvedUrl.origin !== window.location.origin) {
    return "/dashboard";
  }

  return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
}

const benefits = [
  "Find stock and accountable custody quickly",
  "Keep every movement and override auditable",
  "Work comfortably on phone, tablet or desktop",
] as const;

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
        void navigate(getRedirectPath(location.state), { replace: true });
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
        gridTemplateColumns: { xs: "1fr", md: "minmax(360px, 0.9fr) 1.1fr" },
        bgcolor: "background.default",
      }}
    >
      <Box
        sx={{
          display: { xs: "none", md: "flex" },
          position: "relative",
          overflow: "hidden",
          minHeight: "100vh",
          p: { md: 6, lg: 9 },
          color: "#FFFFFF",
          background: "linear-gradient(145deg, #0A292D 0%, #0B484B 56%, #0A6262 100%)",
          "&::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            opacity: 0.18,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          },
          "&::after": {
            content: '""',
            position: "absolute",
            width: 420,
            height: 420,
            right: -160,
            bottom: -180,
            borderRadius: "50%",
            border: "80px solid rgba(240, 168, 76, 0.15)",
          },
        }}
      >
        <Stack
          justifyContent="space-between"
          sx={{ position: "relative", zIndex: 1, width: "100%" }}
        >
          <Brand inverse />
          <Box sx={{ maxWidth: 560, py: 6 }}>
            <Typography variant="overline" sx={{ color: "#F4B464" }}>
              Stock confidence, built in
            </Typography>
            <Typography component="p" variant="h1" sx={{ mt: 1.5, color: "#FFFFFF" }}>
              Know what you have. Know where it is.
            </Typography>
            <Typography
              sx={{
                mt: 3,
                maxWidth: 510,
                color: "rgba(255,255,255,0.76)",
                fontSize: "1.05rem",
                lineHeight: 1.8,
              }}
            >
              A dependable workspace for stores, offices and engineers in the field.
            </Typography>
            <Stack spacing={1.75} sx={{ mt: 4 }}>
              {benefits.map((benefit) => (
                <Stack key={benefit} direction="row" spacing={1.5} alignItems="center">
                  <CheckCircleRounded sx={{ color: "#73D0BF" }} aria-hidden="true" />
                  <Typography fontWeight={650}>{benefit}</Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.6)" }}>
            Named accounts · role-aware access · immutable audit
          </Typography>
        </Stack>
      </Box>

      <Container
        maxWidth="sm"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          py: { xs: 4, sm: 7 },
        }}
      >
        <Box sx={{ width: "100%", maxWidth: 470 }}>
          <Box sx={{ display: { xs: "block", md: "none" }, mb: 5 }}>
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
              boxShadow: "0 24px 70px rgba(16, 42, 46, 0.1)",
            }}
          >
            <Box
              sx={{
                display: "grid",
                placeItems: "center",
                width: 46,
                height: 46,
                mb: 3,
                color: "primary.main",
                bgcolor: "primary.light",
                borderRadius: 2.5,
              }}
            >
              <LockRounded aria-hidden="true" />
            </Box>
            <Typography id="sign-in-title" component="h1" variant="h2">
              Welcome back
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1.25, lineHeight: 1.65 }}>
              Sign in with your StockControl account.
            </Typography>

            <Box component="form" noValidate onSubmit={handleSubmit} sx={{ mt: 4 }}>
              <Stack spacing={2.5}>
                {errorMessage !== null && (
                  <Alert severity="error" role="alert">
                    {errorMessage}
                  </Alert>
                )}
                <TextField
                  id="email"
                  label="Work email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  fullWidth
                  disabled={submitting}
                  slotProps={{
                    htmlInput: {
                      "aria-label": "Work email",
                    },
                  }}
                />
                <TextField
                  id="password"
                  label="Password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  fullWidth
                  disabled={submitting}
                  slotProps={{
                    htmlInput: {
                      "aria-label": "Password",
                    },
                    input: {
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
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  fullWidth
                  disabled={submitting}
                >
                  {submitting ? "Signing in…" : "Sign in"}
                </Button>
              </Stack>
            </Box>
          </Paper>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "block",
              mt: 2.5,
              px: 1,
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            Accounts are created by your StockControl administrator.
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}
