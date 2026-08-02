import ExpandLessRounded from "@mui/icons-material/ExpandLessRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  Link,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type {
  DashboardReservationView,
  EngineerDashboardResponse,
  OfficeDashboardResponse,
} from "@stockcontrol/contracts";
import { useCallback, useState, type ReactElement, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";

import { useApi, useResource } from "../api/ApiContext";
import { useAuth } from "../auth/AuthContext";
import { useCapability } from "../auth/useCapability";
import {
  ErrorState,
  formatDateTime,
  formatQuantity,
  LoadingRows,
  PageHeader,
  StatTile,
  transactionKindLabels,
} from "../components/DataStates";
import { InventoryTable } from "../components/InventoryTable";
import { ItemAvatar } from "../components/ItemAvatar";
import { StockRequestList } from "../components/StockRequestList";

interface PanelProps {
  readonly title: string;
  readonly icon?: ReactNode;
  readonly action?: ReactNode;
  readonly dataHelpTarget?: string;
  readonly children: ReactNode;
}

function Panel({ title, icon, action, dataHelpTarget, children }: PanelProps): ReactElement {
  return (
    <Paper variant="outlined" data-help-target={dataHelpTarget}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2.5, py: 2 }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          {icon}
          <Typography variant="h3" component="h2">
            {title}
          </Typography>
        </Stack>
        {action}
      </Stack>
      <Divider />
      {children}
    </Paper>
  );
}

function Empty({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <Box sx={{ px: 2.5, py: 3 }}>
      <Typography color="text.secondary">{children}</Typography>
    </Box>
  );
}

function ReservationList({
  reservations,
  showOwner,
}: {
  readonly reservations: readonly DashboardReservationView[];
  readonly showOwner: boolean;
}): ReactElement {
  return (
    <List disablePadding>
      {reservations.map((reservation) => (
        <ListItem key={reservation.id} divider>
          <ListItemText
            primary={
              <Stack direction="row" spacing={1} alignItems="center">
                <ItemAvatar
                  name={reservation.itemName}
                  photoUrl={reservation.itemPhotoUrl}
                  size={32}
                />
                <Link component={RouterLink} to={`/jobs/${reservation.jobId}`} underline="hover">
                  {reservation.itemReference} — {reservation.itemName}
                </Link>
              </Stack>
            }
            secondary={`${formatQuantity(reservation.quantityOutstanding)} ${reservation.unit} remaining to collect for ${reservation.jobNumber} ${reservation.jobName}${
              showOwner ? ` · ${reservation.createdByName}` : ""
            }`}
          />
        </ListItem>
      ))}
    </List>
  );
}

/**
 * An Engineer's Overview is their working day: what stock exists, the jobs they
 * are on, and what they have already committed or asked for. There are no
 * business-wide totals here and no low-stock panel — reordering is not their
 * decision, and a count of the whole catalogue tells them nothing useful.
 */
function EngineerDashboard({
  data,
  onChanged,
}: {
  readonly data: EngineerDashboardResponse;
  readonly onChanged: () => void;
}): ReactElement {
  const [itemsOpen, setItemsOpen] = useState(true);

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" data-help-target="dashboard-engineer-stock">
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2.5, py: 2 }}
        >
          <Typography variant="h3" component="h2">
            Stock
          </Typography>
          <Button
            onClick={() => setItemsOpen((open) => !open)}
            endIcon={itemsOpen ? <ExpandLessRounded /> : <ExpandMoreRounded />}
            aria-expanded={itemsOpen}
            aria-controls="dashboard-items"
          >
            {itemsOpen ? "Hide" : "Show"}
          </Button>
        </Stack>
        <Divider />
        <Collapse in={itemsOpen} id="dashboard-items">
          <Box sx={{ p: 2.5 }}>
            <InventoryTable showReservedForYou />
          </Box>
        </Collapse>
      </Paper>

      <Box data-help-target="dashboard-engineer-jobs">
        <Panel title="Your jobs">
          {data.myJobs.length === 0 ? (
            <Empty>You are not assigned to any open jobs. An Office user can put you on one.</Empty>
          ) : (
            <List disablePadding>
              {data.myJobs.map((job) => (
                <ListItem key={job.id} divider sx={{ display: "block", py: 2 }}>
                  <Link component={RouterLink} to={`/jobs/${job.id}`} underline="hover">
                    <Typography component="span" sx={{ fontWeight: 700 }}>
                      {job.number} — {job.name}
                    </Typography>
                  </Link>
                  <Typography variant="body2" color="text.secondary">
                    {job.customer} · {job.openReservationCount} open commitment
                    {job.openReservationCount === 1 ? "" : "s"}
                  </Typography>
                  {job.jobSiteStock.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Nothing has been collected to this site yet.
                    </Typography>
                  ) : (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ mt: 1, flexWrap: "wrap", rowGap: 1 }}
                      aria-label={`Stock at ${job.number}`}
                    >
                      {job.jobSiteStock.map((balance) => (
                        <Chip
                          key={`${job.id}-${balance.locationName}`}
                          size="small"
                          variant="outlined"
                          label={`${balance.locationName} · ${formatQuantity(balance.quantity)}${
                            balance.unit === undefined ? "" : ` ${balance.unit}`
                          }`}
                        />
                      ))}
                    </Stack>
                  )}
                </ListItem>
              ))}
            </List>
          )}
        </Panel>
      </Box>

      <Box data-help-target="dashboard-engineer-requests">
        <Panel title="Stock committed for you">
          {data.myReservations.length === 0 ? (
            <Empty>You have no stock waiting to be collected.</Empty>
          ) : (
            <ReservationList reservations={data.myReservations} showOwner={false} />
          )}
        </Panel>

        <Box sx={{ mt: 3 }}>
          <Panel title="Your stock requests">
            {data.myRequests.length === 0 ? (
              <Empty>
                You have not asked for anything. Open an item and press Request stock to raise one.
              </Empty>
            ) : (
              <StockRequestList
                requests={data.myRequests}
                canReview={false}
                onChanged={onChanged}
              />
            )}
          </Panel>
        </Box>
      </Box>
    </Stack>
  );
}

/** Office and Admin see what needs deciding: shortages, upcoming work, and the queue. */
function OfficeDashboard({
  data,
  onChanged,
}: {
  readonly data: OfficeDashboardResponse;
  readonly onChanged: () => void;
}): ReactElement {
  const [mineOnly, setMineOnly] = useState(false);
  const reservations = mineOnly ? data.myReservations : data.openReservations;
  /*
   * Only roles that hold the capability get Approve and Turn down. Reaching
   * this component already implies the role, but the guard belongs on the
   * capability rather than on which branch rendered us.
   */
  const canReview = useCapability("reviewStockRequests");

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} data-help-target="dashboard-stats">
        <StatTile label="Items in catalogue" value={String(data.counts.items)} tone="primary" />
        <StatTile label="Open jobs" value={String(data.counts.openJobs)} />
        <StatTile label="Open commitments" value={String(data.counts.openReservations)} />
        <StatTile
          label="Requests waiting"
          value={String(data.counts.pendingRequests)}
          tone={data.counts.pendingRequests > 0 ? "warning" : "neutral"}
        />
      </Stack>

      {data.counts.pendingRequests > 0 && (
        <Alert
          severity="warning"
          action={
            <Button component={RouterLink} to="/requests" color="inherit" size="small">
              Review requests
            </Button>
          }
        >
          {data.counts.pendingRequests} stock request
          {data.counts.pendingRequests === 1 ? " is" : "s are"} waiting for a decision.
        </Alert>
      )}

      <Panel
        title="Low on stock"
        icon={
          <WarningAmberRounded
            fontSize="small"
            color={data.lowStock.length > 0 ? "warning" : "disabled"}
          />
        }
      >
        {data.lowStock.length === 0 ? (
          <Empty>Nothing is below its minimum.</Empty>
        ) : (
          <List disablePadding>
            {data.lowStock.map((item) => (
              <ListItem key={item.id} divider>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <ItemAvatar name={item.name} photoUrl={item.coverPhotoUrl} size={32} />
                      <Link component={RouterLink} to={`/inventory/${item.id}`} underline="hover">
                        {item.reference} — {item.name}
                      </Link>
                    </Stack>
                  }
                  secondary={`${formatQuantity(item.available)} ${item.unit} ready to use, minimum ${formatQuantity(item.lowStockThreshold ?? "0")}`}
                />
                {/*
                 * A state, not an instruction. "Reorder" reads as a button that
                 * places an order, and nothing here does that — this is the same
                 * condition the inventory table flags, so it wears the same word.
                 */}
                <Chip label="Low" size="small" color="warning" variant="outlined" />
              </ListItem>
            ))}
          </List>
        )}
      </Panel>

      <Panel
        title="Stock requests"
        dataHelpTarget="dashboard-requests"
        action={
          <Button component={RouterLink} to="/requests" size="small">
            See all
          </Button>
        }
      >
        {data.pendingRequests.length === 0 ? (
          <Empty>Nothing is waiting for a decision.</Empty>
        ) : (
          <StockRequestList
            requests={data.pendingRequests}
            canReview={canReview}
            onChanged={onChanged}
          />
        )}
      </Panel>

      <Panel
        title="Jobs coming up"
        dataHelpTarget="dashboard-jobs"
        action={
          <Button component={RouterLink} to="/jobs" size="small">
            See all
          </Button>
        }
      >
        {data.upcomingJobs.length === 0 ? (
          <Empty>No jobs are open.</Empty>
        ) : (
          <List disablePadding>
            {data.upcomingJobs.map((job) => (
              <ListItem key={job.id} divider>
                <ListItemText
                  primary={
                    <Link component={RouterLink} to={`/jobs/${job.id}`} underline="hover">
                      {job.number} — {job.name}
                    </Link>
                  }
                  secondary={
                    job.assignees.length === 0
                      ? `${job.customer} · nobody assigned`
                      : `${job.customer} · ${job.assignees.map((person) => person.displayName).join(", ")}`
                  }
                />
                <Chip
                  label={`${job.openReservationCount} committed`}
                  size="small"
                  variant="outlined"
                />
              </ListItem>
            ))}
          </List>
        )}
      </Panel>

      <Panel
        title="Stock waiting to be collected"
        action={
          <Button size="small" onClick={() => setMineOnly((only) => !only)}>
            {mineOnly ? "Show everyone" : "Show mine"}
          </Button>
        }
      >
        {reservations.length === 0 ? (
          <Empty>
            {mineOnly
              ? "You have no stock committed to you that is still waiting."
              : "Nothing is committed and waiting to be collected."}
          </Empty>
        ) : (
          <ReservationList reservations={reservations} showOwner={!mineOnly} />
        )}
      </Panel>

      <Panel
        title="Recent activity"
        action={
          <Button component={RouterLink} to="/transactions" size="small">
            See the full log
          </Button>
        }
      >
        {data.recentTransactions.length === 0 ? (
          <Empty>
            Nothing has happened yet. Receive some stock and it will appear here, with who did it
            and when.
          </Empty>
        ) : (
          <List disablePadding>
            {data.recentTransactions.map((transaction) => (
              <ListItem key={transaction.id} divider>
                <ListItemText
                  disableTypography
                  primary={
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{ flexWrap: "wrap" }}
                    >
                      <Chip
                        label={transactionKindLabels[transaction.kind]}
                        size="small"
                        variant="outlined"
                      />
                      <ItemAvatar
                        name={transaction.itemName}
                        photoUrl={transaction.itemPhotoUrl}
                        size={28}
                      />
                      <Link
                        component={RouterLink}
                        to={`/inventory/${transaction.itemId}`}
                        underline="hover"
                      >
                        {transaction.itemReference}
                      </Link>
                      <Typography component="span" sx={{ fontWeight: 700 }}>
                        {formatQuantity(transaction.quantity)} {transaction.unit}
                      </Typography>
                    </Stack>
                  }
                  secondary={
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                      {transaction.actorName} · {formatDateTime(transaction.occurredAt)}
                    </Typography>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Panel>
    </Stack>
  );
}

export function DashboardPage(): ReactElement | null {
  const api = useApi();
  const { user } = useAuth();
  const load = useCallback((signal: AbortSignal) => api.dashboard(signal), [api]);
  const dashboard = useResource(load);

  if (user === null) {
    return null;
  }

  const { data } = dashboard;
  const firstName = user.displayName.split(" ")[0] ?? user.displayName;
  const isEngineer = user.role === "Engineer";

  return (
    <Box>
      <PageHeader
        eyebrow={`Signed in as ${user.role}`}
        title={`Good to see you, ${firstName}`}
        description={
          isEngineer
            ? "The stock you can draw on, the jobs you are working, and what you have committed."
            : "What needs attention, what is coming up, and what people have asked for."
        }
      />

      {dashboard.status === "error" && dashboard.error !== undefined && (
        <ErrorState error={dashboard.error} onRetry={dashboard.reload} />
      )}

      {dashboard.status === "loading" && data === undefined && <LoadingRows rows={6} />}

      {data !== undefined &&
        (data.role === "Engineer" ? (
          <EngineerDashboard data={data} onChanged={dashboard.reload} />
        ) : (
          <OfficeDashboard data={data} onChanged={dashboard.reload} />
        ))}
    </Box>
  );
}
