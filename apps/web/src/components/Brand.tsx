import { Box } from "@mui/material";
import type { ReactElement } from "react";

interface BrandProps {
  readonly inverse?: boolean;
  readonly compact?: boolean;
}

export function Brand({ inverse = false, compact = false }: BrandProps): ReactElement {
  const width = compact ? 156 : 210;
  const height = compact ? 47 : 66;
  const imageTop = compact ? "-14px" : "-18.9px";

  return (
    <Box
      sx={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
      }}
    >
      <Box
        component="img"
        src={
          inverse ? "/christy-plumbing-logo-white-2025.png" : "/christy-plumbing-main-logo-2025.png"
        }
        alt="Christy Plumbing & Heating"
        sx={{
          position: "absolute",
          top: imageTop,
          left: 0,
          display: "block",
          width,
          maxWidth: "none",
        }}
      />
    </Box>
  );
}
