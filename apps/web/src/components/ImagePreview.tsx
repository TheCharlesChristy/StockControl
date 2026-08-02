import CloseRounded from "@mui/icons-material/CloseRounded";
import { Box, Dialog, DialogContent, IconButton, type SxProps, type Theme } from "@mui/material";
import { useState, type ReactNode, type ReactElement } from "react";

interface ImagePreviewProps {
  readonly src: string | null | undefined;
  readonly alt: string;
  readonly children: ReactNode;
  readonly sx?: SxProps<Theme>;
}

/** Makes an existing image open at a readable size without changing its compact layout. */
export function ImagePreview({ src, alt, children, sx }: ImagePreviewProps): ReactElement {
  const [open, setOpen] = useState(false);

  if (src === null || src === undefined || src.length === 0) return <>{children}</>;

  return (
    <>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge ${alt}`}
        sx={{
          display: "inline-flex",
          p: 0,
          border: 0,
          borderRadius: "inherit",
          background: "none",
          cursor: "zoom-in",
          lineHeight: 0,
          "&:focus-visible": {
            outline: "3px solid",
            outlineColor: "primary.main",
            outlineOffset: 2,
          },
          ...sx,
        }}
      >
        {children}
      </Box>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        aria-label={`${alt} preview`}
        maxWidth="lg"
        fullWidth
      >
        <IconButton
          onClick={() => setOpen(false)}
          aria-label="Close image preview"
          sx={{ position: "absolute", top: 8, right: 8, zIndex: 1, bgcolor: "background.paper" }}
        >
          <CloseRounded />
        </IconButton>
        <DialogContent sx={{ p: { xs: 1, sm: 3 }, display: "flex", justifyContent: "center" }}>
          <Box
            component="img"
            src={src}
            alt={alt}
            sx={{ display: "block", maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
