/** Raw little-endian PCM used by Gemini Live; input is 16 kHz, output is 24 kHz. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  if (bytes.byteLength % 2) throw new Error("Invalid PCM16 byte length.");
  const result = new Float32Array(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < result.length; i++) result[i] = view.getInt16(i * 2, true) / 32768;
  return result;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

// Worklet processing stays off the UI thread. Weighted averaging preserves sample
// timing across render blocks, including devices that use 44.1 kHz rather than 48 kHz.
export const PCM_WORKLET_SOURCE = `
class MayPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.reset();
    this.port.onmessage = (event) => { if (event.data?.reset) this.reset(); };
  }
  reset() {
    this.ratio = sampleRate / 16000;
    this.sum = 0;
    this.weight = 0;
    this.cursor = 0;
    this.bytes = new Uint8Array(2048);
    this.view = new DataView(this.bytes.buffer);
  }
  emit(value) {
    value = Math.max(-1, Math.min(1, value));
    this.view.setInt16(this.cursor * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    this.cursor++;
    if (this.cursor === 1024) {
      const buffer = this.bytes.buffer;
      this.port.postMessage(buffer, [buffer]);
      this.bytes = new Uint8Array(2048);
      this.view = new DataView(this.bytes.buffer);
      this.cursor = 0;
    }
  }
  process(inputs, outputs) {
    for (const channels of outputs) for (const channel of channels) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length) return true;
    const count = channels[0].length;
    for (let i = 0; i < count; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      value /= channels.length;
      let remaining = 1;
      while (remaining > 1e-8) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * take;
        this.weight += take;
        remaining -= take;
        if (this.weight >= this.ratio - 1e-8) {
          this.emit(this.sum / this.ratio);
          this.sum = 0;
          this.weight = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("may-pcm-capture", MayPcmCapture);
`;
