import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';

// Muted mineral blues: retain chroma in the middle, with airy upper surfaces.
const heightRamp = ['#355f88', '#5c8cba', '#89afd1', '#b8d0e4', '#dce8f2'].map(hex => new THREE.Color(hex));

function meshStorey(object, z) {
  const transform = object.userData.heightTransform;
  // The middle of the display gap also classifies triangle vertices which
  // straddle the original storey split.
  return transform && z >= transform.split + transform.lift * .5 ? 1 : 0;
}

function meshHeight(object, z) {
  return meshStorey(object, z) ? z - object.userData.heightTransform.lift : z;
}

function meshHeightRanges(panels) {
  const heights = [[], []];
  for (const { object } of panels) {
    if (!object?.isMesh) continue;
    if (!object.userData.heightSamplesByStorey) {
      const positions = object.geometry.attributes.position;
      const count = object.isInstancedMesh ? object.count : positions.count;
      const stride = Math.max(1, Math.ceil(count / 16384));
      const samples = [[], []];
      for (let i = 0; i < count; i += stride) {
        const z = object.isInstancedMesh ? object.instanceMatrix.array[i * 16 + 14] : positions.getZ(i);
        samples[meshStorey(object, z)].push(meshHeight(object, z));
      }
      object.userData.heightSamplesByStorey = samples;
    }
    object.userData.heightSamplesByStorey.forEach((samples, storey) => heights[storey].push(...samples));
  }
  return heights.map(samples => {
    if (!samples.length) return [0, 1];
    samples.sort((a, b) => a - b);
    // Each exploded storey gets the full ramp. Ordinary comparison meshes
    // continue to share one robust scale, excluding clouds and camera overlays.
    const low = samples[Math.floor((samples.length - 1) * .02)];
    const high = samples[Math.ceil((samples.length - 1) * .98)];
    return high - low > .001 ? [low, high] : [samples[0], Math.max(samples.at(-1), samples[0] + .001)];
  });
}

function colorMesh(object, ranges) {
  if (!object?.isMesh) return;
  const material = object.material;
  material.color.setHex(0xffffff); material.roughness = .9;
  const color = new THREE.Color();
  const atHeight = z => {
    const range = ranges[meshStorey(object, z)];
    const span = Math.max(range[1] - range[0], .001);
    const t = Math.pow(THREE.MathUtils.clamp((meshHeight(object, z) - range[0]) / span, 0, 1), .82) * (heightRamp.length - 1);
    const index = Math.min(Math.floor(t), heightRamp.length - 2);
    return color.copy(heightRamp[index]).lerp(heightRamp[index + 1], t - index);
  };
  if (object.isInstancedMesh) {
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix); object.setColorAt(i, atHeight(matrix.elements[14]));
    }
    object.instanceColor.needsUpdate = true;
  } else {
    const positions = object.geometry.attributes.position;
    let colors = object.geometry.attributes.color;
    if (!colors) {
      colors = new THREE.Float32BufferAttribute(new Float32Array(positions.count * 3), 3);
      object.geometry.setAttribute('color', colors);
    }
    for (let i = 0; i < positions.count; i++) {
      atHeight(positions.getZ(i)); colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
  }
  material.vertexColors = !object.isInstancedMesh;
  material.needsUpdate = true;
}

async function loadGeometry(record, signal) {
  const response = await fetch(record.url, { signal });
  if (!response.ok) throw new Error('Unable to load this scene');
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const headerSize = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerSize)));
  if (![1, 2].includes(header.version)) throw new Error('Unsupported scene');
  const arrays = {};
  const types = { '<f4': Float32Array, '<i2': Int16Array, '<u4': Uint32Array, '|u1': Uint8Array };
  for (const item of header.arrays) {
    const Type = types[item.dtype];
    if (!Type) throw new Error('Unsupported geometry');
    let values;
    if (item.byte_planes || item.xor_stride) {
      const source = new Uint8Array(buffer, 4 + headerSize + item.offset, item.bytes);
      const bytes = new Uint8Array(item.bytes), size = Type.BYTES_PER_ELEMENT;
      const count = item.count * item.components;
      if (item.byte_planes) {
        for (let byte = 0; byte < size; byte++) {
          for (let i = 0; i < count; i++) bytes[i * size + byte] = source[byte * count + i];
        }
      } else bytes.set(source);
      if (item.xor_stride) {
        if (size !== 4) throw new Error('Unsupported scene encoding');
        const words = new Uint32Array(bytes.buffer);
        for (let i = item.xor_stride; i < words.length; i++) words[i] ^= words[i - item.xor_stride];
      }
      values = new Type(bytes.buffer);
    } else values = new Type(buffer, 4 + headerSize + item.offset, item.count * item.components);
    arrays[item.name] = new THREE.BufferAttribute(values, item.components, item.normalized);
  }
  if (header.kind === 'voxels') {
    const cube = new THREE.BoxGeometry(header.cell_m, header.cell_m, header.cell_m);
    const material = new THREE.MeshStandardMaterial({ color: 0x8eb0ce, roughness: .85 });
    const object = new THREE.InstancedMesh(cube, material, arrays.position.count);
    const matrices = object.instanceMatrix.array;
    const positions = arrays.position.array;
    for (let i = 0; i < arrays.position.count; i++) {
      const j = i * 16;
      matrices[j] = matrices[j + 5] = matrices[j + 10] = matrices[j + 15] = 1;
      matrices[j + 12] = positions[i * 3]; matrices[j + 13] = positions[i * 3 + 1]; matrices[j + 14] = positions[i * 3 + 2];
    }
    object.instanceMatrix.needsUpdate = true;
    object.computeBoundingSphere();
    return object;
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(arrays)) {
    if (name === 'index') geometry.setIndex(attribute);
    else geometry.setAttribute(name, attribute);
  }
  geometry.computeBoundingSphere();
  if (header.kind === 'points') {
    // Source RGB is sRGB; Three's material pipeline consumes linear vertex colour.
    const colors = arrays.color;
    const linear = new Float32Array(colors.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < colors.count; i++) {
      color.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i), THREE.SRGBColorSpace);
      color.toArray(linear, i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(linear, 3));
    const object = new THREE.Points(geometry, new THREE.PointsMaterial({ size: .019, vertexColors: true, sizeAttenuation: true, toneMapped: false }));
    if (header.camera_lines?.length) {
      const lines = new THREE.BufferGeometry();
      lines.setAttribute('position', new THREE.Float32BufferAttribute(header.camera_lines.flat(), 3));
      object.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0xd55e00, toneMapped: false })));
    }
    return object;
  }
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xa3bfd9, roughness: .82, metalness: 0, side: THREE.DoubleSide }));
  if (record.upper_floor_lift_m) object.userData.heightTransform = { lift: record.upper_floor_lift_m, split: record.split_z };
  return object;
}

function dispose(object) {
  if (!object) return;
  object.traverse(node => {
    node.geometry?.dispose();
    if (Array.isArray(node.material)) node.material.forEach(material => material.dispose());
    else node.material?.dispose();
    if (node.isInstancedMesh) node.dispose();
  });
}

function addPointNoise(object, sigma = .025, seed = 207) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const gaussian = () => {
    const radius = Math.sqrt(-2 * Math.log(Math.max(random(), 1e-8)));
    return radius * Math.cos(2 * Math.PI * random()) * sigma;
  };
  object.traverse(node => {
    if (!node.isPoints) return;
    const position = node.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      position.setXYZ(i, position.getX(i) + gaussian(), position.getY(i) + gaussian(), position.getZ(i) + gaussian());
    }
    position.needsUpdate = true;
    node.geometry.computeBoundingSphere();
    node.userData.positionNoiseSigma = sigma;
  });
}

class Panel {
  constructor(host, changed, appearance = 'standard') {
    this.host = host;
    this.appearance = appearance;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, .01, 1000);
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.setClearColor(0xffffff, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const shaded = appearance === 'overview';
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const sky = new THREE.HemisphereLight(0xffffff, 0xaeb2b7, 1.4);
    sky.position.set(0, 0, 1); this.scene.add(sky);
    const key = new THREE.DirectionalLight(0xffffff, 2.7); key.position.set(4, -6, 12); this.scene.add(key);
    this.key = key;
    const fill = new THREE.DirectionalLight(0xf3f6ff, shaded ? .55 : .8); fill.position.set(-5, 3, 5); this.scene.add(fill);
    if (shaded) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.shadowMap.autoUpdate = false;
      key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -.00008;
      this.scene.add(key.target);
    }
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0; canvas.setAttribute('aria-label', host.dataset.label + '. Drag to rotate, scroll to zoom, right-drag to pan.');
    host.append(canvas);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.rotateSpeed = .7; this.controls.zoomSpeed = .8;
    this.controls.screenSpacePanning = true;
    this.controls.listenToKeyEvents(canvas);
    this.controls.addEventListener('change', () => changed(this));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
  }
  render() { this.renderer.render(this.scene, this.camera); }
  setObject(object) {
    if (this.object) this.scene.remove(this.object);
    dispose(this.object); this.object = object;
    if (object) this.scene.add(object);
    if (this.appearance === 'overview' && object) {
      if (this.ground) { this.scene.remove(this.ground); dispose(this.ground); this.ground = null; }
      if (object.isMesh) {
        object.material.roughness = .9;
        object.castShadow = true; object.receiveShadow = true;
      }
      const bounds = new THREE.Box3().setFromObject(object);
      const center = bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() * .55, 1);
      this.key.position.copy(center).addScaledVector(new THREE.Vector3(.8, -1.2, 3.5).normalize(), radius * 2.5);
      this.key.target.position.copy(center); this.key.target.updateMatrixWorld();
      Object.assign(this.key.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: .05, far: radius * 6 });
      this.key.shadow.camera.updateProjectionMatrix();
      this.key.shadow.normalBias = radius * .00035;
      if (object.isMesh) {
        this.ground = new THREE.Mesh(new THREE.PlaneGeometry(radius * 3, radius * 3), new THREE.ShadowMaterial({ opacity: .08, depthWrite: false }));
        this.ground.position.set(center.x, center.y, bounds.min.z - .025);
        this.ground.receiveShadow = true; this.scene.add(this.ground);
      }
      this.renderer.shadowMap.needsUpdate = true;
    }
  }
}

class SyncedViewer {
  constructor(shell) {
    this.shell = shell; this.lock = false; this.generation = 0;
    this.status = shell.querySelector('.viewer-status');
    this.panels = [];
    for (const host of shell.querySelectorAll('.canvas-host')) this.panels.push(new Panel(host, source => this.synchronize(source), shell.dataset.appearance));
    for (const button of shell.querySelectorAll('[data-view-action]')) button.addEventListener('click', () => {
      const action = button.dataset.viewAction;
      if (action === 'reset') this.reset();
      else if (action === 'fullscreen') {
        if (document.fullscreenElement === shell) document.exitFullscreen();
        else shell.requestFullscreen?.().catch(() => {});
      } else {
        const panel = this.panels[0];
        panel.camera.position.sub(panel.controls.target).multiplyScalar(action === 'in' ? .8 : 1.25).add(panel.controls.target);
        panel.controls.update(); this.synchronize(panel);
      }
    });
  }
  applyColors() {
    const ranges = meshHeightRanges(this.panels);
    for (const panel of this.panels) {
      colorMesh(panel.object, ranges); panel.render();
    }
  }
  synchronize(source) {
    if (this.lock) return;
    this.lock = true;
    for (const panel of this.panels) {
      if (panel !== source) {
        panel.camera.position.copy(source.camera.position);
        panel.camera.quaternion.copy(source.camera.quaternion);
        panel.camera.zoom = source.camera.zoom;
        panel.camera.updateProjectionMatrix();
        panel.controls.target.copy(source.controls.target);
        panel.controls.update();
        // OrbitControls rebuilds spherical coordinates near the poles. Retain
        // the initiating camera exactly after updating the peer's internals.
        panel.camera.position.copy(source.camera.position);
        panel.camera.quaternion.copy(source.camera.quaternion);
      }
      panel.render();
    }
    this.lock = false;
  }
  reset() {
    if (!this.home) return;
    const target = new THREE.Vector3().fromArray(this.home.target);
    const direction = new THREE.Vector3().fromArray(this.home.eye).sub(target).normalize();
    let fittedDistance;
    if (this.panels.length === 2 && this.panels.every(panel => panel.object)) {
      const right = new THREE.Vector3().crossVectors(direction.clone().negate(), new THREE.Vector3().fromArray(this.home.up)).normalize();
      const up = new THREE.Vector3().crossVectors(right, direction.clone().negate());
      const tangent = Math.tan(THREE.MathUtils.degToRad(this.panels[0].camera.fov / 2)) * .88;
      const aspect = Math.min(...this.panels.map(panel => panel.camera.aspect));
      fittedDistance = .1;
      for (const panel of this.panels) {
        const p = panel.object.geometry.attributes.position.array;
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i] - target.x, y = p[i + 1] - target.y, z = p[i + 2] - target.z;
          const depth = x * direction.x + y * direction.y + z * direction.z;
          fittedDistance = Math.max(fittedDistance,
            depth + Math.abs(x * up.x + y * up.y + z * up.z) / tangent,
            depth + Math.abs(x * right.x + y * right.y + z * right.z) / (tangent * aspect));
        }
      }
    }
    this.lock = true;
    for (const panel of this.panels) {
      panel.camera.position.fromArray(this.home.eye); panel.camera.up.fromArray(this.home.up);
      panel.controls.target.fromArray(this.home.target);
      const aspectFit = Math.max(1, 1.4 / Math.min(...this.panels.map(item => item.camera.aspect)));
      panel.camera.position.sub(panel.controls.target).multiplyScalar(aspectFit).add(panel.controls.target);
      if (fittedDistance) panel.camera.position.copy(direction).multiplyScalar(fittedDistance).add(target);
      panel.camera.zoom = 1;
      const distance = panel.camera.position.distanceTo(panel.controls.target);
      panel.controls.minDistance = distance * .035; panel.controls.maxDistance = distance * 6;
      panel.controls.update(); panel.camera.updateProjectionMatrix(); panel.render();
    }
    this.lock = false;
  }
  showPosters(message = '') {
    this.generation++;
    this.abort?.abort();
    this.panels.forEach(panel => panel.setObject(null));
    this.shell.classList.remove('is-ready', 'is-loading');
    const toolbar = this.shell.querySelector('.viewer-toolbar');
    if (toolbar) toolbar.hidden = true;
    this.status.textContent = message;
  }
  async show(records, home, retainCamera = false, { noiseSigma = 0 } = {}) {
    const generation = ++this.generation;
    this.abort?.abort(); this.abort = new AbortController();
    this.status.textContent = 'Loading 3D…';
    this.shell.classList.add('is-loading');
    const toolbar = this.shell.querySelector('.viewer-toolbar');
    if (toolbar) toolbar.hidden = false;
    if (!retainCamera) this.shell.classList.remove('is-ready');
    let objects = [];
    try {
      // allSettled ensures successful siblings are disposed if one request fails.
      const results = await Promise.allSettled(records.map(record => loadGeometry(record, this.abort.signal)));
      objects = results.filter(result => result.status === 'fulfilled').map(result => result.value);
      if (results.some(result => result.status === 'rejected')) throw results.find(result => result.status === 'rejected').reason;
      if (generation !== this.generation) { objects.forEach(dispose); return; }
      if (noiseSigma > 0) objects.forEach(object => addPointNoise(object, noiseSigma));
      this.home = home;
      this.panels.forEach((panel, index) => panel.setObject(objects[index]));
      this.applyColors();
      objects = [];
      this.shell.classList.add('is-ready');
      if (retainCamera) this.panels.forEach(panel => panel.render());
      else this.reset();
      this.status.textContent = '';
    } catch (error) {
      objects.forEach(dispose);
      if (generation !== this.generation || error.name === 'AbortError') return;
      this.shell.classList.remove('is-ready');
      this.status.textContent = '3D could not load. Select the scene to try again.';
    } finally {
      if (generation === this.generation) this.shell.classList.remove('is-loading');
    }
  }
}

const geometry = window.webGeometry;
const pairedShell = document.querySelector('#scale-viewer');
const overviewShell = document.querySelector('#overview-viewer');
const teaserShell = document.querySelector('#teaser-viewer');
const comparisonShell = document.querySelector('#method-viewer');
let paired, overview, teaser, comparison, activeScene, activeTeaser = 'room', activeStage = 0;
let comparisonId = 'snpp-2162a7cf14';
// Presentation levels increase with refinement; source filenames retain their original recorded numbering.
const stages = ['Input point cloud', 'L0 · Coarse occupancy', 'L1 · Intermediate occupancy', 'L2 · Fine occupancy', 'Output mesh'];

function setOverviewStage(index, syncPipeline = true) {
  activeStage = Number(index);
  document.querySelector('#overview-range').value = activeStage;
  document.querySelector('#overview-stage').textContent = stages[activeStage];
  document.querySelectorAll('[data-overview-stage]').forEach(button => {
    const selected = Number(button.dataset.overviewStage) === activeStage;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected);
  });
  if (syncPipeline) selectPipelineStep(pipelineStepForOverviewIndex(activeStage), { syncViewer: false });
  if (overview) {
    const apartment = geometry.scenes.find(scene => scene.id === '2t7WUuJeko7');
    const record = activeStage === 0 ? apartment.input : activeStage === 4 ? apartment.output : geometry.occupancy[activeStage - 1];
    overview.show([record], apartment.camera, overviewShell.classList.contains('is-ready'), { noiseSigma: activeStage === 0 ? .025 : 0 });
  }
}

const pipelineFigure = document.querySelector('#pipeline-interactive');
const overviewStageButtons = [...document.querySelectorAll('[data-overview-stage]')];
const pipelineStageIndex = { input: 0, stage1: 1, stage2: 4 };
function pipelineStepForOverviewIndex(index) { return index === 0 ? 'input' : index === 4 ? 'stage2' : 'stage1'; }
const pipelineControls = [...document.querySelectorAll('[data-pipeline-step]')];
const pipelineDescription = document.querySelector('#pipeline-description');
const pipelineDescriptions = {
  input: 'Observed partial points anchor generation and preserve the geometry already seen in the scene.',
  stage1: 'Stage 1 generates a coarse-to-fine voxel hierarchy, progressively refining the scene layout and preserving fine structures.',
  stage2: 'Stage 2 generates local shape latents, decodes them, and merges the result into a complete mesh.'
};
let selectedPipelineStep = 'input';
let previewPipelineStepName = null;
let pipelineTourTimer = null;
let pipelineTourIndex = 0;
function renderPipelineState() {
  const visibleStep = previewPipelineStepName || selectedPipelineStep;
  if (visibleStep) pipelineFigure.dataset.highlight = visibleStep;
  else delete pipelineFigure.dataset.highlight;
  pipelineControls.forEach(button => {
    const selected = button.dataset.pipelineStep === selectedPipelineStep;
    button.classList.toggle('selected', selected);
    button.classList.toggle('is-preview', button.dataset.pipelineStep === previewPipelineStepName);
    button.setAttribute('aria-pressed', String(selected));
  });
  overviewStageButtons.forEach(button => button.classList.toggle('is-hovered', Number(button.dataset.overviewStage) === pipelineStageIndex[previewPipelineStepName || selectedPipelineStep]));
  pipelineDescription.textContent = visibleStep ? pipelineDescriptions[visibleStep] : 'The pipeline combines partial-point conditioning with hierarchical metric-scale generation to produce a complete scene mesh.';
}
function previewPipelineStep(step) { previewPipelineStepName = step; renderPipelineState(); }
function clearPipelinePreview(step) {
  if (previewPipelineStepName !== step) return;
  previewPipelineStepName = null;
  renderPipelineState();
}
function stopPipelineTour() {
  if (pipelineTourTimer) window.clearInterval(pipelineTourTimer);
  pipelineTourTimer = null;
  document.querySelector('#pipeline-tour').classList.remove('is-running');
  document.querySelector('#pipeline-tour').innerHTML = 'Take the tour <span aria-hidden="true">→</span>';
}
function selectPipelineStep(step, { syncViewer = true, fromTour = false } = {}) {
  if (!fromTour) stopPipelineTour();
  selectedPipelineStep = step;
  renderPipelineState();
  if (syncViewer) setOverviewStage(pipelineStageIndex[step], false);
}
for (const button of overviewStageButtons) {
  const step = pipelineStepForOverviewIndex(Number(button.dataset.overviewStage));
  button.addEventListener('pointerenter', () => previewPipelineStep(step));
  button.addEventListener('pointerleave', () => clearPipelinePreview(step));
  button.addEventListener('focus', () => previewPipelineStep(step));
  button.addEventListener('blur', () => clearPipelinePreview(step));
}
for (const button of pipelineControls) {
  const step = button.dataset.pipelineStep;
  button.addEventListener('pointerenter', () => previewPipelineStep(step));
  button.addEventListener('pointerleave', () => clearPipelinePreview(step));
  button.addEventListener('focus', () => previewPipelineStep(step));
  button.addEventListener('blur', () => clearPipelinePreview(step));
  button.addEventListener('click', () => selectPipelineStep(step));
}
document.querySelector('#pipeline-show-all').addEventListener('click', () => {
  stopPipelineTour(); selectedPipelineStep = null; previewPipelineStepName = null; renderPipelineState();
});
document.querySelector('#pipeline-tour').addEventListener('click', event => {
  if (pipelineTourTimer) { stopPipelineTour(); return; }
  const steps = Object.keys(pipelineStageIndex);
  const tourButton = event.currentTarget;
  pipelineTourIndex = 0;
  const advance = () => {
    selectPipelineStep(steps[pipelineTourIndex], { fromTour: true });
    pipelineTourIndex += 1;
    if (pipelineTourIndex >= steps.length) stopPipelineTour();
    else tourButton.textContent = `Tour · ${pipelineTourIndex}/${steps.length} · Pause`;
  };
  tourButton.classList.add('is-running');
  advance();
  if (pipelineTourIndex < steps.length) pipelineTourTimer = window.setInterval(advance, 2800);
});
renderPipelineState();
document.querySelector('#overview-range').addEventListener('input', event => setOverviewStage(event.target.value));
document.querySelectorAll('[data-overview-stage]').forEach(button => button.addEventListener('click', () => setOverviewStage(button.dataset.overviewStage)));
window.addEventListener('scale-scene-change', event => {
  activeScene = event.detail;
  if (paired) {
    const scene = geometry.scenes.find(item => item.id === activeScene);
    if (scene) paired.show([scene.input, scene.output], scene.camera);
    else paired.showPosters('Static preview · drag to explore is unavailable for this scene.');
  }
});

window.addEventListener('teaser-scene-change', event => {
  activeTeaser = event.detail;
  if (teaser) {
    const scene = geometry.teasers.find(item => item.id === activeTeaser);
    teaser.show([scene.input, scene.output], scene.camera);
  }
});

function showComparison(retainCamera = false) {
  const scene = geometry.comparisons.find(item => item.id === comparisonId);
  const sceneNumber = geometry.comparisons.filter(item => item.dataset === scene.dataset).findIndex(item => item.id === scene.id) + 1;
  const left = document.querySelector('#compare-left-method').value;
  const right = document.querySelector('#compare-right-method').value;
  document.querySelector('#method-caption').textContent = `${scene.dataset} · Scene ${sceneNumber} · ${scene.views}-view ${scene.input_label || 'DA3 input'} · ${left} / ${right}`;
  for (const [kind, method] of [['left', left], ['right', right]]) {
    document.querySelector('#compare-' + kind + '-label').textContent = (method === 'DA3' || method === 'Input') ? 'Point cloud' : 'Reconstructed mesh';
  }
  if (comparison) comparison.show([scene.methods[left], scene.methods[right]], scene.camera, retainCamera && comparisonShell.classList.contains('is-ready'));
}
document.querySelectorAll('[data-compare-scene]').forEach(button => button.addEventListener('click', () => {
  comparisonId = button.dataset.compareScene;
  document.querySelectorAll('[data-compare-scene]').forEach(item => {
    const selected = item === button; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', selected);
  });
  showComparison();
}));
document.querySelectorAll('#compare-left-method,#compare-right-method').forEach(select => select.addEventListener('change', () => showComparison(true)));

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    try {
      if (entry.target === pairedShell) {
        paired = new SyncedViewer(pairedShell);
        const id = activeScene || document.querySelector('[data-scale-scene].selected').dataset.scaleScene;
        const scene = geometry.scenes.find(item => item.id === id);
        if (scene) paired.show([scene.input, scene.output], scene.camera);
        else paired.showPosters('Static preview · drag to explore is unavailable for this scene.');
      } else if (entry.target === overviewShell) {
        overview = new SyncedViewer(overviewShell); setOverviewStage(activeStage);
      } else if (entry.target === teaserShell) {
        teaser = new SyncedViewer(teaserShell);
        activeTeaser = document.querySelector('[data-scene].selected')?.dataset.scene || activeTeaser;
        const scene = geometry.teasers.find(item => item.id === activeTeaser);
        teaser.show([scene.input, scene.output], scene.camera);
      } else {
        comparison = new SyncedViewer(comparisonShell); showComparison();
      }
      window.anchor3D = { get paired() { return paired; }, get overview() { return overview; }, get teaser() { return teaser; }, get comparison() { return comparison; } };
    } catch (error) {
      entry.target.querySelector('.viewer-status').textContent = '3D is unavailable in this browser. Static preview shown.';
    }
  }
}, { rootMargin: '200px' });
observer.observe(pairedShell); observer.observe(overviewShell);
observer.observe(teaserShell); observer.observe(comparisonShell);
