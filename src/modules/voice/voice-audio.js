export const TARGET_SAMPLE_RATE = 16000;
export const MIN_RECORDING_MS = 180;

export function releaseVoiceResources(capture) {
  try {
    capture.source?.disconnect();
  } catch {}

  try {
    capture.processor?.disconnect();
  } catch {}

  try {
    capture.sink?.disconnect();
  } catch {}

  try {
    capture.stream?.getTracks?.().forEach((track) => track.stop());
  } catch {}

  const closeResult = capture.audioContext?.close?.();
  if (closeResult && typeof closeResult.then === "function") {
    return closeResult.catch(() => {});
  }

  return Promise.resolve();
}

export function mergeFloat32Chunks(chunks, totalLength) {
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

export function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.max(1, Math.round(buffer.length / sampleRateRatio));
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.min(
      buffer.length,
      Math.round((offsetResult + 1) * sampleRateRatio)
    );
    let accumulated = 0;
    let count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer; i += 1) {
      accumulated += buffer[i];
      count += 1;
    }

    result[offsetResult] = count > 0 ? accumulated / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

export function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  function writeString(offset, value) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
    offset += bytesPerSample;
  }

  return new Uint8Array(buffer);
}
