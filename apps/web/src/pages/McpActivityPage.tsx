import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import type { McpActivityQuery, McpToolCallOutcome } from "@stockcontrol/contracts";
import { useCallback, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";

import { useApi, useResource } from "../api/ApiContext";
import {
  EmptyState,
  ErrorState,
  formatDateTime,
  LoadingRows,
  PageHeader,
} from "../components/DataStates";

const PAGE_SIZE = 50;
const outcomes: readonly (McpToolCallOutcome | "Incomplete")[] = [
  "Succeeded",
  "Denied",
  "Failed",
  "Interrupted",
  "Incomplete",
];

export function McpActivityPage(): ReactElement {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const tool = params.get("tool") ?? "";
  const outcome = params.get("outcome") ?? "";
  const operation = params.get("operation") ?? "";

  const setFilter = (key: string, value: string): void => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value.length === 0) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  const query = useCallback(
    (): McpActivityQuery => ({
      ...(tool.length > 0 ? { tool } : {}),
      ...(outcome.length > 0 && outcomes.includes(outcome as McpToolCallOutcome | "Incomplete")
        ? { outcome: outcome as McpToolCallOutcome | "Incomplete" }
        : {}),
      ...(operation === "read" || operation === "write" ? { operation } : {}),
      limit: PAGE_SIZE,
      offset: 0,
    }),
    [operation, outcome, tool],
  );
  const activity = useResource((signal) => api.listMcpActivity(query(), signal));
  const connections = useResource((signal) => api.listMcpConnections(signal));

  return (
    <Box>
      <PageHeader
        eyebrow="Via ChatGPT"
        title="ChatGPT activity"
        description="Every MCP tool call is retained with sanitized arguments, its result, and any linked StockControl record. Incomplete calls remain visible for reconciliation."
      />
      <Paper variant="outlined" sx={{ p: 2, mb: 2.5 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField
            label="Tool"
            value={tool}
            onChange={(event) => setFilter("tool", event.target.value)}
            size="small"
            placeholder="e.g. get_item"
            sx={{ minWidth: 220 }}
          />
          <TextField
            select
            label="Result"
            value={outcome}
            onChange={(event) => setFilter("outcome", event.target.value)}
            size="small"
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">Any result</MenuItem>
            {outcomes.map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Kind"
            value={operation}
            onChange={(event) => setFilter("operation", event.target.value)}
            size="small"
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="">Read and write</MenuItem>
            <MenuItem value="read">Read</MenuItem>
            <MenuItem value="write">Write</MenuItem>
          </TextField>
        </Stack>
      </Paper>
      {activity.status === "error" && activity.error !== undefined && (
        <ErrorState error={activity.error} onRetry={activity.reload} />
      )}
      {activity.status === "loading" && activity.data === undefined && <LoadingRows rows={8} />}
      {activity.data !== undefined && activity.data.rows.length === 0 && (
        <EmptyState
          title="No ChatGPT activity matches"
          description="Try clearing one of the filters."
        />
      )}
      {activity.data !== undefined && activity.data.rows.length > 0 && (
        <Paper variant="outlined">
          <TableContainer>
            <Table aria-label="ChatGPT activity">
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Tool</TableCell>
                  <TableCell>Result</TableCell>
                  <TableCell>Arguments</TableCell>
                  <TableCell>Effects</TableCell>
                  <TableCell>Who</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {activity.data.rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(row.receivedAt)}
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight={750}>{row.toolName}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.operation} · v{row.contractVersion}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={row.outcome}
                        color={
                          row.outcome === "Succeeded"
                            ? "success"
                            : row.outcome === "Incomplete"
                              ? "warning"
                              : "default"
                        }
                        variant="outlined"
                      />
                      {row.failureCode !== null && (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {row.failureCode}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Typography
                        variant="body2"
                        sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                      >
                        {row.actionSummary === null
                          ? JSON.stringify(row.arguments)
                          : `${row.actionSummary} · ${JSON.stringify(row.arguments)}`}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {row.effectLinks.length === 0
                        ? "—"
                        : row.effectLinks.map((effect) => (
                            <Typography key={`${effect.type}-${effect.id}`} variant="body2">
                              {effect.type}: {effect.id}
                            </Typography>
                          ))}
                    </TableCell>
                    <TableCell>{row.actorName ?? "Unauthenticated"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
      <Paper variant="outlined" sx={{ mt: 2.5, p: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          ChatGPT connections
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Revoking a connection takes effect immediately.
        </Typography>
        <Stack spacing={1}>
          {(connections.data?.connections ?? []).map((connection) => (
            <Stack
              key={connection.id}
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              alignItems={{ sm: "center" }}
              justifyContent="space-between"
            >
              <Typography variant="body2">
                {connection.clientId} · {connection.scopes.join(", ")}{" "}
                {connection.revokedAt === null ? "" : "· revoked"}
              </Typography>
              {connection.revokedAt === null && (
                <Button
                  size="small"
                  color="error"
                  onClick={() => {
                    void api.revokeMcpConnection(connection.id).then(connections.reload);
                  }}
                >
                  Revoke
                </Button>
              )}
            </Stack>
          ))}
          {connections.data?.connections.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No connections.
            </Typography>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
