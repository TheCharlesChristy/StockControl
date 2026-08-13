import BugReportRounded from "@mui/icons-material/BugReportRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import ErrorOutlineRounded from "@mui/icons-material/ErrorOutlineRounded";
import { Box, Button, Chip, IconButton, Paper, Stack, Typography } from "@mui/material";
import { useState, type ReactElement } from "react";

import {
  dismissConsoleError,
  useConsoleErrorEntries,
  type ConsoleErrorEntry,
} from "../hooks/use-console-error-notifications";
import { ReportIssueDialog } from "./ReportIssueDialog";

const TITLE_LIMIT = 120;
const DESCRIPTION_LIMIT = 4000;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function reportPrefill(
  entry: ConsoleErrorEntry,
  page: string,
): { readonly title: string; readonly description: string } {
  const occurrence =
    entry.count > 1
      ? `It happened ${String(entry.count)} times, most recently at ${entry.lastSeenAt}.`
      : `It happened at ${entry.firstSeenAt}.`;

  return {
    title: truncate(`Console error: ${entry.summary}`, TITLE_LIMIT),
    description: truncate(
      `A console error appeared on ${page}. ${occurrence}\n\n${entry.detail}`,
      DESCRIPTION_LIMIT,
    ),
  };
}

interface ConsoleErrorNotificationsProps {
  readonly page: string;
  readonly reportingEnabled: boolean;
}

/**
 * Surfaces `console.error` calls as dismissible cards in the top-right corner.
 * Each one can hand itself straight to the existing issue-reporting flow,
 * pre-filled, so a user does not have to transcribe a stack trace by hand.
 */
export function ConsoleErrorNotifications({
  page,
  reportingEnabled,
}: ConsoleErrorNotificationsProps): ReactElement | null {
  const entries = useConsoleErrorEntries();
  const [reporting, setReporting] = useState<ConsoleErrorEntry | undefined>(undefined);

  if (entries.length === 0 && reporting === undefined) {
    return null;
  }

  const prefill = reporting === undefined ? undefined : reportPrefill(reporting, page);

  return (
    <>
      <Box
        sx={{
          position: "fixed",
          top: { xs: 76, sm: 88 },
          right: { xs: 12, sm: 20 },
          zIndex: (theme) => theme.zIndex.snackbar,
          width: { xs: "calc(100% - 24px)", sm: 380 },
          maxWidth: "100%",
        }}
      >
        <Stack spacing={1.5}>
          {entries.map((entry) => (
            <Paper
              key={entry.id}
              elevation={6}
              role="alert"
              sx={{
                p: 1.75,
                borderRadius: 2,
                border: "1px solid",
                borderColor: "error.light",
              }}
            >
              <Stack
                direction="row"
                alignItems="flex-start"
                justifyContent="space-between"
                spacing={1}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <ErrorOutlineRounded color="error" fontSize="small" />
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                    Console error
                  </Typography>
                  {entry.count > 1 && (
                    <Chip
                      size="small"
                      color="error"
                      variant="outlined"
                      label={`×${String(entry.count)}`}
                    />
                  )}
                </Stack>
                <IconButton
                  size="small"
                  aria-label="Dismiss error notification"
                  onClick={() => dismissConsoleError(entry.id)}
                >
                  <CloseRounded fontSize="small" />
                </IconButton>
              </Stack>
              <Typography
                variant="body2"
                sx={{ mt: 1, wordBreak: "break-word", color: "text.secondary" }}
              >
                {entry.summary}
              </Typography>
              {reportingEnabled && (
                <Button
                  size="small"
                  startIcon={<BugReportRounded fontSize="small" />}
                  onClick={() => setReporting(entry)}
                  sx={{ mt: 1.5 }}
                >
                  Report bug
                </Button>
              )}
            </Paper>
          ))}
        </Stack>
      </Box>
      {prefill !== undefined && (
        <ReportIssueDialog
          page={page}
          onClose={() => setReporting(undefined)}
          initialTitle={prefill.title}
          initialDescription={prefill.description}
        />
      )}
    </>
  );
}
