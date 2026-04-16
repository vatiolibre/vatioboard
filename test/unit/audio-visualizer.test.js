import { describe, expect, it } from "vitest";

const { isVisualizerSafeSource, requiresCrossOriginForAnalysis } = await import("../../src/shared/audio-visualizer.js");

describe("isVisualizerSafeSource", () => {
  it("returns false for empty/falsy sources", () => {
    expect(isVisualizerSafeSource("")).toBe(false);
    expect(isVisualizerSafeSource(null)).toBe(false);
    expect(isVisualizerSafeSource(undefined)).toBe(false);
  });

  it("returns true for blob: URLs", () => {
    expect(isVisualizerSafeSource("blob:https://vatioboard.com/12345")).toBe(true);
    expect(isVisualizerSafeSource("blob:null/abcdef")).toBe(true);
  });

  it("returns true for data: URLs", () => {
    expect(isVisualizerSafeSource("data:audio/wav;base64,AAAA")).toBe(true);
  });

  it("returns true for same-origin URLs", () => {
    expect(isVisualizerSafeSource(`${window.location.origin}/audio/file.mp3`)).toBe(true);
    expect(isVisualizerSafeSource("/audio/file.mp3")).toBe(true);
  });

  it("returns true for presigned S3 URLs", () => {
    expect(isVisualizerSafeSource("https://my-bucket.s3.us-east-1.amazonaws.com/audio/file.mp3?X-Amz-Signature=abc")).toBe(true);
    expect(isVisualizerSafeSource("https://my-bucket.s3.amazonaws.com/audio/file.mp3?X-Amz-Signature=abc")).toBe(true);
    expect(isVisualizerSafeSource("https://bucket.s3-us-west-2.amazonaws.com/file.mp3")).toBe(true);
  });

  it("returns false for cross-origin BFF URLs", () => {
    expect(isVisualizerSafeSource("https://api.dev.vatioboard.com/api/method/download?name=AUDIO-1")).toBe(false);
    expect(isVisualizerSafeSource("https://dev.vatiolibre.com/api/method/download?name=AUDIO-1")).toBe(false);
  });

  it("returns false for arbitrary cross-origin URLs", () => {
    expect(isVisualizerSafeSource("https://cdn.example.com/audio.mp3")).toBe(false);
    expect(isVisualizerSafeSource("https://other-domain.com/stream")).toBe(false);
  });
});

describe("requiresCrossOriginForAnalysis", () => {
  it("returns false for empty/falsy sources", () => {
    expect(requiresCrossOriginForAnalysis("")).toBe(false);
    expect(requiresCrossOriginForAnalysis(null)).toBe(false);
    expect(requiresCrossOriginForAnalysis(undefined)).toBe(false);
  });

  it("returns false for blob: URLs", () => {
    expect(requiresCrossOriginForAnalysis("blob:https://vatioboard.com/12345")).toBe(false);
  });

  it("returns false for data: URLs", () => {
    expect(requiresCrossOriginForAnalysis("data:audio/wav;base64,AAAA")).toBe(false);
  });

  it("returns false for same-origin URLs", () => {
    expect(requiresCrossOriginForAnalysis(`${window.location.origin}/audio/file.mp3`)).toBe(false);
    expect(requiresCrossOriginForAnalysis("/audio/file.mp3")).toBe(false);
  });

  it("returns true for presigned S3 URLs", () => {
    expect(requiresCrossOriginForAnalysis("https://my-bucket.s3.us-east-1.amazonaws.com/audio/file.mp3?X-Amz-Signature=abc")).toBe(true);
    expect(requiresCrossOriginForAnalysis("https://my-bucket.s3.amazonaws.com/audio/file.mp3")).toBe(true);
  });

  it("returns false for non-storage cross-origin URLs", () => {
    expect(requiresCrossOriginForAnalysis("https://api.dev.vatioboard.com/api/method/download?name=AUDIO-1")).toBe(false);
    expect(requiresCrossOriginForAnalysis("https://cdn.example.com/audio.mp3")).toBe(false);
  });
});
