import type { ThemeConfig } from "./types";

export type LineType =
  | "header"
  | "chat"
  | "whisper_from"
  | "whisper_to"
  | "party"
  | "guild"
  | "system"
  | "continuation"
  | "plain";

export interface ParsedLine {
  type: LineType;
  timestamp?: string;
  prefix?: string;
  speaker?: string;
  body?: string;
  raw: string;
}

// Matches: " HH:MM:SS  <rest>"  (1-2 leading spaces, timestamp, 2 spaces, content)
const TIMESTAMP_RE = /^ {1,2}(\d{2}:\d{2}:\d{2})  (.+)$/;
// Continuation: timestamp followed by 4+ spaces then text (no speaker:)
// e.g. " 11:42:29    す☆"
const CONTINUATION_TS_RE = /^ {1,2}(\d{2}:\d{2}:\d{2})    (.+)$/;
// Matches: "[PREFIX]Speaker: body"
// Delimiter is ": " (half-width colon + space) to avoid splitting on colons within names
const CHAT_RE = /^(\[(?:FROM|TO|PT|GL)\])?\s*(.+?): (.*)$/;
const HEADER_LINE_RE = /^[=|∫]/;

export function parseLine(line: string): ParsedLine {
  const trimmed = line.replace(/\r$/, "");

  if (!trimmed || HEADER_LINE_RE.test(trimmed.trim())) {
    return { type: "header", raw: trimmed };
  }

  // Check for continuation line WITH timestamp (same timestamp, 4+ spaces, text only)
  const contTsMatch = trimmed.match(CONTINUATION_TS_RE);
  if (contTsMatch) {
    const rest = contTsMatch[2];
    // If the rest doesn't contain a colon, it's a continuation
    if (!rest.includes(":") && !rest.includes("：")) {
      return { type: "continuation", timestamp: contTsMatch[1], body: rest.trimStart(), raw: trimmed };
    }
  }

  const tsMatch = trimmed.match(TIMESTAMP_RE);
  if (!tsMatch) {
    // Continuation: indented line without timestamp
    if (/^ {2,}/.test(trimmed) && !/^ {1,2}\d{2}:/.test(trimmed)) {
      return { type: "continuation", body: trimmed.replace(/^ +/, ""), raw: trimmed };
    }
    return { type: "plain", raw: trimmed };
  }

  const timestamp = tsMatch[1];
  const rest = tsMatch[2];

  const chatMatch = rest.match(CHAT_RE);
  if (chatMatch) {
    const prefix = chatMatch[1] || "";
    const speaker = chatMatch[2].trim();
    const body = chatMatch[3];

    // Heuristic: if "speaker" looks like a system msg (contains は/を/の and no actual name-like pattern)
    // then treat as system. But only if there's no prefix.
    if (
      !prefix &&
      !body &&
      /[はをのがで]/.test(speaker) &&
      speaker.length > 15
    ) {
      return { type: "system", timestamp, body: rest, raw: trimmed };
    }

    let type: LineType = "chat";
    if (prefix === "[FROM]") type = "whisper_from";
    else if (prefix === "[TO]") type = "whisper_to";
    else if (prefix === "[PT]") type = "party";
    else if (prefix === "[GL]") type = "guild";

    return { type, timestamp, prefix, speaker, body, raw: trimmed };
  }

  return { type: "system", timestamp, body: rest, raw: trimmed };
}

export function renderSyntaxLine(
  parsed: ParsedLine,
  theme: ThemeConfig
): Array<{ text: string; color: string }> {
  const segments: Array<{ text: string; color: string }> = [];

  // Only highlight timestamps; everything else uses default text color
  if (parsed.timestamp) {
    const tsIdx = parsed.raw.indexOf(parsed.timestamp);
    if (tsIdx > 0) segments.push({ text: parsed.raw.slice(0, tsIdx), color: theme.synTimestamp });
    segments.push({ text: parsed.timestamp, color: theme.synTimestamp });
    // Remaining part after timestamp
    const afterTs = parsed.raw.slice(tsIdx + parsed.timestamp.length);
    if (afterTs) segments.push({ text: afterTs, color: theme.text });
  } else {
    segments.push({ text: parsed.raw || "\u00A0", color: theme.text });
  }

  return segments;
}

// --- Formatting ---

const ANIMAL_NAMES = [
  "パンダ", "ウサギ", "キツネ", "タヌキ", "ネコ", "イヌ", "クマ", "トリ",
  "サル", "シカ", "リス", "カメ", "ヒツジ", "ウマ", "ブタ", "ゾウ",
  "ライオン", "トラ", "ペンギン", "コアラ", "カワウソ", "フクロウ",
  "ハムスター", "アザラシ", "ラッコ", "カピバラ", "レッサーパンダ", "ハリネズミ",
  "モモンガ", "チンチラ",
];

// Regex to match a name at the START of a system message body, followed by a particle.
// "Name が...", "Name は...", "Name から...", "Name と...", "Name に...", "Name の..."
const SYS_NAME_PARTICLE_RE = /^(.+?) (が|は|の|を|と|から|に)/;

export class Anonymizer {
  private map: Map<string, string>;

  constructor(allNames: string[]) {
    this.map = new Map();
    for (let i = 0; i < allNames.length; i++) {
      this.map.set(allNames[i], ANIMAL_NAMES[i % ANIMAL_NAMES.length]);
    }
  }

  anonymizeLine(line: string): string {
    const parsed = parseLine(line);

    // Chat lines: replace speaker structurally (position is certain)
    if (parsed.speaker && parsed.timestamp) {
      const tsIdx = parsed.raw.indexOf(parsed.timestamp);
      const leading = parsed.raw.slice(0, tsIdx);
      const prefix = parsed.prefix || "";
      const replacement = this.map.get(parsed.speaker) ?? parsed.speaker;
      const body = parsed.body ?? "";
      return `${leading}${parsed.timestamp}  ${prefix}${replacement}: ${body}`;
    }

    // System lines: replace name only at the start of body, before a particle
    if (parsed.type === "system" && parsed.timestamp && parsed.body) {
      const m = parsed.body.match(SYS_NAME_PARTICLE_RE);
      if (m) {
        const name = m[1];
        const replacement = this.map.get(name);
        if (replacement) {
          const tsIdx = parsed.raw.indexOf(parsed.timestamp);
          const leading = parsed.raw.slice(0, tsIdx);
          const newBody = replacement + parsed.body.slice(name.length);
          return `${leading}${parsed.timestamp}  ${newBody}`;
        }
      }
    }

    // Everything else: no replacement
    return line;
  }
}

export interface MergedLine {
  merged: string;
  originalIndices: number[];
}

// Sentence-ending characters: if the previous line ends with one of these,
// it's complete and the next line is NOT a continuation.
const SENTENCE_END_RE = /[。！!？?）\)☆♪♡w]+$/;

export function mergeContinuationLines(lines: string[]): MergedLine[] {
  const result: MergedLine[] = [];
  let current: MergedLine | null = null;
  let prevParsed: ParsedLine | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parseLine(line);

    // Explicit continuation (indented, no timestamp)
    const isExplicitContinuation = parsed.type === "continuation";

    // Implicit continuation: same timestamp + system line following same-type line
    // Only merge when the previous line was ALSO a system line (no speaker),
    // and it looks cut off (no sentence-ending punctuation).
    // Never merge a system line after a chat/whisper/party/guild line.
    let isImplicitContinuation = false;
    if (
      prevParsed &&
      current &&
      parsed.timestamp &&
      prevParsed.timestamp === parsed.timestamp &&
      parsed.type === "system" &&
      prevParsed.type === "system"
    ) {
      const prevText = current.merged.trimEnd();
      isImplicitContinuation = !SENTENCE_END_RE.test(prevText);
    }

    if ((isExplicitContinuation || isImplicitContinuation) && current) {
      const bodyToAppend = parsed.body || "";
      current.merged += bodyToAppend;
      current.originalIndices.push(i);
    } else {
      if (current) result.push(current);
      current = { merged: line, originalIndices: [i] };
      prevParsed = parsed;
    }
  }
  if (current) result.push(current);

  return result;
}

