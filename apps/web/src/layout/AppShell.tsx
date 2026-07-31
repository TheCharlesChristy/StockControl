import LogoutRounded from "@mui/icons-material/LogoutRounded";
import MenuRounded from "@mui/icons-material/MenuRounded";
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useState, type ReactElement } from "react";
import { Link as RouterLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { ScanFab } from "../components/ScanFab";
import { navigationForUser, navigationItems } from "../navigation";

const drawerWidth = 272;

function initials(displayName: string): string {
  return displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function AppShell(): ReactElement | null {
  const { user, signOut } = useAuth();
  const theme = useTheme();
  const desktopNavigation = useMediaQuery(theme.breakpoints.up("md"));
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

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

  const roleNavigation = navigationForUser(user);
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

  const drawerContent = (
    <Stack sx={{ height: "100%" }} aria-label="Primary navigation">
      <Box sx={{ px: 2.5, pt: 2.75, pb: 2.25 }}>
        <Brand inverse />
        <Chip
          label="Demo installation"
          size="small"
          sx={{
            mt: 2.5,
            color: "rgba(255,255,255,0.88)",
            bgcolor: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        />
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
        {roleNavigation.map((item) => {
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
                selected={location.pathname === item.path}
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
                    bgcolor: "rgba(99, 210, 192, 0.17)",
                    boxShadow: "inset 3px 0 0 #72D7C7",
                    "&:hover": {
                      bgcolor: "rgba(99, 210, 192, 0.22)",
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
        })}
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
          <Avatar
            sx={{
              width: 38,
              height: 38,
              color: "#093E40",
              bgcolor: "#A6E2D8",
              fontSize: "0.85rem",
              fontWeight: 800,
            }}
          >
            {initials(user.displayName)}
          </Avatar>
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
              STOCKCONTROL
            </Typography>
            <Typography noWrap component="p" sx={{ fontWeight: 800, lineHeight: 1.25 }}>
              {pageTitle}
            </Typography>
          </Box>
          <Chip
            label={user.role}
            color={user.role === "Admin" ? "secondary" : "primary"}
            variant="outlined"
            size="small"
          />
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
              bgcolor: "#0B3033",
              backgroundImage: "linear-gradient(180deg, rgba(15,76,78,0.72), rgba(7,36,39,0.96))",
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
          ml: { md: `${drawerWidth}px` },
          pt: { xs: "64px", sm: "70px" },
          backgroundImage:
            "radial-gradient(circle at 95% 2%, rgba(11,102,104,0.08), transparent 28%)",
        }}
      >
        <Box
          sx={{
            width: "100%",
            maxWidth: 1480,
            mx: "auto",
            px: { xs: 2, sm: 3, lg: 4 },
            py: { xs: 2.5, md: 4 },
          }}
        >
          <Outlet />
        </Box>
      </Box>

      <ScanFab />
    </Box>
  );
}
