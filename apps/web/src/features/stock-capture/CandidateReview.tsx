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
import type {
  ConfidenceBand,
  RecognitionSessionView,
  RecognitionStage,
} from "@stockcontrol/contracts";
import type { ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";

import { AnalysisDetails } from "./AnalysisDetails";
import { topCandidateSelection, type ReceiptSelection } from "./capture-reducer";

const confidenceColor: Readonly<Record<ConfidenceBand, "success" | "info" | "default">> = {
  Strong: "success",
  Possible: "info",
  Weak: "default",
};

/* A band is only useful if the reader knows what it is claiming. */
const confidenceMeaning: Readonly<Record<ConfidenceBand, string>> = {
  Strong: "the evidence points clearly at this item",
  Possible: "it matches, but check it before confirming",
  Weak: "a long shot — check it carefully",
};

const AUTOMATIC_RECOGNITION_STAGES: ReadonlySet<RecognitionStage> = new Set([
  "Ocr",
  "VisualExample",
  "Category",
  "Vlm",
]);

const selectionFor = (
  candidate: RecognitionSessionView["candidates"][number],
): ReceiptSelection | null => {
  if (candidate.kind === "InternalItem" && candidate.item !== null) {
    return {
      kind: "ExistingItem",
      itemId: candidate.item.id,
      candidateId: candidate.id,
      label: candidate.item.name,
      reference: candidate.item.reference,
      unit: candidate.item.unit,
      onHand: candidate.item.onHand,
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
  /* Five cards of equal weight is a decision, not a suggestion. Naming the one
   * the pipeline actually ranked first turns it back into a suggestion. */
  const best = topCandidateSelection(session.candidates);
  const bestCandidateId = best === null ? null : best.candidateId;
  const automaticRecognitionUnavailable = session.stageReports.some(
    (report) => report.outcome === "Unavailable" && AUTOMATIC_RECOGNITION_STAGES.has(report.stage),
  );

  return (
    <Stack spacing={2}>
      {session.candidates.length === 0 && (
        <Alert severity={session.recommendManualEntry ? "info" : "warning"}>
          {session.recommendManualEntry
            ? automaticRecognitionUnavailable
              ? "Automatic photo recognition was unavailable. Show analysis details to see which checks could not run, or choose “None are correct” to type the item in yourself."
              : "Nothing was recognised. Choose “None are correct” to type the item in yourself."
            : "No suggestions yet."}
        </Alert>
      )}

      {session.candidates.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          Choose the item these photographs show. Nothing changes in stock until you confirm it on
          the next screen.
        </Typography>
      )}

      <Stack spacing={1.5}>
        {session.candidates.map((candidate) => {
          const selection = selectionFor(candidate);
          const archived = candidate.item !== null && !candidate.item.isActive;
          const isBest = bestCandidateId !== null && candidate.id === bestCandidateId;

          return (
            <Card
              key={candidate.id}
              variant="outlined"
              sx={isBest ? { borderColor: "primary.main", borderWidth: 2 } : undefined}
            >
              <CardActionArea
                disabled={!candidate.selectable || selection === null}
                onClick={() => {
                  if (selection !== null) onSelect(selection);
                }}
              >
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Stack spacing={0.5}>
                      {isBest && (
                        <Chip
                          size="small"
                          color="primary"
                          label="Best match"
                          sx={{ alignSelf: "flex-start" }}
                        />
                      )}
                      <Typography variant="subtitle1">
                        {candidate.item?.name ?? candidate.identity.name}
                      </Typography>
                      {candidate.item !== null && (
                        <Typography variant="body2" color="text.secondary">
                          {candidate.item.reference} · {candidate.item.unit}
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
                          This item is archived and cannot receive stock. Bring it back into use
                          first.
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
              {archived && (
                <Box sx={{ px: 2, pb: 1.5 }}>
                  <Button
                    size="small"
                    component={RouterLink}
                    to={`/inventory/${candidate.item.id}`}
                  >
                    Open this item
                  </Button>
                </Box>
              )}
            </Card>
          );
        })}
      </Stack>

      {session.candidates.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          {(["Strong", "Possible", "Weak"] as const)
            .map((band) => `${band} — ${confidenceMeaning[band]}`)
            .join(". ")}
          .
        </Typography>
      )}

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
