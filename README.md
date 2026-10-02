# Web-Based Audio Processor, Sound Library & Recorder

A browser-based audio workstation built with **JavaScript, p5.js and p5.sound**. The application combines audio playback, a persistent sound library, a serial effects chain, microphone recording and real-time spectrum visualisation in a single interface.

The original HTML, JavaScript, CSS, bundled p5 libraries and audio assets are preserved unchanged.

## Main Features

### Sound Library

The application provides preset sound slots and a persistent browser-based library.

The JavaScript maps preset keys:

```text
sound1
sound2
sound3
sound4
sound5
sound6
```

to audio files in the `assets/` directory.

The supplied project archive contains:

```text
assets/sound1.mp3
assets/sound2.mp3
assets/sound3.mp3
assets/sound4.mp3
assets/sound5.mp3
```

The source also references `assets/sound6.mp3`, but that file is not present in the supplied project archive. This is documented here without changing the original implementation.

### IndexedDB Persistence

Audio library items are stored in the browser using **IndexedDB**.

Each record can contain:

- slot identifier;
- audio blob;
- source filename;
- source type;
- save timestamp;
- saved effects configuration.

Preset audio is automatically seeded into the IndexedDB store when available.

### Saved Effects Configuration

Effects settings are stored together with library records in IndexedDB.

The same configuration is also mirrored in `localStorage` as a lightweight fallback.

This allows individual library items to retain their own effects settings.

## Audio Import

Users can choose audio files from the local device.

Supported browser file-picker types include:

```text
audio/*
.wav
.mp3
.ogg
.m4a
```

Imported audio is stored as a browser `Blob` inside IndexedDB and is added to the sound library with its current effects configuration.

## Playback Controls

The workstation provides standard transport controls:

- play / pause;
- stop;
- loop;
- skip to start;
- master volume.

The currently selected library item is loaded into a `p5.SoundFile` and routed through the processing chain.

## Serial Effects Chain

The audio signal is routed through the following chain:

```text
Sound / Microphone
        ↓
Low-Pass Filter
        ↓
Distortion
        ↓
Compressor
        ↓
Reverb
        ↓
Master Gain
        ↓
Output
```

The processing nodes are created using:

```text
p5.LowPass
p5.Distortion
p5.Compressor
p5.Reverb
p5.Gain
```

## Low-Pass Filter

The low-pass filter controls include:

- cutoff frequency;
- resonance;
- dry/wet amount;
- output level.

## Reverb

The reverb controls include:

- duration;
- decay rate;
- reverse mode;
- dry/wet amount;
- output level.

## Dynamic Compressor

The compressor section exposes controls for:

- attack;
- knee;
- release;
- ratio;
- threshold;
- dry/wet amount;
- output level.

## Distortion

The distortion section includes controls for:

- distortion amount;
- oversampling;
- dry/wet amount;
- output level.

## Effects Presets and Reset

The interface allows the current effects configuration to be saved for the selected library item.

A clear/reset action restores the project's default effects settings.

## Real-Time Spectrum Visualisation

The application creates two separate `p5.FFT` analyzers:

```text
Input FFT
Output FFT
```

The input analyzer monitors the unprocessed source signal, while the output analyzer monitors the processed master signal.

This allows the interface to display the spectral effect of the audio-processing chain in real time.

The FFT setup uses:

```text
1024 frequency bins
0.8 smoothing
```

## Microphone Recording

The project includes microphone capture using the browser's media APIs together with `p5.SoundRecorder`.

The recording workflow:

1. requests microphone permission;
2. obtains an audio-only `MediaStream`;
3. creates a Web Audio source node;
4. routes the microphone through the effects chain;
5. records the processed signal;
6. converts the completed recording to an audio blob;
7. stores the recording in IndexedDB;
8. adds the new item to the library;
9. exports the recording as a WAV file.

The source contains validation for cases such as:

- microphone permission denial;
- missing audio tracks;
- empty recordings;
- zero-frame recordings;
- recording timeouts.

## Library Management

The application supports:

- selecting library items;
- editing an item by loading it into the workstation;
- deleting saved items;
- restoring deleted preset slots;
- distinguishing preset, imported and recorded sounds;
- retaining saved filter settings per item.

## Interface

The HTML/CSS interface is organised into two main areas.

### Library Panel

Contains:

- preset sound buttons;
- scrollable saved-sound list;
- edit control;
- delete control;
- record-new control;
- device import control.

### Audio Workstation Panel

Contains:

- p5 canvas;
- transport controls;
- master volume;
- status messages;
- real-time visualisation;
- effects controls.

The layout is designed as a responsive two-column desktop interface that collapses for smaller displays.

## Repository Structure

```text
web-audio-processor-recording/
├── README.md
├── .gitignore
├── ORIGINAL_FILES_VERIFIED.txt
├── index.html
├── sketch.js
├── styles.css
├── assets/
│   ├── sound1.mp3
│   ├── sound2.mp3
│   ├── sound3.mp3
│   ├── sound4.mp3
│   └── sound5.mp3
└── libraries/
    ├── p5.js
    ├── p5.min.js
    └── p5.sound.min.js
```

## Technologies

- JavaScript
- HTML
- CSS
- p5.js
- p5.sound
- Web Audio API
- IndexedDB
- localStorage
- MediaDevices / `getUserMedia`
- FFT-based spectrum analysis
- browser audio recording

## Running the Project

Microphone capture and some browser audio APIs require a secure or local-server context, so running the project directly with `file://` is not recommended.

From the project directory:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

in a modern browser.

Allow microphone permission when using the recording feature.

## Original-File Preservation

All original HTML, JavaScript, CSS, library and MP3 files were copied byte-for-byte without modifying their contents.

Only repository-support files were added:

```text
README.md
.gitignore
ORIGINAL_FILES_VERIFIED.txt
```

Operating-system metadata such as `.DS_Store` is excluded.

## Author

**Zimmel Javed Virk**  
BSc Computer Science — University of London
