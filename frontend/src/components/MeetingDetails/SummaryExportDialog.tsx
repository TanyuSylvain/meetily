'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FolderOpen, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface PathValidation {
  valid: boolean;
  fullPath?: string | null;
  normalizedFilename?: string | null;
  error?: string | null;
}

interface SummaryExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFilename: string;
  /** Initial folder only — dialog edits do not write global settings. */
  initialFolder: string;
  onConfirm: (fullPath: string) => Promise<void>;
}

export function SummaryExportDialog({
  open,
  onOpenChange,
  defaultFilename,
  initialFolder,
  onConfirm,
}: SummaryExportDialogProps) {
  const [filename, setFilename] = useState(defaultFilename);
  const [folder, setFolder] = useState(initialFolder);
  const [validation, setValidation] = useState<PathValidation | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);

  // Reset local fields when dialog opens
  useEffect(() => {
    if (open) {
      setFilename(defaultFilename);
      setFolder(initialFolder);
      setValidation(null);
      setIsExporting(false);
    }
  }, [open, defaultFilename, initialFolder]);

  // Validate folder + filename (debounced)
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setIsValidating(true);

    const timer = setTimeout(async () => {
      try {
        const result = await invoke<PathValidation>('validate_summary_export_path', {
          folder,
          filename,
        });
        if (!cancelled) {
          setValidation(result);
        }
      } catch (error) {
        if (!cancelled) {
          setValidation({
            valid: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (!cancelled) {
          setIsValidating(false);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, folder, filename]);

  const handleBrowse = useCallback(async () => {
    setIsBrowsing(true);
    try {
      // One-off folder pick for this export only — does not update global prefs
      const selected = await invoke<string | null>('select_summary_export_folder');
      if (selected) {
        setFolder(selected);
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    } finally {
      setIsBrowsing(false);
    }
  }, []);

  const handleExport = useCallback(async () => {
    if (!validation?.valid || !validation.fullPath || isExporting) return;

    setIsExporting(true);
    try {
      await onConfirm(validation.fullPath);
      onOpenChange(false);
    } catch (error) {
      // Parent shows toast; keep dialog open
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  }, [validation, isExporting, onConfirm, onOpenChange]);

  const canExport = !!validation?.valid && !!validation.fullPath && !isValidating && !isExporting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export Summary</DialogTitle>
          <DialogDescription>
            Choose a filename and folder for the markdown file. Changing the folder here does not
            update your default in Settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="export-filename">File name</Label>
            <Input
              id="export-filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="meeting-summary.md"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="export-folder">Save folder</Label>
            <div className="flex gap-2">
              <Input
                id="export-folder"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="/path/to/folder"
                className="flex-1 font-mono text-sm"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleBrowse}
                disabled={isBrowsing}
                title="Browse for folder"
              >
                {isBrowsing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderOpen className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-gray-50 px-3 py-2">
            <div className="text-xs font-medium text-gray-500 mb-1">Full path</div>
            <div className="text-sm font-mono break-all text-gray-800">
              {validation?.fullPath ||
                (folder && filename ? `${folder.replace(/\/$/, '')}/${filename}` : '—')}
            </div>
            {validation && !validation.valid && validation.error && (
              <p className="text-xs text-red-600 mt-2">{validation.error}</p>
            )}
            {isValidating && (
              <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Validating path…
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleExport} disabled={!canExport}>
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Exporting…
              </>
            ) : (
              'Export'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
