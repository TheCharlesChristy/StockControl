import BugReportRounded from "@mui/icons-material/BugReportRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import MenuRounded from "@mui/icons-material/MenuRounded";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useCallback, useState, type ReactElement } from "react";
import { Link as RouterLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useApi, useResource } from "../api/ApiContext";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { ImagePreview } from "../components/ImagePreview";
import { PageHelp } from "../components/PageHelp";
import { ReportIssueDialog } from "../components/ReportIssueDialog";
import { ScanFab } from "../components/ScanFab";
import { navigationForUser, navigationItems } from "../navigation";

const drawerWidth = 272;
const primaryNavigationPaths = new Set(["/dashboard", "/inventory", "/jobs", "/requests"]);

function initials(displayName: string): string {
  return displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function AppShell(): ReactElement | null {
  const api = useApi();
  const { user, features, signOut } = useAuth();
  const theme = useTheme();
  const desktopNavigation = useMediaQuery(theme.breakpoints.up("md"));
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const loadIssueReporting = useCallback(
    (signal: AbortSignal) => api.issueReportingConfiguration(signal),
    [api],
  );
  const issueReporting = useResource(loadIssueReporting);
  const issueReportingEnabled = issueReporting.data?.enabled === true;

  if (user === null) {
    return null;
  }

  /*
   * Signing out clears the remembered location as well as the session, so the
   * next sign-in starts at the dashboard rather than resuming wherever the last
   * person happened to stop.
   */
  const handleSignOut = (): void => {
    void signOut().finally(() => {
      void navigate("/sign-in", { replace: true, state: null });
    });
  };

  const roleNavigation = navigationForUser(user, features);
  const primaryNavigation = roleNavigation.filter((item) => primaryNavigationPaths.has(item.path));
  const secondaryNavigation = roleNavigation.filter(
    (item) => !primaryNavigationPaths.has(item.path),
  );
  const isLocationWorkspace = location.pathname === "/locations";
  /*
   * Longest matching prefix, so a detail route such as /inventory/:id still
   * names its section rather than falling back to the product name.
   */
  const currentNavigationItem = navigationItems
    .filter(
      (item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`),
    )
    .sort((left, right) => right.path.length - left.path.length)[0];
  const pageTitle = currentNavigationItem?.label ?? "StockControl";

  const renderNavigation = (items: typeof roleNavigation): ReactElement[] =>
    items.map((item) => {
      const Icon = item.icon;

      return (
        /*
         * `describeChild` matters: without it MUI makes the tooltip the
         * link's accessible name, so screen readers would announce the
         * description instead of the section it leads to.
         */
        <Tooltip key={item.path} title={item.description} placement="right" describeChild>
          <ListItemButton
            component={RouterLink}
            to={item.path}
            selected={
              location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
            }
            onClick={() => setMobileNavigationOpen(false)}
            sx={{
              mb: 0.5,
              color: "rgba(255,255,255,0.72)",
              "& .MuiListItemIcon-root": {
                color: "inherit",
              },
              "&:hover": {
                color: "#FFFFFF",
                bgcolor: "rgba(255,255,255,0.08)",
              },
              "&.Mui-selected": {
                color: "#FFFFFF",
                bgcolor: "rgba(234, 240, 252, 0.14)",
                boxShadow: "inset 3px 0 0 #FFFFFF",
                "&:hover": {
                  bgcolor: "rgba(234, 240, 252, 0.2)",
                },
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={item.label}
              slotProps={{
                primary: {
                  fontSize: "0.9rem",
                  fontWeight: 700,
                },
              }}
            />
          </ListItemButton>
        </Tooltip>
      );
    });

  const drawerContent = (
    <Stack sx={{ height: "100%" }} aria-label="Primary navigation">
      <Box sx={{ px: 2.5, pt: 2.75, pb: 2.25 }}>
        <Brand inverse />
      </Box>
      <Divider sx={{ borderColor: "rgba(255,255,255,0.1)" }} />
      <List
        component="nav"
        aria-label="Workspace"
        sx={{
          flex: 1,
          px: 1.5,
          py: 2,
          overflowY: "auto",
        }}
      >
        {renderNavigation(primaryNavigation)}
        {secondaryNavigation.length > 0 && (
          <>
            <ListSubheader
              component="div"
              sx={{
                px: 1.5,
                pt: 2,
                pb: 0.75,
                color: "rgba(255,255,255,0.5)",
                bgcolor: "transparent",
                fontSize: "0.7rem",
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              More
            </ListSubheader>
            {renderNavigation(secondaryNavigation)}
          </>
        )}
      </List>
      <Box sx={{ p: 1.5 }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.25}
          sx={{
            p: 1.25,
            borderRadius: 2,
            bgcolor: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.09)",
          }}
        >
          <ImagePreview src={user.profilePhotoUrl} alt={`${user.displayName} profile photo`}>
            <Avatar
              src={user.profilePhotoUrl ?? undefined}
              alt={`${user.displayName} profile photo`}
              sx={{
                width: 38,
                height: 38,
                color: "primary.dark",
                bgcolor: "primary.light",
                fontSize: "0.85rem",
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              {initials(user.displayName)}
            </Avatar>
          </ImagePreview>
          {/* Named so the two lines are announced as one fact, not two stray strings. */}
          <Box role="group" aria-label="Signed in as" sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap sx={{ color: "#FFFFFF", fontSize: "0.84rem", fontWeight: 750 }}>
              {user.displayName}
            </Typography>
            <Typography noWrap variant="caption" sx={{ color: "rgba(255,255,255,0.6)" }}>
              {user.role}
            </Typography>
          </Box>
          <Tooltip title="Sign out">
            <IconButton
              size="small"
              onClick={handleSignOut}
              aria-label="Sign out"
              sx={{ color: "rgba(255,255,255,0.72)" }}
            >
              <LogoutRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>
    </Stack>
  );

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Box
        component="a"
        href="#main-content"
        sx={{
          position: "fixed",
          zIndex: theme.zIndex.modal + 1,
          top: 8,
          left: 8,
          px: 2,
          py: 1,
          color: "#FFFFFF",
          bgcolor: "primary.dark",
          borderRadius: 1,
          transform: "translateY(-150%)",
          transition: "transform 120ms ease",
          "&:focus": {
            transform: "translateY(0)",
          },
        }}
      >
        Skip to main content
      </Box>

      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(12px)",
        }}
      >
        <Toolbar sx={{ minHeight: { xs: 64, sm: 70 } }}>
          {!desktopNavigation && (
            <IconButton
              edge="start"
              onClick={() => setMobileNavigationOpen(true)}
              aria-label="Open navigation"
              aria-controls="mobile-navigation"
              aria-expanded={mobileNavigationOpen}
              sx={{ mr: 1.5 }}
            >
              <MenuRounded />
            </IconButton>
          )}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: "block",
                fontWeight: 750,
                letterSpacing: "0.04em",
              }}
            >
              StockControl
            </Typography>
            <Typography noWrap component="p" sx={{ fontWeight: 800, lineHeight: 1.25 }}>
              {pageTitle}
            </Typography>
          </Box>
          <Stack direction="row" spacing={{ xs: 0.75, sm: 1.5 }} alignItems="center">
            <PageHelp path={location.pathname} role={user.role} />
            {issueReportingEnabled && (
              <Button
                variant="outlined"
                color="primary"
                size="small"
                aria-label="Report an issue"
                startIcon={<BugReportRounded fontSize="small" />}
                onClick={() => setReportIssueOpen(true)}
                sx={{
                  minWidth: { xs: 40, sm: 0 },
                  minHeight: 40,
                  px: { xs: 1, sm: 1.5 },
                  "& .MuiButton-startIcon": { mr: { xs: 0, sm: 0.75 } },
                }}
              >
                <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                  Report an issue
                </Box>
              </Button>
            )}
            <Chip
              label={user.role}
              color={user.role === "Admin" ? "secondary" : "primary"}
              variant="outlined"
              size="small"
            />
          </Stack>
        </Toolbar>
      </AppBar>

      <Drawer
        id="mobile-navigation"
        variant={desktopNavigation ? "permanent" : "temporary"}
        open={desktopNavigation || mobileNavigationOpen}
        onClose={() => setMobileNavigationOpen(false)}
        ModalProps={{ keepMounted: true }}
        slotProps={{
          paper: {
            sx: {
              width: drawerWidth,
              color: "#FFFFFF",
              borderRight: 0,
              bgcolor: "#071B3A",
            },
          },
        }}
      >
        {drawerContent}
      </Drawer>

      <Box
        component="main"
        id="main-content"
        tabIndex={-1}
        sx={{
          minHeight: "100vh",
          height: isLocationWorkspace ? "100dvh" : undefined,
          ml: { md: `${drawerWidth}px` },
          pt: { xs: "64px", sm: "70px" },
          overflow: isLocationWorkspace ? { xs: "auto", lg: "hidden" } : undefined,
          backgroundImage:
            "radial-gradient(circle at 95% 2%, rgba(0,48,157,0.06), transparent 28%)",
        }}
      >
        <Box
          sx={{
            width: "100%",
            maxWidth: 1480,
            mx: "auto",
            px: { xs: 2, sm: 3, lg: 4 },
            py: isLocationWorkspace ? { xs: 1.5, md: 2 } : { xs: 2.5, md: 4 },
            /*
             * The scan button floats over the bottom-right corner. Without this
             * it lands on the last row of a long table — the one you scrolled
             * all the way down to read.
             */
            pb: isLocationWorkspace ? { xs: 1.5, md: 2 } : { xs: 12, md: 12 },
            height: isLocationWorkspace ? "100%" : undefined,
            display: isLocationWorkspace ? "flex" : undefined,
            flexDirection: isLocationWorkspace ? "column" : undefined,
            boxSizing: "border-box",
          }}
        >
          <Outlet />
        </Box>
      </Box>

      {!isLocationWorkspace && <ScanFab />}
      {issueReportingEnabled && reportIssueOpen && (
        <ReportIssueDialog page={location.pathname} onClose={() => setReportIssueOpen(false)} />
      )}
    </Box>
  );
}
