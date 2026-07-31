import QrCodeScannerRounded from "@mui/icons-material/QrCodeScannerRounded";
import { Fab, Tooltip } from "@mui/material";
import { lazy, Suspense, useState, type ReactElement } from "react";

/*
 * The decoder is a large dependency and most sessions never open it, so it
 * loads the first time somebody presses the button rather than on every page.
 */
const ScanDialog = lazy(async () => {
  const module = await import("./ScanDialog");

  return { default: module.ScanDialog };
});

/**
 * Always within thumb reach, on every screen and for every role. Scanning a
 * label is the fastest way into an item when you are stood in front of it,
 * which is exactly when a phone is the device to hand.
 */
export function ScanFab(): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip title="Scan a QR code or barcode">
        <Fab
          color="primary"
          aria-label="Scan a QR code or barcode"
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
          <ScanDialog open onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
