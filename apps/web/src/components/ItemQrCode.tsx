import { Box, Skeleton, Typography } from "@mui/material";
import QRCode from "qrcode";
import { useEffect, useState, type ReactElement } from "react";

interface ItemQrCodeProps {
  readonly reference: string;
  readonly url: string;
  readonly size?: number;
  readonly showReference?: boolean;
}

/**
 * A QR code carrying the item's own URL. Scanning it with any phone camera
 * opens this page; if the visitor is not signed in they land on sign-in and are
 * returned here afterwards. The code grants no authority of its own — the
 * server still checks the visitor's role.
 */
export function ItemQrCode({
  reference,
  url,
  size = 168,
  showReference = true,
}: ItemQrCodeProps): ReactElement {
  const [svg, setSvg] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;

    void QRCode.toString(url, {
      type: "svg",
      margin: 1,
      width: size,
      errorCorrectionLevel: "M",
    })
      .then((rendered) => {
        if (active) {
          setSvg(rendered);
        }
      })
      .catch(() => {
        if (active) {
          setSvg(undefined);
        }
      });

    return (): void => {
      active = false;
    };
  }, [url, size]);

  return (
    <Box sx={{ textAlign: "center" }}>
      {svg === undefined ? (
        <Skeleton variant="rounded" width={size} height={size} sx={{ mx: "auto" }} />
      ) : (
        <Box
          role="img"
          aria-label={`QR code linking to ${reference}`}
          dangerouslySetInnerHTML={{ __html: svg }}
          sx={{
            width: size,
            height: size,
            mx: "auto",
            "& svg": { width: "100%", height: "100%", display: "block" },
          }}
        />
      )}
      {showReference && (
        <Typography
          variant="caption"
          sx={{ display: "block", mt: 1, fontWeight: 750, letterSpacing: "0.06em" }}
        >
          {reference}
        </Typography>
      )}
    </Box>
  );
}
