import {
  createNominatimClient,
  normalizeNominatimBaseUrl,
} from "../shared/nominatim.js";

const API_KEYS = ["search", "reverse", "lookup", "status", "details"];

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function formatCoordinateInput(value) {
  return isFiniteNumber(value) ? value.toFixed(6) : "";
}

function formatResponseText(payload, fallbackText = "") {
  if (payload === null || payload === undefined) {
    return fallbackText;
  }

  if (typeof payload === "string") {
    return payload || fallbackText;
  }

  return JSON.stringify(payload, null, 2);
}

function getApiLabelKey(apiKey) {
  switch (apiKey) {
    case "search":
      return "gpsRateNominatimSearch";
    case "reverse":
      return "gpsRateNominatimReverse";
    case "lookup":
      return "gpsRateNominatimLookup";
    case "status":
      return "gpsRateNominatimStatusApi";
    case "details":
      return "gpsRateNominatimDetails";
    default:
      return "gpsRateNominatimSearch";
  }
}

export function createGpsRateNominatimLab({
  elements,
  state,
  storageKeys,
  saveText,
  t,
}) {
  let clientCacheKey = "";
  let client = null;

  function getLatestGeoSample() {
    for (let index = state.samples.length - 1; index >= 0; index -= 1) {
      const sample = state.samples[index];
      if (isFiniteNumber(sample.latitude) && isFiniteNumber(sample.longitude)) {
        return sample;
      }
    }
    return null;
  }

  function getClient() {
    const baseUrl = normalizeNominatimBaseUrl(state.nominatim.baseUrl);
    if (!client || clientCacheKey !== baseUrl) {
      client = createNominatimClient({ baseUrl });
      clientCacheKey = baseUrl;
    }
    return client;
  }

  function setRequestState({ key, params = null, rawText = null } = {}) {
    state.nominatim.requestState = {
      key,
      params,
      rawText,
    };
  }

  function persistBaseUrl() {
    saveText(storageKeys.nominatimBaseUrl, state.nominatim.baseUrl);
  }

  function persistActiveApi() {
    saveText(storageKeys.nominatimActiveApi, state.nominatim.activeApi);
  }

  function setActiveApi(apiKey) {
    if (!API_KEYS.includes(apiKey)) return;

    const nominatimClient = getClient();
    if (apiKey === "details" && nominatimClient.isPublicServer) {
      return;
    }

    state.nominatim.activeApi = apiKey;
    persistActiveApi();
    render();
  }

  function syncBaseUrl(value) {
    state.nominatim.baseUrl = normalizeNominatimBaseUrl(value);
    persistBaseUrl();
    client = null;
    clientCacheKey = "";

    const nominatimClient = getClient();
    if (nominatimClient.isPublicServer && state.nominatim.activeApi === "details") {
      state.nominatim.activeApi = "search";
      persistActiveApi();
    }

    render();
  }

  function renderEndpointButtons(nominatimClient) {
    Object.entries(elements.nominatimApiButtons).forEach(([apiKey, button]) => {
      if (!button) return;
      const isActive = state.nominatim.activeApi === apiKey;
      const isDisabled = state.nominatim.isLoading || (apiKey === "details" && nominatimClient.isPublicServer);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      button.disabled = isDisabled;
      button.title = apiKey === "details" && nominatimClient.isPublicServer
        ? t("gpsRateNominatimDetailsPublicNotice")
        : t(getApiLabelKey(apiKey));
    });
  }

  function renderPanels(nominatimClient) {
    Object.entries(elements.nominatimPanels).forEach(([apiKey, panel]) => {
      if (!panel) return;
      panel.hidden = apiKey !== state.nominatim.activeApi;
    });

    if (elements.nominatimDetailsPolicyNote) {
      elements.nominatimDetailsPolicyNote.hidden = !(
        nominatimClient.isPublicServer
        && state.nominatim.activeApi === "details"
      );
    }
  }

  function renderRequestSummary() {
    const requestState = state.nominatim.requestState || {};
    elements.nominatimRequestStateValue.textContent = requestState.rawText
      || t(requestState.key || "gpsRateNominatimIdle", requestState.params || {});
    elements.nominatimRequestEndpointValue.textContent = state.nominatim.lastEndpointKey
      ? t(getApiLabelKey(state.nominatim.lastEndpointKey))
      : "—";
    elements.nominatimRequestSourceValue.textContent = state.nominatim.requestSourceKey
      ? t(state.nominatim.requestSourceKey)
      : "—";
    elements.nominatimRequestUrlValue.textContent = state.nominatim.requestUrl || "—";
    elements.nominatimResponseOutput.textContent = state.nominatim.responseText || t("gpsRateNominatimResponseEmpty");
  }

  function renderInputs() {
    if (elements.nominatimBaseUrl.value !== state.nominatim.baseUrl) {
      elements.nominatimBaseUrl.value = state.nominatim.baseUrl;
    }
    if (elements.nominatimSearchQuery.value !== state.nominatim.searchQuery) {
      elements.nominatimSearchQuery.value = state.nominatim.searchQuery;
    }
    if (elements.nominatimReverseLat.value !== state.nominatim.reverseLat) {
      elements.nominatimReverseLat.value = state.nominatim.reverseLat;
    }
    if (elements.nominatimReverseLon.value !== state.nominatim.reverseLon) {
      elements.nominatimReverseLon.value = state.nominatim.reverseLon;
    }
    if (elements.nominatimLookupIds.value !== state.nominatim.lookupIds) {
      elements.nominatimLookupIds.value = state.nominatim.lookupIds;
    }
    if (elements.nominatimDetailsPlaceId.value !== state.nominatim.detailsPlaceId) {
      elements.nominatimDetailsPlaceId.value = state.nominatim.detailsPlaceId;
    }

    const latestGeoSample = getLatestGeoSample();
    if (elements.nominatimReverseUseLatest) {
      elements.nominatimReverseUseLatest.disabled = state.nominatim.isLoading || !latestGeoSample;
    }

    [
      elements.nominatimSearchRun,
      elements.nominatimReverseRun,
      elements.nominatimLookupRun,
      elements.nominatimStatusRun,
      elements.nominatimDetailsRun,
    ].forEach((button) => {
      if (!button) return;
      button.disabled = state.nominatim.isLoading || button.dataset.api === "details" && getClient().isPublicServer;
    });
  }

  function render() {
    const nominatimClient = getClient();
    renderEndpointButtons(nominatimClient);
    renderPanels(nominatimClient);
    renderInputs();
    renderRequestSummary();
  }

  function useLatestSampleForReverse() {
    const latestGeoSample = getLatestGeoSample();
    if (!latestGeoSample) return;

    state.nominatim.reverseLat = formatCoordinateInput(latestGeoSample.latitude);
    state.nominatim.reverseLon = formatCoordinateInput(latestGeoSample.longitude);
    render();
  }

  async function runRequest(apiKey) {
    if (state.nominatim.isLoading) return;

    syncBaseUrl(elements.nominatimBaseUrl.value);
    if (apiKey === "details" && getClient().isPublicServer) {
      setRequestState({ key: "gpsRateNominatimDetailsPublicNotice" });
      render();
      return;
    }
    setActiveApi(apiKey);
    const nominatimClient = getClient();
    const activeApi = state.nominatim.activeApi;
    let requestPromise = null;

    if (activeApi === "search") {
      const query = state.nominatim.searchQuery.trim();
      if (!query) {
        setRequestState({ key: "gpsRateNominatimNeedQuery" });
        render();
        return;
      }
      requestPromise = nominatimClient.search({ q: query });
    } else if (activeApi === "reverse") {
      const latitude = Number(state.nominatim.reverseLat);
      const longitude = Number(state.nominatim.reverseLon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        setRequestState({ key: "gpsRateNominatimNeedReverseCoords" });
        render();
        return;
      }
      requestPromise = nominatimClient.reverse({ lat: latitude, lon: longitude });
    } else if (activeApi === "lookup") {
      const osmIds = state.nominatim.lookupIds.trim();
      if (!osmIds) {
        setRequestState({ key: "gpsRateNominatimNeedLookupIds" });
        render();
        return;
      }
      requestPromise = nominatimClient.lookup({ osm_ids: osmIds });
    } else if (activeApi === "status") {
      requestPromise = nominatimClient.status();
    } else if (activeApi === "details") {
      const placeId = state.nominatim.detailsPlaceId.trim();
      if (!placeId) {
        setRequestState({ key: "gpsRateNominatimNeedDetailsPlaceId" });
        render();
        return;
      }
      requestPromise = nominatimClient.details({ place_id: placeId });
    }

    if (!requestPromise) return;

    state.nominatim.isLoading = true;
    setRequestState({ key: "gpsRateNominatimLoading" });
    render();

    try {
      const result = await requestPromise;
      state.nominatim.lastEndpointKey = activeApi;
      state.nominatim.requestUrl = result.meta.url;
      state.nominatim.requestSourceKey = result.meta.fromCache
        ? "gpsRateNominatimSourceCache"
        : "gpsRateNominatimSourceLive";
      state.nominatim.responseText = formatResponseText(result.data, t("gpsRateNominatimResponseEmpty"));
      setRequestState({
        key: "gpsRateNominatimSuccess",
        params: { status: result.meta.status },
      });
    } catch (error) {
      state.nominatim.lastEndpointKey = activeApi;
      state.nominatim.requestUrl = error && error.url ? error.url : state.nominatim.requestUrl;
      state.nominatim.requestSourceKey = "gpsRateNominatimSourceLive";
      state.nominatim.responseText = formatResponseText(
        error && error.payload,
        error && error.message ? error.message : t("gpsRateNominatimError"),
      );
      setRequestState({
        rawText: error && error.message ? error.message : t("gpsRateNominatimError"),
      });
    } finally {
      state.nominatim.isLoading = false;
      render();
    }
  }

  function bindEvents() {
    Object.entries(elements.nominatimApiButtons).forEach(([apiKey, button]) => {
      if (!button) return;
      button.addEventListener("click", () => setActiveApi(apiKey));
    });

    elements.nominatimBaseUrl?.addEventListener("change", () => {
      syncBaseUrl(elements.nominatimBaseUrl.value);
    });
    elements.nominatimBaseUrl?.addEventListener("blur", () => {
      syncBaseUrl(elements.nominatimBaseUrl.value);
    });

    elements.nominatimSearchQuery?.addEventListener("input", () => {
      state.nominatim.searchQuery = elements.nominatimSearchQuery.value;
    });
    elements.nominatimReverseLat?.addEventListener("input", () => {
      state.nominatim.reverseLat = elements.nominatimReverseLat.value;
    });
    elements.nominatimReverseLon?.addEventListener("input", () => {
      state.nominatim.reverseLon = elements.nominatimReverseLon.value;
    });
    elements.nominatimLookupIds?.addEventListener("input", () => {
      state.nominatim.lookupIds = elements.nominatimLookupIds.value;
    });
    elements.nominatimDetailsPlaceId?.addEventListener("input", () => {
      state.nominatim.detailsPlaceId = elements.nominatimDetailsPlaceId.value;
    });

    elements.nominatimSearchRun?.addEventListener("click", () => runRequest("search"));
    elements.nominatimReverseRun?.addEventListener("click", () => runRequest("reverse"));
    elements.nominatimLookupRun?.addEventListener("click", () => runRequest("lookup"));
    elements.nominatimStatusRun?.addEventListener("click", () => runRequest("status"));
    elements.nominatimDetailsRun?.addEventListener("click", () => runRequest("details"));
    elements.nominatimReverseUseLatest?.addEventListener("click", useLatestSampleForReverse);
  }

  return {
    init() {
      syncBaseUrl(state.nominatim.baseUrl);
      bindEvents();
    },
    render,
  };
}
