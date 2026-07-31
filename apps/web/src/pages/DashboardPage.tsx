import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import {
  Box,
  Chip,
  Divider,
  Link,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";

import { useApi, useResource } from "../api/ApiContext";
import { useAuth } from "../auth/AuthContext";
import {
  ErrorState,
  formatDateTime,
  formatQuantity,
  LoadingRows,
  PageHeader,
  StatTile,
} from "../components/DataStates";

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

  return (
    <Box>
      <PageHeader
        eyebrow={`Signed in as ${user.role}`}
        title={`Good to see you, ${firstName}`}
        description="What needs attention, what you have committed, and what has just happened."
      />

      {dashboard.status === "error" && dashboard.error !== undefined && (
        <ErrorState error={dashboard.error} onRetry={dashboard.reload} />
      )}

      {dashboard.status === "loading" && data === undefined && <LoadingRows rows={6} />}

      {data !== undefined && (
        <Stack spacing={3}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <StatTile label="Catalogue items" value={String(data.counts.items)} tone="primary" />
            <StatTile label="Open jobs" value={String(data.counts.openJobs)} />
            <StatTile label="Open reservations" value={String(data.counts.openReservations)} />
            <StatTile
              label="Below threshold"
              value={String(data.lowStock.length)}
              tone={data.lowStock.length > 0 ? "warning" : "neutral"}
            />
          </Stack>

          <Paper variant="outlined">
            <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2.5, py: 2 }}>
              <WarningAmberRounded
                fontSize="small"
                color={data.lowStock.length > 0 ? "warning" : "disabled"}
              />
              <Typography variant="h3" component="h2">
                Low stock
              </Typography>
            </Stack>
            <Divider />
            {data.lowStock.length === 0 ? (
              <Box sx={{ px: 2.5, py: 3 }}>
                <Typography color="text.secondary">Nothing is below its threshold.</Typography>
              </Box>
            ) : (
              <List disablePadding>
                {data.lowStock.map((item) => (
                  <ListItem key={item.id} divider>
                    <ListItemText
                      primary={
                        <Link component={RouterLink} to={`/inventory/${item.id}`} underline="hover">
                          {item.reference} — {item.name}
                        </Link>
                      }
                      secondary={`${formatQuantity(item.available)} ${item.unit} available, threshold ${formatQuantity(item.lowStockThreshold ?? "0")}`}
                    />
                    <Chip label="Reorder" size="small" color="warning" variant="outlined" />
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>

          <Paper variant="outlined">
            <Typography variant="h3" component="h2" sx={{ px: 2.5, py: 2 }}>
              Your open reservations
            </Typography>
            <Divider />
            {data.myReservations.length === 0 ? (
              <Box sx={{ px: 2.5, py: 3 }}>
                <Typography color="text.secondary">
                  You have not reserved anything that is still waiting to be collected.
                </Typography>
              </Box>
            ) : (
              <List disablePadding>
                {data.myReservations.map((reservation) => (
                  <ListItem key={reservation.id} divider>
                    <ListItemText
                      primary={
                        <Link
                          component={RouterLink}
                          to={`/jobs/${reservation.jobId}`}
                          underline="hover"
                        >
                          {reservation.itemReference} — {reservation.itemName}
                        </Link>
                      }
                      secondary={`${formatQuantity(reservation.quantityOutstanding)} ${reservation.unit} outstanding for ${reservation.jobNumber} ${reservation.jobName}`}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>

          <Paper variant="outlined">
            <Typography variant="h3" component="h2" sx={{ px: 2.5, py: 2 }}>
              Recent activity
            </Typography>
            <Divider />
            {data.recentTransactions.length === 0 ? (
              <Box sx={{ px: 2.5, py: 3 }}>
                <Typography color="text.secondary">
                  Nothing has happened yet. Receive some stock and it will appear here, with who did
                  it and when.
                </Typography>
              </Box>
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
                          <Chip label={transaction.kind} size="small" variant="outlined" />
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
          </Paper>
        </Stack>
      )}
    </Box>
  );
}
