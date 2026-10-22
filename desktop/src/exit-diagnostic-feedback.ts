export interface ExitDiagnosticReport {
  text: string;
  event_count: number;
  unexpected_exits: number;
  limited: boolean;
}

// Use the existing feedback description contract so installed servers can
// accept explicit diagnostic submissions without a coordinated deployment.
export function feedbackDescription(description: string, report: ExitDiagnosticReport | null): string {
  const note = description.trim();
  if (!report) return note;
  if (!report.event_count || !report.text.startsWith('Relayune exit diagnostics v1\n') ||
      new TextEncoder().encode(report.text).length > 3800) throw new Error('invalid_diagnostic_report');
  const result = `${note}\n\n--- User-selected exit diagnostics ---\n${report.text}`;
  if (new TextEncoder().encode(result).length > 8000) throw new Error('feedback_description_too_long');
  return result;
}
