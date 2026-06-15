# Keyword Spotting (KWS)

On-device wake-word / keyword detection. Feed audio incrementally (e.g. from a
microphone) and get a low-latency detection when a configured keyword is spoken.
Unlike streaming STT, KWS does **not** transcribe — it only fires on the
keywords listed in your `keywords.txt`.

**Import path:** `react-native-sherpa-onnx/kws`

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [createKeywordSpotter()](#createkeywordspotteroptions)
  - [KeywordSpotterEngine](#keywordspotterengine)
  - [KwsStream](#kwsstream)
  - [KwsResult](#kwsresult)
- [keywords.txt Format](#keywordstxt-format)
- [Tuning (Speed & Accuracy)](#tuning-speed--accuracy)
- [See Also](#see-also)

---

## Overview

| Feature | Status | Notes |
| --- | --- | --- |
| Spotter creation | ✅ | `createKeywordSpotter()` --> `KeywordSpotterEngine` |
| Stream creation per session | ✅ | `engine.createStream(keywords?)` |
| Accept waveform | ✅ | `stream.acceptWaveform(samples, sampleRate)` |
| Incremental decode | ✅ | `stream.decode()` + `stream.getResult()` |
| Convenience one-call | ✅ | `stream.processAudioChunk()` — accept + decode + result + auto-reset |
| Per-keyword score/threshold | ✅ | Via `keywords.txt` (`:score` / `#threshold` / `@label`) |
| Multiple streams per engine | ✅ | Independent state per stream |

KWS has **no endpoint concept**. The poll loop is: `accept → while (isReady)
decode → getResult → if keyword non-empty, emit + reset(stream)`. The
convenience `processAudioChunk()` does all of this (including the reset) in a
single bridge crossing.

**Supported model type:** `transducer` (KWS zipformer models).

---

## Quick Start

```typescript
import { createKeywordSpotter } from 'react-native-sherpa-onnx/kws';

// 1) Create the spotter (keywords.txt is read from the model dir by default)
const engine = await createKeywordSpotter({
  modelPath: { type: 'asset', path: 'models/kws-zipformer-zh-en' },
  modelType: 'transducer',
  numThreads: 2,
  numTrailingBlanks: 1, // SPEED: fire sooner
  keywordsScore: 1.5, // ACCURACY: recall boost
  keywordsThreshold: 0.25, // ACCURACY: lower = more recall
  maxActivePaths: 4,
});

// 2) Create a stream
const stream = await engine.createStream();

// 3) Feed audio chunks (float PCM in [-1, 1], 16 kHz recommended)
const { keyword } = await stream.processAudioChunk(samples, 16000);
if (keyword) {
  console.log('Spotted:', keyword);
}

// 4) Clean up
await stream.release();
await engine.destroy();
```

---

## API Reference

### createKeywordSpotter(options)

```typescript
function createKeywordSpotter(
  options: KwsInitOptions
): Promise<KeywordSpotterEngine>;

interface KwsInitOptions {
  modelPath: ModelPathConfig; // { type: 'asset', path: 'models/kws-zipformer-zh-en' }
  modelType?: 'transducer'; // default 'transducer'
  keywordsPath?: ModelPathConfig; // defaults to <modelDir>/keywords.txt
  keywordsScore?: number; // default 1.5 (Kotlin), 1.0 (CXX)
  keywordsThreshold?: number; // default 0.25
  numTrailingBlanks?: number; // default 2 (Kotlin), 1 (CXX)
  maxActivePaths?: number; // default 4
  numThreads?: number; // default 1 — set ≥ 2 for real-time decode
  provider?: string; // 'cpu' | 'coreml' | 'nnapi' | 'xnnpack'
  debug?: boolean;
}
```

When `keywordsPath` is omitted, native scans the model directory for
`keywords.txt`.

### KeywordSpotterEngine

```typescript
interface KeywordSpotterEngine {
  readonly instanceId: string;
  createStream(keywords?: string): Promise<KwsStream>; // optional inline keywords
  destroy(): Promise<void>;
}
```

### KwsStream

```typescript
interface KwsStream {
  readonly streamId: string;
  acceptWaveform(samples: number[], sampleRate: number): Promise<void>;
  decode(): Promise<void>;
  isReady(): Promise<boolean>;
  getResult(): Promise<KwsResult>;
  reset(): Promise<void>;
  release(): Promise<void>;
  // accept + decode loop + getResult + auto-reset on hit, in one bridge call
  processAudioChunk(
    samples: number[] | Float32Array,
    sampleRate: number
  ): Promise<KwsResult>;
}
```

### KwsResult

```typescript
interface KwsResult {
  keyword: string; // '' when nothing detected
  tokens: string[];
  timestamps: number[];
}
```

---

## keywords.txt Format

Each line is a tokenized keyword followed by optional per-keyword overrides.
Generate it with `sherpa-onnx-cli text2token` against the model's tokenizer.

```text
HH EY1 N AE1 P AH0 @HeyNapa
HH AY1 N AE1 P AH0 @HeyNapa
AH0 N AE1 P AH0 :2.0 #0.30 @HeyNapa
```

- `:score` — per-keyword boosting score (overrides global `keywordsScore`).
- `#threshold` — per-keyword detection threshold (overrides global
  `keywordsThreshold`).
- `@label` — the string returned in `KwsResult.keyword`; point several
  pronunciation variants at one canonical label.

Iterating `keywords.txt` needs no native rebuild — re-bundle the asset and
restart the session.

---

## Tuning (Speed & Accuracy)

**Speed (lowest detection latency)**

- `numTrailingBlanks` low (start `1`) — the most direct fire-delay knob.
- Downsample audio to 16 kHz in JS before feeding the bridge.
- Keep PCM chunks small (do not batch).
- Push a short warm-up chunk before live audio to move ONNX graph-init off the
  first real detection.
- `numThreads` ≥ 2, int8 model, optional hardware `provider`.

**Accuracy (variants determined clearly)**

- `keywords.txt` is the primary lever — list pronunciation variants with
  per-keyword `:score` / `#threshold`.
- `keywordsThreshold` lower = more recall (more false-accepts).
- `keywordsScore` higher = stronger bias toward firing.
- `maxActivePaths` higher (4 → 8) = wider beam, better recall at compute cost.

---

## See Also

- [Streaming Speech-to-Text](stt-streaming.md) — full transcription
- [PCM Live Stream](pcm-live-stream.md) — native mic capture with resampling
- [sherpa-onnx KWS docs](https://k2-fsa.github.io/sherpa/onnx/kws/index.html)
- [Pretrained KWS models](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html)
