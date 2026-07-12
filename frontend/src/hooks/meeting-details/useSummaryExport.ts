import { useCallback, useState, RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Summary } from '@/types';
import { BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import {
  buildSummaryMarkdown,
  defaultSummaryFilename,
} from '@/hooks/meeting-details/summaryMarkdown';
import Analytics from '@/lib/analytics';

interface SummaryExportPreferences {
  exportFolder: string;
}

interface UseSummaryExportProps {
  meeting: { id: string; created_at: string };
  meetingTitle: string;
  aiSummary: Summary | null;
  blockNoteSummaryRef: RefObject<BlockNoteSummaryViewRef | null>;
}

export function useSummaryExport({
  meeting,
  meetingTitle,
  aiSummary,
  blockNoteSummaryRef,
}: UseSummaryExportProps) {
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [initialFolder, setInitialFolder] = useState('');
  const [defaultFilename, setDefaultFilename] = useState('meeting-summary.md');

  const openExportDialog = useCallback(async () => {
    try {
      let folder = '';
      try {
        const prefs = await invoke<SummaryExportPreferences>('get_summary_export_preferences');
        folder = prefs?.exportFolder || '';
      } catch {
        // fall through to default path
      }

      if (!folder) {
        folder = await invoke<string>('get_default_summary_export_folder_path');
      }

      setInitialFolder(folder);
      setDefaultFilename(defaultSummaryFilename(meetingTitle));
      setIsExportDialogOpen(true);
      await Analytics.trackButtonClick('export_summary', 'meeting_details');
    } catch (error) {
      console.error('Failed to open export dialog:', error);
      toast.error('Failed to prepare export', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [meetingTitle]);

  const handleExportConfirm = useCallback(
    async (fullPath: string) => {
      try {
        const content = await buildSummaryMarkdown({
          meeting,
          meetingTitle,
          aiSummary,
          blockNoteSummaryRef,
          kind: 'export',
        });

        await invoke('export_summary_markdown', {
          filePath: fullPath,
          content,
        });

        await invoke('set_summary_export_binding', {
          meetingId: meeting.id,
          filePath: fullPath,
        });

        toast.success('Summary exported', {
          description: fullPath,
        });
      } catch (error) {
        console.error('Export failed:', error);
        toast.error('Failed to export summary', {
          description: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [meeting, meetingTitle, aiSummary, blockNoteSummaryRef]
  );

  return {
    isExportDialogOpen,
    setIsExportDialogOpen,
    initialFolder,
    defaultFilename,
    openExportDialog,
    handleExportConfirm,
  };
}
