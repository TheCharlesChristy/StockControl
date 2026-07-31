import ExpandLessRounded from "@mui/icons-material/ExpandLessRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import { Box, IconButton, Stack, Typography } from "@mui/material";
import { memo, useState, type ReactElement } from "react";

import { floatingPanel, statusLegend } from "./constants";

const legendSx = {
  ...floatingPanel,
  right: 16,
  bottom: 16,
  maxWidth: "calc(100% - 32px)",
  backdropFilter: "blur(6px)",
} as const;

export const MapLegend = memo(function MapLegend(): ReactElement {
  const [expanded, setExpanded] = useState(true);

  return (
    <Box aria-label="Map status legend" sx={legendSx}>
      <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="space-between">
        <Typography variant="caption" sx={{ fontWeight: 800 }}>
          Legend
        </Typography>
        <IconButton
          size="small"
          aria-label={expanded ? "Collapse map legend" : "Expand map legend"}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          sx={{ p: 0.25 }}
        >
          {expanded ? (
            <ExpandLessRounded fontSize="small" />
          ) : (
            <ExpandMoreRounded fontSize="small" />
          )}
        </IconButton>
      </Stack>
      {expanded && (
        <Stack direction="row" spacing={1.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
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
      )}
    </Box>
  );
});
