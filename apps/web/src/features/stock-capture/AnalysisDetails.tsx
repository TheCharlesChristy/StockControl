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
import type { RecognitionStageReportView } from "@stockcontrol/contracts";
import type { ReactElement } from "react";

const outcomeColor: Readonly<
  Record<RecognitionStageReportView["outcome"], "default" | "success" | "warning" | "error">
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
          <TableCell>Stage</TableCell>
          <TableCell>Photograph</TableCell>
          <TableCell>Outcome</TableCell>
          <TableCell>Notes</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {stageReports.map((report, index) => (
          <TableRow key={`${report.stage}-${String(report.imageOrdinal)}-${String(index)}`}>
            <TableCell>{report.stage}</TableCell>
            <TableCell>{report.imageOrdinal ?? "—"}</TableCell>
            <TableCell>
              <Chip size="small" label={report.outcome} color={outcomeColor[report.outcome]} />
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
