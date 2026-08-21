import { Alert, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { passwordPolicy } from "@stockcontrol/contracts";
import { useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "../api/ApiClient";
import { useApi } from "../api/ApiContext";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/DataStates";

/**
 * Changing your own password.
 *
 * Reached from the profile by choice, and forced on arrival when the password
 * in use was chosen by somebody else — at account creation, or by an Admin
 * reset. The forced case cannot be dismissed from here, because the whole point
 * is that the password the Admin typed stops working.
 */
export function ChangePasswordPage(): ReactElement {
  const api = useApi();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  const required = user?.mustChangePassword === true;
  const mismatch = confirmation.length > 0 && confirmation !== newPassword;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (mismatch) return;

    setBusy(true);
    setError(undefined);
    setFieldErrors({});

    void api
      .changePassword({ currentPassword, newPassword })
      .then(async () => {
        /*
         * The session's mustChangePassword is now false, and the guard that
         * sent the user here reads it — so refresh before navigating or the
         * redirect bounces straight back.
         */
        await refresh();
        await navigate("/profile", { replace: true });
      })
      .catch((caught: unknown) => {
        if (caught instanceof ApiError && caught.hasFieldErrors) {
          setFieldErrors({
            currentPassword: caught.fieldError("currentPassword"),
            newPassword: caught.fieldError("newPassword"),
          });
          return;
        }

        setError(caught instanceof Error ? caught.message : "The password could not be changed.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <Box>
      <PageHeader
        eyebrow="Your account"
        title="Change your password"
        description={
          required
            ? "This account is using a password somebody else chose. Set your own to continue."
            : "Changing your password signs out every other device."
        }
      />

      <Paper sx={{ p: 3, maxWidth: 520 }}>
        <form onSubmit={submit} noValidate>
          <Stack spacing={2}>
            {required && (
              <Alert severity="warning">
                Until you set a password of your own, the person who created this account knows how
                to sign in as you.
              </Alert>
            )}
            {error !== undefined && <Alert severity="error">{error}</Alert>}

            <TextField
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              error={fieldErrors["currentPassword"] !== undefined}
              helperText={fieldErrors["currentPassword"]}
              required
              fullWidth
            />

            <TextField
              label="New password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              error={fieldErrors["newPassword"] !== undefined}
              helperText={
                fieldErrors["newPassword"] ??
                `At least ${String(passwordPolicy.minimumCharacters)} characters. A memorable phrase beats a short scramble.`
              }
              required
              fullWidth
            />

            <TextField
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              error={mismatch}
              helperText={mismatch ? "This does not match the new password." : " "}
              required
              fullWidth
            />

            <Stack direction="row" spacing={1}>
              <Button type="submit" variant="contained" disabled={busy || mismatch}>
                {busy ? "Saving…" : "Change password"}
              </Button>
              {!required && (
                <Button
                  variant="text"
                  disabled={busy}
                  onClick={() => {
                    void navigate("/profile");
                  }}
                >
                  Cancel
                </Button>
              )}
            </Stack>

            <Typography variant="caption" color="text.secondary">
              Every other signed-in device is signed out when the password changes. This one stays
              signed in.
            </Typography>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
