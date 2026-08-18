import CloseRounded from "@mui/icons-material/CloseRounded";
import PhotoLibraryRounded from "@mui/icons-material/PhotoLibraryRounded";
import {
  Box,
  Button,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ChangeEvent, FormEvent, ReactElement, ReactNode } from "react";

interface CodeEntryProps {
  readonly code: string;
  readonly busy: boolean;
  readonly onCodeChange: (code: string) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onFilesChosen: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onClose: () => void;
  /** The same "not recognised" question the camera asks, inline here. */
  readonly children?: ReactNode;
}

/**
 * What the scan button opens where there is no camera.
 *
 * A viewfinder with nothing in it is not a degraded camera, it is a black
 * rectangle with a dead shutter on it — which is what this screen used to be.
 * A desktop with no webcam is not an edge case either: it is the machine most
 * of this system's office work happens on, and a handheld scanner plugged into
 * it types into a field like a keyboard. So the field is the screen, focused
 * and ready, and the surface looks like the rest of StockControl rather than
 * like a camera that failed.
 */
export function CodeEntry({
  code,
  busy,
  onCodeChange,
  onSubmit,
  onFilesChosen,
  onClose,
  children,
}: CodeEntryProps): ReactElement {
  return (
    <>
      <DialogTitle component="div" sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h2" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
            Find an item
          </Typography>
          <Typography variant="caption" color="text.secondary">
            No camera on this device
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close">
          <CloseRounded />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <Box component="form" onSubmit={onSubmit}>
            <Stack spacing={1.5}>
              <TextField
                label="Item code or barcode"
                value={code}
                onChange={(event) => onCodeChange(event.target.value)}
                placeholder="ITM-0001 or a barcode"
                helperText="Type it, or scan with a handheld scanner — it types into this box."
                autoComplete="off"
                autoFocus
                fullWidth
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={code.trim().length === 0 || busy}
              >
                {busy ? "Looking…" : "Find item"}
              </Button>
            </Stack>
          </Box>

          {busy && <LinearProgress />}

          <Divider>
            <Typography variant="caption" color="text.secondary">
              or
            </Typography>
          </Divider>

          <Button component="label" variant="outlined" startIcon={<PhotoLibraryRounded />}>
            Use a photo of the item
            <input type="file" accept="image/*" multiple hidden onChange={onFilesChosen} />
          </Button>

          {children}
        </Stack>
      </DialogContent>
    </>
  );
}
