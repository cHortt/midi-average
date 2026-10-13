# MIDI Average

Duration-weighted average of MIDI note numbers.

Each note counts in proportion to how long it lasts:

```
average = Σ (note × duration) / Σ duration
```

Type a MIDI number (`60`) or a note name (`C4`, `F#3`, `Bb2`) and a duration (`1`, `1/2`, `2`). The result is the average MIDI number, the nearest note, and how far the weighting moved it from a plain mean. Playback uses the Web Audio API in the browser. Notes stay in local storage on this device.

## Local

```bash
npm install
npm run dev
```

## Site

Pushes to `main` build a static site and deploy it with GitHub Actions to:

https://chortt.github.io/midi-average/
