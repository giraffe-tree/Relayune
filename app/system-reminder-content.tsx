"use client";

import { Fragment, type ReactNode } from "react";
import type { AuthLocale } from "./auth-language";
import { splitSystemReminderSegments } from "./system-reminder-segments";
import { workbenchText } from "./workbench-language";

export default function SystemReminderContent({
  children,
  locale,
  renderContent,
}: {
  children: string;
  locale: AuthLocale;
  renderContent: (content: string, index: number) => ReactNode;
}) {
  return splitSystemReminderSegments(children).map((segment, index) => {
    if (segment.kind === "content") {
      return (
        <Fragment key={`content-${index}`}>
          {renderContent(segment.content, index)}
        </Fragment>
      );
    }

    return (
      <details className="system-reminder" key={`system-reminder-${index}`}>
        <summary>
          <span className="system-reminder-chevron" aria-hidden="true">
            ›
          </span>
          <span className="system-reminder-label">
            {workbenchText(locale, "systemReminder")}
          </span>
          <span className="system-reminder-action system-reminder-action-expand">
            {workbenchText(locale, "expandSystemReminder")}
          </span>
          <span className="system-reminder-action system-reminder-action-collapse">
            {workbenchText(locale, "collapseSystemReminder")}
          </span>
        </summary>
        <div className="system-reminder-body">
          {renderContent(segment.content, index)}
        </div>
      </details>
    );
  });
}
