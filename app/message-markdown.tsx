"use client";

import { isValidElement, type ReactElement } from "react";
import MermaidDiagram, { isMermaidBlock } from "./mermaid-diagram";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AuthLocale } from "./auth-language";
import SystemReminderContent from "./system-reminder-content";

type ReferencedAttachment = { id: string; name: string };

function localFileName(href: string | undefined) {
  if (!href) return null;
  let target: string;
  try {
    target = decodeURIComponent(href);
  } catch {
    return null;
  }
  if (!target.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(target)) {
    return null;
  }
  target = target
    .replace(/#L\d+(?:C\d+)?$/i, "")
    .replace(/:\d+(?::\d+)?$/, "");
  return target.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
}

function MarkdownBlock({
  children,
  referencedAttachments = [],
}: {
  children: string;
  referencedAttachments?: ReferencedAttachment[];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children: linkChildren, href, ...props }) => {
          const name = localFileName(href);
          if (name) {
            const attachment = referencedAttachments.find(
              (candidate) => candidate.name === name,
            );
            if (!attachment) {
              return (
                <bdi className="local-file-reference technical-ltr" dir="ltr">
                  {linkChildren}
                </bdi>
              );
            }
            const targetId = `message-attachment-${attachment.id}`;
            return (
              <a
                {...props}
                href={`#${targetId}`}
                className="technical-ltr"
                dir="ltr"
                onClick={(event) => {
                  event.preventDefault();
                  const target = document.getElementById(targetId);
                  if (target instanceof HTMLButtonElement) target.click();
                  else target?.scrollIntoView({ block: "center" });
                }}
              >
                {linkChildren}
              </a>
            );
          }
          const technicalLink =
            href?.startsWith("mailto:") ||
            href?.startsWith("http://") ||
            href?.startsWith("https://");
          return (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noreferrer"
              className={technicalLink ? "technical-ltr" : undefined}
              dir={technicalLink ? "ltr" : undefined}
            >
              {linkChildren}
            </a>
          );
        },
        code: ({ children: codeChildren, className, ...props }) => (
          <code
            {...props}
            className={`technical-ltr${className ? ` ${className}` : ""}`}
            dir="ltr"
          >
            {codeChildren}
          </code>
        ),
        pre: ({ children: preChildren, className, ...props }) => {
          const code = isValidElement(preChildren)
            ? (preChildren as ReactElement<{ children?: string; className?: string }>).props
            : null;
          if (code && typeof code.children === "string" && isMermaidBlock(code.children, code.className)) {
            return <MermaidDiagram source={code.children} />;
          }
          return <pre {...props} className={`technical-ltr${className ? ` ${className}` : ""}`} dir="ltr">{preChildren}</pre>;
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

export default function MessageMarkdown({
  children,
  locale,
  referencedAttachments,
}: {
  children: string;
  locale: AuthLocale;
  referencedAttachments?: ReferencedAttachment[];
}) {
  return (
    <SystemReminderContent
      locale={locale}
      renderContent={(content) => (
        <MarkdownBlock referencedAttachments={referencedAttachments}>
          {content}
        </MarkdownBlock>
      )}
    >
      {children}
    </SystemReminderContent>
  );
}
