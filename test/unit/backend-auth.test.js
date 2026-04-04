import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearBackendAccessCache,
  downloadSyncPayloadFromBackend,
  getBackendFeatureAccessState,
  getBackendSessionState,
  pushSyncChangesToBackend,
} from '../../src/shared/backend-auth.js';

const TEST_CONFIG = {
  apiBase: 'https://api.test.example',
};

afterEach(() => {
  clearBackendAccessCache();
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

async function gzipText(text) {
  const sourceStream = new Response(text, {
    headers: {
      'Content-Type': 'application/json',
    },
  }).body;
  if (!sourceStream) {
    throw new Error('Compression source stream is unavailable.');
  }

  const compressedStream = sourceStream.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(compressedStream).arrayBuffer());
}

async function gunzipText(bytes) {
  const sourceStream = new Response(bytes, {
    headers: {
      'Content-Type': 'application/gzip',
    },
  }).body;
  if (!sourceStream) {
    throw new Error('Decompression source stream is unavailable.');
  }

  const decompressedStream = sourceStream.pipeThrough(new DecompressionStream('gzip'));
  return new Response(decompressedStream).text();
}

describe('backend auth transport helpers', () => {
  it('dedupes concurrent session probes', async () => {
    clearBackendAccessCache();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      message: {
        is_guest: false,
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    const [first, second] = await Promise.all([
      getBackendSessionState({
        fetchImpl,
        config: TEST_CONFIG,
      }),
      getBackendSessionState({
        fetchImpl,
        config: TEST_CONFIG,
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent feature access probes', async () => {
    clearBackendAccessCache();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      message: {
        has_active_subscription: true,
        csrf_token: 'csrf-token',
        features: {
          saved_drawings: {
            enabled: true,
          },
          cloud_sync: {
            enabled: true,
          },
        },
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    const [first, second] = await Promise.all([
      getBackendFeatureAccessState({
        fetchImpl,
        config: TEST_CONFIG,
      }),
      getBackendFeatureAccessState({
        fetchImpl,
        config: TEST_CONFIG,
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.cloudSyncCapability.enabled).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not repopulate stale session state after the cache is cleared mid-request', async () => {
    clearBackendAccessCache();
    const staleProbe = createDeferred();
    const freshProbe = createDeferred();
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => staleProbe.promise)
      .mockImplementationOnce(() => freshProbe.promise);

    const staleResultPromise = getBackendSessionState({
      fetchImpl,
      config: TEST_CONFIG,
    });

    clearBackendAccessCache();

    const freshResultPromise = getBackendSessionState({
      fetchImpl,
      config: TEST_CONFIG,
    });

    staleProbe.resolve(jsonResponse({
      message: {
        is_guest: true,
      },
    }, 401));
    freshProbe.resolve(jsonResponse({
      message: {
        is_guest: false,
      },
    }));

    const [staleResult, freshResult] = await Promise.all([
      staleResultPromise,
      freshResultPromise,
    ]);

    expect(staleResult.isGuest).toBe(true);
    expect(freshResult.authenticated).toBe(true);

    const cachedResult = await getBackendSessionState({
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(cachedResult.authenticated).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate stale feature access after the cache is cleared mid-request', async () => {
    clearBackendAccessCache();
    const staleProbe = createDeferred();
    const freshProbe = createDeferred();
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => staleProbe.promise)
      .mockImplementationOnce(() => freshProbe.promise);

    const staleResultPromise = getBackendFeatureAccessState({
      fetchImpl,
      config: TEST_CONFIG,
    });

    clearBackendAccessCache();

    const freshResultPromise = getBackendFeatureAccessState({
      fetchImpl,
      config: TEST_CONFIG,
    });

    staleProbe.resolve(jsonResponse({
      message: {
        has_active_subscription: false,
        features: {
          cloud_sync: {
            enabled: false,
          },
        },
      },
    }));
    freshProbe.resolve(jsonResponse({
      message: {
        has_active_subscription: true,
        csrf_token: 'fresh-csrf-token',
        features: {
          saved_drawings: {
            enabled: true,
          },
          cloud_sync: {
            enabled: true,
          },
        },
      },
    }));

    const [staleResult, freshResult] = await Promise.all([
      staleResultPromise,
      freshResultPromise,
    ]);

    expect(staleResult.cloudSyncCapability.enabled).toBe(false);
    expect(freshResult.cloudSyncCapability.enabled).toBe(true);

    const cachedResult = await getBackendFeatureAccessState({
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(cachedResult.cloudSyncCapability.enabled).toBe(true);
    expect(cachedResult.capability.enabled).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('pushes large sync batches as a gzipped multipart payload', async () => {
    const changes = [
      {
        entity_type: 'replay_session',
        client_record_id: 'replay-huge',
        device_id: 'device-a',
        updated_at_ms: 1712163600000,
        payload: {
          id: 'replay-huge',
          telemetryBlob: '0123456789abcdef'.repeat(12000),
        },
      },
    ];
    const fetchImpl = vi.fn(async (_url, options = {}) => {
      expect(options.method).toBe('POST');
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.headers['X-Frappe-CSRF-Token']).toBe('csrf-token');
      expect(options.body.get('changes_encoding')).toBe('gzip');

      const compressedChanges = options.body.get('changes_gzip');
      expect(compressedChanges).toBeInstanceOf(File);
      expect(compressedChanges.name).toBe('changes.json.gz');

      const uploadedJson = await gunzipText(
        new Uint8Array(await compressedChanges.arrayBuffer())
      );
      expect(JSON.parse(uploadedJson)).toEqual(changes);

      return new Response(JSON.stringify({
        message: {
          records: [],
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    const result = await pushSyncChangesToBackend({
      changes,
      csrfToken: 'csrf-token',
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('downloads gzipped sync payloads and inflates them client-side', async () => {
    const payload = {
      id: 'replay-1',
      samples: [
        { timestampMs: 1000, latitude: 1, longitude: 1, totalDistanceM: 0 },
        { timestampMs: 2000, latitude: 2, longitude: 2, totalDistanceM: 100 },
      ],
    };
    const compressedPayload = await gzipText(JSON.stringify(payload));
    const payloadBase64 = Buffer.from(compressedPayload).toString('base64');

    const fetchImpl = vi.fn(async (_url, options = {}) => {
      expect(options.method).toBe('POST');
      expect(String(options.body || '')).toContain('compressed=1');
      expect(String(options.body || '')).toContain('payload_encoding=gzip_base64');

      return new Response(JSON.stringify({
        message: {
          record: {
            name: 'sync-replay-1',
          },
          payload_encoding: 'gzip_base64',
          payload_gzip_base64: payloadBase64,
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    const result = await downloadSyncPayloadFromBackend({
      name: 'sync-replay-1',
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(result.ok).toBe(true);
    expect(result.record).toEqual({ name: 'sync-replay-1' });
    expect(result.payload).toEqual(payload);
  });
});
