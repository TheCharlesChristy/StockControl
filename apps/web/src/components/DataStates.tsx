import ErrorOutlineRounded from "@mui/icons-material/ErrorOutlineRounded";
import InboxRounded from "@mui/icons-material/InboxRounded";
import LockOutlined from "@mui/icons-material/LockOutlined";
import { Alert, AlertTitle, Box, Button, Paper, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactElement, ReactNode } from "react";

import type { ApiError } from "../api/ApiClient";

/** Trims trailing zeros so a table reads "7" and "7.5", not "7.000". */
export function formatQuantity(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/u, "") || "0" : value;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

interface LoadingRowsProps {
  readonly rows?: number | undefined;
  readonly label?: string | undefined;
}

export function LoadingRows({ rows = 5, label = "Loading" }: LoadingRowsProps): ReactElement {
  return (
    <Stack spacing={1} role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} variant="rounded" height={index === 0 ? 44 : 36} />
      ))}
    </Stack>
  );
}

interface ErrorStateProps {
  readonly error: ApiError;
  readonly onRetry?: (() => void) | undefined;
}

export function ErrorState({ error, onRetry }: ErrorStateProps): ReactElement {
  const denied = error.isPermissionDenied;

  return (
    <Alert
      severity={denied ? "warning" : "error"}
      icon={denied ? <LockOutlined /> : <ErrorOutlineRounded />}
      role="alert"
      action={
        onRetry === undefined || denied ? undefined : (
          <Button color="inherit" size="small" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    >
      <AlertTitle>{denied ? "Not available to your role" : "Could not load this"}</AlertTitle>
      {error.message}
    </Alert>
  );
}

interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode | undefined;
}

export function EmptyState({ title, description, action }: EmptyStateProps): ReactElement {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 }, textAlign: "center" }}>
      <Stack spacing={1.5} alignItems="center">
        <Box
          sx={{
            display: "grid",
            placeItems: "center",
            width: 44,
            height: 44,
            color: "text.secondary",
            bgcolor: "action.hover",
            borderRadius: 2.5,
          }}
        >
          <InboxRounded />
        </Box>
        <Typography variant="h3" component="p">
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 460 }}>
          {description}
        </Typography>
        {action}
      </Stack>
    </Paper>
  );
}

interface PageHeaderProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly actions?: ReactNode | undefined;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: PageHeaderProps): ReactElement {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      alignItems={{ xs: "stretch", sm: "flex-end" }}
      justifyContent="space-between"
      sx={{ mb: 3 }}
    >
      <Box>
        <Typography variant="overline" color="primary.main">
          {eyebrow}
        </Typography>
        <Typography component="h1" variant="h2" sx={{ mt: 0.25 }}>
          {title}
        </Typography>
        {description !== undefined && (
          <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 680 }}>
            {description}
          </Typography>
        )}
      </Box>
      {/*
       * Wraps rather than forcing every action onto one row: an item with all
       * four stock operations available does not fit a phone otherwise, and a
       * row that overflows its container drags the whole page sideways with it.
       */}
      {actions !== undefined && (
        <Stack direction="row" spacing={1.25} useFlexGap flexWrap="wrap" sx={{ flexShrink: 0 }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

interface StatTileProps {
  readonly label: string;
  readonly value: string;
  readonly caption?: string | undefined;
  readonly tone?: "neutral" | "primary" | "warning" | undefined;
}

const tones = {
  neutral: { background: "#F7F8FA", foreground: "#3F4858" },
  primary: { background: "#EAF0FC", foreground: "#002477" },
  warning: { background: "#FEF3C7", foreground: "#92400E" },
} as const;

export function StatTile({ label, value, caption, tone = "neutral" }: StatTileProps): ReactElement {
  const palette = tones[tone];

  return (
    /*
     * Grouped and named so the figure is announced with the thing it counts.
     * Reading "353" on its own tells nobody anything.
     */
    <Paper
      variant="outlined"
      role="group"
      aria-label={label}
      sx={{ p: 2, flex: 1, minWidth: 140, bgcolor: palette.background, borderColor: "divider" }}
    >
      <Typography variant="caption" sx={{ fontWeight: 750, color: palette.foreground }}>
        {label}
      </Typography>
      <Typography variant="h3" component="p" sx={{ mt: 0.5, color: palette.foreground }}>
        {value}
      </Typography>
      {caption !== undefined && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
          {caption}
        </Typography>
      )}
    </Paper>
  );
}
