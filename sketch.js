/*
  CM3065 — Exercise 1 (Audio player + FX + library + recording)

  A browser-based audio sketch built with p5.js + p5.sound.
  Main features:
  - Six preset sounds (assets/sound1.mp3 ... sound6.mp3)
  - A sound library stored in IndexedDB (audio blobs + saved filter settings)
  - Filter settings also mirrored in localStorage as a lightweight fallback
  - A serial effects chain with live sliders
  - Recording from the microphone, saved back into the library
  - Two spectrum views: input (raw) vs output (post-FX)
*/

"use strict";

/* Preset slot names mapped to audio file paths in the assets folder. */
const PRESET_AUDIO_FILES = {
  sound1: "assets/sound1.mp3",
  sound2: "assets/sound2.mp3",
  sound3: "assets/sound3.mp3",
  sound4: "assets/sound4.mp3",
  sound5: "assets/sound5.mp3",
  sound6: "assets/sound6.mp3",
};


/* IndexedDB is used as the persistent library for audio blobs plus saved FX configs. */
const SLOT_DB_NAME = "cm3065_ex1_slots_db"; // Stable database name so existing saved slots remain accessible
const SLOT_STORE_NAME = "slots"; // Stable store name so existing saved slots remain accessible
let slotDb = null;

/* Opens (and creates if needed) the library database with a single object store keyed by slot id. */
function openSlotDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SLOT_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(SLOT_STORE_NAME)) {
        d.createObjectStore(SLOT_STORE_NAME, { keyPath: "slot" });
      }
    };
    req.onsuccess = () => {
      slotDb = req.result;
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

/* Writes or overwrites a slot record (audio blob + metadata + optional FX config). */
function idbWrite(rec) {
  return new Promise((resolve, reject) => {
    const tx = slotDb.transaction(SLOT_STORE_NAME, "readwrite");
    tx.objectStore(SLOT_STORE_NAME).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* Reads a single slot record by key, returning null when missing. */
function idbRead(slot) {
  return new Promise((resolve, reject) => {
    const tx = slotDb.transaction(SLOT_STORE_NAME, "readonly");
    const req = tx.objectStore(SLOT_STORE_NAME).get(slot);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/* Reads all saved slot records at once (used to render the library list). */
function idbReadAll() {
  return new Promise((resolve, reject) => {
    const tx = slotDb.transaction(SLOT_STORE_NAME, "readonly");
    const req = tx.objectStore(SLOT_STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* Removes a slot record from the database. */
function idbRemove(slot) {
  return new Promise((resolve, reject) => {
    const tx = slotDb.transaction(SLOT_STORE_NAME, "readwrite");
    tx.objectStore(SLOT_STORE_NAME).delete(slot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/*
  Ensures the six preset slots exist inside IndexedDB.
  If a preset slot is missing its audio blob, the matching asset is fetched and stored as a blob.
  Any previously saved FX config is preserved (from IndexedDB if present, otherwise from localStorage).
*/
async function seedPresetsIfMissing() {
  const slots = ["sound1","sound2","sound3","sound4","sound5","sound6"];

  for (const slot of slots) {
    const existing = await idbRead(slot);
    if (existing && existing.blob) continue;

    const presetFile = PRESET_AUDIO_FILES[slot];
    try {
      const resp = await fetch(presetFile);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();

      const cfg = (existing && existing.cfg) ? existing.cfg : lsLoadCfg(slot);

      await idbWrite({
        slot,
        blob,
        name: presetFile,
        source: "preset",
        savedAt: Date.now(),
        cfg: cfg || null,
      });
    } catch (e) {
      console.warn("Preset seed failed for", slot, presetFile, e);
    }
  }
}


/*
  localStorage is used as a lightweight fallback store for FX config only.
  Audio data stays in IndexedDB; localStorage keeps the last-known slider values per slot key.
*/
function cfgStorageKey(slot) {
  return `cm3065_ex1_cfg_${slot}`; // Stable key format so older saved configs remain readable
}
function lsSaveCfg(slot, cfg) {
  localStorage.setItem(cfgStorageKey(slot), JSON.stringify(cfg));
}
function lsLoadCfg(slot) {
  try {
    const raw = localStorage.getItem(cfgStorageKey(slot));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

/* Small DOM helper to fetch elements by id. */
const byId = (id) => document.getElementById(id);

/*
  ui holds references to all buttons, sliders, checkboxes, and the library list container.
  These start as null and get assigned inside wireUi().
*/
const ui = {
  statusLine: null,

  playPause: null,
  stop: null,
  loop: null,
  skip: null,

  s1: null,
  s2: null,
  s3: null,
  s4: null,
  s5: null,
  s6: null,

  edit: null,
  del: null,
  recNew: null,

  libList: null,

  recMic: null,
  recSystem: null,

  masterVol: null,

  lpCut: null,
  lpRes: null,
  lpDW: null,
  lpOL: null,

  rvDur: null,
  rvDecay: null,
  rvRev: null,
  rvDW: null,
  rvOL: null,

  cpAtk: null,
  cpKnee: null,
  cpRel: null,
  cpRatio: null,
  cpThr: null,
  cpDW: null,
  cpOL: null,

  dsAmt: null,
  dsOver: null,
  dsDW: null,
  dsOL: null,

  clear: null,
  save: null,
};

/* Updates the on-page status line with short feedback messages. */
function setStatusText(msg) {
  if (ui.statusLine) ui.statusLine.textContent = msg || "";
}


/*
  Runtime state:
  - audioBooted ensures userStartAudio() runs only once
  - activeKey is the currently loaded slot key (preset or user/import/record key)
  - selectedKey is the currently selected library row in the list (can differ from activeKey)
*/
let audioBooted = false;

let activeKey = null;
let selectedKey = null;

/* Detects preset slot keys: sound1 .. sound6. */
const isPresetKey = (k) => /^sound[1-6]$/.test(k);

/* Generates a unique key for recordings/imports using time + random hex. */
function makeUserKey(prefix = "user") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/* activeSound is the currently loaded p5.SoundFile for playback. */
let activeSound = null;

/* loopEnabled controls whether play() repeats continuously. */
let loopEnabled = false;

/*
  Live recording state:
  - capturing shows whether recording is active
  - captureStream is the MediaStream from getUserMedia
  - captureNode is the WebAudio node created from the stream
*/
let capturing = false;
let captureStream = null;
let captureNode = null;

/*
  FX chain nodes in serial order:
  activeSound -> LowPass -> Distortion -> Compressor -> Reverb -> Master Gain -> speakers
*/
let fxLowpass, fxDist, fxComp, fxVerb, fxMaster;

/*
  Two FFT analyzers:
  - fftInput watches the unprocessed input
  - fftOutput watches the processed master output
*/
let fftInput, fftOutput;

/*
  Recorder components:
  - p5Recorder records from a chosen node in the chain
  - p5RecordingFile holds the recorded audio data after stop()
*/
let p5Recorder, p5RecordingFile;


/*
  File import UI:
  - importFileInput is a hidden <input type="file">
  - importDeviceBtn is a visible button placed beside Record New
*/
let importFileInput = null;
let importDeviceBtn = null;


/*
  Loads audio with error handling so missing files or decode failures do not crash the sketch.
  onOk runs after successful load; failMsg provides a clearer status message when needed.
*/
function loadSoundSafely(pathOrUrl, onOk, failMsg) {
  try {
    return loadSound(
      pathOrUrl,
      () => {
        if (onOk) onOk();
      },
      (err) => {
        setStatusText(failMsg || `❌ Failed to load audio: ${pathOrUrl}`);
        console.error("loadSound error:", pathOrUrl, err);
      }
    );
  } catch (e) {
    setStatusText(failMsg || `❌ Audio load crashed: ${pathOrUrl}`);
    console.error(e);
    return null;
  }
}

/* Checks whether a p5.SoundFile has a decoded buffer ready for playback. */
function soundIsReady(sf) {
  return !!(sf && sf.buffer);
}


/*
  p5 setup():
  - Creates the canvas
  - Builds FX chain nodes and FFT analyzers
  - Prepares the recorder
  - Wires UI events and import button
  - Opens IndexedDB, seeds presets, renders library
  - Starts in noLoop() mode until audio is booted
*/
function setup() {
  const canvas = createCanvas(760, 200);
  canvas.parent(document.querySelector("main"));

  fxLowpass = new p5.LowPass();
  fxDist = new p5.Distortion();
  fxComp = new p5.Compressor();
  fxVerb = new p5.Reverb();
  fxMaster = new p5.Gain();

  fftInput = new p5.FFT(0.8, 1024);
  fftOutput = new p5.FFT(0.8, 1024);

  p5Recorder = new p5.SoundRecorder();
  p5Recorder.setInput(fxMaster);
  p5RecordingFile = new p5.SoundFile();

  wireUi();
  initDeviceImportUi();

  openSlotDb()
     .then(seedPresetsIfMissing)
    .then(renderLibrary)
    .then(() =>
      setStatusText(
        "Ready. Load Sound 1–6 or Choose from device, then Play. Record New saves into the library."
      )
    )
    .catch((e) => {
      console.error(e);
      setStatusText("IndexedDB blocked/unavailable. Recording/library persistence may not work.");
    });

  noLoop();
}

/*
  p5 draw():
  - Draws two rounded panels and headings
  - If audio is not booted yet, shows a helper message and exits
  - Otherwise draws input and output spectra using the FFT analyzers
*/
function draw() {
  background(255);

  stroke(30);
  noFill();
  rect(10, 25, width / 2 - 20, height - 45, 12);
  rect(width / 2 + 10, 25, width / 2 - 20, height - 45, 12);

  noStroke();
  fill(0);
  textStyle(BOLD);
  text("Spectrum In", 20, 18);
  text("Spectrum Out", width / 2 + 20, 18);

  if (!audioBooted) {
    fill(80);
    textStyle(NORMAL);
    text("Click a Sound button, Choose from device, or Record New to start audio.", 28, 108);
    return;
  }

  const specIn = fftInput.analyze();
  const specOut = fftOutput.analyze();

drawNeonSpectrum(specIn, 20, 40, width / 2 - 40, height - 70);
drawNeonSpectrum(specOut, width / 2 + 20, 40, width / 2 - 40, height - 70);



}

/*
  Draws a smooth, glowing “mountain” spectrum:
  - Samples the FFT array down to a smaller set of points
  - Applies a couple of smoothing passes to reduce jagged movement
  - Uses canvas shadow settings for a neon glow
  - Renders a filled shape, a bright outline, and occasional peak dots
*/
function drawNeonSpectrum(spec, x, y, w, h) {
  const pts = 140;
  const step = Math.max(1, Math.floor(spec.length / pts));

  const vals = new Array(pts + 1).fill(0);
  for (let i = 0; i <= pts; i++) {
    const bin = Math.min(spec.length - 1, i * step);
    vals[i] = spec[bin] / 255;
  }
  for (let k = 0; k < 2; k++) {
    for (let i = 1; i < pts; i++) {
      vals[i] = (vals[i - 1] + vals[i] + vals[i + 1]) / 3;
    }
  }

  const ctx = drawingContext;
  ctx.save();
  ctx.shadowBlur = 18;
  ctx.shadowColor = "rgba(0, 170, 255, 0.95)";

  noStroke();
  fill(0, 170, 255, 55);
  beginShape();
  vertex(x, y + h);
  for (let i = 0; i <= pts; i++) {
    const px = x + (i / pts) * w;
    const py = y + h - vals[i] * h;
    vertex(px, py);
  }
  vertex(x + w, y + h);
  endShape(CLOSE);

  noFill();
  stroke(0, 170, 255, 170);
  strokeWeight(2.5);
  beginShape();
  for (let i = 0; i <= pts; i++) {
    const px = x + (i / pts) * w;
    const py = y + h - vals[i] * h;
    vertex(px, py);
  }
  endShape();

  noStroke();
  fill(255, 255, 255, 190);
  for (let i = 0; i <= pts; i += 10) {
    const px = x + (i / pts) * w;
    const py = y + h - vals[i] * h;
    circle(px, py, 3.2);
  }

  ctx.restore();

  stroke(80);
  strokeWeight(1);
  line(x, y + h, x + w, y + h);
}


/*
  Starts the audio context once, then enables continuous drawing.
  p5.sound requires a user gesture before audio can run, so this is triggered from UI actions.
*/
async function bootAudioOnce() {
  if (audioBooted) return;
  await userStartAudio();
  audioBooted = true;
  loop();
  setStatusText("Audio started.");
}


/*
  Finds UI elements by id and attaches all event handlers:
  - Slot buttons load preset keys
  - Transport buttons control playback
  - Edit/Delete/Record New operate on selected library items
  - Sliders and toggles update FX parameters live
  - Clear resets slider values; Save stores current FX config for the active/selected slot
*/
function wireUi() {
  ui.statusLine = byId("status");

  ui.playPause = byId("playPauseBtn");
  ui.stop = byId("stopBtn");
  ui.loop = byId("loopBtn");
  ui.skip = byId("skipBtn");

  ui.s1 = byId("sound1Btn");
  ui.s2 = byId("sound2Btn");
  ui.s3 = byId("sound3Btn");
  ui.s4 = byId("sound4Btn");
  ui.s5 = byId("sound5Btn");
  ui.s6 = byId("sound6Btn");

  ui.edit = byId("editBtn");
  ui.del = byId("deleteBtn");
  ui.recNew = byId("recordNewBtn");

  ui.libList = byId("libraryList");

  ui.recMic = byId("recMic");
  ui.recSystem = byId("recSystem");

  ui.masterVol = byId("masterVol");

  ui.lpCut = byId("lpCut");
  ui.lpRes = byId("lpRes");
  ui.lpDW = byId("lpDW");
  ui.lpOL = byId("lpOL");

  ui.rvDur = byId("rvDur");
  ui.rvDecay = byId("rvDecay");
  ui.rvRev = byId("rvRev");
  ui.rvDW = byId("rvDW");
  ui.rvOL = byId("rvOL");

  ui.cpAtk = byId("cpAtk");
  ui.cpKnee = byId("cpKnee");
  ui.cpRel = byId("cpRel");
  ui.cpRatio = byId("cpRatio");
  ui.cpThr = byId("cpThr");
  ui.cpDW = byId("cpDW");
  ui.cpOL = byId("cpOL");

  ui.dsAmt = byId("dsAmt");
  ui.dsOver = byId("dsOver");
  ui.dsDW = byId("dsDW");
  ui.dsOL = byId("dsOL");

  ui.clear = byId("clearBtn");
  ui.save = byId("saveBtn");

  if (ui.s1) ui.s1.onclick = () => loadByKey("sound1");
  if (ui.s2) ui.s2.onclick = () => loadByKey("sound2");
  if (ui.s3) ui.s3.onclick = () => loadByKey("sound3");
  if (ui.s4) ui.s4.onclick = () => loadByKey("sound4");
  if (ui.s5) ui.s5.onclick = () => loadByKey("sound5");
  if (ui.s6) ui.s6.onclick = () => loadByKey("sound6");

  if (ui.playPause) ui.playPause.onclick = () => togglePlay();
  if (ui.stop) ui.stop.onclick = () => stopNow(false);
  if (ui.loop) ui.loop.onclick = () => flipLoopMode();
  if (ui.skip) ui.skip.onclick = () => goToStart();

  if (ui.edit) ui.edit.onclick = () => editLibrarySelection();
  if (ui.del) ui.del.onclick = () => deleteLibrarySelection();
  if (ui.recNew) ui.recNew.onclick = () => toggleRecordNew();

  const boundInputs = [
    ui.masterVol,
    ui.lpCut,
    ui.lpRes,
    ui.lpDW,
    ui.lpOL,
    ui.rvDur,
    ui.rvDecay,
    ui.rvRev,
    ui.rvDW,
    ui.rvOL,
    ui.cpAtk,
    ui.cpKnee,
    ui.cpRel,
    ui.cpRatio,
    ui.cpThr,
    ui.cpDW,
    ui.cpOL,
    ui.dsAmt,
    ui.dsOver,
    ui.dsDW,
    ui.dsOL,
  ].filter(Boolean);

  boundInputs.forEach((control) => {
    const evtName = control.type === "checkbox" || control.tagName === "SELECT" ? "change" : "input";
    control.addEventListener(evtName, syncFxParams);
  });

  if (ui.clear) ui.clear.onclick = () => resetFilters();
  if (ui.save) ui.save.onclick = () => persistCurrentFx();
}


/*
  Adds “Choose from device” support:
  - Uses an existing hidden file input if present, otherwise creates one
  - When a file is picked, it is imported into the library as a new slot
  - A visible button triggers the file picker after audio has been booted
*/
function initDeviceImportUi() {
  importFileInput = byId("filePicker");
  if (!importFileInput) {
    importFileInput = document.createElement("input");
    importFileInput.type = "file";
    importFileInput.accept = "audio/*,.wav,.mp3,.ogg,.m4a";
    importFileInput.style.display = "none";
    document.body.appendChild(importFileInput);
  } else {
    importFileInput.accept = "audio/*,.wav,.mp3,.ogg,.m4a";
  }

  importFileInput.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    try {
      if (!f) return;
      await bootAudioOnce();
      await importIntoLibrary(f);
    } finally {
      importFileInput.value = "";
    }
  });

  importDeviceBtn = document.createElement("button");
  importDeviceBtn.type = "button";
  importDeviceBtn.textContent = "Choose from device";
  importDeviceBtn.style.marginLeft = "8px";
  importDeviceBtn.onclick = async () => {
    await bootAudioOnce();
    importFileInput.click();
  };

  if (ui.recNew && ui.recNew.parentNode) {
    ui.recNew.parentNode.insertBefore(importDeviceBtn, ui.recNew.nextSibling);
  } else {
    document.body.appendChild(importDeviceBtn);
  }
}

/*
  Imports an audio file into IndexedDB:
  - Builds a fresh slot key (import_...)
  - Stores the file as a blob
  - Captures the current FX config so the imported audio loads with the same settings
  - Re-renders the library and auto-loads the new slot
*/
async function importIntoLibrary(file) {
 const targetSlot = makeUserKey("import");

  setStatusText(`Importing "${file.name}" into ${targetSlot.toUpperCase()}...`);

  const buf = await file.arrayBuffer();
  const blob = new Blob([buf], { type: file.type || "audio/wav" });

  if (!blob || blob.size === 0) {
    setStatusText("❌ Import failed: file was empty.");
    return;
  }

  const fxCfg = readFxConfig();
  await idbWrite({
    slot: targetSlot,
    blob,
    name: file.name,
    source: "imported",
    savedAt: Date.now(),
    cfg: fxCfg,
  });
  lsSaveCfg(targetSlot, fxCfg);

  await renderLibrary();
 await loadByKey(targetSlot);


  setStatusText(`✅ Imported "${file.name}" into ${targetSlot.toUpperCase()} (now editable in library).`);
}


/* Highlights the active preset button so it matches the loaded preset slot. */
function highlightSlotButton(slot) {
  const btnMap = {
    sound1: ui.s1,
    sound2: ui.s2,
    sound3: ui.s3,
    sound4: ui.s4,
    sound5: ui.s5,
    sound6: ui.s6,
  };
  Object.keys(btnMap).forEach((k) => {
    if (btnMap[k]) btnMap[k].classList.toggle("active", k === slot);
  });
}


/* Reads the current slider/checkbox/select values into a single config object. */
function readFxConfig() {
  return {
    masterVol: +ui.masterVol.value,

    lpCut: +ui.lpCut.value,
    lpRes: +ui.lpRes.value,
    lpDW: +ui.lpDW.value,
    lpOL: +ui.lpOL.value,

    rvDur: +ui.rvDur.value,
    rvDecay: +ui.rvDecay.value,
    rvRev: !!ui.rvRev.checked,
    rvDW: +ui.rvDW.value,
    rvOL: +ui.rvOL.value,

    cpAtk: +ui.cpAtk.value,
    cpKnee: +ui.cpKnee.value,
    cpRel: +ui.cpRel.value,
    cpRatio: +ui.cpRatio.value,
    cpThr: +ui.cpThr.value,
    cpDW: +ui.cpDW.value,
    cpOL: +ui.cpOL.value,

    dsAmt: +ui.dsAmt.value,
    dsOver: ui.dsOver.value,
    dsDW: +ui.dsDW.value,
    dsOL: +ui.dsOL.value,
  };
}

/*
  Applies a config object back onto the UI controls.
  syncFxParams() is called at the end so the audio nodes immediately match the UI.
*/
function applyFxConfig(cfg) {
  if (!cfg) return;

  ui.masterVol.value = cfg.masterVol ?? ui.masterVol.value;

  ui.lpCut.value = cfg.lpCut ?? ui.lpCut.value;
  ui.lpRes.value = cfg.lpRes ?? ui.lpRes.value;
  ui.lpDW.value = cfg.lpDW ?? ui.lpDW.value;
  ui.lpOL.value = cfg.lpOL ?? ui.lpOL.value;

  ui.rvDur.value = cfg.rvDur ?? ui.rvDur.value;
  ui.rvDecay.value = cfg.rvDecay ?? ui.rvDecay.value;
  ui.rvRev.checked = cfg.rvRev ?? ui.rvRev.checked;
  ui.rvDW.value = cfg.rvDW ?? ui.rvDW.value;
  ui.rvOL.value = cfg.rvOL ?? ui.rvOL.value;

  ui.cpAtk.value = cfg.cpAtk ?? ui.cpAtk.value;
  ui.cpKnee.value = cfg.cpKnee ?? ui.cpKnee.value;
  ui.cpRel.value = cfg.cpRel ?? ui.cpRel.value;
  ui.cpRatio.value = cfg.cpRatio ?? ui.cpRatio.value;
  ui.cpThr.value = cfg.cpThr ?? ui.cpThr.value;
  ui.cpDW.value = cfg.cpDW ?? ui.cpDW.value;
  ui.cpOL.value = cfg.cpOL ?? ui.cpOL.value;

  ui.dsAmt.value = cfg.dsAmt ?? ui.dsAmt.value;
  ui.dsOver.value = cfg.dsOver ?? ui.dsOver.value;
  ui.dsDW.value = cfg.dsDW ?? ui.dsDW.value;
  ui.dsOL.value = cfg.dsOL ?? ui.dsOL.value;

  syncFxParams();
}


/*
  Pushes current UI values into the audio FX nodes in serial order.
  If audio has not been booted yet, the function exits early to avoid invalid node calls.
*/
function syncFxParams() {
  if (!audioBooted) return;

  fxLowpass.freq(+ui.lpCut.value);
  fxLowpass.res(+ui.lpRes.value);
  fxLowpass.drywet(+ui.lpDW.value);
  fxLowpass.amp(+ui.lpOL.value);

  fxDist.set(+ui.dsAmt.value, ui.dsOver.value);
  fxDist.drywet(+ui.dsDW.value);
  fxDist.amp(+ui.dsOL.value);

  fxComp.set(+ui.cpAtk.value, +ui.cpKnee.value, +ui.cpRatio.value, +ui.cpThr.value, +ui.cpRel.value);
  fxComp.drywet(+ui.cpDW.value);
  fxComp.amp(+ui.cpOL.value);

  fxVerb.set(+ui.rvDur.value, +ui.rvDecay.value, !!ui.rvRev.checked);
  fxVerb.drywet(+ui.rvDW.value);
  fxVerb.amp(+ui.rvOL.value);

  fxMaster.amp(+ui.masterVol.value);
}


/*
  Connects the currently loaded sound file to the FX chain and speakers.
  Also sets FFT inputs so the “in” spectrum reads the raw file, while “out” reads the post-FX master.
*/
function routeSoundThroughFx() {
  if (!activeSound) return;

  if (!soundIsReady(activeSound)) {
    setStatusText("❌ Audio buffer is invalid (missing file or failed decode). Fix WAV path.");
    return;
  }

  activeSound.disconnect();
  fxLowpass.disconnect();
  fxDist.disconnect();
  fxComp.disconnect();
  fxVerb.disconnect();
  fxMaster.disconnect();

  activeSound.connect(fxLowpass);
  fxLowpass.connect(fxDist);
  fxDist.connect(fxComp);
  fxComp.connect(fxVerb);
  fxVerb.connect(fxMaster);
  fxMaster.connect();

  fftInput.setInput(activeSound);
  fftOutput.setInput(fxMaster);

  syncFxParams();
}


/*
  Routes a WebAudio source node (typically from a MediaStream) through the same FX chain.
  The master output is connected directly to the AudioContext destination.
*/
function routeStreamThroughFx(webAudioSourceNode) {
  if (!webAudioSourceNode) return;

  const ac = getAudioContext();

  fxLowpass.disconnect();
  fxDist.disconnect();
  fxComp.disconnect();
  fxVerb.disconnect();
  fxMaster.disconnect();

  try {
    webAudioSourceNode.disconnect();
  } catch (_) {}

  webAudioSourceNode.connect(fxLowpass.input);
  fxLowpass.connect(fxDist);
  fxDist.connect(fxComp);
  fxComp.connect(fxVerb);
  fxVerb.connect(fxMaster);

  fxMaster.output.connect(ac.destination);

  fftInput.setInput(fxLowpass);
  fftOutput.setInput(fxMaster);

  syncFxParams();
}


/* Provides a consistent default set of FX values used for first-time loads and reset actions. */
function defaultFxConfig() {
  return {
    masterVol: 0.8,
    lpCut: 2500,
    lpRes: 1.2,
    lpDW: 0.7,
    lpOL: 1.0,

    rvDur: 2.5,
    rvDecay: 3.0,
    rvRev: false,
    rvDW: 0.0,
    rvOL: 1.0,

    cpAtk: 0.02,
    cpKnee: 10,
    cpRel: 0.25,
    cpRatio: 4,
    cpThr: -18,
    cpDW: 1.0,
    cpOL: 1.0,

    dsAmt: 0.0,
    dsOver: "none",
    dsDW: 0.0,
    dsOL: 1.0,
  };
}

/*
  Loads a slot by key:
  - Boots audio if needed
  - Stops current playback
  - Restores FX config (IndexedDB cfg > localStorage cfg > defaults)
  - Loads audio from IndexedDB blob when present
  - For preset keys, falls back to loading the asset file if no blob exists
*/
async function loadByKey(key) {
  await bootAudioOnce();

  stopNow(true);
  activeKey = key;

  if (isPresetKey(key)) highlightSlotButton(key);

  const rec = await idbRead(key);
  const cfg = (rec && rec.cfg) ? rec.cfg : (lsLoadCfg(key) || defaultFxConfig());
applyFxConfig(cfg);
  if (rec && rec.blob) {
    const url = URL.createObjectURL(rec.blob);
    const extra = rec.name ? ` (${rec.name})` : "";
    setStatusText(`Loading ${key.toUpperCase()}${extra}...`);

    activeSound = loadSoundSafely(url, () => {
      routeSoundThroughFx();
      applyFxConfig(cfg);
      setStatusText(`${key.toUpperCase()} loaded. Press Play.`);
    }, `❌ Failed to load saved audio for ${key.toUpperCase()}.`);
    return;
  }

  if (isPresetKey(key)) {
    const presetFile = PRESET_AUDIO_FILES[key];
    setStatusText(`Loading ${key.toUpperCase()} (${presetFile})...`);

    activeSound = loadSoundSafely(presetFile, () => {
      routeSoundThroughFx();
      applyFxConfig(cfg);
      setStatusText(`${key.toUpperCase()} loaded. Press Play.`);
    }, `❌ Missing preset: ${presetFile}`);
    return;
  }

  setStatusText("❌ Library item missing (deleted or corrupted).");
}


/*
  Playback controls:
  - togglePlay() plays/pauses the active sound and applies loop state
  - stopNow() stops playback
  - flipLoopMode() toggles looping and updates the sound’s loop flag
  - goToStart() jumps playhead back to time 0
*/
function togglePlay() {
  bootAudioOnce().then(() => {
    if (!activeSound) {
      setStatusText("Load a sound first (Sound 1–6) or Choose from device.");
      return;
    }
    if (!soundIsReady(activeSound)) {
      setStatusText("❌ This sound failed to load (0 frames). Fix file path / missing wav.");
      return;
    }

    if (activeSound.isPlaying()) {
      activeSound.pause();
      setStatusText("Paused.");
    } else {
      activeSound.play();
      activeSound.setLoop(loopEnabled);
      setStatusText("Playing.");
    }
  });
}

function stopNow(silent) {
  if (activeSound) {
    try {
      activeSound.stop();
    } catch (_) {}
  }
  if (!silent) setStatusText("Stopped.");
}

function flipLoopMode() {
  loopEnabled = !loopEnabled;
  if (activeSound && soundIsReady(activeSound)) activeSound.setLoop(loopEnabled);
  setStatusText(loopEnabled ? "Loop ON." : "Loop OFF.");
}

function goToStart() {
  if (!activeSound) {
    setStatusText("Load a sound first.");
    return;
  }
  if (!soundIsReady(activeSound)) {
    setStatusText("❌ Sound invalid (failed decode).");
    return;
  }
  activeSound.jump(0);
  setStatusText("Skipped to start.");
}


/*
  Restores all FX controls to a known baseline and applies them to the audio chain.
*/
function resetFilters() {
  const defaults = {
    masterVol: 0.8,
    lpCut: 2500,
    lpRes: 1.2,
    lpDW: 0.7,
    lpOL: 1.0,
    rvDur: 2.5,
    rvDecay: 3.0,
    rvRev: false,
    rvDW: 0.0,
    rvOL: 1.0,
    cpAtk: 0.02,
    cpKnee: 10,
    cpRel: 0.25,
    cpRatio: 4,
    cpThr: -18,
    cpDW: 1.0,
    cpOL: 1.0,
    dsAmt: 0.0,
    dsOver: "none",
    dsDW: 0.0,
    dsOL: 1.0,
  };
  applyFxConfig(defaults);
  setStatusText("Filters cleared (defaults).");
}


/*
  Saves current FX config for the active or selected slot:
  - Writes cfg into the IndexedDB record (or creates a minimal record if missing)
  - Mirrors cfg into localStorage for quick reload compatibility
  - Refreshes the library UI so “Filters saved” tags update
*/
async function persistCurrentFx() {
  if (!slotDb) {
    setStatusText("❌ Database not ready yet. Refresh and try again.");
    return;
  }

  const key = activeKey || selectedKey;
  if (!key) {
    setStatusText("Load/select a sound first, then Save.");
    return;
  }

  const cfg = readFxConfig();
  const existing = await idbRead(key);

  const base = existing || {
    slot: key,
    blob: null,
    name: isPresetKey(key) ? PRESET_AUDIO_FILES[key] : (key),
    source: isPresetKey(key) ? "preset" : "user",
    savedAt: Date.now(),
  };

  base.cfg = cfg;

  await idbWrite(base);
  lsSaveCfg(key, cfg);

  setStatusText(`✅ Saved filters for ${isPresetKey(key) ? key.toUpperCase() : (base.name || "library item")}.`);
  await renderLibrary();
}


/*
  Renders the library list UI:
  - Preset slots always appear first (Sound1..Sound6)
  - Recorded/imported items appear under a divider, newest first
  - Clicking a row sets selectedKey and updates selection styling
*/
async function renderLibrary() {
  if (!ui.libList) return;

  const all = await idbReadAll();
  const byKey = new Map(all.map((x) => [x.slot, x]));
  const presetKeys = ["sound1","sound2","sound3","sound4","sound5","sound6"];

  const extras = all
    .filter(r => !isPresetKey(r.slot))
    .sort((a,b) => (b.savedAt || 0) - (a.savedAt || 0));

  ui.libList.innerHTML = "";

  for (const k of presetKeys) {
    const rec = byKey.get(k);
    const row = document.createElement("div");
    row.className = "libRow";
    row.dataset.key = k;

    const title = document.createElement("div");
    title.className = "libName";
    title.textContent = k.toUpperCase();

    const meta = document.createElement("div");
    meta.className = "libTag";
    const hasCfg = !!(rec && rec.cfg) || !!lsLoadCfg(k);
    meta.textContent = `Preset${hasCfg ? " | Filters saved" : ""}`;

    row.appendChild(title);
    row.appendChild(meta);

    row.onclick = () => {
      selectedKey = k;
      Array.from(ui.libList.querySelectorAll(".libRow")).forEach(r =>
        r.classList.toggle("selected", r.dataset.key === k)
      );
      setStatusText(`Selected ${k.toUpperCase()} (preset).`);
    };

    ui.libList.appendChild(row);
  }

  if (extras.length) {
    const sep = document.createElement("div");
    sep.style.margin = "10px 0";
    sep.style.opacity = "0.6";
    sep.textContent = "Library (Recorded / Imported)";
    ui.libList.appendChild(sep);
  }

  for (const rec of extras) {
    const k = rec.slot;

    const row = document.createElement("div");
    row.className = "libRow";
    row.dataset.key = k;

    const title = document.createElement("div");
    title.className = "libName";
    title.textContent = rec.name ? rec.name : k;

    const meta = document.createElement("div");
    meta.className = "libTag";
    const hasCfg = !!rec.cfg || !!lsLoadCfg(k);
    const kind = rec.source === "imported" ? "Imported" : "Recorded";
    meta.textContent = `${kind}${hasCfg ? " | Filters saved" : ""}`;

    row.appendChild(title);
    row.appendChild(meta);

    row.onclick = () => {
      selectedKey = k;
      Array.from(ui.libList.querySelectorAll(".libRow")).forEach(r =>
        r.classList.toggle("selected", r.dataset.key === k)
      );
      setStatusText(`Selected library item.`);
    };

    ui.libList.appendChild(row);
  }
}


/*
  Edit loads the selected (or active) slot into the player so sliders can be adjusted and saved.
*/
function editLibrarySelection() {
  const key = selectedKey || activeKey;
  if (!key) {
    setStatusText("Select an item in the list, then Edit.");
    return;
  }
  loadByKey(key);
  setStatusText("Editing: adjust filters then press Save.");
}


/*
  Delete removes a slot record and its saved config, then refreshes the library.
  Note: selectedInLibrary and activeSlot are referenced here and are expected to exist in the full project scope.
*/
async function deleteLibrarySelection() {
  const slot = selectedKey || activeKey;

  if (!slot) {
    setStatusText("Select a slot in the list, then Delete.");
    return;
  }

  const wasActive = (activeKey === slot);

  // Remove the record (audio blob + cfg) from IndexedDB
  await idbRemove(slot);

  // Remove saved FX config fallback
  localStorage.removeItem(cfgStorageKey(slot));

  // If we deleted the currently loaded sound, stop and clear playback state
  if (wasActive) {
    stopNow(true);
    activeSound = null;
    activeKey = null;
    highlightSlotButton(null); // clears preset highlight
  }

  // Clear selection if it was the deleted one
  if (selectedKey === slot) selectedKey = null;

  // If a preset was deleted, re-seed it so the preset audio comes back (but filters stay cleared)
  if (isPresetKey(slot)) {
    await seedPresetsIfMissing();
    setStatusText(`${slot.toUpperCase()} reset to preset (audio restored, filters cleared).`);
  } else {
    setStatusText("Library item deleted.");
  }

  await renderLibrary();
}



/*
  Recording toggle:
  - First click starts capture
  - Second click stops capture and triggers finalize logic in the record callback
*/
async function toggleRecordNew() {
  await bootAudioOnce();
  if (capturing) finishCapture();
  else beginCapture();
}

/* Used to guard against cases where the stop callback never fires (permission or stream issues). */
let finalizeWatchdog = null;

/*
  Starts microphone capture and routes it through the FX chain:
  - Blocks recording on file:// to avoid browser security restrictions
  - Requests microphone permission
  - Builds a MediaStreamSource node and connects it into the chain
  - Sets recorder input to the start of the chain to avoid empty recordings
  - Uses a watchdog timeout to fail cleanly if finalize never happens
*/
async function beginCapture() {
  try {
    if (location.protocol === "file:") {
      setStatusText("❌ Recording blocked on file://. Use Live Server (http://127.0.0.1).");
      return;
    }

    if (finalizeWatchdog) {
      clearTimeout(finalizeWatchdog);
      finalizeWatchdog = null;
    }

    setStatusText("Requesting microphone permission...");
    captureStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    const audioTracks = captureStream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) {
      releaseCapture();
      setStatusText("❌ No audio track detected. Check mic permissions.");
      return;
    }

    const t = audioTracks[0];
    if (t.readyState === "ended" || t.enabled === false) {
      releaseCapture();
      setStatusText("❌ Microphone track is not active. Re-allow permission and try again.");
      return;
    }

    const ac = getAudioContext();
    captureNode = ac.createMediaStreamSource(captureStream);

    routeStreamThroughFx(captureNode);

    p5Recorder.setInput(fxLowpass);

    await new Promise((r) => setTimeout(r, 250));

    p5RecordingFile = new p5.SoundFile();
    let callbackHit = false;

    p5Recorder.record(p5RecordingFile, undefined, async () => {
      callbackHit = true;

      if (finalizeWatchdog) {
        clearTimeout(finalizeWatchdog);
        finalizeWatchdog = null;
      }

      try {
        if (!p5RecordingFile || !p5RecordingFile.buffer) {
          setStatusText("❌ Recording produced no buffer. Check mic + record longer (2–3s).");
          return;
        }

        const frames = p5RecordingFile.buffer.length || 0;
        if (frames <= 0) {
          setStatusText("❌ Recorded 0 frames. Make sure mic has input + record longer.");
          return;
        }

        let blob;
        try {
          blob = p5RecordingFile.getBlob();
        } catch (e) {
          console.error("getBlob failed:", e);
          setStatusText("❌ Could not export recording. Try recording longer.");
          return;
        }

        if (!blob || blob.size === 0) {
          setStatusText("❌ Recording blob empty. Check mic input.");
          return;
        }

        const targetSlot = makeUserKey("record");

        const cfg = readFxConfig();

        await idbWrite({
          slot: targetSlot,
          blob,
          name: `${targetSlot}_recording.wav`,
          source: "recorded",
          savedAt: Date.now(),
          cfg,
        });

        lsSaveCfg(targetSlot, cfg);

        await renderLibrary();
        await loadByKey(targetSlot);

        setStatusText(`✅ Recording saved into ${targetSlot.toUpperCase()} (${blob.size} bytes)`);
        saveSound(p5RecordingFile, `${targetSlot}_recording.wav`);
      } catch (err) {
        console.error(err);
        setStatusText("❌ Error saving recording: " + (err?.message || err));
      } finally {
        releaseCapture();
        p5Recorder.setInput(fxMaster);
      }
    });

    capturing = true;
    setStatusText("Recording... click Record New again to stop.");

    finalizeWatchdog = setTimeout(() => {
      if (!callbackHit) {
        setStatusText("❌ Recording timed out. Permission denied or no mic input.");
        try { p5Recorder.stop(); } catch (_) {}
        releaseCapture();
        try { p5Recorder.setInput(fxMaster); } catch (_) {}
        capturing = false;
      }
    }, 10000);
  } catch (e) {
    console.error(e);

    if (finalizeWatchdog) {
      clearTimeout(finalizeWatchdog);
      finalizeWatchdog = null;
    }

    if (e && e.name === "NotAllowedError") {
      setStatusText("❌ Permission denied. Allow microphone access in browser settings.");
    } else {
      setStatusText("❌ Recording failed: " + (e?.message || e));
    }

    releaseCapture();
    try { p5Recorder.setInput(fxMaster); } catch (_) {}
    capturing = false;
  }
}

/*
  Stops an in-progress recording.
  The actual save/export work happens inside the record callback registered in beginCapture().
*/
function finishCapture() {
  if (!capturing) return;

  setStatusText("Finalizing recording...");
  try {
    p5Recorder.stop();
  } catch (_) {}

  capturing = false;
}

/* Releases microphone stream tracks and clears capture nodes so future recordings can start cleanly. */
function releaseCapture() {
  if (captureStream) {
    try {
      captureStream.getTracks().forEach((t) => t.stop());
    } catch (_) {}
    captureStream = null;
  }
  captureNode = null;
}

/*
  Scans preset slots and returns the first slot that has no stored blob.
  If all are filled, sound1 is returned as a fallback.
*/
async function pickWritableSlot() {
  const order = ["sound1", "sound2", "sound3", "sound4", "sound5", "sound6"];
  for (const s of order) {
    const rec = await idbRead(s);
    if (!rec || !rec.blob) return s;
  }
  return "sound1";
}
