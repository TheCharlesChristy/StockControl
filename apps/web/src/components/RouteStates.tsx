import ConstructionRounded from "@mui/icons-material/ConstructionRounded";
import ErrorOutlineRounded from "@mui/icons-material/ErrorOutlineRounded";
import LockOutlined from "@mui/icons-material/LockOutlined";
import SearchOffRounded from "@mui/icons-material/SearchOffRounded";
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import type { ReactElement, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

interface StatePanelProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly icon: ReactNode;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

function StatePanel({
  eyebrow,
  title,
  description,
  icon,
  actionLabel,
  onAction,
}: StatePanelProps): ReactElement {
  return (
    <Paper
      variant="outlined"
      sx={{
        width: "100%",
        maxWidth: 680,
        mx: "auto",
        p: { xs: 3, sm: 5 },
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Stack spacing={2} alignItems="flex-start">
        <Box
          sx={{
            display: "grid",
            placeItems: "center",
            width: 48,
            height: 48,
            color: "primary.main",
            bgcolor: "primary.light",
            borderRadius: 2.5,
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography variant="overline" color="primary.main">
            {eyebrow}
          </Typography>
          <Typography component="h1" variant="h2" sx={{ mt: 0.5 }}>
            {title}
          </Typography>
        </Box>
        <Typography color="text.secondary" sx={{ maxWidth: 560, lineHeight: 1.7 }}>
          {description}
        </Typography>
        {actionLabel !== undefined && onAction !== undefined && (
          <Button variant="contained" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

export function FullPageLoading(): ReactElement {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
        p: 3,
      }}
    >
      <Stack spacing={2} alignItems="center">
        <CircularProgress size={36} thickness={4.5} aria-hidden="true" />
        <Typography color="text.secondary" fontWeight={700}>
          Preparing your StockControl workspace…
        </Typography>
      </Stack>
    </Box>
  );
}

export function LoadingPage(): ReactElement {
  return (
    <Box sx={{ py: { xs: 6, md: 10 } }}>
      <Paper
        role="status"
        aria-live="polite"
        variant="outlined"
        sx={{ maxWidth: 620, mx: "auto", p: { xs: 4, sm: 6 } }}
      >
        <Stack spacing={2} alignItems="center" textAlign="center">
          <CircularProgress size={38} aria-hidden="true" />
          <Typography component="h1" variant="h3">
            Loading workspace data
          </Typography>
          <Typography color="text.secondary">
            We are checking the latest inventory state and permissions.
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}

export function ErrorPage(): ReactElement {
  const navigate = useNavigate();

  return (
    <Box sx={{ py: { xs: 4, md: 8 } }}>
      <Alert severity="error" variant="outlined" sx={{ maxWidth: 680, mx: "auto", mb: 2 }}>
        No stock changes were submitted.
      </Alert>
      <StatePanel
        eyebrow="Something went wrong"
        title="This view could not be loaded"
        description="Try the request again. If the problem continues, return to the overview and use the support details in Help."
        icon={<ErrorOutlineRounded />}
        actionLabel="Return to overview"
        onAction={() => {
          void navigate("/dashboard");
        }}
      />
    </Box>
  );
}

export function NotFoundPage(): ReactElement {
  const navigate = useNavigate();

  return (
    <Box sx={{ py: { xs: 4, md: 8 } }}>
      <StatePanel
        eyebrow="404"
        title="Page not found"
        description="The address may be incorrect, or the page may have moved. Your inventory data has not been changed."
        icon={<SearchOffRounded />}
        actionLabel="Go to overview"
        onAction={() => {
          void navigate("/dashboard");
        }}
      />
    </Box>
  );
}

export function AccessDeniedPage(): ReactElement {
  const navigate = useNavigate();

  return (
    <Box sx={{ py: { xs: 4, md: 8 } }}>
      <StatePanel
        eyebrow="Permission required"
        title="Access restricted"
        description="Your current role does not include this section. Ask an Admin if you need access for your work."
        icon={<LockOutlined />}
        actionLabel="Return to overview"
        onAction={() => {
          void navigate("/dashboard");
        }}
      />
    </Box>
  );
}

interface PlaceholderPageProps {
  readonly title: string;
  readonly description: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps): ReactElement {
  return (
    <Box sx={{ py: { xs: 2, md: 4 } }}>
      <StatePanel
        eyebrow="Foundation route"
        title={title}
        description={`${description} The protected route and responsive workspace are ready for the next vertical slice.`}
        icon={<ConstructionRounded />}
      />
    </Box>
  );
}
