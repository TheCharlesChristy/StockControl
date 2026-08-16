import AutoAwesomeRounded from "@mui/icons-material/AutoAwesomeRounded";
import LockOutlined from "@mui/icons-material/LockOutlined";
import { Alert, Box, Button, Paper, Stack, Typography } from "@mui/material";
import type { ReactElement } from "react";

interface IdentifyPanelProps {
  readonly photoCount: number;
  /** A code this device read but the catalogue did not know. It travels with
   *  the photographs as evidence, so say so rather than losing it silently. */
  readonly unmatchedCode: string | null;
  readonly onIdentify: () => void;
}

/**
 * The opt-in.
 *
 * Photographs added to the scan sheet are read on the device: that is how the
 * barcode fast path works, and it costs nothing and discloses nothing. Sending
 * them to be identified is a different act with a different cost, so it is
 * never the default and never a side effect of attaching a photograph. This
 * panel is the only route to it, and the button says what pressing it does.
 *
 * Rendered only for a role the server would accept — Office and Admin, through
 * `manageStock` — and only where the installation has the feature switched on.
 * Both are re-checked on every request the browser then makes.
 */
export function IdentifyPanel({
  photoCount,
  unmatchedCode,
  onIdentify,
}: IdentifyPanelProps): ReactElement {
  const one = photoCount === 1;
  const photos = one ? "photo" : "photos";

  return (
    <Paper variant="outlined" sx={{ p: 2, borderColor: "primary.main", bgcolor: "primary.light" }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <LockOutlined fontSize="small" color="action" sx={{ mt: 0.25 }} />
          <Typography variant="body2" color="text.secondary">
            {unmatchedCode === null
              ? `Nothing has left this device. StockControl read your ${photos} here and found no code in ${one ? "it" : "them"}.`
              : `Nothing has left this device. StockControl read “${unmatchedCode}” from your ${photos}, but no item in the catalogue uses it.`}
          </Typography>
        </Stack>

        <Box>
          <Typography variant="subtitle2">Let StockControl work out what it is</Typography>
          <Typography variant="body2" color="text.secondary">
            {`Choosing this sends ${one ? "the photo" : `all ${String(photoCount)} photos`} to StockControl to be identified. You check what it suggests, and nothing changes in stock until you confirm it.`}
          </Typography>
        </Box>

        <Stack direction="row" justifyContent="flex-end">
          <Button variant="contained" startIcon={<AutoAwesomeRounded />} onClick={onIdentify}>
            {one
              ? "Send this photo to be identified"
              : `Send these ${String(photoCount)} photos to be identified`}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

/**
 * What somebody who cannot use assisted capture is told instead. It never
 * mentions the feature: an Engineer has no way to turn it on, so naming it
 * would only describe a door they cannot open.
 */
export function NoCodeAdvice(): ReactElement {
  return (
    <Alert severity="info">
      No code was found in those photos. A closer, better-lit shot of the label usually reads — or
      type the code in above.
    </Alert>
  );
}
