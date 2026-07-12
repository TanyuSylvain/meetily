'use client';

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { FolderOpen, Loader2 } from 'lucide-react';
import { ModelConfig, ModelSettingsModal } from '@/components/ModelSettingsModal';
import { SummaryLanguageSettings } from '@/components/SummaryLanguageSettings';
import { Switch } from './ui/switch';
import { Button } from './ui/button';
import { useConfig } from '@/contexts/ConfigContext';

interface SummaryExportPreferences {
  exportFolder: string;
}

interface SummaryModelSettingsProps {
  refetchTrigger?: number; // Change this to trigger refetch
}

export function SummaryModelSettings({ refetchTrigger }: SummaryModelSettingsProps) {
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: 'ollama',
    model: 'llama3.2:latest',
    whisperModel: 'large-v3',
    apiKey: null,
    ollamaEndpoint: null
  });
  const [exportFolder, setExportFolder] = useState<string>('');
  const [isExportFolderLoading, setIsExportFolderLoading] = useState(true);
  const [isExportFolderSaving, setIsExportFolderSaving] = useState(false);

  const { isAutoSummary, toggleIsAutoSummary } = useConfig();

  const loadExportFolder = useCallback(async () => {
    setIsExportFolderLoading(true);
    try {
      const prefs = await invoke<SummaryExportPreferences>('get_summary_export_preferences');
      if (prefs?.exportFolder) {
        setExportFolder(prefs.exportFolder);
      } else {
        const defaultPath = await invoke<string>('get_default_summary_export_folder_path');
        setExportFolder(defaultPath);
      }
    } catch (error) {
      console.error('Failed to load summary export folder:', error);
      try {
        const defaultPath = await invoke<string>('get_default_summary_export_folder_path');
        setExportFolder(defaultPath);
      } catch {
        setExportFolder('');
      }
    } finally {
      setIsExportFolderLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExportFolder();
  }, [loadExportFolder]);

  const handleChangeExportFolder = async () => {
    setIsExportFolderSaving(true);
    try {
      const selected = await invoke<string | null>('select_summary_export_folder');
      if (!selected) {
        return;
      }
      await invoke('set_summary_export_preferences', {
        preferences: { exportFolder: selected },
      });
      setExportFolder(selected);
      toast.success('Default export folder updated');
    } catch (error) {
      console.error('Failed to set summary export folder:', error);
      toast.error('Failed to update export folder', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsExportFolderSaving(false);
    }
  };

  const handleOpenExportFolder = async () => {
    try {
      await invoke('open_summary_export_folder', {
        folder: exportFolder || null,
      });
    } catch (error) {
      console.error('Failed to open summary export folder:', error);
      toast.error('Failed to open folder', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Reusable fetch function
  const fetchModelConfig = useCallback(async () => {
    try {
      const data = await invoke('api_get_model_config') as any;
      if (data && data.provider !== null) {
        // Fetch API key if not included and provider requires it
        if (data.provider !== 'ollama' && data.provider !== 'builtin-ai' && !data.apiKey) {
          try {
            const apiKeyData = await invoke('api_get_api_key', {
              provider: data.provider
            }) as string;
            data.apiKey = apiKeyData;
          } catch (err) {
            console.error('Failed to fetch API key:', err);
          }
        }
        // Fetch Custom OpenAI config if that's the active provider
        if (data.provider === 'custom-openai') {
          try {
            const customConfig = (await invoke('api_get_custom_openai_config')) as any;
            if (customConfig) {
              data.customOpenAIDisplayName = customConfig.displayName || null;
              data.customOpenAIEndpoint = customConfig.endpoint || null;
              data.customOpenAIModel = customConfig.model || null;
              data.customOpenAIApiKey = customConfig.apiKey || null;
              data.maxTokens = customConfig.maxTokens || null;
              data.temperature = customConfig.temperature || null;
              data.topP = customConfig.topP || null;
              // For custom-openai, model field should match customOpenAIModel
              data.model = customConfig.model || data.model;
            }
          } catch (err) {
            console.error('Failed to fetch custom OpenAI config:', err);
          }
        }
        setModelConfig(data);
      }
    } catch (error) {
      console.error('Failed to fetch model config:', error);
      toast.error('Failed to load model settings');
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchModelConfig();
  }, [fetchModelConfig]);

  // Refetch when trigger changes (optional external control)
  useEffect(() => {
    if (refetchTrigger !== undefined && refetchTrigger > 0) {
      fetchModelConfig();
    }
  }, [refetchTrigger, fetchModelConfig]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        console.log('SummaryModelSettings received model-config-updated event:', event.payload);
        setModelConfig(event.payload);
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => cleanup = fn);

    return () => {
      cleanup?.();
    };
  }, []);

  // Save handler
  const handleSaveModelConfig = async (config: ModelConfig) => {
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
      });

      setModelConfig(config);

      // Emit event to sync other components
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

      toast.success('Model settings saved successfully');
    } catch (error) {
      console.error('Error saving model config:', error);
      toast.error('Failed to save model settings');
    }
  };

  return (
    <div className='flex flex-col gap-4'>
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Auto Summary</h3>
            <p className="text-sm text-gray-600">Auto Generating summary after meeting completion(Stopping)</p>
          </div>
          <Switch checked={isAutoSummary} onCheckedChange={toggleIsAutoSummary} />
        </div>
      </div>

      <SummaryLanguageSettings />

      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Default summary export folder</h3>
        <p className="text-sm text-gray-600 mb-4">
          Used as the starting folder when exporting a summary. You can pick a different folder in
          the export dialog without changing this default.
        </p>
        {isExportFolderLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border bg-gray-50 px-3 py-2 font-mono text-sm break-all text-gray-800">
              {exportFolder || 'Not set'}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleChangeExportFolder}
                disabled={isExportFolderSaving}
              >
                {isExportFolderSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Change folder
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleOpenExportFolder}
                disabled={!exportFolder}
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Open folder
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">Summary Model Configuration</h3>
        <p className="text-sm text-gray-600 mb-6">
          Configure the AI model used for generating meeting summaries.
        </p>

        <ModelSettingsModal
          modelConfig={modelConfig}
          setModelConfig={setModelConfig}
          onSave={handleSaveModelConfig}
          skipInitialFetch={true}
        />
      </div>
    </div>
  );
}
