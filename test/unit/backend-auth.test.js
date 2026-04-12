import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearBackendAccessCache,
  downloadSyncPayloadFromBackend,
  getBackendAccelRunDetail,
  getBackendFeatureAccessState,
  getBackendMediaAssetAccess,
  getBackendMediaAssetDetail,
  getBackendSessionState,
  listBackendMediaAssets,
  normalizeBackendOwnedUrl,
  pushSyncChangesToBackend,
} from '../../src/shared/backend-auth.js';

const TEST_CONFIG = {
  apiBase: 'https://api.test.example',
};

// ── URL origins used in normalization tests ──────────────────────────
// Raw backend origins: intentional inputs representing URLs returned by
// the Frappe backend before BFF rewriting.  Do not remove — these prove
// that normalizeBackendOwnedUrl rewrites legacy origins correctly.
const LEGACY_DEV_BACKEND_ORIGIN = 'https://dev.vatiolibre.com';
const LEGACY_PROD_BACKEND_ORIGIN = 'https://www.vatiolibre.com';
// Expected BFF-rewritten origins.
const DEV_BFF_ORIGIN = 'https://api.dev.vatioboard.com';
const PROD_BFF_ORIGIN = 'https://api.vatioboard.com';

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
  it('rewrites backend-owned media URLs to the configured BFF origin', () => {
    // Raw dev backend origin → dev BFF
    expect(normalizeBackendOwnedUrl(
      `${LEGACY_DEV_BACKEND_ORIGIN}/api/method/vatiolibre.vatiolibre.drawings.get_my_saved_drawing_detail?name=DRAW-1`,
      {
        config: {
          apiBase: DEV_BFF_ORIGIN,
        },
      }
    )).toBe(
      `${DEV_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.drawings.get_my_saved_drawing_detail?name=DRAW-1`
    );

    // Raw prod backend origin → prod BFF
    expect(normalizeBackendOwnedUrl(
      `${LEGACY_PROD_BACKEND_ORIGIN}/api/method/vatiolibre.vatiolibre.drawings.download_my_saved_drawing?name=DRAW-2&as_attachment=1`,
      {
        config: {
          apiBase: PROD_BFF_ORIGIN,
        },
      }
    )).toBe(
      `${PROD_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.drawings.download_my_saved_drawing?name=DRAW-2&as_attachment=1`
    );

    // Relative path → prepended with BFF origin
    expect(normalizeBackendOwnedUrl('/api/method/vatiolibre.vatiolibre.drawings.get_my_saved_drawing_detail?name=DRAW-3', {
      config: {
        apiBase: DEV_BFF_ORIGIN,
      },
    })).toBe(
      `${DEV_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.drawings.get_my_saved_drawing_detail?name=DRAW-3`
    );

    expect(normalizeBackendOwnedUrl('/files/skidpad.png?token=view#preview', {
      config: {
        apiBase: PROD_BFF_ORIGIN,
      },
    })).toBe(`${PROD_BFF_ORIGIN}/files/skidpad.png?token=view#preview`);

    expect(normalizeBackendOwnedUrl('/private/files/skidpad.png?download=1', {
      config: {
        apiBase: DEV_BFF_ORIGIN,
      },
    })).toBe(`${DEV_BFF_ORIGIN}/private/files/skidpad.png?download=1`);

    // Third-party CDN URL passes through unchanged
    expect(normalizeBackendOwnedUrl('https://cdn.example.com/skidpad.png?token=view', {
      config: {
        apiBase: PROD_BFF_ORIGIN,
      },
    })).toBe('https://cdn.example.com/skidpad.png?token=view');
  });

  it('normalizes media asset URLs returned by shared list/detail helpers', async () => {
    // Mock responses simulate raw backend-origin URLs the Frappe API returns.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        message: {
          assets: [
            {
              name: 'MEDIA-1',
              title: 'Skidpad',
              media_kind: 'audio',
              preview_image_url: `${LEGACY_PROD_BACKEND_ORIGIN}/files/skidpad.png?token=view#preview`,
              download_url: `${LEGACY_PROD_BACKEND_ORIGIN}/private/files/skidpad.png?download=1`,
              export_url: '/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1&as_attachment=1',
              playback_url: `${LEGACY_PROD_BACKEND_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`,
            },
          ],
          total_count: 1,
          has_more: false,
          next_offset: 1,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        message: {
          asset: {
            name: 'MEDIA-1',
            title: 'Skidpad',
            media_kind: 'video',
            preview_image_url: `${LEGACY_DEV_BACKEND_ORIGIN}/files/skidpad.png?token=view#preview`,
            download_url: '/private/files/skidpad.png?download=1',
            export_url: 'https://127.0.0.1/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1',
            playback_url: `${LEGACY_DEV_BACKEND_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`,
          },
        },
      }));

    const listResult = await listBackendMediaAssets({
      fetchImpl,
      config: {
        apiBase: PROD_BFF_ORIGIN,
      },
    });

    const detailResult = await getBackendMediaAssetDetail({
      name: 'MEDIA-1',
      fetchImpl,
      config: {
        apiBase: DEV_BFF_ORIGIN,
      },
    });

    expect(listResult.assets).toEqual([
      expect.objectContaining({
        preview_image_url: `${PROD_BFF_ORIGIN}/files/skidpad.png?token=view#preview`,
        download_url: `${PROD_BFF_ORIGIN}/private/files/skidpad.png?download=1`,
        export_url: `${PROD_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1&as_attachment=1`,
        playback_url: `${PROD_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`,
      }),
    ]);
    expect(detailResult.asset).toEqual(expect.objectContaining({
      preview_image_url: `${DEV_BFF_ORIGIN}/files/skidpad.png?token=view#preview`,
      download_url: `${DEV_BFF_ORIGIN}/private/files/skidpad.png?download=1`,
      export_url: `${DEV_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`,
      playback_url: `${DEV_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`,
    }));
  });

  it('rewrites playback_url from legacy backend origin to the configured BFF origin', () => {
    expect(normalizeBackendOwnedUrl(
      `${LEGACY_DEV_BACKEND_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`,
      { config: { apiBase: DEV_BFF_ORIGIN } },
    )).toBe(`${DEV_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`);
  });

  it('rewrites relative playback_url to the configured BFF origin', () => {
    expect(normalizeBackendOwnedUrl(
      '/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1',
      { config: { apiBase: PROD_BFF_ORIGIN } },
    )).toBe(`${PROD_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`);
  });

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
          media_assets: {
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
          media_assets: {
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

  it('requests accel detail from the accel detail backend method', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toBe(
        '/api/method/vatiolibre.vatiolibre.cloud_sync.get_my_accel_recording_detail'
      );
      expect(requestUrl.searchParams.get('name')).toBe('SYNC-ACCEL-1');
      expect(requestUrl.searchParams.get('include_payload')).toBe('1');

      return jsonResponse({
        message: {
          record: {
            name: 'SYNC-ACCEL-1',
            title: 'Quarter mile',
          },
          payload: {
            id: 'run-1',
          },
        },
      });
    });

    const result = await getBackendAccelRunDetail({
      name: 'SYNC-ACCEL-1',
      includePayload: true,
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      record: {
        name: 'SYNC-ACCEL-1',
        title: 'Quarter mile',
      },
      payload: {
        id: 'run-1',
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

  it('fetches media asset access without normalizing S3 URLs', async () => {
    const s3DownloadUrl = 'https://my-bucket.s3.amazonaws.com/key?X-Amz-Signature=abc';
    const s3PlaybackUrl = 'https://my-bucket.s3.amazonaws.com/key?X-Amz-Signature=def';

    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        message: {
          asset: { name: 'media-1', content_hash: 'aabbcc', media_kind: 'audio' },
          access: {
            download_url: s3DownloadUrl,
            playback_url: s3PlaybackUrl,
            expires_in_seconds: 300,
          },
        },
      })
    );

    const result = await getBackendMediaAssetAccess({
      name: 'media-1',
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(result.ok).toBe(true);
    expect(result.asset).toEqual({ name: 'media-1', content_hash: 'aabbcc', media_kind: 'audio' });
    // S3 URLs must NOT be rewritten through BFF normalization
    expect(result.access.download_url).toBe(s3DownloadUrl);
    expect(result.access.playback_url).toBe(s3PlaybackUrl);
    expect(result.access.expires_in_seconds).toBe(300);
  });
});
