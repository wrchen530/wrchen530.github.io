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

The current method video is `assets/anchorcomplete-method.mp4`. It uses six Figure 2 DF2 RGB views, the recorded Stage-1 trace from `eval_results/website_pipeline_example_frozen/2t7WUuJeko7/trace/`, and the matching Stage-2 mesh, then holds on the complete mesh. Asset preparation is in `video/pipeline_example_assets.py`; composition is in `video/render_real_animation.py`; exact timing is in `assets/animation-sequence.json`. The original illustrative film remains under `video/anchorcomplete-method.mp4` for history.

Recompose the current cut without flythrough footage using `conda run -n trellis python website/video/render_pipeline_example.py --trace eval_results/website_pipeline_example_frozen/2t7WUuJeko7/trace --compose-only --end-at-mesh --output website/assets/anchorcomplete-method.mp4`.

Sequential rendering: `video/render_sequential_stage1.sbatch`; accumulation logic: `video/sequential_stage1.py`; exact video window timing: `assets/animation-sequence.json`.
