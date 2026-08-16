import CheckCircleOutlineRounded from "@mui/icons-material/CheckCircleOutlineRounded";
import PhotoCameraRounded from "@mui/icons-material/PhotoCameraRounded";
import {
  Alert,
  Button,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
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
  AwaitingUpload: "Sending photos",
  Queued: "Waiting its turn",
  ProcessingBarcode: "Checking barcodes",
  ProcessingImages: "Reading photos",
  Enriching: "Checking matches",
  Fusing: "Preparing suggestions",
  ReviewReady: "Ready to review",
  Committed: "Added",
  Failed: "Could not be read",
  Cancelled: "Removed",
  Expired: "Expired",
};

const workingStatuses: ReadonlySet<RecognitionSessionStatus> = new Set([
  "AwaitingUpload",
  "Queued",
  "ProcessingBarcode",
  "ProcessingImages",
  "Enriching",
  "Fusing",
]);

const stuckStatuses: ReadonlySet<RecognitionSessionStatus> = new Set(["Failed", "Expired"]);

/**
 * How long ago, in the words somebody would use out loud. Which item is stuck
 * is the question this page exists to answer, and a timestamp makes the reader
 * do the arithmetic themselves.
 */
export const howLongAgo = (iso: string, now: number = Date.now()): string => {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${String(minutes)} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${String(hours)} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${String(days)} days ago`;
};

const photoCountLabel = (count: number): string =>
  count === 1 ? "1 photo" : `${String(count)} photos`;

interface QueueRowProps {
  readonly session: RecognitionSessionSummaryView;
  readonly action: string;
  readonly primary: boolean;
  readonly onOpen: () => void;
  readonly onRemove: (() => void) | undefined;
}

function QueueRow({ session, action, primary, onOpen, onRemove }: QueueRowProps): ReactElement {
  return (
    <Paper variant="outlined" sx={{ p: 1.75 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", sm: "center" }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
          <PhotoCameraRounded color="action" />
          <Stack sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700 }}>{photoCountLabel(session.photoCount)}</Typography>
            <Typography variant="caption" color="text.secondary">
              Photographed {howLongAgo(session.createdAt)}
            </Typography>
          </Stack>
        </Stack>

        <Chip
          size="small"
          label={statusLabels[session.status]}
          color={primary ? "primary" : "default"}
          variant={primary ? "filled" : "outlined"}
        />

        <Stack direction="row" spacing={1}>
          <Button variant={primary ? "contained" : "outlined"} size="small" onClick={onOpen}>
            {action}
          </Button>
          {onRemove !== undefined && (
            <Button size="small" color="inherit" onClick={onRemove}>
              Remove
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

interface QueueGroupProps {
  readonly title: string;
  readonly explanation: string;
  readonly children: ReactElement[];
}

function QueueGroup({ title, explanation, children }: QueueGroupProps): ReactElement {
  return (
    <Stack spacing={1.25} component="section" aria-label={title}>
      <Stack spacing={0.25}>
        <Typography variant="h4" component="h2">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {explanation}
        </Typography>
      </Stack>
      {children}
    </Stack>
  );
}

interface ReviewQueueProps {
  readonly batch: StockCaptureBatchView;
  readonly added: readonly AddedEntry[];
  readonly locations: readonly LocationView[];
  readonly defaultLocationId: string;
  readonly notice: string | null;
  readonly error: string | null;
  readonly finishing: boolean;
  readonly onDefaultLocationChange: (locationId: string) => void;
  readonly onDismissNotice: () => void;
  readonly onScan: () => void;
  readonly onOpenSession: (session: RecognitionSessionSummaryView) => void;
  readonly onRemoveSession: (session: RecognitionSessionSummaryView) => void;
  readonly onFinishDelivery: () => void;
}

/**
 * The queue, sorted by what it wants from you.
 *
 * This page used to lead with a button for photographing an item, which is no
 * longer where photographing an item starts — that is the scan button, on
 * every screen. What is left is the part only this page can do: seeing what is
 * still being read, what is waiting to be checked, and what got stuck, and
 * being able to act on any of it without opening each one to find out.
 *
 * Grouped by required action rather than by status, because "Enriching" and
 * "Fusing" are the same fact to the person reading them — it is not ready yet
 * — while "Ready to review" is the only row that wants them now.
 */
export function ReviewQueue({
  batch,
  added,
  locations,
  defaultLocationId,
  notice,
  error,
  finishing,
  onDefaultLocationChange,
  onDismissNotice,
  onScan,
  onOpenSession,
  onRemoveSession,
  onFinishDelivery,
}: ReviewQueueProps): ReactElement {
  const ready = batch.sessions.filter((session) => session.status === "ReviewReady");
  const working = batch.sessions.filter((session) => workingStatuses.has(session.status));
  const stuck = batch.sessions.filter((session) => stuckStatuses.has(session.status));
  const stores = locations.filter((location) => location.kind === "Store" && location.isActive);

  /*
   * Items committed on an earlier visit have no name here — the batch carries a
   * count and an id, not a catalogue row — so they fall back to a plain row
   * that still links through rather than costing one request each.
   */
  const earlierCommitted = batch.sessions.filter(
    (session) =>
      session.status === "Committed" &&
      session.committedItemId !== null &&
      !added.some((entry) => entry.itemId === session.committedItemId),
  );

  const nothingQueued = ready.length + working.length + stuck.length === 0;
  const addedCount = added.length + earlierCommitted.length;

  return (
    <Stack spacing={3}>
      {notice !== null && (
        <Alert severity="info" onClose={onDismissNotice}>
          {notice}
        </Alert>
      )}
      {error !== null && (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      )}

      {nothingQueued && (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Stack spacing={1.5} alignItems="center">
            <Typography sx={{ fontWeight: 700 }}>Nothing is waiting</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>
              Photograph an item StockControl does not recognise and it appears here while it is
              read. Anything with a barcode it knows goes straight to the item, without coming
              through this queue at all.
            </Typography>
            <Button variant="contained" startIcon={<PhotoCameraRounded />} onClick={onScan}>
              Photograph an item
            </Button>
          </Stack>
        </Paper>
      )}

      {ready.length > 0 && (
        <QueueGroup
          title="Waiting for you"
          explanation="StockControl has finished with these. Check what it suggests, then confirm the quantity."
        >
          {ready.map((session) => (
            <QueueRow
              key={session.id}
              session={session}
              action="Review"
              primary
              onOpen={() => onOpenSession(session)}
              onRemove={() => onRemoveSession(session)}
            />
          ))}
        </QueueGroup>
      )}

      {working.length > 0 && (
        <QueueGroup
          title="Still being read"
          explanation="These keep working whether or not this page is open. They move up on their own."
        >
          {working.map((session) => (
            <QueueRow
              key={session.id}
              session={session}
              action="Open"
              primary={false}
              onOpen={() => onOpenSession(session)}
              onRemove={() => onRemoveSession(session)}
            />
          ))}
        </QueueGroup>
      )}

      {stuck.length > 0 && (
        <QueueGroup
          title="Could not be read"
          explanation="Photograph these again, or remove them from the queue."
        >
          {stuck.map((session) => (
            <QueueRow
              key={session.id}
              session={session}
              action="Open"
              primary={false}
              onOpen={() => onOpenSession(session)}
              onRemove={() => onRemoveSession(session)}
            />
          ))}
        </QueueGroup>
      )}

      {!nothingQueued && (
        <Button
          variant="outlined"
          startIcon={<PhotoCameraRounded />}
          onClick={onScan}
          sx={{ alignSelf: "flex-start" }}
        >
          Photograph another item
        </Button>
      )}

      {addedCount > 0 && (
        <Stack spacing={0.5} component="section" aria-label="Added to stock">
          <Typography variant="h4" component="h2">
            Added to stock
          </Typography>
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
            {earlierCommitted.map((session) => (
              <ListItem key={session.id} disableGutters>
                <ListItemIcon sx={{ minWidth: 34 }}>
                  <CheckCircleOutlineRounded color="success" fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Item added" secondary={howLongAgo(session.createdAt)} />
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

      <Divider />

      {/*
       * The delivery itself, kept deliberately quiet at the bottom: one store
       * for the whole delivery saves picking it per item, and finishing is a
       * once-a-delivery act, not the thing this page is for.
       */}
      <Stack spacing={1.5} component="section" aria-label="This delivery">
        <Typography variant="subtitle2">This delivery</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems="flex-start">
          <TextField
            select
            size="small"
            label="Where it is going"
            value={defaultLocationId}
            helperText="Used as the starting point for each item. You can change it per item."
            sx={{ minWidth: 280 }}
            onChange={(event) => onDefaultLocationChange(event.target.value)}
          >
            <MenuItem value="">No default — choose per item</MenuItem>
            {stores.map((store) => (
              <MenuItem key={store.id} value={store.id}>
                {store.code} — {store.name}
              </MenuItem>
            ))}
          </TextField>
          <Button
            onClick={onFinishDelivery}
            disabled={finishing || ready.length + working.length > 0}
          >
            {finishing ? "Finishing…" : "Finish this delivery"}
          </Button>
        </Stack>
        {ready.length + working.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            Review or remove everything above before finishing.
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}
