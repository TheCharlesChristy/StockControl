import AddAPhotoRounded from "@mui/icons-material/AddAPhotoRounded";
import CheckCircleOutlineRounded from "@mui/icons-material/CheckCircleOutlineRounded";
import {
  Alert,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type {
  LocationView,
  RecognitionSessionStatus,
  RecognitionSessionSummaryView,
  StockCaptureBatchView,
} from "@stockcontrol/contracts";
import type { ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";

import { formatQuantity } from "../../components/DataStates";
import type { AddedEntry } from "./capture-reducer";

const statusLabels: Readonly<Record<RecognitionSessionStatus, string>> = {
  AwaitingUpload: "Sending photographs",
  Queued: "Waiting its turn",
  ProcessingBarcode: "Checking barcodes",
  ProcessingImages: "Reading photographs",
  Enriching: "Checking matches",
  Fusing: "Preparing suggestions",
  ReviewReady: "Ready to review",
  Committed: "Added",
  Failed: "Could not finish",
  Cancelled: "Cancelled",
  Expired: "Expired",
};

const terminalStatuses: ReadonlySet<RecognitionSessionStatus> = new Set([
  "Committed",
  "Cancelled",
  "Expired",
]);

interface BatchSummaryProps {
  readonly batch: StockCaptureBatchView;
  readonly added: readonly AddedEntry[];
  readonly locations: readonly LocationView[];
  readonly defaultLocationId: string;
  readonly notice: string | null;
  readonly error: string | null;
  readonly finishing: boolean;
  readonly onDefaultLocationChange: (locationId: string) => void;
  readonly onDismissNotice: () => void;
  readonly onStartNewItem: () => void;
  readonly onResumeSession: (session: RecognitionSessionSummaryView) => void;
  readonly onFinishBatch: () => void;
}

/**
 * The landing page for a batch, specification section 5: every item added so
 * far, and every session still in flight — the browser has nothing to lose by
 * navigating away and back, so this is always safe to return to.
 */
export function BatchSummary({
  batch,
  added,
  locations,
  defaultLocationId,
  notice,
  error,
  finishing,
  onDefaultLocationChange,
  onDismissNotice,
  onStartNewItem,
  onResumeSession,
  onFinishBatch,
}: BatchSummaryProps): ReactElement {
  const unresolved = batch.sessions.filter((session) => !terminalStatuses.has(session.status));
  const stores = locations.filter((location) => location.kind === "Store" && location.isActive);
  const empty = batch.committedEntryCount === 0;
  /*
   * Sessions committed before this visit have no item name to show — the batch
   * view carries a count and an id, not a catalogue row. Rather than fetch one
   * item at a time, those fall back to a plain row that still links through.
   */
  const earlierCommitted = batch.sessions.filter(
    (session) =>
      session.status === "Committed" &&
      session.committedItemId !== null &&
      !added.some((entry) => entry.itemId === session.committedItemId),
  );

  return (
    <Stack spacing={2.5}>
      {notice !== null && (
        <Alert severity="info" onClose={onDismissNotice}>
          {notice}
        </Alert>
      )}

      <Typography variant="body1">
        {empty
          ? "Nothing has been added to stock yet in this batch."
          : `${String(batch.committedEntryCount)} ${
              batch.committedEntryCount === 1 ? "item has" : "items have"
            } been added to stock in this batch.`}
      </Typography>

      {error !== null && (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      )}

      {/*
       * Specification section 5.1 step 2. One delivery usually lands in one
       * store, and picking it here means it is not picked again for every
       * item in the delivery.
       */}
      <TextField
        select
        label="Where this delivery is going"
        value={defaultLocationId}
        helperText="Used as the starting point for each item. You can change it per item."
        sx={{ maxWidth: 420 }}
        onChange={(event) => onDefaultLocationChange(event.target.value)}
      >
        <MenuItem value="">No default — choose per item</MenuItem>
        {stores.map((store) => (
          <MenuItem key={store.id} value={store.id}>
            {store.code} — {store.name}
          </MenuItem>
        ))}
      </TextField>

      {added.length > 0 && (
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">Added in this batch</Typography>
          <List dense disablePadding>
            {added.map((entry) => (
              <ListItem key={`${entry.itemId}-${entry.reference}-${entry.quantity}`} disableGutters>
                <ListItemIcon sx={{ minWidth: 34 }}>
                  <CheckCircleOutlineRounded color="success" fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={`${formatQuantity(entry.quantity)} ${entry.unit} — ${entry.name}`}
                  secondary={entry.reference}
                />
                <Button size="small" component={RouterLink} to={`/inventory/${entry.itemId}`}>
                  View
                </Button>
              </ListItem>
            ))}
          </List>
        </Stack>
      )}

      {earlierCommitted.length > 0 && (
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">Added earlier in this batch</Typography>
          <List dense disablePadding>
            {earlierCommitted.map((session) => (
              <ListItem key={session.id} disableGutters>
                <ListItemIcon sx={{ minWidth: 34 }}>
                  <CheckCircleOutlineRounded color="success" fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Item added" />
                <Button
                  size="small"
                  component={RouterLink}
                  to={`/inventory/${session.committedItemId ?? ""}`}
                >
                  View
                </Button>
              </ListItem>
            ))}
          </List>
        </Stack>
      )}

      {unresolved.length > 0 && (
        <Stack spacing={1.5}>
          <Typography variant="subtitle2">Recognition queue</Typography>
          {unresolved.map((session) => (
            <Card key={session.id} variant="outlined">
              <CardActionArea onClick={() => onResumeSession(session)}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2">
                      {session.photoCount === 1
                        ? "1 photograph"
                        : `${String(session.photoCount)} photographs`}
                    </Typography>
                    <Chip size="small" label={statusLabels[session.status]} />
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}

      <Stack direction="row" spacing={1.5} justifyContent="space-between">
        <Button variant="contained" startIcon={<AddAPhotoRounded />} onClick={onStartNewItem}>
          {empty ? "Photograph an item" : "Add another item"}
        </Button>
        <Button onClick={onFinishBatch} disabled={finishing || unresolved.length > 0}>
          {finishing ? "Finishing…" : "Finish this batch"}
        </Button>
      </Stack>
      {unresolved.length > 0 && (
        <Typography variant="caption" color="text.secondary" textAlign="right">
          Review or cancel every queued item before finishing this batch.
        </Typography>
      )}
    </Stack>
  );
}
