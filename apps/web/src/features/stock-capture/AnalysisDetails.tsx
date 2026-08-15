import {
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type {
  RecognitionStage,
  RecognitionStageOutcome,
  RecognitionStageReportView,
} from "@stockcontrol/contracts";
import type { ReactElement } from "react";

/*
 * The pipeline's own stage names are how the specification and the worker
 * logs talk about these steps. They are not how a stockroom talks, and this
 * table is read by people who have never seen either — "Vlm" and
 * "VisualExample" told nobody anything.
 */
export const stageLabels: Readonly<Record<RecognitionStage, string>> = {
  Barcode: "Barcode",
  Ocr: "Label text",
  VisualExample: "Looks like a confirmed item",
  Category: "Product category",
  Web: "Manufacturer page",
  Vlm: "Photo analysis",
};

const outcomeLabels: Readonly<Record<RecognitionStageOutcome, string>> = {
  Succeeded: "Found something",
  NotApplicable: "Not needed",
  Unavailable: "Not available",
  Failed: "Did not work",
};

const outcomeColor: Readonly<
  Record<RecognitionStageOutcome, "default" | "success" | "warning" | "error">
> = {
  Succeeded: "success",
  NotApplicable: "default",
  Unavailable: "warning",
  Failed: "error",
};

interface AnalysisDetailsProps {
  readonly stageReports: readonly RecognitionStageReportView[];
}

/**
 * The expandable disclosure from section 5.1 step 9: every stage, for every
 * photograph, so a person can see why a suggestion showed up without the
 * default view drowning in fifteen duplicate cards for three images.
 */
export function AnalysisDetails({ stageReports }: AnalysisDetailsProps): ReactElement {
  if (stageReports.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No stage evidence was recorded for this item.
      </Typography>
    );
  }

  return (
    <Table size="small" aria-label="Analysis details">
      <TableHead>
        <TableRow>
          <TableCell>What was checked</TableCell>
          <TableCell>Photograph</TableCell>
          <TableCell>Result</TableCell>
          <TableCell>Notes</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {stageReports.map((report, index) => (
          <TableRow key={`${report.stage}-${String(report.imageOrdinal)}-${String(index)}`}>
            <TableCell>{stageLabels[report.stage]}</TableCell>
            <TableCell>{report.imageOrdinal ?? "All"}</TableCell>
            <TableCell>
              <Chip
                size="small"
                label={outcomeLabels[report.outcome]}
                color={outcomeColor[report.outcome]}
              />
            </TableCell>
            <TableCell>
              <Stack spacing={0.25}>
                {report.observations.map((observation, observationIndex) => (
                  <Typography key={observationIndex} variant="body2" color="text.secondary">
                    {observation}
                  </Typography>
                ))}
              </Stack>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
