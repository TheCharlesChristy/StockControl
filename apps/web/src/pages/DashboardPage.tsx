import InventoryRounded from "@mui/icons-material/InventoryRounded";
import QrCodeScannerRounded from "@mui/icons-material/QrCodeScannerRounded";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useAuth, type UserRole } from "../auth/AuthContext";

interface DashboardMetric {
  readonly label: string;
  readonly context: string;
  readonly tone: "primary" | "secondary" | "warning";
}

interface DashboardConfiguration {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly metrics: readonly DashboardMetric[];
}

const dashboardByRole: Record<UserRole, DashboardConfiguration> = {
  Engineer: {
    eyebrow: "Field workspace",
    title: "Your stock, jobs and collections",
    description:
      "Everything assigned to you is kept close at hand, with accountable actions one scan away.",
    metrics: [
      {
        label: "Ready to collect",
        context: "Shown when approved reservations are connected.",
        tone: "primary",
      },
      {
        label: "In your custody",
        context: "Shown when user assignments are connected.",
        tone: "secondary",
      },
      {
        label: "Needs attention",
        context: "Shown when return dates and exceptions are connected.",
        tone: "warning",
      },
    ],
  },
  Office: {
    eyebrow: "Operations desk",
    title: "Keep stock moving without surprises",
    description:
      "Approvals, shortages and inbound deliveries are arranged around today’s operational priorities.",
    metrics: [
      {
        label: "Pending approvals",
        context: "Shown when reservation and order requests are connected.",
        tone: "primary",
      },
      {
        label: "Incoming today",
        context: "Shown when expected deliveries are connected.",
        tone: "secondary",
      },
      {
        label: "Stock exceptions",
        context: "Shown when live stock rules and holdings are connected.",
        tone: "warning",
      },
    ],
  },
  Admin: {
    eyebrow: "Control tower",
    title: "Inventory command centre",
    description:
      "See operational health, accountable exceptions and the controls that keep every stock movement dependable.",
    metrics: [
      {
        label: "Stock accuracy",
        context: "Calculated from completed stocktakes once live data is connected.",
        tone: "primary",
      },
      {
        label: "Inventory value",
        context: "Calculated from priced holdings once live data is connected.",
        tone: "secondary",
      },
      {
        label: "Critical exceptions",
        context: "Shown when inventory rules and exception handling are connected.",
        tone: "warning",
      },
    ],
  },
};

const metricTone = {
  primary: {
    background: "#DDF1EE",
    foreground: "#075254",
  },
  secondary: {
    background: "#FFF0DC",
    foreground: "#8B4A11",
  },
  warning: {
    background: "#FDE8E7",
    foreground: "#9C241B",
  },
} as const;

export function DashboardPage(): ReactElement | null {
  const { user } = useAuth();

  if (user === null) {
    return null;
  }

  const dashboard = dashboardByRole[user.role];

  return (
    <Stack spacing={{ xs: 3, md: 4 }}>
      <Paper
        component="section"
        aria-labelledby="dashboard-heading"
        elevation={0}
        sx={{
          position: "relative",
          overflow: "hidden",
          p: { xs: 3, sm: 4.5, md: 5 },
          color: "#FFFFFF",
          background: "linear-gradient(125deg, #0B3437 0%, #0C5D60 62%, #127978 100%)",
          boxShadow: "0 24px 50px rgba(9, 62, 64, 0.16)",
          "&::after": {
            content: '""',
            position: "absolute",
            top: -115,
            right: -65,
            width: 300,
            height: 300,
            borderRadius: "50%",
            border: "58px solid rgba(255,255,255,0.06)",
          },
        }}
      >
        <Box sx={{ position: "relative", zIndex: 1, maxWidth: 850 }}>
          <Typography variant="overline" sx={{ color: "#91DFD2" }}>
            {dashboard.eyebrow}
          </Typography>
          <Typography
            id="dashboard-heading"
            component="h1"
            variant="h2"
            sx={{ mt: 0.5, color: "#FFFFFF" }}
          >
            {dashboard.title}
          </Typography>
          <Typography
            sx={{
              mt: 1.5,
              maxWidth: 720,
              color: "rgba(255,255,255,0.74)",
              lineHeight: 1.7,
            }}
          >
            {dashboard.description}
          </Typography>
          <Chip
            label="Interface preview: no live stock data"
            size="small"
            sx={{
              mt: 2.5,
              color: "#FFFFFF",
              bgcolor: "rgba(255,255,255,0.11)",
              border: "1px solid rgba(255,255,255,0.18)",
            }}
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 3 }}>
            <Button
              component={RouterLink}
              to="/scan"
              variant="contained"
              color="secondary"
              startIcon={<QrCodeScannerRounded />}
            >
              Scan stock
            </Button>
            <Button
              component={RouterLink}
              to="/inventory"
              variant="outlined"
              startIcon={<InventoryRounded />}
              sx={{
                color: "#FFFFFF",
                borderColor: "rgba(255,255,255,0.4)",
                "&:hover": {
                  borderColor: "#FFFFFF",
                  bgcolor: "rgba(255,255,255,0.08)",
                },
              }}
            >
              Open inventory
            </Button>
          </Stack>
        </Box>
      </Paper>

      <Box
        component="section"
        aria-label="Operational metric placeholders"
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(3, minmax(0, 1fr))",
          },
          gap: 2,
        }}
      >
        {dashboard.metrics.map((metric) => {
          const tone = metricTone[metric.tone];

          return (
            <Card key={metric.label}>
              <CardContent sx={{ p: 2.75, "&:last-child": { pb: 2.75 } }}>
                <Stack
                  direction="row"
                  alignItems="flex-start"
                  justifyContent="space-between"
                  spacing={2}
                >
                  <Box>
                    <Typography color="text.secondary" fontSize="0.82rem" fontWeight={750}>
                      {metric.label}
                    </Typography>
                    <Typography
                      component="p"
                      sx={{
                        mt: 0.75,
                        color: "text.primary",
                        fontSize: "clamp(1.75rem, 4vw, 2.4rem)",
                        fontWeight: 820,
                        letterSpacing: "-0.04em",
                        lineHeight: 1,
                      }}
                    >
                      —
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      width: 38,
                      height: 38,
                      display: "grid",
                      placeItems: "center",
                      borderRadius: 2,
                      color: tone.foreground,
                      bgcolor: tone.background,
                    }}
                  >
                    {metric.tone === "warning" ? (
                      <WarningAmberRounded fontSize="small" aria-hidden="true" />
                    ) : (
                      <InventoryRounded fontSize="small" aria-hidden="true" />
                    )}
                  </Box>
                </Stack>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 1.5 }}
                >
                  {metric.context}
                </Typography>
              </CardContent>
            </Card>
          );
        })}
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.55fr) minmax(300px, 0.75fr)" },
          gap: 2,
        }}
      >
        <Paper
          component="section"
          aria-labelledby="priority-heading"
          variant="outlined"
          sx={{ p: { xs: 2.5, sm: 3 } }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Box>
              <Typography id="priority-heading" component="h2" variant="h3">
                Priority queue
              </Typography>
              <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
                Work that is ready for your role.
              </Typography>
            </Box>
            <Chip label="No live data" size="small" color="primary" variant="outlined" />
          </Stack>
          <Divider sx={{ my: 2.5 }} />
          <Stack
            alignItems="center"
            spacing={1.25}
            sx={{
              py: { xs: 4, sm: 5 },
              px: 2,
              textAlign: "center",
              bgcolor: "background.default",
              borderRadius: 2.5,
              border: "1px dashed",
              borderColor: "divider",
            }}
          >
            <Box
              sx={{
                width: 44,
                height: 44,
                display: "grid",
                placeItems: "center",
                color: "primary.main",
                bgcolor: "primary.light",
                borderRadius: 2.5,
              }}
            >
              <InventoryRounded aria-hidden="true" />
            </Box>
            <Typography component="h3" variant="h5">
              Task data is not connected
            </Typography>
            <Typography color="text.secondary" variant="body2" sx={{ maxWidth: 470 }}>
              Role-aware approvals, collections and exceptions will appear here when the inventory
              service is available.
            </Typography>
          </Stack>
        </Paper>

        <Paper
          component="section"
          aria-labelledby="readiness-heading"
          variant="outlined"
          sx={{
            p: { xs: 2.5, sm: 3 },
            background: "linear-gradient(155deg, #FFFFFF 0%, #F1F8F6 100%)",
          }}
        >
          <Typography id="readiness-heading" component="h2" variant="h3">
            Preview scope
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 0.75, lineHeight: 1.6 }}>
            This screen demonstrates the application shell and contains no operational stock,
            purchasing or backup data.
          </Typography>
          <Chip label="Interface only" size="small" color="secondary" sx={{ mt: 2.5 }} />
          <Stack spacing={1.25} sx={{ mt: 3 }}>
            {[
              "Responsive navigation",
              "Role-aware workspace",
              "Accessible route states",
              "Test-ready application shell",
            ].map((item) => (
              <Stack key={item} direction="row" spacing={1} alignItems="center">
                <Box
                  aria-hidden="true"
                  sx={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    bgcolor: "success.main",
                  }}
                />
                <Typography variant="body2">{item}</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      </Box>
    </Stack>
  );
}
