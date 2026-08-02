import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import PhotoCameraRounded from "@mui/icons-material/PhotoCameraRounded";
import { Alert, Avatar, Box, Button, Paper, Stack, Typography } from "@mui/material";
import { useState, type ChangeEvent, type ReactElement } from "react";

import { ApiError } from "../api/ApiClient";
import { useApi } from "../api/ApiContext";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/DataStates";
import { ImagePreview } from "../components/ImagePreview";
import { readImageFile } from "../components/photo-files";

function initials(displayName: string): string {
  return displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function ProfilePage(): ReactElement {
  const api = useApi();
  const { user, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  if (user === null) return <></>;

  const upload = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    setBusy(true);
    setMessage(undefined);
    setError(undefined);
    void readImageFile(file)
      .then((input) => api.uploadProfilePhoto(user.id, input))
      .then(async () => {
        await refresh();
        setMessage("Profile photo saved.");
      })
      .catch((caught: unknown) =>
        setError(
          caught instanceof ApiError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : "Photo upload failed.",
        ),
      )
      .finally(() => setBusy(false));
  };

  const remove = (): void => {
    setBusy(true);
    setMessage(undefined);
    setError(undefined);
    void api
      .deleteProfilePhoto(user.id)
      .then(async () => {
        await refresh();
        setMessage("Profile photo removed.");
      })
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught.message : "Photo could not be removed."),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Box>
      <PageHeader
        eyebrow="Your account"
        title="Profile"
        description="Keep the picture your team sees next to your name up to date."
      />
      <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 }, maxWidth: 640 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={3} alignItems={{ sm: "center" }}>
          <ImagePreview src={user.profilePhotoUrl} alt={`${user.displayName} profile photo`}>
            <Avatar
              src={user.profilePhotoUrl ?? undefined}
              alt={`${user.displayName} profile photo`}
              sx={{
                width: 112,
                height: 112,
                fontSize: "2rem",
                bgcolor: "primary.light",
                color: "primary.dark",
              }}
            >
              {initials(user.displayName)}
            </Avatar>
          </ImagePreview>
          <Stack spacing={1}>
            <Typography variant="h3" component="h2">
              {user.displayName}
            </Typography>
            <Typography color="text.secondary">{user.email}</Typography>
            <Typography variant="body2" color="text.secondary">
              {user.role}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button
                component="label"
                variant="contained"
                data-help-target="profile-photo"
                startIcon={<PhotoCameraRounded />}
                disabled={busy}
              >
                {busy ? "Saving…" : "Choose photo"}
                <input hidden type="file" accept="image/png,image/jpeg" onChange={upload} />
              </Button>
              {user.profilePhotoUrl !== null && (
                <Button
                  variant="outlined"
                  color="error"
                  data-help-target="profile-remove"
                  startIcon={<DeleteOutlineRounded />}
                  onClick={remove}
                  disabled={busy}
                >
                  Remove
                </Button>
              )}
            </Stack>
          </Stack>
        </Stack>
        {message !== undefined && (
          <Alert severity="success" sx={{ mt: 3 }}>
            {message}
          </Alert>
        )}
        {error !== undefined && (
          <Alert severity="error" sx={{ mt: 3 }}>
            {error}
          </Alert>
        )}
      </Paper>
    </Box>
  );
}
