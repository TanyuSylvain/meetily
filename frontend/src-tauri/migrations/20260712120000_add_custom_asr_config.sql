-- Custom API transcription (OpenAI-compatible / MiMo-style ASR) configuration
-- Stored as JSON: { endpoint, apiKey, model, language? }
ALTER TABLE transcript_settings ADD COLUMN customAsrConfig TEXT;
