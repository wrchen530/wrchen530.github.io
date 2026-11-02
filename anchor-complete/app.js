'use strict';

const scenes = {
  room: { caption: 'Replica · 7.8 × 4.7 m · 10 views', name: 'Replica room', width: 1095, height: 649 },
  office: { caption: 'ScanNet++ · 6.5 × 6.8 m · 10 views', name: 'ScanNet++ office', width: 861, height: 822 },
  house: { caption: 'Matterport3D · Two-story apartment · 24.2 × 25.6 m · 10 views per floor', name: 'two-story Matterport3D apartment, with floors separated for visualization', width: 834, height: 931 }
};

function select(buttons, selected) {
  buttons.forEach(button => {
    const active = button === selected;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

const sceneButtons = [...document.querySelectorAll('[data-scene]')];
sceneButtons.forEach(button => button.addEventListener('click', () => {
  const key = button.dataset.scene;
  const scene = scenes[key];
  for (const kind of ['input', 'output']) {
    const image = document.querySelector(`#hero-${kind}`);
    image.src = `assets/${key}-${kind}.webp`;
    image.width = scene.width;
    image.height = scene.height;
    image.alt = kind === 'input' ? `Partial point cloud of the ${scene.name}, with input camera poses shown` : `Completed mesh of the same ${scene.name}, rendered in light blue`;
  }
  document.querySelector('#scene-caption').textContent = scenes[key].caption;
  select(sceneButtons, button);
  window.dispatchEvent(new CustomEvent('teaser-scene-change', { detail: key }));
}));

const scaleSceneButtons = [...document.querySelectorAll('[data-scale-scene]')];
const scaleDatasetButtons = [...document.querySelectorAll('[data-scale-dataset]')];
const scaleSelection = { 'ScanNet++': 'b4b39438f0', Matterport3D: '2t7WUuJeko7' };
function showScaleScene(id) {
  const scene = window.scaleScenes.find(item => item.id === id);
  if (!scene) return;
  const hasLiveGeometry = window.webGeometry?.scenes.some(item => item.id === id);
  const sceneNumber = window.scaleScenes.filter(item => item.dataset === scene.dataset).findIndex(item => item.id === id) + 1;
  const sceneLabel = `Scene ${sceneNumber}`;
  scaleSelection[scene.dataset] = id;
  select(scaleSceneButtons, scaleSceneButtons.find(button => button.dataset.scaleScene === id));
  for (const kind of ['input', 'output']) {
    const path = scene[kind + '_asset'];
    const image = document.querySelector('#scale-' + kind);
    image.src = path;
    image.alt = `${kind === 'input' ? 'Partial input point cloud' : 'Completed mesh'} of ${scene.dataset} ${sceneLabel}`;

  }
  window.dispatchEvent(new CustomEvent('scale-scene-change', { detail: id }));
  const extent = scene.extent_m.slice(0, 2).map(value => value.toFixed(1)).join(' × ');
  const count = scene.input_kind.includes('stations') ? `${scene.views} stations per level` : `${scene.views} views`;
  document.querySelector('#scale-caption').textContent = `${scene.dataset} · ${sceneLabel} · ${extent} m · ${count}`;
  document.querySelector('#scale .scale-hint').textContent = hasLiveGeometry
    ? 'Drag either view to rotate · scroll or pinch to zoom · right-drag to pan. Both views stay in sync.'
    : 'Saved cvis3 input and Ours previews · static views for this candidate.';
}
scaleSceneButtons.forEach(button => button.addEventListener('click', () => showScaleScene(button.dataset.scaleScene)));
scaleDatasetButtons.forEach(button => button.addEventListener('click', () => {
  const dataset = button.dataset.scaleDataset;
  select(scaleDatasetButtons, button);
  scaleSceneButtons.forEach(scene => { scene.hidden = scene.dataset.family !== dataset; });
  showScaleScene(scaleSelection[dataset]);
}));
showScaleScene('b4b39438f0');

// ICLR manuscript Table 1, limited to image-based generation and scene completion.
const results = [
  { group: 'Image-based generation', method: 'TRELLIS', Replica: [.537,.584,.239,.127], SCRREAM: [.346,.416,.262,.160] },
  { group: 'Image-based generation', method: 'TRELLIS (Scene-level Finetuned)', Replica: [.244,.288,.308,.150], SCRREAM: [.221,.264,.323,.170] },
  { group: 'Image-based generation', method: 'GenRC', Replica: [.355,.366,.161,.076], SCRREAM: [.295,.332,.191,.091] },
  { group: 'Image-based generation', method: 'Surflo', Replica: [.162,.318,.442,.288], SCRREAM: [.094,.270,.482,.325] },
  { group: 'Scene completion', method: 'SG-NN', Replica: [.085,.214,.600,.415], SCRREAM: [.111,.225,.518,.308] },
  { group: 'Scene completion', method: 'NKSR', Replica: [.057,.211,.633,.527], SCRREAM: [.066,.209,.614,.457] },
  { group: 'Scene completion', method: 'Seen2Scene', Replica: [.070,.132,.777,.647], SCRREAM: [.075,.167,.692,.525] },
  { group: 'Scene completion', method: 'AnchorComplete (ours)', Replica: [.055,.067,.819,.684], SCRREAM: [.057,.076,.786,.584], ours: true }
];
const metricDefs = {
  cd_vis: { index: 0, label: 'CDvis', direction: 'lower', text: 'Lower is better · visible-region Chamfer distance (m)' },
  cd_all: { index: 1, label: 'CDall', direction: 'lower', text: 'Lower is better · complete-scene Chamfer distance (m)' },
  f_01: { index: 2, label: 'F0.1', direction: 'higher', text: 'Higher is better · F-score at 10 cm' },
  f_005: { index: 3, label: 'F0.05', direction: 'higher', text: 'Higher is better · F-score at 5 cm' }
};
let selectedDataset = 'Replica';
let selectedMetric = 'f_005';

function renderResults() {
  const metric = metricDefs[selectedMetric];
  const values = results.map(row => row[selectedDataset][metric.index]);
  const scale = Math.max(...results.flatMap(row => [row.Replica[metric.index], row.SCRREAM[metric.index]]));
  const chart = document.querySelector('#results-chart');
  chart.replaceChildren();
  document.querySelector('#chart-direction').textContent = `${metric.text} · ${selectedDataset}`;

  let group = '';
  for (const [index, row] of results.entries()) {
    if (row.group !== group) {
      group = row.group;
      const heading = document.createElement('div');
      heading.className = 'chart-group';
      heading.textContent = group;
      chart.append(heading);
    }
    const line = document.createElement('div');
    line.className = `chart-row${row.ours ? ' ours' : ''}`;
    line.setAttribute('role', 'listitem');
    const name = document.createElement('span');
    name.className = 'chart-method'; name.textContent = row.method;
    const track = document.createElement('span');
    track.className = 'chart-track';
    const bar = document.createElement('span');
    bar.className = 'chart-bar';
    bar.style.width = `${Math.max(2, values[index] / scale * 100)}%`;
    bar.setAttribute('aria-hidden', 'true');
    track.append(bar);
    const score = document.createElement('span');
    score.className = 'chart-score'; score.textContent = values[index].toFixed(3);
    line.setAttribute('aria-label', `${row.method}: ${score.textContent} ${metric.label}`);
    line.append(name, track, score); chart.append(line);
  }

}

const datasetButtons = [...document.querySelectorAll('[data-dataset]')];
datasetButtons.forEach(button => button.addEventListener('click', () => {
  selectedDataset = button.dataset.dataset;
  select(datasetButtons, button); renderResults();
}));
const metricButtons = [...document.querySelectorAll('[data-metric]')];
metricButtons.forEach(button => button.addEventListener('click', () => {
  selectedMetric = button.dataset.metric;
  select(metricButtons, button); renderResults();
}));
renderResults();

const methodVideo = document.querySelector('.method-video');
const methodVideoPlayer = document.querySelector('#method-video-player');
const videoSeek = document.querySelector('#method-video-seek');
const videoPlay = document.querySelector('#method-video-play');
const videoCurrent = document.querySelector('#method-video-current');
const videoDuration = document.querySelector('#method-video-duration');
function videoTimestamp(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
function syncVideoControls() {
  const duration = methodVideo.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  videoSeek.disabled = false;
  videoSeek.value = String(Math.round(methodVideo.currentTime / duration * 1000));
  videoSeek.style.setProperty('--video-progress', `${videoSeek.value / 10}%`);
  videoCurrent.textContent = videoTimestamp(methodVideo.currentTime);
  videoDuration.textContent = videoTimestamp(duration);
}
function updateVideoPlayButton() {
  const playing = !methodVideo.paused && !methodVideo.ended;
  videoPlay.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
  videoPlay.firstElementChild.textContent = playing ? 'Ⅱ' : '▶';
}
videoPlay.addEventListener('click', () => {
  if (methodVideo.paused || methodVideo.ended) methodVideo.play().catch(() => {});
  else methodVideo.pause();
});
methodVideo.addEventListener('click', () => {
  if (methodVideo.paused) methodVideo.play().catch(() => {});
  else methodVideo.pause();
});
videoSeek.addEventListener('input', () => {
  if (!Number.isFinite(methodVideo.duration) || methodVideo.duration <= 0) return;
  methodVideo.currentTime = Number(videoSeek.value) / 1000 * methodVideo.duration;
  syncVideoControls();
});
for (const eventName of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked']) methodVideo.addEventListener(eventName, syncVideoControls);
for (const eventName of ['play', 'pause', 'ended']) methodVideo.addEventListener(eventName, updateVideoPlayButton);
document.querySelector('#method-video-fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement === methodVideoPlayer) document.exitFullscreen();
  else methodVideoPlayer.requestFullscreen?.().catch(() => {});
});

document.querySelector('nav a[href="#abstract"]').addEventListener('click', () => { document.querySelector('.abstract-disclosure').open = true; });
