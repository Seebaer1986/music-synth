# FM Loops

A browser-only FM groovebox: build patterns on multiple tracks, layer them as loops, and arrange them into a song. No install, no build step, no server — plain HTML/JS on the Web Audio API.

## Run

Serve the folder with any static file server and open it:

    python3 -m http.server 8000

To use it from any device, host the folder on any static host (for example GitHub Pages: Settings → Pages → deploy from branch).

## How it works

- **Tracks** – synth tracks (4-operator FM, 6 algorithms, 8 presets, per-operator envelopes) and drum tracks (synthesized kit). Each has mute/solo, volume, pan, delay and reverb sends.
- **Patterns** – every track has 8 patterns of 1, 2 or 4 bars, edited in a piano roll (or drum grid). "Scale only" hides notes outside the chosen key and scale.
- **Loop mode** – every track loops its selected pattern; switch patterns while it plays.
- **Song mode** – the Song tab is a bar-by-bar arrangement of which pattern each track plays.
- **File menu** – projects autosave in the browser; save/open them as JSON files, or export the loop or song as WAV.

Shortcuts: Space = play/stop, Ctrl/Cmd+Z = undo.
