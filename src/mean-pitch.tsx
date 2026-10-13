import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Copy, Play, Plus, Square, Trash2 } from "lucide-react";
import {
  EXAMPLE_NOTES,
  NOTE_NAMES,
  describeNearest,
  describeWeighting,
  formatNumber,
  formulaText,
  midiToHz,
  midiToName,
  nearestNote,
  parseDuration,
  parseLine,
  parsePitch,
  weightedMean,
  type NoteEvent,
} from "./midi";

const STORAGE_KEY = "mean-pitch.v1";
const NOTE_CAP = 500;
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const BLACK_AFTER = new Set([0, 2, 5, 7, 9]);

const fieldClass =
  "min-h-11 rounded-lg border border-stroke bg-canvas px-3 font-mono text-base text-ink outline-none focus-visible:border-amber";

let idSeq = 0;
function newId(): string {
  idSeq += 1;
  return `n-${Date.now().toString(36)}-${idSeq}`;
}

function isExample(notes: NoteEvent[]): boolean {
  return (
    notes.length === EXAMPLE_NOTES.length &&
    notes.every((n, i) => n.midi === EXAMPLE_NOTES[i]?.midi && n.duration === EXAMPLE_NOTES[i]?.duration)
  );
}

function sanitizeNotes(value: unknown): NoteEvent[] | null {
  if (!Array.isArray(value)) return null;
  const out: NoteEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const midi = Number((item as NoteEvent).midi);
    const duration = Number((item as NoteEvent).duration);
    if (!Number.isFinite(midi) || midi < 0 || midi > 127) continue;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 1_000_000) continue;
    const id = typeof (item as NoteEvent).id === "string" ? (item as NoteEvent).id : newId();
    out.push({ id, midi, duration });
  }
  return out.slice(0, NOTE_CAP);
}

export function MeanPitch() {
  const [notes, setNotes] = useState<NoteEvent[]>(EXAMPLE_NOTES);
  const [bpm, setBpm] = useState(120);
  const [hydrated, setHydrated] = useState(false);
  const [pitch, setPitch] = useState("60");
  const [duration, setDuration] = useState("1");
  const [octaveBase, setOctaveBase] = useState(60);
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [hearingMean, setHearingMean] = useState(false);

  const pitchRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<OscillatorNode[]>([]);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as { notes?: unknown; bpm?: unknown };
        const stored = sanitizeNotes(data.notes);
        if (stored) setNotes(stored);
        if (typeof data.bpm === "number" && data.bpm >= 40 && data.bpm <= 240) setBpm(data.bpm);
      }
    } catch {
      /* keep the example */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ notes, bpm }));
  }, [notes, bpm, hydrated]);

  useEffect(() => () => stopSound(), []);

  const stats = useMemo(() => weightedMean(notes), [notes]);
  const activeMidi = parsePitch(pitch);

  function stopSound() {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
    for (const node of nodesRef.current) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    nodesRef.current = [];
    setPlayingId(null);
    setHearingMean(false);
  }

  function audio(): AudioContext {
    if (!audioRef.current) audioRef.current = new AudioContext();
    return audioRef.current;
  }

  function addNote() {
    const midi = parsePitch(pitch);
    const dur = parseDuration(duration);
    if (midi == null || dur == null) {
      setMessage("Use a MIDI number from 0 to 127 (or a name like C4) and a duration greater than 0. Fractions such as 1/2 are fine.");
      return;
    }
    if (notes.length >= NOTE_CAP) {
      setMessage(`The list holds ${NOTE_CAP} notes.`);
      return;
    }
    setNotes((curr) => [...curr, { id: newId(), midi, duration: dur }]);
    setPitch("");
    setMessage(null);
    pitchRef.current?.focus();
  }

  function addPasted() {
    const lines = paste.split(/\r?\n/);
    const added: NoteEvent[] = [];
    const bad: number[] = [];
    lines.forEach((line, index) => {
      const parsed = parseLine(line);
      if (parsed === "empty") return;
      if (parsed == null) bad.push(index + 1);
      else added.push({ id: newId(), midi: parsed.midi, duration: parsed.duration });
    });
    if (added.length === 0) {
      setMessage(bad.length ? `Could not read line ${bad.join(", ")}.` : "Paste one note per line: a MIDI number or name, then a duration.");
      return;
    }
    const room = NOTE_CAP - notes.length;
    const next = added.slice(0, Math.max(0, room));
    if (next.length === 0) {
      setMessage(`The list holds ${NOTE_CAP} notes.`);
      return;
    }
    setNotes((curr) => [...curr, ...next]);
    setPaste("");
    const skipped = bad.length ? ` Skipped line ${bad.slice(0, 6).join(", ")}.` : "";
    const trimmed = next.length < added.length ? " Some lines were left out because the list is full." : "";
    setMessage(skipped || trimmed ? `Added ${next.length}.${skipped}${trimmed}` : null);
  }

  function playSequence() {
    if (notes.length === 0) return;
    stopSound();
    const ctx = audio();
    void ctx.resume();
    const beat = 60 / bpm;
    let t = ctx.currentTime + 0.05;
    notes.forEach((note) => {
      const dur = Math.max(0.05, note.duration * beat);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = midiToHz(note.midi);
      const attack = Math.min(0.02, dur / 4);
      const release = Math.min(0.06, dur / 3);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.16, t + attack);
      gain.gain.setValueAtTime(0.16, Math.max(t + attack, t + dur - release));
      gain.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      nodesRef.current.push(osc);
      const wait = Math.max(0, (t - ctx.currentTime) * 1000);
      timersRef.current.push(window.setTimeout(() => setPlayingId(note.id), wait));
      t += dur;
    });
    timersRef.current.push(
      window.setTimeout(() => {
        setPlayingId(null);
        nodesRef.current = [];
      }, Math.max(0, (t - ctx.currentTime) * 1000)),
    );
  }

  function hearAverage() {
    if (stats.mean == null) return;
    stopSound();
    const ctx = audio();
    void ctx.resume();
    const seconds = 1.4;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = midiToHz(stats.mean);
    const t = ctx.currentTime + 0.02;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.04);
    gain.gain.linearRampToValueAtTime(0, t + seconds);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
    nodesRef.current.push(osc);
    setHearingMean(true);
    timersRef.current.push(
      window.setTimeout(() => {
        setHearingMean(false);
        nodesRef.current = [];
      }, seconds * 1000),
    );
  }

  async function copyResult() {
    if (stats.mean == null || stats.plain == null) return;
    const { nearest } = nearestNote(stats.mean);
    const text = [
      `Duration-weighted average MIDI: ${formatNumber(stats.mean)}`,
      `Nearest note: ${midiToName(nearest)} (${describeNearest(stats.mean)})`,
      `Plain average (ignoring duration): ${formatNumber(stats.plain)}`,
      `Total duration: ${formatNumber(stats.total)}`,
      formulaText(notes, stats),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setMessage("Could not copy. Select the formula and copy it manually.");
    }
  }

  const sounding = playingId != null || hearingMean;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="max-w-2xl">
        <p className="text-sm font-medium tracking-widest text-amber uppercase">Mean pitch</p>
        <h1 className="mt-2 font-display text-4xl text-ink sm:text-5xl">Average MIDI, weighted by time</h1>
        <p className="mt-3 text-soft">
          Enter MIDI note numbers and how long each one lasts. The result is the average note number across the whole
          duration — a long note pulls it more than a short one.
        </p>
      </header>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-2">
        <section className="order-2 flex flex-col gap-4 lg:order-1" aria-label="Notes">
          <form
            className="rounded-xl border border-stroke bg-panel p-4 sm:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              addNote();
            }}
          >
            <h2 className="text-lg font-medium text-ink">Add a note</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm text-soft">
                MIDI number or name
                <input
                  ref={pitchRef}
                  id="pitch"
                  className={fieldClass}
                  value={pitch}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="60 or C4"
                  onChange={(event) => {
                    setPitch(event.target.value);
                    setMessage(null);
                  }}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-soft">
                Duration
                <input
                  id="duration"
                  className={fieldClass}
                  value={duration}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="1 or 1/2"
                  onChange={(event) => {
                    setDuration(event.target.value);
                    setMessage(null);
                  }}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {["1/4", "1/2", "1", "2", "4"].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`min-h-11 rounded-lg border px-3 font-mono text-sm ${
                    duration === preset
                      ? "border-amber bg-amber text-on-amber"
                      : "border-stroke bg-canvas text-ink"
                  }`}
                  onClick={() => setDuration(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
            <Button type="submit" className="mt-4 w-full sm:w-auto">
              <Plus className="size-4" aria-hidden="true" />
              Add note
            </Button>
            {message ? <p className="mt-3 text-sm text-amber">{message}</p> : null}
          </form>

          <div className="rounded-xl border border-stroke bg-panel p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium text-ink">Keyboard</h2>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="px-3"
                  disabled={octaveBase <= 0}
                  aria-label="Lower octave"
                  onClick={() => setOctaveBase((n) => Math.max(0, n - 12))}
                >
                  −
                </Button>
                <Button
                  variant="ghost"
                  className="px-3"
                  disabled={octaveBase >= 108}
                  aria-label="Higher octave"
                  onClick={() => setOctaveBase((n) => Math.min(108, n + 12))}
                >
                  +
                </Button>
              </div>
            </div>
            <p className="mt-1 font-mono text-sm text-soft">
              {midiToName(octaveBase)} – {midiToName(octaveBase + 11)} · click a key to fill the pitch
            </p>
            <div className="relative mt-3">
              <div className="flex">
                {WHITE_SEMITONES.map((semi) => {
                  const midi = octaveBase + semi;
                  const selected = activeMidi === midi;
                  return (
                    <button
                      key={midi}
                      type="button"
                      aria-label={`${midiToName(midi)}, MIDI ${midi}`}
                      className={`flex h-28 flex-1 items-end justify-center rounded-b-md border border-canvas pb-2 font-mono text-xs ${
                        selected ? "bg-amber text-on-amber" : "bg-ink text-on-amber"
                      }`}
                      onClick={() => {
                        setPitch(String(midi));
                        setMessage(null);
                      }}
                    >
                      {NOTE_NAMES[semi]}
                    </button>
                  );
                })}
              </div>
              <div className="pointer-events-none absolute inset-x-0 top-0 flex h-16">
                {WHITE_SEMITONES.map((semi) => {
                  const midi = octaveBase + semi + 1;
                  if (!BLACK_AFTER.has(semi)) return <div key={semi} className="flex-1" />;
                  const selected = activeMidi === midi;
                  return (
                    <div key={semi} className="relative flex-1">
                      <button
                        type="button"
                        aria-label={`${midiToName(midi)}, MIDI ${midi}`}
                        className={`pointer-events-auto absolute top-0 left-full h-16 w-8 -translate-x-1/2 rounded-b-md border border-stroke font-mono text-xs ${
                          selected ? "bg-amber text-on-amber" : "bg-canvas text-soft"
                        }`}
                        onClick={() => {
                          setPitch(String(midi));
                          setMessage(null);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-stroke bg-panel p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-medium text-ink">
                Notes
                <span className="ml-2 font-mono text-sm font-normal text-soft">
                  {notes.length} {notes.length === 1 ? "note" : "notes"}
                  {stats.total > 0 ? ` · total ${formatNumber(stats.total)}` : ""}
                </span>
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="min-h-11 px-2 text-sm text-soft"
                  onClick={() => {
                    stopSound();
                    setNotes(EXAMPLE_NOTES);
                    setMessage(null);
                  }}
                >
                  Example
                </button>
                <button
                  type="button"
                  className="min-h-11 px-2 text-sm text-soft"
                  onClick={() => {
                    stopSound();
                    setNotes([]);
                    setMessage(null);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>

            {notes.length === 0 ? (
              <p className="mt-4 text-sm text-soft">
                Nothing here yet. Add a MIDI number and a duration, or load the example — C major, with G held twice
                as long.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {notes.map((note) => {
                  const share = stats.total > 0 ? (note.duration / stats.total) * 100 : 0;
                  const name = midiToName(note.midi);
                  const active = playingId === note.id;
                  return (
                    <li
                      key={note.id}
                      className={`rounded-lg border px-3 py-2 ${active ? "border-amber bg-panel-2" : "border-stroke bg-canvas"}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-12 font-mono text-sm text-amber">{name}</span>
                        <input
                          aria-label={`MIDI number for ${name}`}
                          className={`${fieldClass} w-20`}
                          type="number"
                          min={0}
                          max={127}
                          step="any"
                          value={note.midi}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (!Number.isFinite(value) || value < 0 || value > 127) return;
                            setNotes((curr) => curr.map((n) => (n.id === note.id ? { ...n, midi: value } : n)));
                          }}
                        />
                        <input
                          aria-label={`Duration for ${name}`}
                          className={`${fieldClass} w-20`}
                          type="number"
                          min={0.001}
                          step="any"
                          value={note.duration}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return;
                            setNotes((curr) => curr.map((n) => (n.id === note.id ? { ...n, duration: value } : n)));
                          }}
                        />
                        <span className="font-mono text-sm text-soft tabular-nums">{formatNumber(share, 1)}%</span>
                        <button
                          type="button"
                          className="ml-auto grid size-11 place-items-center rounded-lg text-soft"
                          aria-label={`Remove ${name}`}
                          onClick={() => {
                            if (playingId === note.id) stopSound();
                            setNotes((curr) => curr.filter((n) => n.id !== note.id));
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2">
                        <div className="h-full rounded-full bg-amber" style={{ width: `${Math.min(100, share)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-sm text-soft">
              Order is only for playback. The average ignores order and uses duration as the weight. Any unit works —
              beats, seconds, ticks — if every row uses the same one.
            </p>
          </div>

          <details className="rounded-xl border border-stroke bg-panel p-4 sm:p-5">
            <summary className="min-h-11 cursor-pointer text-lg font-medium text-ink">Paste a list</summary>
            <p className="mt-2 text-sm text-soft">One note per line. A number or a name, then a duration.</p>
            <textarea
              className={`${fieldClass} mt-3 w-full py-2`}
              rows={5}
              spellCheck={false}
              value={paste}
              placeholder={"60 1\n64 1/2\nG4 2"}
              onChange={(event) => setPaste(event.target.value)}
            />
            <Button type="button" variant="ghost" className="mt-3" onClick={addPasted}>
              Add pasted notes
            </Button>
          </details>
        </section>

        <section className="order-1 lg:order-2 lg:sticky lg:top-6" aria-label="Average">
          <div className="rounded-xl border border-stroke bg-panel p-4 sm:p-5">
            <h2 className="text-sm font-medium tracking-widest text-soft uppercase">Weighted average</h2>
            {stats.mean == null || stats.plain == null ? (
              <p className="mt-4 font-display text-4xl text-ink">—</p>
            ) : (
              <>
                <p className="mt-2 font-display text-6xl leading-none text-ink tabular-nums sm:text-7xl" aria-live="polite">
                  {formatNumber(stats.mean)}
                </p>
                <p className="mt-3 text-xl text-amber">{describeNearest(stats.mean)}</p>
                {isExample(notes) ? (
                  <p className="mt-3 text-sm text-soft">
                    Example: C4, E4, G4 held twice as long, then C5. The long G pulls the mean up to F#4.
                  </p>
                ) : null}
              </>
            )}

            <dl className="mt-5 grid grid-cols-3 gap-2">
              <Stat label="Total length" value={stats.total > 0 ? formatNumber(stats.total) : "—"} />
              <Stat label="Plain mean" value={stats.plain == null ? "—" : formatNumber(stats.plain)} />
              <Stat
                label="Shift"
                value={
                  stats.mean == null || stats.plain == null
                    ? "—"
                    : `${stats.mean - stats.plain >= 0 ? "+" : "−"}${formatNumber(Math.abs(stats.mean - stats.plain))}`
                }
              />
            </dl>

            <p className="mt-4 text-sm text-soft">{describeWeighting(notes, stats)}</p>
            <p className="mt-2 font-mono text-sm break-words text-ink">{formulaText(notes, stats)}</p>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              {sounding ? (
                <Button type="button" className="flex-1" onClick={stopSound}>
                  <Square className="size-4" aria-hidden="true" />
                  Stop
                </Button>
              ) : (
                <Button type="button" className="flex-1" disabled={notes.length === 0} onClick={playSequence}>
                  <Play className="size-4" aria-hidden="true" />
                  Play sequence
                </Button>
              )}
              <Button type="button" variant="ghost" className="flex-1" disabled={stats.mean == null || sounding} onClick={hearAverage}>
                Hear the average
              </Button>
            </div>
            <label className="mt-3 flex items-center justify-between gap-3 text-sm text-soft">
              Playback tempo
              <span className="flex items-center gap-2">
                <input
                  className={`${fieldClass} w-20`}
                  type="number"
                  min={40}
                  max={240}
                  aria-label="Tempo in beats per minute"
                  value={bpm}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    setBpm(Math.min(240, Math.max(40, value)));
                  }}
                />
                BPM
              </span>
            </label>
            <p className="mt-1 text-sm text-soft">Sound treats each duration as one beat. It does not change the average.</p>

            <PianoRoll notes={notes} mean={stats.mean} playingId={playingId} />

            <Button
              type="button"
              variant="ghost"
              className="mt-4"
              disabled={stats.mean == null}
              onClick={() => void copyResult()}
            >
              <Copy className="size-4" aria-hidden="true" />
              {copied ? "Copied" : "Copy result"}
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-canvas px-2 py-3">
      <dt className="text-xs text-soft">{label}</dt>
      <dd className="mt-1 font-mono text-lg text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function Button({
  children,
  variant = "solid",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "ghost"; children: ReactNode }) {
  const look =
    variant === "solid"
      ? "bg-amber text-on-amber"
      : "border border-stroke bg-canvas text-ink";
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-40 ${look} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function PianoRoll({
  notes,
  mean,
  playingId,
}: {
  notes: NoteEvent[];
  mean: number | null;
  playingId: string | null;
}) {
  if (notes.length === 0 || mean == null) {
    return (
      <p className="mt-5 rounded-lg border border-dashed border-stroke px-3 py-8 text-center text-sm text-soft">
        The roll appears once there is at least one note.
      </p>
    );
  }

  const pitches = notes.map((n) => n.midi);
  const lo = Math.min(...pitches, mean) - 2;
  const hi = Math.max(...pitches, mean) + 2;
  const span = Math.max(1, hi - lo);
  const total = notes.reduce((sum, n) => sum + n.duration, 0);
  let x = 0;
  const bars = notes.map((note) => {
    const w = (note.duration / total) * 100;
    const height = Math.min(28, (2.2 / span) * 100);
    const top = ((hi - note.midi) / span) * 100 - height / 2;
    const bar = {
      ...note,
      x,
      w: w > 1.2 ? w - 0.35 : w,
      top,
      height,
      name: midiToName(note.midi),
    };
    x += w;
    return bar;
  });
  const meanTop = ((hi - mean) / span) * 100;
  const labelTop = Math.min(92, Math.max(8, meanTop));

  return (
    <figure className="mt-5">
      <div className="relative h-48 overflow-hidden rounded-lg border border-stroke bg-canvas">
        {bars.map((bar) => (
          <div
            key={bar.id}
            title={`${bar.name} · MIDI ${formatNumber(bar.midi)} · ${formatNumber(bar.duration)}`}
            className={`absolute flex items-end overflow-hidden rounded-sm px-1 ${
              playingId === bar.id ? "bg-ink text-canvas" : "bg-amber text-on-amber"
            }`}
            style={{
              left: `${bar.x}%`,
              width: `${bar.w}%`,
              top: `${bar.top}%`,
              height: `${bar.height}%`,
            }}
          >
            {bar.w > 12 ? <span className="truncate font-mono text-xs">{bar.name}</span> : null}
          </div>
        ))}
        <div className="absolute inset-x-0 z-10 h-0.5 bg-ink" style={{ top: `${meanTop}%` }} />
        <span
          className="absolute right-2 z-20 -translate-y-1/2 rounded bg-canvas px-1.5 py-0.5 font-mono text-xs text-amber"
          style={{ top: `${labelTop}%` }}
        >
          avg {formatNumber(mean)}
        </span>
      </div>
      <figcaption className="mt-2 text-sm text-soft">
        Blocks are notes across the total duration. The line is the weighted average.
      </figcaption>
    </figure>
  );
}
