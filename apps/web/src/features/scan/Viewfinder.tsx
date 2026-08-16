import CloseRounded from "@mui/icons-material/CloseRounded";
import KeyboardAltRounded from "@mui/icons-material/KeyboardAltRounded";
import PhotoLibraryRounded from "@mui/icons-material/PhotoLibraryRounded";
import { Box, CircularProgress, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { ChangeEvent, ReactElement, ReactNode, Ref } from "react";

const CONTROL_SX = {
  color: "#FFFFFF",
  bgcolor: "rgba(0,0,0,0.45)",
  "&:hover": { bgcolor: "rgba(0,0,0,0.65)" },
} as const;

interface ViewfinderProps {
  readonly videoRef: Ref<HTMLVideoElement>;
  /** The shot on screen, frozen over the live stream while it is read. */
  readonly frozenPreviewUrl: string | null;
  readonly cameraUnavailable: boolean;
  readonly busy: boolean;
  readonly hint: string;
  readonly canShoot: boolean;
  readonly onClose: () => void;
  readonly onShutter: () => void;
  readonly onToggleKeyboard: () => void;
  readonly onFilesChosen: (event: ChangeEvent<HTMLInputElement>) => void;
  /** The result panel, laid over the bottom of the picture. */
  readonly children?: ReactNode;
}

/**
 * The camera, and almost nothing else.
 *
 * This screen used to be a form with a camera in it — a preview, a divider, a
 * code box, another divider, a photo tray and two paragraphs of guidance. It
 * read as a page you had to fill in, and the one thing somebody standing in
 * front of a shelf wants is to point their phone at the label. So the picture
 * fills the screen, there is a shutter under your thumb, and everything else
 * is an icon at the edge.
 */
export function Viewfinder({
  videoRef,
  frozenPreviewUrl,
  cameraUnavailable,
  busy,
  hint,
  canShoot,
  onClose,
  onShutter,
  onToggleKeyboard,
  onFilesChosen,
  children,
}: ViewfinderProps): ReactElement {
  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 380,
        bgcolor: "#000000",
        overflow: "hidden",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="Camera preview"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          /*
           * Never mirrored. This is the rear camera, and a mirrored preview
           * shows every part number backwards — which is exactly what somebody
           * is squinting at when a decode will not catch.
           */
          objectFit: "cover",
          display: cameraUnavailable ? "none" : "block",
        }}
      />

      {frozenPreviewUrl !== null && (
        /* The shot stays on screen while it is read. Returning to a live
         * picture would suggest nothing had been taken. */
        <Box
          component="img"
          src={frozenPreviewUrl}
          alt="The photo you just took"
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}

      {cameraUnavailable && frozenPreviewUrl === null && (
        <Stack
          spacing={1}
          sx={{ position: "absolute", inset: 0, p: 4, placeContent: "center", textAlign: "center" }}
        >
          <Typography sx={{ color: "#FFFFFF", fontWeight: 700 }}>No camera here</Typography>
          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.7)" }}>
            Type or scan the code below instead — a handheld scanner types into that box.
          </Typography>
        </Stack>
      )}

      <Stack
        direction="row"
        justifyContent="space-between"
        sx={{ position: "absolute", top: 0, left: 0, right: 0, p: 1.5 }}
      >
        <IconButton aria-label="Close" onClick={onClose} sx={CONTROL_SX}>
          <CloseRounded />
        </IconButton>
        <Tooltip title="Type a code instead">
          <IconButton aria-label="Type a code instead" onClick={onToggleKeyboard} sx={CONTROL_SX}>
            <KeyboardAltRounded />
          </IconButton>
        </Tooltip>
      </Stack>

      {!cameraUnavailable && frozenPreviewUrl === null && (
        <>
          {/* Something to aim with. A full-bleed picture gives no clue where
           *  to hold the label for the decoder to catch it. */}
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              inset: "22% 10%",
              border: "2px solid rgba(255,255,255,0.85)",
              borderRadius: 3,
              boxShadow: "0 0 0 100vmax rgba(0,0,0,0.28)",
            }}
          />
          <Typography
            variant="body2"
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 116,
              textAlign: "center",
              color: "#FFFFFF",
              textShadow: "0 1px 4px rgba(0,0,0,0.8)",
            }}
          >
            {hint}
          </Typography>
        </>
      )}

      {children}

      {frozenPreviewUrl === null && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ position: "absolute", left: 0, right: 0, bottom: 0, px: 3, py: 2.5 }}
        >
          <Tooltip title="Choose a photo you already have">
            <IconButton
              component="label"
              aria-label="Choose a photo you already have"
              sx={CONTROL_SX}
            >
              <PhotoLibraryRounded />
              <input type="file" accept="image/*" multiple hidden onChange={onFilesChosen} />
            </IconButton>
          </Tooltip>

          {/* The shutter: deliberately the largest thing on the screen and
           *  centred under a thumb, the way every camera app puts it. */}
          <IconButton
            aria-label="Take a photo"
            disabled={!canShoot || busy || cameraUnavailable}
            onClick={onShutter}
            sx={{
              width: 72,
              height: 72,
              bgcolor: "rgba(255,255,255,0.25)",
              border: "4px solid #FFFFFF",
              "&:hover": { bgcolor: "rgba(255,255,255,0.4)" },
              "&.Mui-disabled": { border: "4px solid rgba(255,255,255,0.35)" },
            }}
          >
            {busy ? (
              <CircularProgress size={28} sx={{ color: "#FFFFFF" }} />
            ) : (
              <Box sx={{ width: 52, height: 52, borderRadius: "50%", bgcolor: "#FFFFFF" }} />
            )}
          </IconButton>

          {/* Balances the row so the shutter sits centred. */}
          <Box sx={{ width: 40 }} />
        </Stack>
      )}
    </Box>
  );
}
