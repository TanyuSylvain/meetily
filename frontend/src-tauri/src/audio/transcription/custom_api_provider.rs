// audio/transcription/custom_api_provider.rs
//
// Custom API ASR provider (MiMo-V2.5-ASR and OpenAI-compatible chat+input_audio endpoints).

use super::provider::{TranscriptionError, TranscriptionProvider, TranscriptResult};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use log::{debug, info, warn};
use serde_json::Value;

const SAMPLE_RATE: u32 = 16_000;
const MIN_SAMPLES: usize = 16_000 / 2; // ~0.5s at 16kHz
const MAX_SAMPLES: usize = 16_000 * 60; // 60s safety cap (~base64 under 10MB easily)
const REQUEST_TIMEOUT_SECS: u64 = 60;

/// Custom HTTP ASR configuration
#[derive(Debug, Clone)]
pub struct CustomApiAsrProvider {
    endpoint: String,
    api_key: Option<String>,
    model: String,
    language: Option<String>,
}

impl CustomApiAsrProvider {
    pub fn new(
        endpoint: String,
        api_key: Option<String>,
        model: String,
        language: Option<String>,
    ) -> Self {
        Self {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            api_key: api_key.filter(|k| !k.trim().is_empty()),
            model,
            language,
        }
    }

    pub fn from_config(config: &crate::database::models::CustomAsrConfig) -> Self {
        Self::new(
            config.endpoint.clone(),
            config.api_key.clone(),
            config.model.clone(),
            config.language.clone(),
        )
    }

    pub fn is_configured(&self) -> bool {
        !self.endpoint.is_empty()
            && !self.model.is_empty()
            && self.api_key.as_ref().map(|k| !k.is_empty()).unwrap_or(false)
    }

    /// Encode mono f32 PCM @ 16kHz as 16-bit little-endian WAV bytes.
    fn encode_wav_pcm16(samples: &[f32]) -> Vec<u8> {
        let mut pcm = Vec::with_capacity(samples.len() * 2);
        for &s in samples {
            let clamped = s.clamp(-1.0, 1.0);
            let i = (clamped * i16::MAX as f32) as i16;
            pcm.extend_from_slice(&i.to_le_bytes());
        }

        let data_size = pcm.len() as u32;
        let file_size = 36 + data_size;
        let channels = 1u16;
        let bits_per_sample = 16u16;
        let block_align = channels * (bits_per_sample / 8);
        let byte_rate = SAMPLE_RATE * block_align as u32;

        let mut wav = Vec::with_capacity(44 + pcm.len());
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&file_size.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
        wav.extend_from_slice(&byte_rate.to_le_bytes());
        wav.extend_from_slice(&block_align.to_le_bytes());
        wav.extend_from_slice(&bits_per_sample.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_size.to_le_bytes());
        wav.extend_from_slice(&pcm);
        wav
    }

    fn chat_completions_url(&self) -> String {
        format!("{}/chat/completions", self.endpoint.trim_end_matches('/'))
    }

    fn build_request_body(&self, audio_data_url: &str, language: Option<&str>) -> Value {
        let lang = language
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                self.language
                    .as_deref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or("auto");

        serde_json::json!({
            "model": self.model,
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "input_audio",
                    "input_audio": {
                        "data": audio_data_url
                    }
                }]
            }],
            "asr_options": {
                "language": lang
            }
        })
    }

    fn extract_text(response: &Value) -> Result<String, TranscriptionError> {
        // choices[0].message.content as string
        if let Some(content) = response
            .pointer("/choices/0/message/content")
            .and_then(|v| v.as_str())
        {
            return Ok(content.trim().to_string());
        }

        // content as array of parts
        if let Some(parts) = response
            .pointer("/choices/0/message/content")
            .and_then(|v| v.as_array())
        {
            let mut text = String::new();
            for part in parts {
                if let Some(t) = part.get("text").and_then(|v| v.as_str()) {
                    if !text.is_empty() {
                        text.push(' ');
                    }
                    text.push_str(t);
                } else if let Some(t) = part.as_str() {
                    if !text.is_empty() {
                        text.push(' ');
                    }
                    text.push_str(t);
                }
            }
            return Ok(text.trim().to_string());
        }

        // Some APIs return top-level text
        if let Some(text) = response.get("text").and_then(|v| v.as_str()) {
            return Ok(text.trim().to_string());
        }

        Err(TranscriptionError::EngineFailed(
            "ASR response missing transcript text".to_string(),
        ))
    }

    async fn post_asr(
        &self,
        audio_samples: &[f32],
        language: Option<String>,
    ) -> Result<String, TranscriptionError> {
        if !self.is_configured() {
            return Err(TranscriptionError::ModelNotLoaded);
        }

        let wav = Self::encode_wav_pcm16(audio_samples);
        let b64 = BASE64.encode(&wav);
        let data_url = format!("data:audio/wav;base64,{}", b64);
        let body = self.build_request_body(&data_url, language.as_deref());
        let url = self.chat_completions_url();

        debug!(
            "Custom API ASR request: url={}, model={}, samples={}, wav_bytes={}",
            url,
            self.model,
            audio_samples.len(),
            wav.len()
        );

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|e| TranscriptionError::EngineFailed(format!("HTTP client error: {}", e)))?;

        let mut request = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body);

        if let Some(ref key) = self.api_key {
            // Bearer (OpenAI SDK style) + api-key (MiMo curl style)
            request = request
                .header("Authorization", format!("Bearer {}", key))
                .header("api-key", key.as_str());
        }

        let response = request.send().await.map_err(|e| {
            TranscriptionError::EngineFailed(format!("ASR request failed: {}", e))
        })?;

        let status = response.status();
        let response_text = response.text().await.map_err(|e| {
            TranscriptionError::EngineFailed(format!("Failed to read ASR response: {}", e))
        })?;

        if !status.is_success() {
            let snippet: String = response_text.chars().take(400).collect();
            return Err(TranscriptionError::EngineFailed(format!(
                "ASR API returned {}: {}",
                status, snippet
            )));
        }

        let json: Value = serde_json::from_str(&response_text).map_err(|e| {
            TranscriptionError::EngineFailed(format!("Invalid ASR JSON response: {}", e))
        })?;

        Self::extract_text(&json)
    }

    /// Public helper for connection testing with a short silent clip.
    pub async fn test_connection(&self) -> Result<String, String> {
        if self.endpoint.is_empty() || self.model.is_empty() {
            return Err("Endpoint and model are required".to_string());
        }
        if !self.endpoint.starts_with("http://") && !self.endpoint.starts_with("https://") {
            return Err("Endpoint must start with http:// or https://".to_string());
        }
        if self.api_key.as_ref().map(|k| k.is_empty()).unwrap_or(true) {
            return Err("API key is required".to_string());
        }

        // ~0.5s of silence at 16kHz
        let silence = vec![0.0f32; MIN_SAMPLES];
        match self.post_asr(&silence, self.language.clone()).await {
            Ok(text) => Ok(if text.is_empty() {
                "Connection successful".to_string()
            } else {
                format!("Connection successful (sample response: {})", text)
            }),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[async_trait]
impl TranscriptionProvider for CustomApiAsrProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        if audio.len() < MIN_SAMPLES {
            return Err(TranscriptionError::AudioTooShort {
                samples: audio.len(),
                minimum: MIN_SAMPLES,
            });
        }

        let audio = if audio.len() > MAX_SAMPLES {
            warn!(
                "Custom API ASR: truncating audio from {} to {} samples",
                audio.len(),
                MAX_SAMPLES
            );
            audio[..MAX_SAMPLES].to_vec()
        } else {
            audio
        };

        let text = self.post_asr(&audio, language).await?;
        if text.is_empty() {
            // Empty is valid (silence) — return empty without error so worker can skip emit if desired
            return Ok(TranscriptResult {
                text: String::new(),
                confidence: None,
                is_partial: false,
            });
        }

        info!("Custom API ASR transcript: {} chars", text.len());
        Ok(TranscriptResult {
            text,
            confidence: None,
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        self.is_configured()
    }

    async fn get_current_model(&self) -> Option<String> {
        if self.model.is_empty() {
            None
        } else {
            Some(self.model.clone())
        }
    }

    fn provider_name(&self) -> &'static str {
        "Custom API"
    }
}
