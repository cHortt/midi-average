export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export type NoteEvent = {
  id: string;
  midi: number;
  duration: number;
};

export const EXAMPLE_NOTES: NoteEvent[] = [
  { id: "ex-c4", midi: 60, duration: 1 },
  { id: "ex-e4", midi: 64, duration: 1 },
  { id: "ex-g4", midi: 67, duration: 2 },
  { id: "ex-c5", midi: 72, duration: 1 },
];

const FLATS: Record<string, { name: string; octaveShift: number }> = {
  Cb: { name: "B", octaveShift: -1 },
  Db: { name: "C#", octaveShift: 0 },
  Eb: { name: "D#", octaveShift: 0 },
  Fb: { name: "E", octaveShift: 0 },
  Gb: { name: "F#", octaveShift: 0 },
  Ab: { name: "G#", octaveShift: 0 },
  Bb: { name: "A#", octaveShift: 0 },
  "E#": { name: "F", octaveShift: 0 },
  "B#": { name: "C", octaveShift: 1 },
};

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiToName(midi: number): string {
  const n = Math.round(midi);
  const pc = ((n % 12) + 12) % 12;
  const octave = Math.floor(n / 12) - 1;
  return `${NOTE_NAMES[pc]}${octave}`;
}

export function nameToMidi(input: string): number | null {
  const t = input.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(t);
  if (!match) return null;
  let letter = match[1].toUpperCase() + (match[2] ?? "");
  let octave = Number(match[3]);
  const enharmonic = FLATS[letter];
  if (enharmonic) {
    letter = enharmonic.name;
    octave += enharmonic.octaveShift;
  }
  const pc = NOTE_NAMES.indexOf(letter as (typeof NOTE_NAMES)[number]);
  if (pc < 0) return null;
  const midi = (octave + 1) * 12 + pc;
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) return null;
  return midi;
}

/** MIDI number 0–127, or a note name such as C4 / F#3 / Bb2. */
export function parsePitch(input: string): number | null {
  const t = input.trim();
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (n >= 0 && n <= 127) return n;
    return null;
  }
  return nameToMidi(t);
}

/** Positive duration: a decimal or a fraction such as 1/2. */
export function parseDuration(input: string): number | null {
  const t = input.trim();
  const frac = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    const n = Number(frac[1]) / den;
    if (n > 0 && n <= 1_000_000 && Number.isFinite(n)) return n;
    return null;
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (n > 0 && n <= 1_000_000 && Number.isFinite(n)) return n;
  return null;
}

export type ParsedPair = { midi: number; duration: number };

export function parseLine(line: string): ParsedPair | null | "empty" {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return "empty";
  if (/^(note|midi|pitch|duration)\b/i.test(trimmed)) return "empty";
  const parts = trimmed.split(/[\s,;:|]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const midi = parsePitch(parts[0] ?? "");
  const duration = parseDuration(parts[1] ?? "");
  if (midi == null || duration == null) return null;
  return { midi, duration };
}

export type MeanStats = {
  mean: number | null;
  total: number;
  moment: number;
  plain: number | null;
};

export function weightedMean(notes: { midi: number; duration: number }[]): MeanStats {
  let total = 0;
  let moment = 0;
  let sum = 0;
  for (const note of notes) {
    total += note.duration;
    moment += note.midi * note.duration;
    sum += note.midi;
  }
  return {
    mean: total > 0 ? moment / total : null,
    total,
    moment,
    plain: notes.length > 0 ? sum / notes.length : null,
  };
}

export function nearestNote(midi: number): { nearest: number; cents: number } {
  const nearest = Math.round(midi);
  return { nearest, cents: (midi - nearest) * 100 };
}

export function formatNumber(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return "—";
  return n
    .toFixed(digits)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

export function formatCents(cents: number): string {
  const rounded = Math.round(cents * 10) / 10;
  if (Math.abs(rounded) < 0.05) return "0";
  const body = Math.abs(rounded)
    .toFixed(1)
    .replace(/\.0$/, "");
  return `${rounded > 0 ? "+" : "−"}${body}`;
}

export function describeNearest(midi: number): string {
  const { nearest, cents } = nearestNote(midi);
  const name = midiToName(nearest);
  const rounded = Math.round(cents * 10) / 10;
  if (Math.abs(rounded) < 0.05) return `${name} · exactly on the note`;
  const way = rounded > 0 ? "sharp" : "flat";
  return `${name} · ${formatNumber(Math.abs(rounded), 1)} cents ${way}`;
}

export function describeWeighting(notes: { midi: number; duration: number }[], stats: MeanStats): string {
  if (stats.mean == null || stats.plain == null) return "Add a note to compute the average.";
  if (notes.length < 2) return "With a single note, the average is just that note.";
  const delta = stats.mean - stats.plain;
  if (Math.abs(delta) < 0.0005) {
    return "Weighting by duration does not move the average — it matches the plain mean of the note numbers.";
  }
  const dir = delta > 0 ? "higher" : "lower";
  const amount = formatNumber(Math.abs(delta));
  const steps = amount === "1" ? "step" : "steps";
  return `Longer notes pull the average ${dir} than treating every note equally — by ${amount} ${steps}.`;
}

export function formulaText(notes: { midi: number; duration: number }[], stats: MeanStats): string {
  if (stats.mean == null) return "Σ (note × duration) / Σ duration";
  const mean = formatNumber(stats.mean);
  if (notes.length <= 6) {
    const terms = notes
      .map((n) => `${formatNumber(n.midi)}×${formatNumber(n.duration)}`)
      .join(" + ");
    return `(${terms}) / ${formatNumber(stats.total)} = ${mean}`;
  }
  return `${formatNumber(stats.moment)} / ${formatNumber(stats.total)} = ${mean}`;
}
