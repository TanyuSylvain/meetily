//! Summary markdown export: default folder prefs, path validation, file write, per-meeting bindings.

use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const PREFS_STORE: &str = "summary_export_preferences.json";
const BINDINGS_STORE: &str = "summary_export_bindings.json";
const PREFS_KEY: &str = "preferences";
const BINDINGS_KEY: &str = "bindings";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SummaryExportPreferences {
    pub export_folder: PathBuf,
}

impl Default for SummaryExportPreferences {
    fn default() -> Self {
        Self {
            export_folder: get_default_summary_export_folder(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SummaryExportPathValidation {
    pub valid: bool,
    pub full_path: Option<String>,
    pub normalized_filename: Option<String>,
    pub error: Option<String>,
}

/// Default export folder: Documents/Meetily Summaries (platform-appropriate).
pub fn get_default_summary_export_folder() -> PathBuf {
    dirs::document_dir()
        .or_else(dirs::download_dir)
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Meetily Summaries")
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        std::fs::create_dir_all(path)
            .map_err(|e| format!("Failed to create directory {}: {}", path.display(), e))?;
        info!("Created summary export directory: {:?}", path);
    }
    Ok(())
}

fn load_preferences_store<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<SummaryExportPreferences, String> {
    let store = match app.store(PREFS_STORE) {
        Ok(store) => store,
        Err(e) => {
            warn!("Failed to access summary export prefs store: {}, using defaults", e);
            return Ok(SummaryExportPreferences::default());
        }
    };

    if let Some(value) = store.get(PREFS_KEY) {
        match serde_json::from_value::<SummaryExportPreferences>(value.clone()) {
            Ok(prefs) => Ok(prefs),
            Err(e) => {
                warn!("Failed to deserialize summary export prefs: {}, using defaults", e);
                Ok(SummaryExportPreferences::default())
            }
        }
    } else {
        Ok(SummaryExportPreferences::default())
    }
}

fn save_preferences_store<R: Runtime>(
    app: &AppHandle<R>,
    preferences: &SummaryExportPreferences,
) -> Result<(), String> {
    let store = app
        .store(PREFS_STORE)
        .map_err(|e| format!("Failed to access store: {}", e))?;

    let value = serde_json::to_value(preferences)
        .map_err(|e| format!("Failed to serialize preferences: {}", e))?;

    store.set(PREFS_KEY, value);
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;
    Ok(())
}

fn load_bindings_map<R: Runtime>(app: &AppHandle<R>) -> HashMap<String, String> {
    let store = match app.store(BINDINGS_STORE) {
        Ok(store) => store,
        Err(e) => {
            warn!("Failed to access summary export bindings store: {}", e);
            return HashMap::new();
        }
    };

    if let Some(value) = store.get(BINDINGS_KEY) {
        serde_json::from_value::<HashMap<String, String>>(value.clone()).unwrap_or_default()
    } else {
        HashMap::new()
    }
}

fn save_bindings_map<R: Runtime>(
    app: &AppHandle<R>,
    bindings: &HashMap<String, String>,
) -> Result<(), String> {
    let store = app
        .store(BINDINGS_STORE)
        .map_err(|e| format!("Failed to access bindings store: {}", e))?;

    let value = serde_json::to_value(bindings)
        .map_err(|e| format!("Failed to serialize bindings: {}", e))?;

    store.set(BINDINGS_KEY, value);
    store
        .save()
        .map_err(|e| format!("Failed to save bindings store: {}", e))?;
    Ok(())
}

/// Normalize a user-provided filename: trim, strip path components, ensure `.md`.
pub fn normalize_export_filename(filename: &str) -> Result<String, String> {
    let trimmed = filename.trim();
    if trimmed.is_empty() {
        return Err("Filename is required".to_string());
    }

    // Reject path traversal / separators in the name itself
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Filename cannot contain path separators".to_string());
    }

    // If user pasted a path-like string, take only the last component as a soft guard
    let base = Path::new(trimmed)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(trimmed)
        .trim();

    if base.is_empty() || base == "." || base == ".." {
        return Err("Invalid filename".to_string());
    }

    if base.contains("..") || base.contains('/') || base.contains('\\') {
        return Err("Filename cannot contain path separators".to_string());
    }

    let mut name = base.to_string();
    if !name.to_lowercase().ends_with(".md") {
        name.push_str(".md");
    }

    // Reject bare extension
    if name.eq_ignore_ascii_case(".md") {
        return Err("Filename cannot be empty".to_string());
    }

    Ok(name)
}

/// Validate folder + filename and return a resolved full path when valid.
pub fn validate_export_path(folder: &str, filename: &str) -> SummaryExportPathValidation {
    let folder_trimmed = folder.trim();
    if folder_trimmed.is_empty() {
        return SummaryExportPathValidation {
            valid: false,
            full_path: None,
            normalized_filename: None,
            error: Some("Export folder is required".to_string()),
        };
    }

    let folder_path = PathBuf::from(folder_trimmed);
    if !folder_path.is_absolute() {
        return SummaryExportPathValidation {
            valid: false,
            full_path: None,
            normalized_filename: None,
            error: Some("Export folder must be an absolute path".to_string()),
        };
    }

    // Folder must exist, or its parent must exist so we can create it on write
    if !folder_path.exists() {
        let parent_ok = folder_path
            .parent()
            .map(|p| p.exists() || p.as_os_str().is_empty())
            .unwrap_or(false);
        if !parent_ok {
            return SummaryExportPathValidation {
                valid: false,
                full_path: None,
                normalized_filename: None,
                error: Some("Export folder does not exist and cannot be created".to_string()),
            };
        }
    } else if !folder_path.is_dir() {
        return SummaryExportPathValidation {
            valid: false,
            full_path: None,
            normalized_filename: None,
            error: Some("Export folder path is not a directory".to_string()),
        };
    }

    let normalized = match normalize_export_filename(filename) {
        Ok(n) => n,
        Err(e) => {
            return SummaryExportPathValidation {
                valid: false,
                full_path: None,
                normalized_filename: None,
                error: Some(e),
            };
        }
    };

    let full_path = folder_path.join(&normalized);
    SummaryExportPathValidation {
        valid: true,
        full_path: Some(full_path.to_string_lossy().to_string()),
        normalized_filename: Some(normalized),
        error: None,
    }
}

fn open_folder_in_os(folder_path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

// --- Tauri commands ---

#[tauri::command]
pub async fn get_summary_export_preferences<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SummaryExportPreferences, String> {
    load_preferences_store(&app)
}

#[tauri::command]
pub async fn set_summary_export_preferences<R: Runtime>(
    app: AppHandle<R>,
    preferences: SummaryExportPreferences,
) -> Result<(), String> {
    ensure_directory(&preferences.export_folder)?;
    save_preferences_store(&app, &preferences)?;
    info!(
        "Saved summary export preferences: folder={:?}",
        preferences.export_folder
    );
    Ok(())
}

#[tauri::command]
pub async fn get_default_summary_export_folder_path() -> Result<String, String> {
    Ok(get_default_summary_export_folder()
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub async fn select_summary_export_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    info!("Opening dialog to select summary export folder");

    let folder = app.dialog().file().blocking_pick_folder();

    if let Some(path) = folder {
        let path_str = path.to_string();
        info!("User selected summary export folder: {}", path_str);
        Ok(Some(path_str))
    } else {
        info!("User cancelled summary export folder selection");
        Ok(None)
    }
}

/// Open a folder. If `folder` is None/empty, open the configured default export folder.
#[tauri::command]
pub async fn open_summary_export_folder<R: Runtime>(
    app: AppHandle<R>,
    folder: Option<String>,
) -> Result<(), String> {
    let folder_path = match folder {
        Some(f) if !f.trim().is_empty() => PathBuf::from(f.trim()),
        _ => load_preferences_store(&app)?.export_folder,
    };

    ensure_directory(&folder_path)?;
    let path_str = folder_path.to_string_lossy().to_string();
    open_folder_in_os(&path_str)?;
    info!("Opened summary export folder: {}", path_str);
    Ok(())
}

#[tauri::command]
pub async fn validate_summary_export_path(
    folder: String,
    filename: String,
) -> Result<SummaryExportPathValidation, String> {
    Ok(validate_export_path(&folder, &filename))
}

#[tauri::command]
pub async fn export_summary_markdown(file_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            ensure_directory(parent)?;
        }
    }

    std::fs::write(&path, content.as_bytes())
        .map_err(|e| format!("Failed to write summary file {}: {}", path.display(), e))?;

    info!("Exported summary markdown to {}", path.display());
    Ok(())
}

#[tauri::command]
pub async fn get_summary_export_binding<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
) -> Result<Option<String>, String> {
    let bindings = load_bindings_map(&app);
    Ok(bindings.get(&meeting_id).cloned())
}

#[tauri::command]
pub async fn set_summary_export_binding<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    file_path: String,
) -> Result<(), String> {
    if meeting_id.trim().is_empty() {
        return Err("meeting_id is required".to_string());
    }
    if file_path.trim().is_empty() {
        return Err("file_path is required".to_string());
    }

    let mut bindings = load_bindings_map(&app);
    bindings.insert(meeting_id.clone(), file_path.clone());
    save_bindings_map(&app, &bindings)?;
    info!(
        "Bound summary export for meeting {} -> {}",
        meeting_id, file_path
    );
    Ok(())
}
