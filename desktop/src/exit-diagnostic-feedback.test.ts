import { describe, expect, it } from 'vitest';
import { feedbackDescription, type ExitDiagnosticReport } from './exit-diagnostic-feedback';
import { parseFeedback } from '../../shared/feedback.mjs';
const report: ExitDiagnosticReport = {
  text: 'Relayune exit diagnostics v1\n2026-09-25T06:00:00Z run=1/2 v=0.3.24 terminated_unexpected code=1 ms=5400\n',
  event_count: 1, unexpected_exits: 1, limited: false,
};
describe('user-selected exit diagnostics', () => {
  it('does not include diagnostics when the user leaves the option off', () => {
    expect(feedbackDescription('  问题描述  ', null)).toBe('问题描述');
  });
  it('includes exactly the previewed snapshot and keeps retries stable', () => {
    const text = feedbackDescription('偶尔退出', report);
    expect(text).toContain(report.text);
    expect(feedbackDescription('偶尔退出', report)).toBe(text);
    expect(parseFeedback({ id: 'a'.repeat(32), client: 'desktop', category: 'bug', description: text,
      environment: { app_version: '0.3.24', device_model: 'MacBookPro18,3', os_version: 'macOS 15.7.3' } })?.description).toBe(text.trim());
  });
  it('rejects oversized Unicode notes without truncating the report or changing the payload', () => {
    const original = structuredClone(report);
    expect(() => feedbackDescription('😀'.repeat(2000), report)).toThrow('too_long');
    expect(report).toEqual(original);
    expect(() => feedbackDescription('note', { ...report, text: report.text + 'x'.repeat(3800) })).toThrow('invalid');
    expect(() => feedbackDescription('note', { ...report, event_count: 0 })).toThrow('invalid');
  });
});
