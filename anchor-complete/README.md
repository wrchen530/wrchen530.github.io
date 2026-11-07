# AnchorComplete website preview

Open `index.html` directly in a browser. No installation or build is required.
The page uses system fonts and local assets, with no external font dependencies.

For HTTP preview, run from the TRELLIS directory:

```sh
python3 -m http.server 8765 --directory website --bind 127.0.0.1
```

Open http://localhost:8765 on the same machine. For a remote workspace, forward
port 8765 through your editor or SSH first.

Online preview: https://anchorcomplete-research-preview.toastyowlet512.chatgpt.site

The preview is owner-private. Author names and
unreleased external resource links are omitted to match the anonymous manuscript.
See `assets/SOURCES.md` for media provenance. Research numbers come from Table 1
of the specified current ICLR manuscript. The hero uses pre-rendered geometry;
it is a scene selector, not an orbitable 3D viewer.

The current video is `assets/anchorcomplete-method.mp4`, the 45 s overview cut built by `website/video/build_social_media_cut.py` in the TRELLIS repo; see `assets/SOURCES.md`.

Sequential rendering: `video/render_sequential_stage1.sbatch`; accumulation logic: `video/sequential_stage1.py`; exact video window timing: `assets/animation-sequence.json`.
