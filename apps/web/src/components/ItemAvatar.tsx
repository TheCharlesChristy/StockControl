import { Avatar, type SxProps, type Theme } from "@mui/material";
import type { ReactElement } from "react";

interface ItemAvatarProps {
  readonly name: string;
  readonly photoUrl: string | null | undefined;
  readonly size?: number;
  readonly sx?: SxProps<Theme>;
}

function initialFor(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?";
}

/** The compact item identity used wherever an item name appears. */
export function ItemAvatar({ name, photoUrl, size = 40, sx }: ItemAvatarProps): ReactElement {
  return (
    <Avatar
      src={photoUrl ?? undefined}
      alt={`${name} photo`}
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        fontSize: Math.max(12, Math.round(size * 0.42)),
        fontWeight: 750,
        bgcolor: "primary.light",
        color: "primary.dark",
        ...sx,
      }}
    >
      {initialFor(name)}
    </Avatar>
  );
}
