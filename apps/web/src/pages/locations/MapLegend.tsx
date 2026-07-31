import { Box, Stack, Typography } from "@mui/material";
import { memo, type ReactElement } from "react";

import { floatingPanel, statusLegend } from "./constants";

const legendSx = {
  ...floatingPanel,
  right: 16,
  bottom: 16,
  maxWidth: "calc(100% - 32px)",
  backdropFilter: "blur(6px)",
} as const;

export const MapLegend = memo(function MapLegend(): ReactElement {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      flexWrap="wrap"
      aria-label="Map status legend"
      sx={legendSx}
    >
      {statusLegend.map((entry) => (
        <Stack key={entry.label} direction="row" spacing={0.5} alignItems="center">
          <Box
            aria-hidden="true"
            sx={{ width: 8, height: 8, bgcolor: entry.colour, borderRadius: "50%" }}
          />
          <Typography variant="caption">{entry.label}</Typography>
        </Stack>
      ))}
    </Stack>
  );
});
