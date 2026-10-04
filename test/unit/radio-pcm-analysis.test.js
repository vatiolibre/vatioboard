import { describe, expect, it, vi } from "vitest";
import { parseAacFramesForTesting, parseMp3FramesForTesting, requiresRadioPcmAnalysis } from "../../src/shared/radio-pcm-analysis.js";

function mp3Frame(fill = 0x55) {
  // MPEG-1 Layer III, 128kbps, 44.1kHz, stereo: 417 bytes.
  const frame = new Uint8Array(417).fill(fill);
  frame.set([0xff, 0xfb, 0x90, 0x64], 0);
  return frame;
}

function aacFrame(fill = 0x55) {
  // MPEG-4 AAC-LC, 22050Hz, stereo, 382-byte ADTS frame.
  const frame = new Uint8Array(382).fill(fill);
  frame.set([0xff, 0xf1, 0x5e, 0x80, 0x2f, 0xdf, 0xfc], 0);
  return frame;
}

describe("radio PCM analysis parser", () => {
  it("selects PCM analysis for iPhone Safari without selecting Chromium", () => {
    const userAgent = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
    );
    const vendor = vi.spyOn(navigator, "vendor", "get").mockReturnValue("Apple Computer, Inc.");
    expect(requiresRadioPcmAnalysis()).toBe(true);
    userAgent.mockReturnValue("Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36");
    expect(requiresRadioPcmAnalysis()).toBe(false);
    userAgent.mockRestore();
    vendor.mockRestore();
  });

  it("keeps incomplete network frames until the next chunk", () => {
    const first = mp3Frame(0x11);
    const second = mp3Frame(0x22);
    const split = first.length - 13;
    const chunkA = new Uint8Array(first.slice(0, split));
    const parsedA = parseMp3FramesForTesting(chunkA);
    expect(parsedA.frames).toHaveLength(0);

    const chunkB = new Uint8Array(parsedA.remainder.length + 13 + second.length);
    chunkB.set(parsedA.remainder);
    chunkB.set(first.slice(split), parsedA.remainder.length);
    chunkB.set(second, parsedA.remainder.length + 13);
    const parsedB = parseMp3FramesForTesting(chunkB);
    expect(parsedB.frames).toHaveLength(2);
    expect(parsedB.sampleRate).toBe(44100);
    expect(parsedB.channels).toBe(2);
  });

  it("skips an ID3 header before parsing MPEG frames", () => {
    const id3 = new Uint8Array(10);
    id3.set([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0]);
    const result = parseMp3FramesForTesting(new Uint8Array([...id3, ...mp3Frame()]));
    expect(result.frames).toHaveLength(1);
  });

  it("parses AAC ADTS frames and preserves incomplete frames", () => {
    const first = aacFrame(0x11);
    const second = aacFrame(0x22);
    const split = first.length - 13;
    const parsedA = parseAacFramesForTesting(first.slice(0, split));
    expect(parsedA.frames).toHaveLength(0);
    const chunkB = new Uint8Array(parsedA.remainder.length + 13 + second.length);
    chunkB.set(parsedA.remainder);
    chunkB.set(first.slice(split), parsedA.remainder.length);
    chunkB.set(second, parsedA.remainder.length + 13);
    const parsedB = parseAacFramesForTesting(chunkB);
    expect(parsedB.frames).toHaveLength(2);
    expect(parsedB.codec).toBe("mp4a.40.2");
    expect(parsedB.sampleRate).toBe(22050);
    expect(parsedB.channels).toBe(2);
  });
});
