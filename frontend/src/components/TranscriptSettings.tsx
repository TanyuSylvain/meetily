import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Eye, EyeOff, Lock, Unlock, Loader2 } from 'lucide-react';
import { ModelManager } from './WhisperModelManager';
import { ParakeetModelManager } from './ParakeetModelManager';
import { toast } from 'sonner';

export interface TranscriptModelProps {
    provider: 'localWhisper' | 'parakeet' | 'custom-api' | 'deepgram' | 'elevenLabs' | 'groq' | 'openai';
    model: string;
    apiKey?: string | null;
    customAsrEndpoint?: string | null;
    customAsrModel?: string | null;
    customAsrApiKey?: string | null;
    customAsrLanguage?: string | null;
}

export interface TranscriptSettingsProps {
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onModelSelect?: () => void;
}

export function TranscriptSettings({ transcriptModelConfig, setTranscriptModelConfig, onModelSelect }: TranscriptSettingsProps) {
    const [apiKey, setApiKey] = useState<string | null>(transcriptModelConfig.apiKey || null);
    const [showApiKey, setShowApiKey] = useState<boolean>(false);
    const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(true);
    const [isLockButtonVibrating, setIsLockButtonVibrating] = useState<boolean>(false);
    const [uiProvider, setUiProvider] = useState<TranscriptModelProps['provider']>(transcriptModelConfig.provider);

    // Custom API local form state
    const [customEndpoint, setCustomEndpoint] = useState(transcriptModelConfig.customAsrEndpoint || '');
    const [customModel, setCustomModel] = useState(transcriptModelConfig.customAsrModel || 'mimo-v2.5-asr');
    const [customApiKey, setCustomApiKey] = useState(transcriptModelConfig.customAsrApiKey || '');
    const [customLanguage, setCustomLanguage] = useState(transcriptModelConfig.customAsrLanguage || 'auto');
    const [showCustomApiKey, setShowCustomApiKey] = useState(false);
    const [isCustomKeyLocked, setIsCustomKeyLocked] = useState(true);
    const [isSavingCustom, setIsSavingCustom] = useState(false);
    const [isTestingCustom, setIsTestingCustom] = useState(false);

    // Sync uiProvider when backend config changes
    useEffect(() => {
        setUiProvider(transcriptModelConfig.provider);
    }, [transcriptModelConfig.provider]);

    useEffect(() => {
        if (transcriptModelConfig.provider === 'localWhisper' || transcriptModelConfig.provider === 'parakeet') {
            setApiKey(null);
        }
    }, [transcriptModelConfig.provider]);

    // Load custom ASR config when switching to custom-api or on mount
    const loadCustomAsrConfig = useCallback(async () => {
        try {
            const cfg = await invoke<{
                endpoint: string;
                apiKey?: string | null;
                model: string;
                language?: string | null;
            } | null>('api_get_custom_asr_config');
            if (cfg) {
                setCustomEndpoint(cfg.endpoint || '');
                setCustomModel(cfg.model || 'mimo-v2.5-asr');
                setCustomApiKey(cfg.apiKey || '');
                setCustomLanguage(cfg.language || 'auto');
                setTranscriptModelConfig({
                    ...transcriptModelConfig,
                    provider: transcriptModelConfig.provider === 'custom-api' ? 'custom-api' : transcriptModelConfig.provider,
                    model: transcriptModelConfig.provider === 'custom-api' ? (cfg.model || transcriptModelConfig.model) : transcriptModelConfig.model,
                    customAsrEndpoint: cfg.endpoint,
                    customAsrModel: cfg.model,
                    customAsrApiKey: cfg.apiKey ?? null,
                    customAsrLanguage: cfg.language ?? 'auto',
                });
            }
        } catch (err) {
            console.error('Failed to load custom ASR config:', err);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (uiProvider === 'custom-api') {
            loadCustomAsrConfig();
        }
    }, [uiProvider, loadCustomAsrConfig]);

    // Sync from parent props when they change
    useEffect(() => {
        if (transcriptModelConfig.customAsrEndpoint !== undefined) {
            setCustomEndpoint(transcriptModelConfig.customAsrEndpoint || '');
        }
        if (transcriptModelConfig.customAsrModel !== undefined) {
            setCustomModel(transcriptModelConfig.customAsrModel || 'mimo-v2.5-asr');
        }
        if (transcriptModelConfig.customAsrApiKey !== undefined) {
            setCustomApiKey(transcriptModelConfig.customAsrApiKey || '');
        }
        if (transcriptModelConfig.customAsrLanguage !== undefined) {
            setCustomLanguage(transcriptModelConfig.customAsrLanguage || 'auto');
        }
    }, [
        transcriptModelConfig.customAsrEndpoint,
        transcriptModelConfig.customAsrModel,
        transcriptModelConfig.customAsrApiKey,
        transcriptModelConfig.customAsrLanguage,
    ]);

    const fetchApiKey = async (provider: string) => {
        try {
            const data = await invoke('api_get_transcript_api_key', { provider }) as string;
            setApiKey(data || '');
        } catch (err) {
            console.error('Error fetching API key:', err);
            setApiKey(null);
        }
    };

    const modelOptions = {
        localWhisper: [] as string[],
        parakeet: [] as string[],
        'custom-api': [] as string[],
        deepgram: ['nova-2-phonecall'],
        elevenLabs: ['eleven_multilingual_v2'],
        groq: ['llama-3.3-70b-versatile'],
        openai: ['gpt-4o'],
    };

    const requiresApiKey =
        transcriptModelConfig.provider === 'deepgram' ||
        transcriptModelConfig.provider === 'elevenLabs' ||
        transcriptModelConfig.provider === 'openai' ||
        transcriptModelConfig.provider === 'groq';

    const handleInputClick = () => {
        if (isApiKeyLocked) {
            setIsLockButtonVibrating(true);
            setTimeout(() => setIsLockButtonVibrating(false), 500);
        }
    };

    const handleWhisperModelSelect = (modelName: string) => {
        setTranscriptModelConfig({
            ...transcriptModelConfig,
            provider: 'localWhisper',
            model: modelName
        });
        if (onModelSelect) {
            onModelSelect();
        }
    };

    const handleParakeetModelSelect = (modelName: string) => {
        setTranscriptModelConfig({
            ...transcriptModelConfig,
            provider: 'parakeet',
            model: modelName
        });
        if (onModelSelect) {
            onModelSelect();
        }
    };

    const handleSaveCustomApi = async () => {
        const endpoint = customEndpoint.trim();
        const model = customModel.trim();
        if (!endpoint) {
            toast.error('Endpoint URL is required');
            return;
        }
        if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
            toast.error('Endpoint must start with http:// or https://');
            return;
        }
        if (!model) {
            toast.error('Model name is required');
            return;
        }
        if (!customApiKey.trim()) {
            toast.error('API key is required');
            return;
        }

        setIsSavingCustom(true);
        try {
            await invoke('api_save_custom_asr_config', {
                endpoint,
                apiKey: customApiKey.trim(),
                model,
                language: customLanguage === 'auto' ? 'auto' : customLanguage,
            });

            setTranscriptModelConfig({
                provider: 'custom-api',
                model,
                apiKey: customApiKey.trim(),
                customAsrEndpoint: endpoint,
                customAsrModel: model,
                customAsrApiKey: customApiKey.trim(),
                customAsrLanguage: customLanguage,
            });
            setUiProvider('custom-api');
            toast.success('Custom API transcription settings saved');
            if (onModelSelect) {
                onModelSelect();
            }
        } catch (error) {
            console.error('Failed to save custom ASR config:', error);
            toast.error('Failed to save settings', {
                description: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setIsSavingCustom(false);
        }
    };

    const handleTestCustomApi = async () => {
        const endpoint = customEndpoint.trim();
        const model = customModel.trim();
        if (!endpoint || !model || !customApiKey.trim()) {
            toast.error('Fill in endpoint, model, and API key before testing');
            return;
        }

        setIsTestingCustom(true);
        try {
            const result = await invoke<{ status: string; message: string }>('api_test_custom_asr_connection', {
                endpoint,
                apiKey: customApiKey.trim(),
                model,
                language: customLanguage || 'auto',
            });
            toast.success('Connection successful', {
                description: result?.message || 'Custom ASR endpoint responded successfully',
            });
        } catch (error) {
            console.error('Custom ASR test failed:', error);
            toast.error('Connection failed', {
                description: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setIsTestingCustom(false);
        }
    };

    return (
        <div>
            <div>
                <div className="space-y-4 pb-6">
                    <div>
                        <Label className="block text-sm font-medium text-gray-700 mb-1">
                            Transcript Model
                        </Label>
                        <div className="flex space-x-2 mx-1">
                            <Select
                                value={uiProvider}
                                onValueChange={(value) => {
                                    const provider = value as TranscriptModelProps['provider'];
                                    setUiProvider(provider);
                                    if (provider === 'custom-api') {
                                        setTranscriptModelConfig({
                                            ...transcriptModelConfig,
                                            provider: 'custom-api',
                                            model: customModel || 'mimo-v2.5-asr',
                                        });
                                    } else if (provider !== 'localWhisper' && provider !== 'parakeet') {
                                        fetchApiKey(provider);
                                    } else {
                                        setTranscriptModelConfig({
                                            ...transcriptModelConfig,
                                            provider,
                                        });
                                    }
                                }}
                            >
                                <SelectTrigger className='focus:ring-1 focus:ring-blue-500 focus:border-blue-500'>
                                    <SelectValue placeholder="Select provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="parakeet">⚡ Parakeet (Recommended - Real-time / Accurate)</SelectItem>
                                    <SelectItem value="localWhisper">🏠 Local Whisper (High Accuracy)</SelectItem>
                                    <SelectItem value="custom-api">☁️ Custom API (MiMo / OpenAI-compatible ASR)</SelectItem>
                                </SelectContent>
                            </Select>

                            {uiProvider !== 'localWhisper' && uiProvider !== 'parakeet' && uiProvider !== 'custom-api' && (
                                <Select
                                    value={transcriptModelConfig.model}
                                    onValueChange={(value) => {
                                        const model = value as TranscriptModelProps['model'];
                                        setTranscriptModelConfig({ ...transcriptModelConfig, provider: uiProvider, model });
                                    }}
                                >
                                    <SelectTrigger className='focus:ring-1 focus:ring-blue-500 focus:border-blue-500'>
                                        <SelectValue placeholder="Select model" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {modelOptions[uiProvider].map((model) => (
                                            <SelectItem key={model} value={model}>{model}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}

                        </div>
                    </div>

                    {uiProvider === 'localWhisper' && (
                        <div className="mt-6">
                            <ModelManager
                                selectedModel={transcriptModelConfig.provider === 'localWhisper' ? transcriptModelConfig.model : undefined}
                                onModelSelect={handleWhisperModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}

                    {uiProvider === 'parakeet' && (
                        <div className="mt-6">
                            <ParakeetModelManager
                                selectedModel={transcriptModelConfig.provider === 'parakeet' ? transcriptModelConfig.model : undefined}
                                onModelSelect={handleParakeetModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}

                    {uiProvider === 'custom-api' && (
                        <div className="mt-4 space-y-4 border rounded-lg p-4 bg-gray-50">
                            <div>
                                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4">
                                    Audio is sent to the configured API endpoint for transcription. Use a trusted provider and review their privacy policy.
                                </p>
                                <Label className="block text-sm font-medium text-gray-700 mb-1">
                                    Base URL
                                </Label>
                                <Input
                                    value={customEndpoint}
                                    onChange={(e) => setCustomEndpoint(e.target.value)}
                                    placeholder="https://token-plan-cn.xiaomimimo.com/v1"
                                    className="font-mono text-sm"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    OpenAI-compatible base URL (requests go to {'{base}'}/chat/completions with input_audio).
                                </p>
                            </div>

                            <div>
                                <Label className="block text-sm font-medium text-gray-700 mb-1">
                                    Model
                                </Label>
                                <Input
                                    value={customModel}
                                    onChange={(e) => setCustomModel(e.target.value)}
                                    placeholder="mimo-v2.5-asr"
                                />
                            </div>

                            <div>
                                <Label className="block text-sm font-medium text-gray-700 mb-1">
                                    API Key
                                </Label>
                                <div className="relative">
                                    <Input
                                        type={showCustomApiKey ? 'text' : 'password'}
                                        className={`pr-24 ${isCustomKeyLocked ? 'bg-gray-100' : ''}`}
                                        value={customApiKey}
                                        onChange={(e) => setCustomApiKey(e.target.value)}
                                        disabled={isCustomKeyLocked}
                                        placeholder="Enter your API key"
                                    />
                                    <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setIsCustomKeyLocked(!isCustomKeyLocked)}
                                            title={isCustomKeyLocked ? 'Unlock to edit' : 'Lock'}
                                        >
                                            {isCustomKeyLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setShowCustomApiKey(!showCustomApiKey)}
                                        >
                                            {showCustomApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <Label className="block text-sm font-medium text-gray-700 mb-1">
                                    Language
                                </Label>
                                <Select value={customLanguage} onValueChange={setCustomLanguage}>
                                    <SelectTrigger className="w-full max-w-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="auto">Auto-detect</SelectItem>
                                        <SelectItem value="zh">Chinese (zh)</SelectItem>
                                        <SelectItem value="en">English (en)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex flex-wrap gap-2 pt-2">
                                <Button
                                    type="button"
                                    onClick={handleSaveCustomApi}
                                    disabled={isSavingCustom}
                                >
                                    {isSavingCustom && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                                    Save
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleTestCustomApi}
                                    disabled={isTestingCustom}
                                >
                                    {isTestingCustom && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                                    Test connection
                                </Button>
                            </div>
                        </div>
                    )}

                    {requiresApiKey && (
                        <div>
                            <Label className="block text-sm font-medium text-gray-700 mb-1">
                                API Key
                            </Label>
                            <div className="relative mx-1">
                                <Input
                                    type={showApiKey ? "text" : "password"}
                                    className={`pr-24 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${isApiKeyLocked ? 'bg-gray-100 cursor-not-allowed' : ''
                                        }`}
                                    value={apiKey || ''}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    disabled={isApiKeyLocked}
                                    onClick={handleInputClick}
                                    placeholder="Enter your API key"
                                />
                                {isApiKeyLocked && (
                                    <div
                                        onClick={handleInputClick}
                                        className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-50 rounded-md cursor-not-allowed"
                                    />
                                )}
                                <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
                                        className={`transition-colors duration-200 ${isLockButtonVibrating ? 'animate-vibrate text-red-500' : ''
                                            }`}
                                        title={isApiKeyLocked ? "Unlock to edit" : "Lock to prevent editing"}
                                    >
                                        {isApiKeyLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setShowApiKey(!showApiKey)}
                                    >
                                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div >
    )
}
