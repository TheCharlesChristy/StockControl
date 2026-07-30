import ErrorOutlineRounded from "@mui/icons-material/ErrorOutlineRounded";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { Component, type ReactElement, type ReactNode } from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";

interface BoundaryFallbackProps {
  readonly onRetry: () => void;
}

interface ResettableErrorBoundaryProps {
  readonly children: ReactNode;
  readonly renderFallback: (props: BoundaryFallbackProps) => ReactNode;
  readonly resetKey?: string;
}

interface ResettableErrorBoundaryState {
  readonly hasError: boolean;
}

class ResettableErrorBoundary extends Component<
  ResettableErrorBoundaryProps,
  ResettableErrorBoundaryState
> {
  public override state: ResettableErrorBoundaryState = {
    hasError: false,
  };

  public static getDerivedStateFromError(): ResettableErrorBoundaryState {
    return { hasError: true };
  }

  public override componentDidUpdate(previousProps: ResettableErrorBoundaryProps): void {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  private readonly handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      return this.props.renderFallback({ onRetry: this.handleRetry });
    }

    return this.props.children;
  }
}

function ErrorPanel({
  eyebrow,
  title,
  description,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly actions: ReactNode;
}): ReactElement {
  return (
    <Box
      component="main"
      id="main-content"
      tabIndex={-1}
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        p: 3,
        bgcolor: "background.default",
      }}
    >
      <Paper
        role="alert"
        aria-live="assertive"
        variant="outlined"
        sx={{
          width: "100%",
          maxWidth: 660,
          p: { xs: 3, sm: 5 },
          background: "linear-gradient(155deg, rgba(255,255,255,1) 0%, rgba(244,249,247,1) 100%)",
        }}
      >
        <Stack spacing={2.25} alignItems="flex-start">
          <Box
            sx={{
              display: "grid",
              placeItems: "center",
              width: 48,
              height: 48,
              color: "error.main",
              bgcolor: "error.light",
              borderRadius: 2.5,
            }}
          >
            <ErrorOutlineRounded aria-hidden="true" />
          </Box>
          <Box>
            <Typography variant="overline" color="error.main">
              {eyebrow}
            </Typography>
            <Typography component="h1" variant="h2" sx={{ mt: 0.5 }}>
              {title}
            </Typography>
          </Box>
          <Typography color="text.secondary" sx={{ maxWidth: 560, lineHeight: 1.7 }}>
            {description}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
            {actions}
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}

function ApplicationErrorFallback({ onRetry }: BoundaryFallbackProps): ReactElement {
  return (
    <ErrorPanel
      eyebrow="Application error"
      title="StockControl could not start"
      description="The application encountered an unexpected problem. Try starting it again. If the problem continues, contact your administrator."
      actions={
        <Button variant="contained" startIcon={<RefreshRounded />} onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}

function RouteErrorFallback({ onRetry }: BoundaryFallbackProps): ReactElement {
  return (
    <ErrorPanel
      eyebrow="Unexpected page error"
      title="This page could not be displayed"
      description="Something unexpected interrupted this page. You can retry it or return to the overview."
      actions={
        <>
          <Button variant="contained" startIcon={<RefreshRounded />} onClick={onRetry}>
            Retry page
          </Button>
          <Button component={RouterLink} to="/dashboard" variant="outlined">
            Return to overview
          </Button>
        </>
      }
    />
  );
}

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

export function ApplicationErrorBoundary({ children }: ErrorBoundaryProps): ReactElement {
  return (
    <ResettableErrorBoundary renderFallback={(props) => <ApplicationErrorFallback {...props} />}>
      {children}
    </ResettableErrorBoundary>
  );
}

export function RouteErrorBoundary({ children }: ErrorBoundaryProps): ReactElement {
  const location = useLocation();

  return (
    <ResettableErrorBoundary
      resetKey={`${location.pathname}${location.search}`}
      renderFallback={(props) => <RouteErrorFallback {...props} />}
    >
      {children}
    </ResettableErrorBoundary>
  );
}
