import "../styles/board.less";
import "../styles/backend-auth.less";
import "../styles/calculator.less";
import "../styles/energy.less";
import "../styles/dock.less";
import "../shared/ui/confirm-dialog.less";

import { createCalculatorWidget } from "../calculator/calculator-widget.js";
import { integratePlayerWidget } from "../player/integrate-player-widget.js";
import { navigateToAppRoute } from "../app/router.js";
import {
  clearCurrentBoardDocumentMeta,
  loadBoardDrawing,
  loadCurrentBoardDocumentMeta,
  saveBoardDrawing,
  saveCurrentBoardDocumentMeta,
} from "./storage.js";
import {
  consumeBoardDocumentOpen,
  persistBoardDocumentSelection,
} from "../shared/repositories/board-document-repository.js";
import { createEnergyCalculatorWidget } from "../energy/energy-calculator-widget.js";
import { createFloatingDock } from "../dock/floating-dock.js";
import {
  BACKEND_AUTH_STATE_EVENT,
  deleteBoardDocumentFromBackend,
  getBackendFeatureAccessState,
  getBackendSessionState,
  initBackendAuthControllers,
  saveBoardDocumentToBackend,
  updateBoardDocumentInBackend,
} from "../shared/backend-auth.js";
import {
  CLOUD_SYNC_APPLIED_EVENT,
  CLOUD_SYNC_ENTITY_TYPES,
  queueCloudSyncChange,
  startCloudSyncLoop,
  syncCloudRecords,
} from "../shared/cloud-sync.js";
import {
  CLOUD_LIBRARY_TAB_KEYS,
  cloudLibraryResources,
} from "../shared/cloud-library-resources.js";
import { ensureSingleTabOwnership, SINGLE_TAB_OWNERSHIP_EVENT } from "../shared/single-tab.js";
import { applyButtonIcon, initToolsMenu } from "../shared/tools-menu.js";
import { showConfirmDialog, showPromptDialog } from "../shared/ui/confirm-dialog.js";
import {
  createBlankSession,
  createOpenedDocumentSession,
  createRestoredSession,
  isCloudEligible,
  isNamedDocument,
  hasUnsavedWork,
  needsTitleForSave,
  markContentModified,
  markSaved,
  markDeleted,
} from "./document-session.js";
import {
  queueCreateMutation,
  queueUpdateMutation,
  queueDeleteMutation,
  removeMutation,
  markMutationFailed,
  markMutationReplaying,
  getPendingMutations,
  hasPendingMutations,
  clearMutationQueue,
  reconcileLocalToRemote,
} from "./offline-mutations.js";
import iro from "@jaames/iro";
import { t, applyTranslations, toggleLang, getLang } from "../i18n.js";
import {
  IconAccel,
  IconCalculator,
  IconEnergy,
  IconEraser,
  IconFilePlus,
  IconPages,
  IconPen,
  IconRedo,
  IconSave,
  IconSpeed,
  IconTrash,
  IconUndo,
  IconWorld,
} from "../icons.js";

// Apply translations immediately
applyTranslations();
const isSpaRuntime = Boolean(window.__vatioboardSpa);
const singleTabOwnershipPromise = isSpaRuntime ? Promise.resolve(true) : ensureSingleTabOwnership();

let boardLegacyLifecycle = {
  mount() {},
  unmount() {},
};

export function onLegacyViewMount() {
  boardLegacyLifecycle.mount();
}

export function onLegacyViewUnmount() {
  boardLegacyLifecycle.unmount();
}

const langToggleButtons = Array.from(document.querySelectorAll("[data-lang-toggle], #langToggle"));

function syncLangToggleButtons(langCode){
  const nextLabel = String(langCode || getLang()).toUpperCase();
  langToggleButtons.forEach((button) => {
    button.textContent = nextLabel;
  });
}

syncLangToggleButtons(getLang());
langToggleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const newLang = toggleLang();
    syncLangToggleButtons(newLang);
  });
});

// Toolbar buttons
const openCalcBtn = document.getElementById("openCalc");
const openSpeedBtn = document.getElementById("openSpeed");
const openEnergyBtn = document.getElementById("openEnergy");
const openAccelMenuBtn = document.getElementById("openAccelMenu");
const openCalcMenuBtn = document.getElementById("openCalcMenu");
const openLibraryMenuBtn = document.getElementById("openLibraryMenu");
const openSpeedMenuBtn = document.getElementById("openSpeedMenu");
const toolsMenuBtn = document.getElementById("toolsMenuBtn");
const toolsMenuList = document.getElementById("toolsMenuList");

applyButtonIcon(document.getElementById("pen"), IconPen);
applyButtonIcon(document.getElementById("erase"), IconEraser);
applyButtonIcon(document.getElementById("undo"), IconUndo);
applyButtonIcon(document.getElementById("redo"), IconRedo);
applyButtonIcon(document.getElementById("createNew"), IconFilePlus);
applyButtonIcon(document.getElementById("save"), IconSave);
applyButtonIcon(document.getElementById("deleteBoard"), IconTrash);
applyButtonIcon(openCalcBtn, IconCalculator);
applyButtonIcon(openCalcMenuBtn, IconCalculator);
applyButtonIcon(openAccelMenuBtn, IconAccel);
applyButtonIcon(openLibraryMenuBtn, IconWorld);
applyButtonIcon(openSpeedBtn, IconSpeed);
applyButtonIcon(openSpeedMenuBtn, IconSpeed);
applyButtonIcon(openEnergyBtn, IconEnergy);
applyButtonIcon(toolsMenuBtn, IconPages);

// Floating dock with tool buttons
const { calcBtn } = createFloatingDock();
const toolsMenu = initToolsMenu({ button: toolsMenuBtn, list: toolsMenuList });
initBackendAuthControllers();
toolsMenu.setOpen(true);

// Create widgets - all buttons toggle the same instance
const energyWidget = createEnergyCalculatorWidget({ button: null });
const calcWidget = createCalculatorWidget({
  floating: false,
  onOpenEnergy: () => energyWidget.toggle(),
});

const bindToggle = (btn, widget) => {
  btn?.addEventListener("click", () => {
    widget.toggle();
    toolsMenu.close();
  });
};

const bindNavigation = (btn, href) => {
  btn?.addEventListener("click", () => {
    toolsMenu.close();
    navigateToAppRoute(href);
  });
};

bindToggle(openCalcBtn, calcWidget);
bindToggle(openCalcMenuBtn, calcWidget);
bindToggle(calcBtn, calcWidget);

bindToggle(openEnergyBtn, energyWidget);

bindNavigation(openSpeedBtn, "#/speed");
bindNavigation(openSpeedMenuBtn, "#/speed");
bindNavigation(openAccelMenuBtn, "#/accel");
bindNavigation(openLibraryMenuBtn, "#/library?tab=board_documents");

integratePlayerWidget({ toolsMenuList, toolsMenu });

  (function(){
    const canvas = document.getElementById("pad");
    const ctx = canvas.getContext("2d", { alpha: true });
    const historyCanvas = document.createElement("canvas");
    const historyCtx = historyCanvas.getContext("2d", { alpha: true });
    const statusEl = document.getElementById("status");

    const penBtn = document.getElementById("pen");
    const eraseBtn = document.getElementById("erase");
    const undoBtn = document.getElementById("undo");
    const redoBtn = document.getElementById("redo");
    const sizeEl = document.getElementById("size");
    const sizePreview = document.getElementById("sizePreview");
    const createNewBtn = document.getElementById("createNew");
    const saveBtn = document.getElementById("save");
    const deleteBoardBtn = document.getElementById("deleteBoard");
    const backendAuthUserInput = document.querySelector("[data-backend-auth-user]");

    // NEW: color UI
    const swatchesEl = document.getElementById("swatches");

    const LS_INK_RAW = "vatio_board_ink_raw";
    let saveBusy = false;
    let currentBoardDocument = loadCurrentBoardDocumentMeta();
    let documentSession = currentBoardDocument
      ? createRestoredSession({
        name: currentBoardDocument.name,
        title: currentBoardDocument.title,
        hasContent: false,
      })
      : createBlankSession();
    let activeBackendUser = null;

    function isDarkMode(){
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    }

    let inkRaw =
    normalizeHex(localStorage.getItem(LS_INK_RAW)) ||
    (isDarkMode() ? "#e5e7eb" : "#111827");

    // Popup UI
    const colorTriggerBtn = document.getElementById("sizePreview");
    const colorPopup = document.getElementById("colorPopup");
    const colorPopupClose = document.getElementById("colorPopupClose");

    const hexInput = document.getElementById("hexInput");
    const rRange = document.getElementById("rRange");
    const gRange = document.getElementById("gRange");
    const bRange = document.getElementById("bRange");
    const rVal = document.getElementById("rVal");
    const gVal = document.getElementById("gVal");
    const bVal = document.getElementById("bVal");

    const iroPickerEl = document.getElementById("iroPicker");

    let iroPicker = null;
    let syncingFromIro = false;


    function setPopupFromInkRaw(){
      const rgb = hexToRgb(inkRaw) || { r: 17, g: 24, b: 39 };
      if (rRange) rRange.value = String(rgb.r);
      if (gRange) gRange.value = String(rgb.g);
      if (bRange) bRange.value = String(rgb.b);
      if (rVal) rVal.textContent = String(rgb.r);
      if (gVal) gVal.textContent = String(rgb.g);
      if (bVal) bVal.textContent = String(rgb.b);
      if (hexInput) hexInput.value = inkRaw;
    }

    function setInkFromSliders(){
      const r = parseInt(rRange?.value || "0", 10);
      const g = parseInt(gRange?.value || "0", 10);
      const b = parseInt(bRange?.value || "0", 10);

      if (rVal) rVal.textContent = String(r);
      if (gVal) gVal.textContent = String(g);
      if (bVal) bVal.textContent = String(b);

      const hex = rgbToHex({ r, g, b });
      if (hexInput) hexInput.value = hex;
        setInkRaw(hex);
      }

    function openColorPopup(){
      setPopupFromInkRaw();
      ensureIroPicker();
      syncIroFromInk();
      if (colorPopup) colorPopup.hidden = false;
    }

    function closeColorPopup(){
      if (colorPopup) colorPopup.hidden = true;
    }

    colorTriggerBtn?.addEventListener("click", openColorPopup);
    colorPopupClose?.addEventListener("click", closeColorPopup);
    colorPopup?.addEventListener("click", (e) => {
    if (e.target === colorPopup) closeColorPopup();
    });
    swatchesEl?.addEventListener("click", (event) => {
      if (!event.target?.closest?.(".swatch")) return;
      event.preventDefault();
      event.stopPropagation();
    });

    [rRange, gRange, bRange].forEach((el) => el?.addEventListener("input", setInkFromSliders));

    hexInput?.addEventListener("change", () => {
      const h = normalizeHex(hexInput.value);
      if (h) {
        setInkRaw(h);
        syncIroFromInk();
      } else {
        setPopupFromInkRaw();
      }
    });

    let tool = "pen"; // "pen" | "eraser"
    let drawing = false;
    let activePointerId = null;
    let last = null;
    let currentStroke = null;
    let boardStateRevision = 0;
    let canvasCssWidth = 0;
    let canvasCssHeight = 0;
    let canvasDpr = 1;
    let viewMounted = true;
    let initialized = false;
    const commandHistory = [];
    const redoHistory = [];

    // Theme-aware colors from CSS variables
    function cssVar(name){
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
    function currentCanvasBg(){ return cssVar("--canvas-bg") || "#ffffff"; }

    function setStatus(s){ statusEl.textContent = s; }

    function syncToolbarButtons(){
      if (!saveBtn) return;
      const busy = saveBusy || documentSession.saveState === "saving";
      saveBtn.disabled = busy;
      if (deleteBoardBtn) {
        deleteBoardBtn.disabled = busy || documentSession.deleteState === "deleting";
      }
    }

    function normalizeBackendUser(value){
      const normalized = typeof value === "string" ? value.trim() : "";
      return normalized || null;
    }

    function clearRemoteBoardDocumentReference({ preserveTitle = true } = {}){
      const nextTitle = preserveTitle
        ? (documentSession.documentTitle || currentBoardDocument?.title || "")
        : "";

      documentSession.remoteDocumentName = null;
      documentSession.documentTitle = nextTitle;
      documentSession.lastSavedAtMs = 0;
      documentSession.materializedRemotely = false;
      documentSession.openedFromCloud = false;
      currentBoardDocument = null;
      clearCurrentBoardDocumentMeta();
    }

    async function saveBoardDocumentWithFallback({
      title,
      snapshot,
      previewImage,
      csrfToken,
    }){
      if (!isNamedDocument(documentSession)) {
        return saveBoardDocumentToBackend({
          title,
          payload: snapshot,
          previewImage,
          csrfToken,
        });
      }

      const updateResponse = await updateBoardDocumentInBackend({
        name: documentSession.remoteDocumentName,
        payload: snapshot,
        previewImage,
        csrfToken,
      });

      if (updateResponse?.status !== 404) {
        return updateResponse;
      }

      clearRemoteBoardDocumentReference({ preserveTitle: true });
      const fallbackTitle = String(title || documentSession.documentTitle || "").trim();

      return saveBoardDocumentToBackend({
        title: fallbackTitle,
        payload: snapshot,
        previewImage,
        csrfToken,
      });
    }

    function handleBackendAuthStateChange(event){
      if (event?.detail?.pendingLogout === true) return;
      if (event?.detail?.isGuest === true || event?.detail?.authenticated !== true) {
        return;
      }

      const nextUser = normalizeBackendUser(event?.detail?.user);
      if (activeBackendUser && nextUser && activeBackendUser !== nextUser) {
        clearRemoteBoardDocumentReference({ preserveTitle: true });
      }
      if (nextUser) {
        activeBackendUser = nextUser;
      }
    }

    function setActive(options = {}){
      const shouldAnnounce = options.announce !== false;
      penBtn.setAttribute("aria-pressed", tool === "pen" ? "true" : "false");
      eraseBtn.setAttribute("aria-pressed", tool === "eraser" ? "true" : "false");
      if (shouldAnnounce) {
        setStatus(tool === "pen" ? t("pen") : t("eraser"));
      }
    }

    function activatePenTool(options = {}){
      if (tool === "pen") {
        if (options.announce) setActive(options);
        return;
      }
      tool = "pen";
      setActive(options);
    }

    function syncSizePreview(){
      if (!sizeEl || !sizePreview) return;
      const sizeValue = Math.max(2, Math.min(22, Number(sizeEl.value) || 6));
      sizePreview.style.setProperty("--board-size-preview", `${sizeValue}px`);
      sizeEl.setAttribute("aria-valuetext", `${sizeValue}`);
      activatePenTool({ announce: true });
    }

    function setDrawingSelectionLock(isLocked){
      document.documentElement.classList.toggle("board-is-drawing", isLocked);
      document.body.classList.toggle("board-is-drawing", isLocked);
    }

    function clearNativeSelection(){
      try {
        window.getSelection?.()?.removeAllRanges?.();
      } catch {
        // Ignore browser-specific selection cleanup failures.
      }
    }

    function clonePoint(point){
      return { x: point.x, y: point.y };
    }

    function cloneCommand(command){
      if (!command) return null;
      if (command.type === "clear") return { type: "clear" };
      return {
        type: "stroke",
        tool: command.tool,
        size: command.size,
        inkRaw: command.inkRaw,
        points: command.points.map(clonePoint),
      };
    }

    function syncHistoryButtons(){
      if (undoBtn) undoBtn.disabled = commandHistory.length === 0;
      if (redoBtn) redoBtn.disabled = redoHistory.length === 0;
    }

    function createBoardDrawingSnapshot(){
      return {
        commands: commandHistory.map(cloneCommand).filter(Boolean),
        redoCommands: redoHistory.map(cloneCommand).filter(Boolean),
      };
    }

    function queueBoardPersistence(){
      boardStateRevision += 1;
      markContentModified(documentSession);
      const updatedAtMs = Date.now();
      const snapshot = {
        ...createBoardDrawingSnapshot(),
        updatedAtMs,
      };
      void saveBoardDrawing(snapshot);
      if (isCloudEligible(documentSession)) {
        void queueCloudSyncChange({
          entityType: CLOUD_SYNC_ENTITY_TYPES.boardDrawing,
          recordId: "primary",
          recordTitle: documentSession.documentTitle || "Board",
          updatedAtMs,
          payload: snapshot,
        });
      }
    }

    async function hydrateBoardDrawing(){
      const restoreRevision = boardStateRevision;
      const pendingOpen = await consumeBoardDocumentOpen();
      const storedDrawing = pendingOpen?.payload || await loadBoardDrawing();

      if (boardStateRevision !== restoreRevision || drawing || commandHistory.length > 0 || redoHistory.length > 0) {
        return;
      }

      const restoredCommands = Array.isArray(storedDrawing?.commands)
        ? storedDrawing.commands.map(cloneCommand).filter(Boolean)
        : [];
      const restoredRedoCommands = Array.isArray(storedDrawing?.redoCommands)
        ? storedDrawing.redoCommands.map(cloneCommand).filter(Boolean)
        : [];

      if (!pendingOpen && restoredCommands.length === 0 && restoredRedoCommands.length === 0) {
        return;
      }

      commandHistory.length = 0;
      redoHistory.length = 0;
      commandHistory.push(...restoredCommands);
      redoHistory.push(...restoredRedoCommands);
      syncHistoryButtons();
      redrawCanvas();

      if (pendingOpen?.document) {
        currentBoardDocument = {
          name: pendingOpen.document.name,
          title: pendingOpen.document.title,
          updatedAtMs: pendingOpen.document.updated_at_ms || storedDrawing.updatedAtMs || Date.now(),
        };
        documentSession = createOpenedDocumentSession({
          name: pendingOpen.document.name,
          title: pendingOpen.document.title,
          hasContent: restoredCommands.length > 0,
          linkedPngName: pendingOpen.document.preview_image_file || null,
        });
        await persistBoardDocumentSelection({
          document: pendingOpen.document,
          payload: {
            ...storedDrawing,
            updatedAtMs: storedDrawing.updatedAtMs || Date.now(),
          },
        });
        syncToolbarButtons();
        setStatus(t("boardDocumentOpened", {
          title: currentBoardDocument.title || t("boardDocumentUntitled"),
        }));
      } else if (restoredCommands.length > 0 && !isNamedDocument(documentSession)) {
        documentSession.hasUserContent = true;
      }
    }

    function pushHistoryCommand(command, { clearRedo = true } = {}){
      const nextCommand = cloneCommand(command);
      if (!nextCommand) return;
      commandHistory.push(nextCommand);
      if (clearRedo) {
        redoHistory.length = 0;
      }
      syncHistoryButtons();
    }

    // ---- Color utilities (contrast-safe ink) ----
    function clamp01(x){ return Math.max(0, Math.min(1, x)); }

    function normalizeHex(hex){
      if(!hex) return null;
      let h = String(hex).trim();
      if(h[0] !== "#") h = "#" + h;
      // #rgb -> #rrggbb
      if(/^#([0-9a-fA-F]{3})$/.test(h)){
        const m = h.match(/^#([0-9a-fA-F]{3})$/)[1];
        h = "#" + m.split("").map(ch => ch + ch).join("");
      }
      if(!/^#([0-9a-fA-F]{6})$/.test(h)) return null;
      return h.toLowerCase();
    }

    function hexToRgb(hex){
      const h = normalizeHex(hex);
      if(!h) return null;
      const n = parseInt(h.slice(1), 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function rgbToHex({r,g,b}){
      const to = (v)=> v.toString(16).padStart(2, "0");
      return "#" + to(r) + to(g) + to(b);
    }

    function srgbToLin(c){
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }

    function relLuminance(rgb){
      const R = srgbToLin(rgb.r), G = srgbToLin(rgb.g), B = srgbToLin(rgb.b);
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    }

    function contrastRatio(hexA, hexB){
      const a = hexToRgb(hexA), b = hexToRgb(hexB);
      if(!a || !b) return 1;
      const L1 = relLuminance(a);
      const L2 = relLuminance(b);
      const hi = Math.max(L1, L2);
      const lo = Math.min(L1, L2);
      return (hi + 0.05) / (lo + 0.05);
    }

    function mixHex(hexA, hexB, t){
      const a = hexToRgb(hexA), b = hexToRgb(hexB);
      if(!a || !b) return hexA;
      const tt = clamp01(t);
      const r = Math.round(a.r + (b.r - a.r) * tt);
      const g = Math.round(a.g + (b.g - a.g) * tt);
      const bb = Math.round(a.b + (b.b - a.b) * tt);
      return rgbToHex({r,g,b:bb});
    }

    // Make sure ink stays readable on current canvas background.
    // Keeps the user's chosen hue as much as possible, nudging toward white/black only if needed.
    function ensureInkContrast(rawInkHex){
      const bg = normalizeHex(currentCanvasBg()) || "#ffffff";
      const raw = normalizeHex(rawInkHex) || "#111827";

      const TARGET = 4.0; // practical readability for lines
      let cr = contrastRatio(raw, bg);
      if(cr >= TARGET) return raw;

      // Decide which direction improves contrast faster (toward white or toward black)
      const toWhite = mixHex(raw, "#ffffff", 0.65);
      const toBlack = mixHex(raw, "#000000", 0.65);
      const crW = contrastRatio(toWhite, bg);
      const crB = contrastRatio(toBlack, bg);
      const toward = (crW >= crB) ? "#ffffff" : "#000000";

      // Binary search a mix amount that hits target (or gets close)
      let lo = 0, hi = 1, best = raw;
      for(let i=0;i<12;i++){
        const mid = (lo + hi) / 2;
        const cand = mixHex(raw, toward, mid);
        const c = contrastRatio(cand, bg);
        if(c >= TARGET){
          best = cand;
          hi = mid;
        } else {
          lo = mid;
        }
      }
      return best;
    }

    function setCssInk(hex){
      document.documentElement.style.setProperty("--ink", hex);
    }

    function fillCanvasBackground(targetCtx = ctx){
      targetCtx.save();
      targetCtx.globalCompositeOperation = "source-over";
      targetCtx.fillStyle = currentCanvasBg();
      targetCtx.fillRect(0, 0, canvasCssWidth, canvasCssHeight);
      targetCtx.restore();
    }

    function applyCommandStyle(targetCtx, command){
      targetCtx.lineWidth = command.size;
      targetCtx.lineCap = "round";
      targetCtx.lineJoin = "round";

      if (command.tool === "eraser") {
        targetCtx.globalCompositeOperation = "destination-out";
        targetCtx.strokeStyle = "rgba(0,0,0,1)";
        targetCtx.fillStyle = "rgba(0,0,0,1)";
      } else {
        targetCtx.globalCompositeOperation = "source-over";
        const appliedInk = ensureInkContrast(command.inkRaw);
        targetCtx.strokeStyle = appliedInk;
        targetCtx.fillStyle = appliedInk;
      }
    }

    function drawCommandToContext(targetCtx, command){
      if (!command) return;
      if (command.type === "clear") {
        fillCanvasBackground(targetCtx);
        return;
      }

      if (!Array.isArray(command.points) || command.points.length === 0) return;

      targetCtx.save();
      applyCommandStyle(targetCtx, command);

      if (command.points.length === 1) {
        const point = command.points[0];
        targetCtx.beginPath();
        targetCtx.arc(point.x, point.y, Math.max(1, command.size / 2), 0, Math.PI * 2);
        targetCtx.fill();
        targetCtx.restore();
        return;
      }

      targetCtx.beginPath();
      targetCtx.moveTo(command.points[0].x, command.points[0].y);

      let previousPoint = command.points[0];
      for (let index = 1; index < command.points.length; index += 1) {
        const point = command.points[index];
        const middleX = (previousPoint.x + point.x) / 2;
        const middleY = (previousPoint.y + point.y) / 2;
        targetCtx.quadraticCurveTo(previousPoint.x, previousPoint.y, middleX, middleY);
        previousPoint = point;
      }

      targetCtx.lineTo(previousPoint.x, previousPoint.y);
      targetCtx.stroke();
      targetCtx.restore();
    }

    function prepareHistorySurface(){
      historyCanvas.width = canvas.width;
      historyCanvas.height = canvas.height;
      historyCtx.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
      fillCanvasBackground(historyCtx);
    }

    function copyHistorySurfaceToVisible(){
      if (!canvas.width || !canvas.height || !historyCanvas.width || !historyCanvas.height) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(historyCanvas, 0, 0);
      ctx.restore();
    }

    function rebuildHistorySurface(){
      fillCanvasBackground(historyCtx);
      for (const command of commandHistory) {
        drawCommandToContext(historyCtx, command);
      }
    }

    function redrawCanvas(){
      rebuildHistorySurface();
      copyHistorySurfaceToVisible();
    }

    function ensureIroPicker(){
      if (!iroPickerEl || iroPicker) return;

      try {
        iroPicker = new iro.ColorPicker(iroPickerEl, {
        width: 260,
        color: inkRaw,
        layout: [
            { component: iro.ui.Box },
            { component: iro.ui.Slider, options: { sliderType: "hue" } },
          ],
        });

        document.documentElement.classList.add("has-iro");

        // When user drags the picker: update inkRaw via your pipeline
        iroPicker.on("color:change", (c) => {
        const hex = normalizeHex(c?.hexString);
        if (!hex) return;

        syncingFromIro = true;
        try {
            setInkRaw(hex); // preserves your contrast enforcement + persistence
            // Keep hex input in sync while dragging
            if (hexInput) hexInput.value = hex;
        } finally {
            syncingFromIro = false;
        }
      });
    } catch (e) {
        // If anything goes wrong, keep your fallback UI
        iroPicker = null;
        document.documentElement.classList.remove("has-iro");
      }
    }

    function syncIroFromInk(){
    if (!iroPicker || syncingFromIro) return;
    try {
        iroPicker.color.hexString = inkRaw;
    } catch {
        // Ignore invalid intermediate picker states while syncing.
    }
    }

    function syncColorTrigger(){
      if (!colorTriggerBtn) return;

      const raw = normalizeHex(inkRaw) || "#111827";
      colorTriggerBtn.title = `${t("moreColors")} (${raw})`;
      colorTriggerBtn.setAttribute("aria-label", `${t("moreColors")}. Current: ${raw}`);
    }

    function syncPenButtonColor(){
      if (!penBtn) return;
      const raw = normalizeHex(inkRaw) || "#111827";
      penBtn.style.setProperty("--board-pen-tip", raw);
    }

    // Presets tuned for Tesla-ish minimal look (different per theme)
    const PRESETS = [
      { id: "graphite", light: "#111827", dark: "#e5e7eb" },
      { id: "slate",    light: "#334155", dark: "#cbd5e1" },
      { id: "blue",     light: "#2563eb", dark: "#60a5fa" },
      { id: "green",    light: "#10b981", dark: "#34d399" },
      { id: "amber",    light: "#f59e0b", dark: "#fbbf24" },
      { id: "rose",     light: "#e11d48", dark: "#fb7185" }
    ];

    function appliedInkFromRaw(){
      return ensureInkContrast(inkRaw);
    }

    function renderSwatches(){
      swatchesEl.innerHTML = "";
      const dark = isDarkMode();

      for(const p of PRESETS){
        const hex = dark ? p.dark : p.light;

        const b = document.createElement("button");
        b.type = "button";
        b.className = "swatch";
        b.setAttribute("aria-label", t(p.id));
        b.setAttribute("title", t(p.id));
        b.dataset.hex = hex;

        b.style.background = hex;

        b.addEventListener("click", () => {
          setInkRaw(hex);
        });

        swatchesEl.appendChild(b);
      }

      syncColorUI();
      syncColorTrigger();
    }

    function syncColorUI(){
      const raw = normalizeHex(inkRaw);

      [...swatchesEl.querySelectorAll(".swatch")].forEach(btn => {
        const hx = normalizeHex(btn.dataset.hex);
        btn.classList.toggle("is-active", !!raw && hx === raw);
      });
    }

    function applyInk(){
      const applied = appliedInkFromRaw();
      setCssInk(applied);
      syncPenButtonColor();
      syncColorUI();
      syncColorTrigger();
    }

    function setInkRaw(hex){
      const h = normalizeHex(hex);
      if(!h) return;
      inkRaw = h;
      localStorage.setItem(LS_INK_RAW, inkRaw);
      activatePenTool({ announce: false });
      applyInk();

      // NEW: keep popup controls aligned
      setPopupFromInkRaw();
      syncIroFromInk();

      setStatus(t("colorUpdated"));
    }

    // Preserve drawings across resize by snapshotting pixels
    function resize(){
      if (isSpaRuntime && !viewMounted) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvasCssWidth = rect.width;
      canvasCssHeight = rect.height;
      canvasDpr = dpr;

      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      prepareHistorySurface();

      // Work in CSS pixels
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawCanvas();
    }

    function pos(ev){
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    function start(ev){
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      if (activePointerId !== null && ev.pointerId !== activePointerId) return;
      toolsMenu.close();
      clearNativeSelection();
      drawing = true;
      activePointerId = ev.pointerId;
      setDrawingSelectionLock(true);
      try {
        canvas.setPointerCapture?.(ev.pointerId);
      } catch {
        // Some browsers reject capture during transient gesture states.
      }
      last = pos(ev);
      currentStroke = {
        type: "stroke",
        tool,
        size: parseInt(sizeEl.value || "6", 10),
        inkRaw,
        points: [clonePoint(last)],
      };
      applyCommandStyle(ctx, currentStroke);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
    }

    function move(ev){
      if (activePointerId !== null && ev.pointerId !== activePointerId) return;
      if(!drawing || !currentStroke) return;
      const p = pos(ev);
      currentStroke.points.push(clonePoint(p));
      applyCommandStyle(ctx, currentStroke);

      const mx = (last.x + p.x) / 2;
      const my = (last.y + p.y) / 2;
      ctx.quadraticCurveTo(last.x, last.y, mx, my);
      ctx.stroke();
      last = p;
    }

    function finishStroke({ commit = true, ev = null } = {}){
      if (!drawing) return false;
      if (activePointerId !== null && ev?.pointerId !== undefined && ev.pointerId !== activePointerId) return false;
      const pointerId = activePointerId;
      drawing = false;
      activePointerId = null;
      setDrawingSelectionLock(false);
      last = null;

      if (pointerId !== null && pointerId !== undefined) {
        try {
          canvas.releasePointerCapture?.(pointerId);
        } catch {
          // Pointer capture may already be released when pointerup/cancel fires.
        }
      }

      if (currentStroke) {
        if (commit) {
          pushHistoryCommand(currentStroke);
          drawCommandToContext(historyCtx, currentStroke);
          queueBoardPersistence();
        }
        currentStroke = null;
        copyHistorySurfaceToVisible();
      }
      return true;
    }

    function end(ev){
      if (!drawing) return;
      if (!finishStroke({ commit: true, ev })) return;
      setStatus(t("draftUpdated"));
    }

    function handleSingleTabOwnershipChange(event){
      if (event?.detail?.owned !== false) return;
      finishStroke({ commit: false });
    }

    function resetCanvasToBlank(){
      finishStroke({ commit: false });
      commandHistory.length = 0;
      redoHistory.length = 0;
      fillCanvasBackground(historyCtx);
      copyHistorySurfaceToVisible();
      syncHistoryButtons();
    }

    function invalidateBoardDocumentCache(){
      try {
        cloudLibraryResources[CLOUD_LIBRARY_TAB_KEYS.boardDocuments]?.resource?.invalidateList?.();
      } catch {
        // Non-critical: cloud library cache refresh can silently fail.
      }
    }

    async function saveBoardDocument(){
      if (saveBusy) return;

      saveBusy = true;
      documentSession.saveState = "saving";
      syncToolbarButtons();
      setStatus(t("saveCheckingAccess"));

      try {
        const capability = await resolveCloudSyncAccess();
        if (!capability) return;

        // Prompt for title on first save
        let title = documentSession.documentTitle;
        if (needsTitleForSave(documentSession)) {
          title = await showPromptDialog({
            title: t("boardTitlePrompt"),
            placeholder: t("boardTitlePlaceholder"),
            value: title || "",
            confirmLabel: t("saveBoard"),
          });
          if (title === null) return;
          title = String(title || "").trim();
          if (!title) {
            setStatus(t("boardDocumentTitleRequired"));
            return;
          }
        }

        setStatus(t("boardSaving"));
        const snapshot = createBoardDocumentSnapshot();

        // Export PNG preview
        let pngBlob = null;
        try {
          const exported = await exportCanvasAsPng();
          pngBlob = exported.fileBlob;
        } catch {
          // Non-critical: save the document without a preview image.
        }

        const response = await saveBoardDocumentWithFallback({
          title,
          snapshot,
          previewImage: pngBlob,
          csrfToken: capability.csrfToken,
        });

        if (!response?.ok || !response.document) {
          if (response?.status === 401 || response?.status === 403) {
            openBackendAuth();
            setStatus(t("saveLoginRequired"));
          } else {
            setStatus(t("boardCouldNotSave"));
          }
          return;
        }



        // Update session & persisted metadata
        markSaved(documentSession, {
          name: response.document.name,
          title: response.document.title,
        });
        currentBoardDocument = {
          name: response.document.name,
          title: response.document.title,
          updatedAtMs: response.document.updated_at_ms || snapshot.updatedAtMs,
        };
        saveCurrentBoardDocumentMeta(currentBoardDocument);
        invalidateBoardDocumentCache();
        setStatus(t("boardSaved", { title: currentBoardDocument.title || t("boardDocumentUntitled") }));
      } catch {
        setStatus(t("saveNetworkError"));
      } finally {
        saveBusy = false;
        documentSession.saveState = "idle";
        syncToolbarButtons();
      }
    }

    async function deleteBoardDocument(){
      if (saveBusy || documentSession.deleteState === "deleting") return;

      const named = isNamedDocument(documentSession);
      const hasContent = commandHistory.length > 0 || documentSession.hasUserContent;

      // Nothing to delete or discard
      if (!named && !hasContent) {
        setStatus(t("cleared"));
        return;
      }

      // Confirm before destructive action
      const confirmed = await showConfirmDialog({
        title: named
          ? t("deleteBoardConfirmTitle")
          : t("deleteBoardConfirmLocalTitle"),
        message: named
          ? t("deleteBoardConfirmMessage", {
            title: documentSession.documentTitle || t("boardDocumentUntitled"),
          })
          : t("deleteBoardConfirmLocalMessage"),
        confirmLabel: named ? t("deleteBoard") : t("discard"),
        destructive: true,
      });
      if (!confirmed) return;

      if (named) {
        documentSession.deleteState = "deleting";
        syncToolbarButtons();
        setStatus(t("boardDeleting"));

        try {
          const capability = await resolveCloudSyncAccess();
          if (!capability) return;

          const response = await deleteBoardDocumentFromBackend({
            name: documentSession.remoteDocumentName,
            csrfToken: capability.csrfToken,
          });
          if (!response.ok) {
            setStatus(t("boardDocumentDeleteFailed", { status: response.status || 0 }));
            return;
          }
        } catch {
          setStatus(t("saveNetworkError"));
          return;
        } finally {
          documentSession.deleteState = "idle";
          syncToolbarButtons();
        }
      }

      // Reset to blank
      resetCanvasToBlank();
      markDeleted(documentSession);
      currentBoardDocument = null;
      clearCurrentBoardDocumentMeta();
      documentSession = createBlankSession();
      invalidateBoardDocumentCache();
      queueBoardPersistence();
      setStatus(t("boardDeleted"));
    }

    async function createNewBoard(){
      // If there's unsaved work, offer to save first
      if (hasUnsavedWork(documentSession) && commandHistory.length > 0) {
        const confirmed = await showConfirmDialog({
          title: t("createNewConfirmTitle"),
          message: t("createNewConfirmMessage"),
          confirmLabel: t("createNew"),
        });
        if (!confirmed) return;
      }

      resetCanvasToBlank();
      currentBoardDocument = null;
      clearCurrentBoardDocumentMeta();
      documentSession = createBlankSession();
      queueBoardPersistence();
      setStatus(t("cleared"));
    }

    function undo(){
      if (!commandHistory.length) return;
      finishStroke({ commit: false });
      const command = commandHistory.pop();
      redoHistory.push(command);
      redrawCanvas();
      syncHistoryButtons();
      queueBoardPersistence();
      setStatus(t("undo"));
    }

    function redo(){
      if (!redoHistory.length) return;
      finishStroke({ commit: false });
      const command = redoHistory.pop();
      pushHistoryCommand(command, { clearRedo: false });
      drawCommandToContext(historyCtx, command);
      copyHistorySurfaceToVisible();
      queueBoardPersistence();
      setStatus(t("redo"));
    }

    function isEditableElement(element){
      return Boolean(element?.closest?.("input, textarea, [contenteditable='true']"));
    }

    function preventSelectionWhileDrawing(event){
      if (!drawing || isEditableElement(event.target)) return;
      event.preventDefault();
      clearNativeSelection();
    }

    function handleLegacyViewMount(){
      viewMounted = true;
      if (!initialized) return;
      resize();
      syncToolbarButtons();
      syncHistoryButtons();
      setActive({ announce: false });
    }

    function handleLegacyViewUnmount(){
      if (isSpaRuntime && !viewMounted) return;
      finishStroke({ commit: false });
      closeColorPopup();
      toolsMenu.close();
      calcWidget.close?.();
      energyWidget.close?.();
      setDrawingSelectionLock(false);
      viewMounted = false;
    }

    function dataUrlToBlob(dataUrl){
      const value = String(dataUrl || "");
      const parts = value.split(",", 2);
      if (parts.length !== 2) {
        throw new Error("Canvas export data URL is invalid.");
      }

      const mimeMatch = parts[0].match(/^data:([^;]+);base64$/i);
      const mimeType = mimeMatch?.[1] || "application/octet-stream";
      const binary = window.atob(parts[1]);
      const bytes = new Uint8Array(binary.length);

      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      return new Blob([bytes], { type: mimeType });
    }

    function canvasToPngBlob(sourceCanvas){
      return new Promise((resolve, reject) => {
        if (typeof sourceCanvas?.toBlob === "function") {
          sourceCanvas.toBlob((blob) => {
            if (blob) {
              resolve(blob);
              return;
            }

            reject(new Error("Could not prepare the drawing."));
          }, "image/png");
          return;
        }

        try {
          resolve(dataUrlToBlob(sourceCanvas.toDataURL("image/png")));
        } catch (error) {
          reject(error);
        }
      });
    }

    async function exportCanvasAsPng(){
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      const out = document.createElement("canvas");
      out.width = canvas.width;
      out.height = canvas.height;
      const octx = out.getContext("2d");
      if (!octx) {
        throw new Error("Canvas export context is unavailable.");
      }

      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.fillStyle = currentCanvasBg();
      octx.fillRect(0,0,rect.width,rect.height);

      octx.setTransform(1,0,0,1,0,0);
      octx.drawImage(canvas, 0, 0);

      return {
        fileBlob: await canvasToPngBlob(out),
        fileName: "drawing.png",
        imageWidth: out.width,
        imageHeight: out.height,
      };
    }

    function openBackendAuth(){
      toolsMenu.setOpen(true);
      backendAuthUserInput?.focus?.();
    }

    function getBlockedSaveMessage(capability){
      if (capability?.reason) {
        return capability.reason;
      }

      if (capability?.hasActiveSubscription) {
        return t("saveUnavailable");
      }

      return t("saveSubscriptionRequired");
    }

    async function resolveCloudSyncAccess(){
      const session = await getBackendSessionState();

      if (!session.ok) {
        if (session.isGuest) {
          openBackendAuth();
          setStatus(t("saveLoginRequired"));
        } else {
          setStatus(t("saveSessionCheckFailed", { status: session.status }));
        }
        return null;
      }

      if (session.isGuest) {
        openBackendAuth();
        setStatus(t("saveLoginRequired"));
        return null;
      }

      const featureAccess = await getBackendFeatureAccessState();

      if (!featureAccess.ok) {
        if (featureAccess.isGuest) {
          openBackendAuth();
          setStatus(t("saveLoginRequired"));
        } else {
          setStatus(t("saveFeatureAccessFailed", { status: featureAccess.status }));
        }
        return null;
      }

      // Board document saves require the cloud_sync capability.
      const cloudSync = featureAccess.cloudSyncCapability;

      if (!cloudSync?.enabled) {
        setStatus(getBlockedSaveMessage(cloudSync));
        return null;
      }

      if (!cloudSync.csrfToken) {
        setStatus(t("saveUnavailable"));
        return null;
      }

      return cloudSync;
    }

    function createBoardDocumentSnapshot(){
      return {
        ...createBoardDrawingSnapshot(),
        updatedAtMs: Date.now(),
      };
    }

    // Events
    canvas.addEventListener("pointerdown", (e)=>{ e.preventDefault(); start(e); });
    canvas.addEventListener("pointermove", (e)=>{ e.preventDefault(); move(e); });
    canvas.addEventListener("pointerup",   (e)=>{ e.preventDefault(); end(e); });
    canvas.addEventListener("pointercancel",(e)=>{ e.preventDefault(); end(e); });
    canvas.addEventListener("lostpointercapture", (e) => { end(e); });
    canvas.addEventListener("contextmenu",(e)=>e.preventDefault());
    canvas.addEventListener("selectstart", (e) => e.preventDefault());
    canvas.addEventListener("dragstart", (e) => e.preventDefault());
    document.addEventListener("selectstart", preventSelectionWhileDrawing);

    penBtn.addEventListener("click", ()=>{ tool="pen"; setActive(); });
    eraseBtn.addEventListener("click", ()=>{ tool="eraser"; setActive(); });
    undoBtn?.addEventListener("click", undo);
    redoBtn?.addEventListener("click", redo);

    sizeEl.addEventListener("input", syncSizePreview);

    createNewBtn?.addEventListener("click", () => {
      void createNewBoard();
    });
    saveBtn?.addEventListener("click", () => {
      void saveBoardDocument();
    });
    deleteBoardBtn?.addEventListener("click", () => {
      void deleteBoardDocument();
    });
    window.addEventListener(BACKEND_AUTH_STATE_EVENT, handleBackendAuthStateChange);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener){
      mq.addEventListener("change", () => {
        // recompute presets + apply ink contrast for new background
        renderSwatches();
        applyInk();
        resize();
        setStatus(t("themeUpdated"));
      });
    }

    window.addEventListener("resize", resize);
    document.addEventListener("keydown", (event) => {
      if (isEditableElement(document.activeElement)) return;
      if (!(event.ctrlKey || event.metaKey)) return;

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (key === "y") {
        event.preventDefault();
        redo();
      }
    });

    window.addEventListener(CLOUD_SYNC_APPLIED_EVENT, (event) => {
      if (event?.detail?.entityType !== CLOUD_SYNC_ENTITY_TYPES.boardDrawing) return;
      void hydrateBoardDrawing();
    });
    window.addEventListener(SINGLE_TAB_OWNERSHIP_EVENT, handleSingleTabOwnershipChange);

    // Init
    syncSizePreview();
    syncHistoryButtons();
    syncToolbarButtons();
    setActive();

    renderSwatches();
    applyInk();

    resize();
    initialized = true;
    boardLegacyLifecycle = {
      mount: handleLegacyViewMount,
      unmount: handleLegacyViewUnmount,
    };
    setStatus(t("ready"));
    void (async () => {
      if (!(await singleTabOwnershipPromise)) {
        return;
      }

      await hydrateBoardDrawing();
      if (!isSpaRuntime) startCloudSyncLoop({ immediate: false });
      void syncCloudRecords().catch(() => {
        // Keep the page usable with the local drawing if sync is temporarily unavailable.
      });
    })();
  })();
