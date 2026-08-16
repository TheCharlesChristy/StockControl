import QrCodeScannerRounded from "@mui/icons-material/QrCodeScannerRounded";
import { Fab, Tooltip } from "@mui/material";
import { lazy, Suspense, useState, type ReactElement } from "react";

/*
 * The decoder is a large dependency and most sessions never open it, so it
 * loads the first time somebody presses the button rather than on every page.
 */
const ScanSheet = lazy(async () => {
  const module = await import("../features/scan/ScanSheet");

  return { default: module.ScanSheet };
});

/**
 * Always within thumb reach, on every screen and for every role. Pointing a
 * phone at an item is the fastest way into it when you are stood in front of
 * it — to read the record, to put stock in, or to ask what the thing even is.
 * All three start here, which is why there is one button and not three.
 */
export function ScanFab(): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip title="Scan, type or photograph an item">
        <Fab
          color="primary"
          aria-label="Scan an item"
          data-help-target="scan-item"
          className="no-print"
          onClick={() => setOpen(true)}
          sx={{
            position: "fixed",
            right: { xs: 16, sm: 24 },
            bottom: { xs: 16, sm: 24 },
            zIndex: (theme) => theme.zIndex.appBar,
          }}
        >
          <QrCodeScannerRounded />
        </Fab>
      </Tooltip>

      {open && (
        <Suspense fallback={null}>
          <ScanSheet open onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
