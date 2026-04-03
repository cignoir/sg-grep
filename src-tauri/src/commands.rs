use encoding_rs::SHIFT_JIS;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use walkdir::WalkDir;

// --- Config (portable: stored next to the executable) ---

#[derive(Serialize, Deserialize, Clone)]
pub struct AppConfig {
    #[serde(default)]
    pub last_directory: Option<String>,
    #[serde(default)]
    pub theme: serde_json::Value,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            last_directory: None,
            theme: serde_json::Value::Object(serde_json::Map::new()),
        }
    }
}

fn config_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    exe.parent().unwrap_or(Path::new(".")).join("config.json")
}

#[tauri::command]
pub fn load_config() -> AppConfig {
    let path = config_path();
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> Result<(), String> {
    let path = config_path();
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

// --- In-memory cache ---

#[derive(Clone)]
struct CachedFile {
    path: String,
    name: String,
    folder: String,
    content: String,
    lines: Vec<String>,
    lines_lower: Vec<String>,
}

static FILE_CACHE: std::sync::LazyLock<Mutex<Vec<CachedFile>>> =
    std::sync::LazyLock::new(|| Mutex::new(Vec::new()));

fn read_sjis_file(path: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;
    let (cow, _, _) = SHIFT_JIS.decode(&bytes);
    // Strip \r so lines are clean
    Ok(cow.replace('\r', ""))
}

// --- Directory scanning (reads all files into cache) ---

#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct FolderGroup {
    pub folder: String,
    pub files: Vec<FileEntry>,
}

#[tauri::command]
pub fn scan_directory(dir: String) -> Result<Vec<FolderGroup>, String> {
    let base = Path::new(&dir);
    if !base.is_dir() {
        return Err("Directory not found".into());
    }

    let mut cached_files = Vec::new();
    let mut groups: BTreeMap<String, Vec<FileEntry>> = BTreeMap::new();

    for entry in WalkDir::new(base).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if n.starts_with("chat_") && n.ends_with(".txt") => n.to_string(),
            _ => continue,
        };

        let path_str = path.to_string_lossy().replace('\\', "/");
        let folder = path
            .parent()
            .unwrap_or(base)
            .strip_prefix(base)
            .unwrap_or(Path::new(""))
            .to_string_lossy()
            .replace('\\', "/");
        let folder_key = if folder.is_empty() {
            ".".to_string()
        } else {
            folder.clone()
        };

        let content = read_sjis_file(&path_str).unwrap_or_default();
        let lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
        let lines_lower: Vec<String> = lines.iter().map(|l| l.to_lowercase()).collect();

        cached_files.push(CachedFile {
            path: path_str.clone(),
            name: name.clone(),
            folder: folder_key.clone(),
            content,
            lines,
            lines_lower,
        });

        groups
            .entry(folder_key)
            .or_default()
            .push(FileEntry {
                path: path_str,
                name,
            });
    }

    *FILE_CACHE.lock().unwrap() = cached_files;

    let result: Vec<FolderGroup> = groups
        .into_iter()
        .map(|(folder, mut files)| {
            files.sort_by(|a, b| a.name.cmp(&b.name));
            FolderGroup { folder, files }
        })
        .collect();

    Ok(result)
}

// --- File reading (from cache) ---

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let cache = FILE_CACHE.lock().unwrap();
    if let Some(f) = cache.iter().find(|f| f.path == path) {
        return Ok(f.content.clone());
    }
    drop(cache);
    read_sjis_file(&path)
}

// --- Extract all speaker names across all cached files ---

#[tauri::command]
pub fn collect_all_names() -> Vec<String> {
    let cache = FILE_CACHE.lock().unwrap();

    // Chat lines: "HH:MM:SS  [PREFIX]Name: message" (half-width colon + space)
    let chat_re = regex::Regex::new(
        r"^ {1,2}\d{2}:\d{2}:\d{2}  (?:\[(?:FROM|TO|PT|GL)\])?\s*(.+?): "
    ).unwrap();

    // System lines: "HH:MM:SS  Name PARTICLE ..."
    // Extract name before common particles that follow player names
    let sys_re = regex::Regex::new(
        r"^ {1,2}\d{2}:\d{2}:\d{2}  (.+?) (?:が|は|の|を|と|から|に|とトレード|からの|にメール)"
    ).unwrap();

    let mut seen_set = std::collections::HashSet::new();
    let mut names = Vec::new();

    for file in cache.iter() {
        for line in &file.lines {
            // Try chat pattern first
            if let Some(caps) = chat_re.captures(line) {
                let name = caps[1].trim().to_string();
                if !name.is_empty() && seen_set.insert(name.clone()) {
                    names.push(name);
                }
                continue;
            }
            // Try system pattern (no colon = not a chat line)
            if !line.contains(':') || line.matches(':').count() == 1 {
                // Only match lines with timestamp (1 colon in timestamp)
            }
            if let Some(caps) = sys_re.captures(line) {
                let name = caps[1].trim().to_string();
                // Skip names that look like items/skills (contain common item/skill words)
                if !name.is_empty()
                    && !name.contains("経験値")
                    && !name.contains("アイテム")
                    && !name.contains("スタンプ")
                    && !name.contains("掃討")
                    && !name.contains("バザー")
                    && seen_set.insert(name.clone())
                {
                    names.push(name);
                }
            }
        }
    }
    names
}

// --- Query parsing: AND(&), OR(|), NOT(-) ---

enum QueryTerm {
    Must(String),    // plain term: must contain
    Not(String),     // -term: must NOT contain
}

struct ParsedQuery {
    // Groups joined by OR. Each group is a Vec of AND/NOT terms.
    or_groups: Vec<Vec<QueryTerm>>,
}

impl ParsedQuery {
    fn is_empty(&self) -> bool {
        self.or_groups.is_empty()
    }

    fn matches(&self, line_lower: &str) -> bool {
        self.or_groups.iter().any(|group| {
            group.iter().all(|term| match term {
                QueryTerm::Must(t) => line_lower.contains(t.as_str()),
                QueryTerm::Not(t) => !line_lower.contains(t.as_str()),
            })
        })
    }

    /// Return the first positive (Must) term for excerpt building
    fn first_positive_term(&self) -> Option<&str> {
        for group in &self.or_groups {
            for term in group {
                if let QueryTerm::Must(t) = term {
                    return Some(t.as_str());
                }
            }
        }
        None
    }
}

fn parse_query(query: &str) -> ParsedQuery {
    let query_lower = query.to_lowercase();

    // Split by | for OR groups
    let or_parts: Vec<&str> = query_lower.split('|').collect();

    let or_groups: Vec<Vec<QueryTerm>> = or_parts
        .iter()
        .filter_map(|part| {
            // Split by & for AND terms, also split by whitespace within each &-group
            let terms: Vec<QueryTerm> = part
                .split('&')
                .flat_map(|s| s.split_whitespace())
                .filter(|s| !s.is_empty())
                .map(|s| {
                    if let Some(rest) = s.strip_prefix('-') {
                        if rest.is_empty() {
                            QueryTerm::Must(s.to_string())
                        } else {
                            QueryTerm::Not(rest.to_string())
                        }
                    } else {
                        QueryTerm::Must(s.to_string())
                    }
                })
                .collect();

            if terms.is_empty() {
                None
            } else {
                Some(terms)
            }
        })
        .collect();

    ParsedQuery { or_groups }
}

// --- Full-text search (from cache, pure memory) ---

#[derive(Serialize)]
pub struct SearchHit {
    pub line_number: usize,
    pub line: String,
    pub excerpt: String,
}

#[derive(Serialize)]
pub struct FileSearchResult {
    pub path: String,
    pub name: String,
    pub folder: String,
    pub hits: Vec<SearchHit>,
}

/// Build a short excerpt centered around the query match
fn build_excerpt(line: &str, query_lower: &str, max_len: usize) -> String {
    let line_lower = line.to_lowercase();
    let Some(pos) = line_lower.find(query_lower) else {
        return line.chars().take(max_len).collect();
    };

    let chars: Vec<char> = line.chars().collect();
    let char_pos = line_lower.char_indices()
        .position(|(byte_idx, _)| byte_idx == pos)
        .unwrap_or(0);

    let half = max_len / 2;
    let start = char_pos.saturating_sub(half);
    let end = (start + max_len).min(chars.len());
    let start = if end == chars.len() { end.saturating_sub(max_len) } else { start };

    let mut excerpt: String = chars[start..end].iter().collect();
    if start > 0 {
        excerpt = format!("…{}", excerpt.trim_start());
    }
    if end < chars.len() {
        excerpt = format!("{}…", excerpt.trim_end());
    }
    excerpt
}

#[tauri::command]
pub fn search_files(dir: String, query: String) -> Result<Vec<FileSearchResult>, String> {
    let _ = dir;
    if query.is_empty() {
        return Ok(vec![]);
    }

    let parsed = parse_query(&query);
    if parsed.is_empty() {
        return Ok(vec![]);
    }

    let excerpt_term = parsed.first_positive_term().unwrap_or("").to_string();
    let cache = FILE_CACHE.lock().unwrap();
    let mut results = Vec::new();

    for file in cache.iter() {
        let hits: Vec<SearchHit> = file
            .lines
            .iter()
            .zip(file.lines_lower.iter())
            .enumerate()
            .filter_map(|(i, (line, line_lower))| {
                if parsed.matches(line_lower) {
                    Some(SearchHit {
                        line_number: i,
                        line: line.clone(),
                        excerpt: build_excerpt(line, &excerpt_term, 40),
                    })
                } else {
                    None
                }
            })
            .collect();

        if !hits.is_empty() {
            results.push(FileSearchResult {
                path: file.path.clone(),
                name: file.name.clone(),
                folder: file.folder.clone(),
                hits,
            });
        }
    }

    results.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(results)
}
