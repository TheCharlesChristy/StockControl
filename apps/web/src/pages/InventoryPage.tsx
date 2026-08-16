import AddAPhotoRounded from "@mui/icons-material/AddAPhotoRounded";
import AddRounded from "@mui/icons-material/AddRounded";
import FileDownloadRounded from "@mui/icons-material/FileDownloadRounded";
import { Box, Button, Stack } from "@mui/material";
import { useRef, useState, type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { useCapability } from "../auth/useCapability";
import { CreateItemDialog } from "../components/CreateItemDialog";
import { LoadingRows, PageHeader } from "../components/DataStates";
import { InventoryTable, type InventoryTableHandle } from "../components/InventoryTable";

export function InventoryPage(): ReactElement {
  const { user, features } = useAuth();
  const canManageCatalogue = useCapability("manageCatalogue");
  const canManageStock = useCapability("manageStock");
  const [creating, setCreating] = useState(false);
  const table = useRef<InventoryTableHandle>(null);

  if (user === null) {
    return <LoadingRows />;
  }

  return (
    <Box>
      <PageHeader
        eyebrow="Inventory"
        title="What you have, and where"
        description="Search by item code, name, barcode or part number. Expand a row to see the per-location breakdown. Available is what is free to take: it counts stores only, never stock already dropped at a job site."
        actions={
          <Stack direction="row" spacing={1.5} data-help-target="inventory-actions">
            {/* The queue of photographed items, not the camera: photographing
             *  one starts at the scan button, which is on this screen too. */}
            {features.stockCapture && canManageStock && (
              <Button
                component={RouterLink}
                to="/stock-capture"
                variant="outlined"
                startIcon={<AddAPhotoRounded />}
              >
                Review queue
              </Button>
            )}
            <Button
              variant="outlined"
              data-help-target="inventory-export"
              startIcon={<FileDownloadRounded />}
              onClick={() => void table.current?.exportCsv()}
            >
              Export CSV
            </Button>
            {canManageCatalogue && (
              <Button
                variant="contained"
                data-help-target="inventory-new-item"
                startIcon={<AddRounded />}
                onClick={() => setCreating(true)}
              >
                New item
              </Button>
            )}
          </Stack>
        }
      />

      <InventoryTable handleRef={table} />

      {creating && (
        <CreateItemDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            table.current?.reload();
          }}
        />
      )}
    </Box>
  );
}
