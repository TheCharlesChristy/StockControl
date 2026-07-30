import Inventory2Rounded from "@mui/icons-material/Inventory2Rounded";
import { Box, Stack, Typography } from "@mui/material";
import type { ReactElement } from "react";

interface BrandProps {
  readonly inverse?: boolean;
  readonly compact?: boolean;
}

export function Brand({ inverse = false, compact = false }: BrandProps): ReactElement {
  const foreground = inverse ? "#FFFFFF" : "text.primary";
  const muted = inverse ? "rgba(255, 255, 255, 0.68)" : "text.secondary";

  return (
    <Stack direction="row" spacing={1.25} alignItems="center" aria-label="StockControl">
      <Box
        sx={{
          width: compact ? 36 : 42,
          height: compact ? 36 : 42,
          display: "grid",
          placeItems: "center",
          borderRadius: 2,
          color: "#FFFFFF",
          background: "linear-gradient(145deg, #1A8B86 0%, #0B6668 60%, #07494B 100%)",
          boxShadow: "0 8px 20px rgba(4, 42, 44, 0.28)",
        }}
      >
        <Inventory2Rounded fontSize={compact ? "small" : "medium"} />
      </Box>
      <Box>
        <Typography
          component="span"
          sx={{
            display: "block",
            color: foreground,
            fontSize: compact ? "1rem" : "1.08rem",
            fontWeight: 850,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          StockControl
        </Typography>
        {!compact && (
          <Typography
            component="span"
            variant="caption"
            sx={{
              display: "block",
              color: muted,
              fontWeight: 650,
              letterSpacing: "0.045em",
            }}
          >
            Inventory, accounted for
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
