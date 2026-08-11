import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Collapse,
  Stack,
  Typography,
} from "@mui/material";
import type { ConfidenceBand, RecognitionSessionView } from "@stockcontrol/contracts";
import type { ReactElement } from "react";

import { AnalysisDetails } from "./AnalysisDetails";
import type { ReceiptSelection } from "./capture-reducer";

const confidenceColor: Readonly<Record<ConfidenceBand, "success" | "info" | "default">> = {
  Strong: "success",
  Possible: "info",
  Weak: "default",
};

const selectionFor = (
  candidate: RecognitionSessionView["candidates"][number],
): ReceiptSelection | null => {
  if (candidate.kind === "InternalItem" && candidate.item !== null) {
    return {
      kind: "ExistingItem",
      itemId: candidate.item.id,
      candidateId: candidate.id,
      label: candidate.item.name,
    };
  }

  if (candidate.kind === "ExternalDraft") {
    return {
      kind: "NewItem",
      candidateId: candidate.id,
      reference: null,
      name: candidate.identity.name,
      unit: candidate.identity.unit ?? "",
      barcode: candidate.identity.barcode,
      partNumber: candidate.identity.partNumber,
    };
  }

  return null;
};

interface CandidateReviewProps {
  readonly session: RecognitionSessionView;
  readonly showDetails: boolean;
  readonly onToggleDetails: () => void;
  readonly onSelect: (selection: ReceiptSelection) => void;
  readonly onManualEntry: () => void;
  readonly onCancel: () => void;
}

/**
 * Up to five deduplicated candidates, specification section 5.1 steps 8-10.
 * Confidence is always a word, never a number: the underlying fusion score
 * is an internal ranking signal, not a probability anything downstream could
 * average or compare across sessions.
 */
export function CandidateReview({
  session,
  showDetails,
  onToggleDetails,
  onSelect,
  onManualEntry,
  onCancel,
}: CandidateReviewProps): ReactElement {
  return (
    <Stack spacing={2}>
      {session.candidates.length === 0 && (
        <Alert severity={session.recommendManualEntry ? "info" : "warning"}>
          {session.recommendManualEntry
            ? "Nothing was recognised. Enter the item yourself below."
            : "No suggestions yet."}
        </Alert>
      )}

      <Stack spacing={1.5}>
        {session.candidates.map((candidate) => {
          const selection = selectionFor(candidate);
          const archived = candidate.item !== null && !candidate.item.isActive;

          return (
            <Card key={candidate.id} variant="outlined">
              <CardActionArea
                disabled={!candidate.selectable || selection === null}
                onClick={() => {
                  if (selection !== null) onSelect(selection);
                }}
              >
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Stack spacing={0.5}>
                      <Typography variant="subtitle1">
                        {candidate.item?.name ?? candidate.identity.name}
                      </Typography>
                      {candidate.item !== null && (
                        <Typography variant="body2" color="text.secondary">
                          {candidate.item.reference}
                        </Typography>
                      )}
                      <Stack direction="row" spacing={0.75} flexWrap="wrap">
                        {candidate.evidence.map((evidence) => (
                          <Chip
                            key={`${evidence.stage}-${evidence.summary}`}
                            size="small"
                            variant="outlined"
                            label={evidence.summary}
                          />
                        ))}
                      </Stack>
                      {archived && (
                        <Typography variant="body2" color="warning.main">
                          This item is archived and cannot receive stock directly.
                        </Typography>
                      )}
                    </Stack>
                    <Chip
                      label={candidate.confidence}
                      color={confidenceColor[candidate.confidence]}
                      size="small"
                    />
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          );
        })}
      </Stack>

      <Box>
        <Button size="small" onClick={onToggleDetails}>
          {showDetails ? "Hide analysis details" : "Show analysis details"}
        </Button>
        <Collapse in={showDetails}>
          <Box sx={{ mt: 1 }}>
            <AnalysisDetails stageReports={session.stageReports} />
          </Box>
        </Collapse>
      </Box>

      <Stack direction="row" spacing={1.5} justifyContent="space-between">
        <Button onClick={onCancel}>Cancel this item</Button>
        <Button variant="outlined" onClick={onManualEntry}>
          None are correct
        </Button>
      </Stack>
    </Stack>
  );
}
