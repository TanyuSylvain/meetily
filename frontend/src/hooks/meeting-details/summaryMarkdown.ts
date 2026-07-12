import { RefObject } from 'react';
import { Summary } from '@/types';
import { BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';

export type SummaryMarkdownKind = 'copy' | 'export';

interface BuildSummaryMarkdownParams {
  meeting: { id: string; created_at: string };
  meetingTitle: string;
  aiSummary: Summary | null;
  blockNoteSummaryRef: RefObject<BlockNoteSummaryViewRef | null>;
  kind?: SummaryMarkdownKind;
}

/**
 * Build full markdown for copy/export from the live BlockNote editor or stored summary.
 */
export async function buildSummaryMarkdown({
  meeting,
  meetingTitle,
  aiSummary,
  blockNoteSummaryRef,
  kind = 'copy',
}: BuildSummaryMarkdownParams): Promise<string> {
  let summaryMarkdown = '';

  if (blockNoteSummaryRef.current?.getMarkdown) {
    summaryMarkdown = await blockNoteSummaryRef.current.getMarkdown();
  }

  if (!summaryMarkdown && aiSummary && 'markdown' in aiSummary) {
    summaryMarkdown = (aiSummary as { markdown?: string }).markdown || '';
  }

  if (!summaryMarkdown && aiSummary) {
    const sections = Object.entries(aiSummary)
      .filter(([key]) => {
        return (
          key !== 'markdown' &&
          key !== 'summary_json' &&
          key !== '_section_order' &&
          key !== 'MeetingName'
        );
      })
      .map(([, section]) => {
        if (section && typeof section === 'object' && 'title' in section && 'blocks' in section) {
          const sectionTitle = `## ${(section as any).title}\n\n`;
          const sectionContent = (section as any).blocks
            .map((block: any) => `- ${block.content}`)
            .join('\n');
          return sectionTitle + sectionContent;
        }
        return '';
      })
      .filter((s) => s.trim())
      .join('\n\n');
    summaryMarkdown = sections;
  }

  if (!summaryMarkdown.trim()) {
    throw new Error('No summary content available');
  }

  const actionLabel = kind === 'export' ? 'Exported on' : 'Copied on';
  const header = `# Meeting Summary: ${meetingTitle}\n\n`;
  const metadata = `**Meeting ID:** ${meeting.id}\n**Date:** ${new Date(meeting.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}\n**${actionLabel}:** ${new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}\n\n---\n\n`;

  return header + metadata + summaryMarkdown;
}

/** Sanitize a meeting title into a safe default .md filename (no path separators). */
export function defaultSummaryFilename(meetingTitle: string): string {
  const base = (meetingTitle || 'meeting-summary')
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

  const name = base || 'meeting-summary';
  return name.toLowerCase().endsWith('.md') ? name : `${name}.md`;
}
