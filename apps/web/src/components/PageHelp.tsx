import CloseRounded from "@mui/icons-material/CloseRounded";
import HelpOutlineRounded from "@mui/icons-material/HelpOutlineRounded";
import {
  Box,
  Button,
  GlobalStyles,
  IconButton,
  LinearProgress,
  Paper,
  Portal,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import type { UserRole } from "@stockcontrol/contracts";
import { useEffect, useState, type ReactElement } from "react";

import { pageHelpFor } from "./page-help-content";

function bringIntoView(element: HTMLElement): void {
  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
}

function focusableWithin(element: HTMLElement): HTMLElement | null {
  const selector =
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return element.matches(selector) ? element : element.querySelector<HTMLElement>(selector);
}

interface PageHelpProps {
  readonly path: string;
  readonly role?: UserRole | undefined;
}

/** A small, route-aware walkthrough for the page currently on screen. */
export function PageHelp({ path, role }: PageHelpProps): ReactElement {
  const help = pageHelpFor(path, role);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const currentStepIndex = Math.min(stepIndex, help.steps.length - 1);
  const step = help.steps[currentStepIndex] ?? help.steps[0] ?? { title: "Help", body: help.intro };
  const isLastStep = currentStepIndex === help.steps.length - 1;
  const targetElement =
    open && step.target !== undefined && typeof document !== "undefined"
      ? document.querySelector(step.target)
      : null;
  const focusableTarget =
    targetElement instanceof HTMLElement ? focusableWithin(targetElement) : null;

  useEffect(() => {
    if (!open || step.target === undefined || typeof document === "undefined") return undefined;

    const element = document.querySelector(step.target);
    if (element === null) return undefined;

    element.classList.add("page-help-highlight");
    if (element instanceof HTMLElement) bringIntoView(element);

    return () => {
      element.classList.remove("page-help-highlight");
    };
  }, [open, step.target]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    setStepIndex(0);
  };

  const focusTarget = (): void => {
    if (!(targetElement instanceof HTMLElement)) return;
    bringIntoView(targetElement);
    focusableTarget?.focus({ preventScroll: true });
  };

  return (
    <>
      <GlobalStyles
        styles={{
          ".page-help-highlight": {
            outline: "3px solid #F59E0B",
            outlineOffset: "4px",
            boxShadow: "0 0 0 8px rgba(245, 158, 11, 0.18)",
            borderRadius: "4px",
            scrollMarginTop: "84px",
            scrollMarginBottom: "calc(70dvh + 32px)",
          },
        }}
      />
      <Tooltip title="How to use this page" describeChild>
        <IconButton
          size="small"
          aria-label="How to use this page"
          onClick={() => {
            setStepIndex(0);
            setOpen(true);
          }}
          sx={{ minWidth: 40, minHeight: 40, color: "primary.main" }}
        >
          <HelpOutlineRounded fontSize="small" />
        </IconButton>
      </Tooltip>

      {open && (
        <Portal>
          <Box
            component="section"
            role="dialog"
            aria-modal="false"
            aria-labelledby="page-help-title"
            aria-describedby="page-help-step"
            sx={{
              position: "fixed",
              top: "auto",
              left: { xs: 12, sm: "50%" },
              right: { xs: 12, sm: "auto" },
              bottom: 12,
              zIndex: (theme) => theme.zIndex.modal,
              width: { xs: "auto", sm: "min(560px, calc(100vw - 48px))" },
              height: "auto",
              maxHeight: "70dvh",
              transform: { xs: "none", sm: "translateX(-50%)" },
              overflowY: "auto",
            }}
          >
            <Paper
              elevation={12}
              sx={{
                minHeight: 0,
                borderRadius: 2,
                overflow: "hidden",
                border: "1px solid",
                borderColor: "primary.light",
              }}
            >
              <Stack
                direction="row"
                alignItems="flex-start"
                justifyContent="space-between"
                sx={{ p: 2.5, pb: 1.5 }}
              >
                <Box sx={{ pr: 5 }}>
                  <Typography component="h2" variant="h3" id="page-help-title">
                    {help.title} Step {String(currentStepIndex + 1)} of {String(help.steps.length)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Follow the highlighted control, then continue when you are ready.
                  </Typography>
                </Box>
                <IconButton
                  aria-label="Close page help"
                  onClick={close}
                  sx={{ mt: -0.75, mr: -0.75 }}
                >
                  <CloseRounded />
                </IconButton>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={((currentStepIndex + 1) / help.steps.length) * 100}
                aria-label={`Page help progress: step ${String(currentStepIndex + 1)} of ${String(help.steps.length)}`}
              />
              <Box sx={{ p: 2.5 }}>
                <Stack spacing={2}>
                  {step.targetLabel !== undefined && (
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: 1.5,
                        bgcolor: "warning.50",
                        border: "1px solid",
                        borderColor: "warning.light",
                      }}
                    >
                      <Typography variant="overline" color="warning.dark" sx={{ fontWeight: 800 }}>
                        Look here
                      </Typography>
                      <Typography fontWeight={750}>{step.targetLabel}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Try this control on the page while the guide stays open.
                      </Typography>
                      {targetElement !== null && (
                        <Button size="small" onClick={focusTarget} sx={{ mt: 0.5, px: 0 }}>
                          {focusableTarget === null ? "Show on page" : "Focus this control"}
                        </Button>
                      )}
                    </Box>
                  )}
                  <Box>
                    <Typography component="h3" variant="h3" sx={{ mb: 1 }}>
                      {step.title}
                    </Typography>
                    <Typography id="page-help-step">{step.body}</Typography>
                  </Box>
                </Stack>
              </Box>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ px: 2.5, py: 2, borderTop: "1px solid", borderColor: "divider" }}
              >
                <Button onClick={close}>Close</Button>
                <Box sx={{ flex: 1 }} />
                <Button
                  onClick={() => setStepIndex(Math.max(0, currentStepIndex - 1))}
                  disabled={currentStepIndex === 0}
                >
                  Back
                </Button>
                <Button
                  variant="contained"
                  onClick={isLastStep ? close : () => setStepIndex(currentStepIndex + 1)}
                >
                  {isLastStep ? "Finish" : "Next"}
                </Button>
              </Stack>
            </Paper>
          </Box>
        </Portal>
      )}
    </>
  );
}
