import "../styles/board.less";
import "../styles/calculator.less";
import "../styles/energy.less";
import "../styles/dock.less";

import { createCalculatorWidget } from "../calculator/calculator-widget.js";
import { createEnergyCalculatorWidget } from "../energy/energy-calculator-widget.js";
import { createFloatingDock } from "../dock/floating-dock.js";
import { applyButtonIcon, initToolsMenu } from "../shared/tools-menu.js";
import iro from "@jaames/iro";
import { t, applyTranslations, toggleLang, getLang } from "../i18n.js";
import {
  IconAccel,
  IconCalculator,
  IconDownload,
  IconEnergy,
  IconEraser,
  IconPages,
  IconPen,
  IconRedo,
  IconSpeed,
  IconTrash,
  IconUndo,
} from "../icons.js";

// Apply translations immediately
applyTranslations();

const langToggleBtn = document.getElementById("langToggle");
langToggleBtn.textContent = getLang().toUpperCase();
langToggleBtn.addEventListener("click", () => {
  const newLang = toggleLang();
  langToggleBtn.textContent = newLang.toUpperCase();
});

// Toolbar buttons
const openCalcBtn = document.getElementById("openCalc");
const openSpeedBtn = document.getElementById("openSpeed");
const openEnergyBtn = document.getElementById("openEnergy");
const openAccelMenuBtn = document.getElementById("openAccelMenu");
const openCalcMenuBtn = document.getElementById("openCalcMenu");
const openSpeedMenuBtn = document.getElementById("openSpeedMenu");
const openEnergyMenuBtn = document.getElementById("openEnergyMenu");
const toolsMenuBtn = document.getElementById("toolsMenuBtn");
const toolsMenuList = document.getElementById("toolsMenuList");

applyButtonIcon(document.getElementById("pen"), IconPen);
applyButtonIcon(document.getElementById("erase"), IconEraser);
applyButtonIcon(document.getElementById("undo"), IconUndo);
applyButtonIcon(document.getElementById("redo"), IconRedo);
applyButtonIcon(document.getElementById("clear"), IconTrash);
applyButtonIcon(document.getElementById("save"), IconDownload);
applyButtonIcon(openCalcBtn, IconCalculator);
applyButtonIcon(openCalcMenuBtn, IconCalculator);
applyButtonIcon(openAccelMenuBtn, IconAccel);
applyButtonIcon(openSpeedBtn, IconSpeed);
applyButtonIcon(openSpeedMenuBtn, IconSpeed);
applyButtonIcon(openEnergyBtn, IconEnergy);
applyButtonIcon(openEnergyMenuBtn, IconEnergy);
applyButtonIcon(toolsMenuBtn, IconPages);

// Floating dock with tool buttons
const { calcBtn, energyBtn } = createFloatingDock();
const toolsMenu = initToolsMenu({ button: toolsMenuBtn, list: toolsMenuList });
toolsMenu.setOpen(true);

// Create widgets - all buttons toggle the same instance
const calcWidget = createCalculatorWidget({ floating: false });
const energyWidget = createEnergyCalculatorWidget({ button: null });

const bindToggle = (btn, widget) => {
  btn?.addEventListener("click", () => {
    widget.toggle();
    toolsMenu.close();
  });
};

const bindNavigation = (btn, href) => {
  btn?.addEventListener("click", () => {
    toolsMenu.close();
    window.location.href = href;
  });
};

bindToggle(openCalcBtn, calcWidget);
bindToggle(openCalcMenuBtn, calcWidget);
bindToggle(calcBtn, calcWidget);

bindToggle(openEnergyBtn, energyWidget);
bindToggle(openEnergyMenuBtn, energyWidget);
bindToggle(energyBtn, energyWidget);

bindNavigation(openSpeedBtn, "/speed");
bindNavigation(openSpeedMenuBtn, "/speed");
bindNavigation(openAccelMenuBtn, "/accel");

  (function(){
    const canvas = document.getElementById("pad");
    const ctx = canvas.getContext("2d", { alpha: true });
    const statusEl = document.getElementById("status");

    const penBtn = document.getElementById("pen");
    const eraseBtn = document.getElementById("erase");
    const undoBtn = document.getElementById("undo");
    const redoBtn = document.getElementById("redo");
    const sizeEl = document.getElementById("size");
    const sizePreview = document.getElementById("sizePreview");
    const clearBtn = document.getElementById("clear");
    const saveBtn = document.getElementById("save");

    // NEW: color UI
    const swatchesEl = document.getElementById("swatches");

    const LS_INK_RAW = "vatio_board_ink_raw";

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
    let last = null;
    let currentStroke = null;
    const commandHistory = [];
    const redoHistory = [];
    const MAX_HISTORY_STEPS = 120;

    // Theme-aware colors from CSS variables
    function cssVar(name){
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
    function currentCanvasBg(){ return cssVar("--canvas-bg") || "#ffffff"; }

    function setStatus(s){ statusEl.textContent = s; }

    function setActive(){
      penBtn.setAttribute("aria-pressed", tool === "pen" ? "true" : "false");
      eraseBtn.setAttribute("aria-pressed", tool === "eraser" ? "true" : "false");
      setStatus(tool === "pen" ? t("pen") : t("eraser"));
    }

    function syncSizePreview(){
      if (!sizeEl || !sizePreview) return;
      const sizeValue = Math.max(2, Math.min(22, Number(sizeEl.value) || 6));
      sizePreview.style.setProperty("--board-size-preview", `${sizeValue}px`);
      sizeEl.setAttribute("aria-valuetext", `${sizeValue}`);
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

    function pushHistoryCommand(command, { clearRedo = true } = {}){
      const nextCommand = cloneCommand(command);
      if (!nextCommand) return;
      commandHistory.push(nextCommand);
      if (commandHistory.length > MAX_HISTORY_STEPS) {
        commandHistory.shift();
      }
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

    function fillCanvasBackground(){
      const rect = canvas.getBoundingClientRect();
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = currentCanvasBg();
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.restore();
    }

    function applyCommandStyle(command){
      ctx.lineWidth = command.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (command.tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
        ctx.fillStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
        const appliedInk = ensureInkContrast(command.inkRaw);
        ctx.strokeStyle = appliedInk;
        ctx.fillStyle = appliedInk;
      }
    }

    function drawCommand(command){
      if (!command) return;
      if (command.type === "clear") {
        fillCanvasBackground();
        return;
      }

      if (!Array.isArray(command.points) || command.points.length === 0) return;

      ctx.save();
      applyCommandStyle(command);

      if (command.points.length === 1) {
        const point = command.points[0];
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(1, command.size / 2), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      ctx.beginPath();
      ctx.moveTo(command.points[0].x, command.points[0].y);

      let previousPoint = command.points[0];
      for (let index = 1; index < command.points.length; index += 1) {
        const point = command.points[index];
        const middleX = (previousPoint.x + point.x) / 2;
        const middleY = (previousPoint.y + point.y) / 2;
        ctx.quadraticCurveTo(previousPoint.x, previousPoint.y, middleX, middleY);
        previousPoint = point;
      }

      ctx.lineTo(previousPoint.x, previousPoint.y);
      ctx.stroke();
      ctx.restore();
    }

    function redrawCanvas(){
      fillCanvasBackground();
      for (const command of commandHistory) {
        drawCommand(command);
      }
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
      syncColorUI();
      syncColorTrigger();
    }

    function setInkRaw(hex){
      const h = normalizeHex(hex);
      if(!h) return;
      inkRaw = h;
      localStorage.setItem(LS_INK_RAW, inkRaw);
      applyInk();

      // NEW: keep popup controls aligned
      setPopupFromInkRaw();
      syncIroFromInk();

      setStatus(t("colorUpdated"));
    }

    // Preserve drawings across resize by snapshotting pixels
    function resize(){
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);

      // Work in CSS pixels
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawCanvas();
    }

    function pos(ev){
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    function start(ev){
      drawing = true;
      canvas.setPointerCapture(ev.pointerId);
      last = pos(ev);
      currentStroke = {
        type: "stroke",
        tool,
        size: parseInt(sizeEl.value || "6", 10),
        inkRaw,
        points: [clonePoint(last)],
      };
      applyCommandStyle(currentStroke);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
    }

    function move(ev){
      if(!drawing || !currentStroke) return;
      const p = pos(ev);
      currentStroke.points.push(clonePoint(p));
      applyCommandStyle(currentStroke);

      const mx = (last.x + p.x) / 2;
      const my = (last.y + p.y) / 2;
      ctx.quadraticCurveTo(last.x, last.y, mx, my);
      ctx.stroke();
      last = p;
    }

    function end(){
      if (!drawing) return;
      drawing = false;
      last = null;
      if (currentStroke) {
        pushHistoryCommand(currentStroke);
        currentStroke = null;
        redrawCanvas();
      }
      setStatus(t("savedLocally"));
    }

    function clear(){
      currentStroke = null;
      drawing = false;
      last = null;

      if (commandHistory.length === 0) {
        redoHistory.length = 0;
        redrawCanvas();
        syncHistoryButtons();
        setStatus(t("cleared"));
        return;
      }

      pushHistoryCommand({ type: "clear" });
      redrawCanvas();
      setStatus(t("cleared"));
    }

    function undo(){
      if (!commandHistory.length) return;
      if (drawing) {
        drawing = false;
        currentStroke = null;
        last = null;
      }
      const command = commandHistory.pop();
      redoHistory.push(command);
      redrawCanvas();
      syncHistoryButtons();
      setStatus(t("undo"));
    }

    function redo(){
      if (!redoHistory.length) return;
      const command = redoHistory.pop();
      pushHistoryCommand(command, { clearRedo: false });
      redrawCanvas();
      setStatus(t("redo"));
    }

    function isEditableElement(element){
      return Boolean(element?.closest?.("input, textarea, [contenteditable='true']"));
    }

    function savePNG(){
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      const out = document.createElement("canvas");
      out.width = canvas.width;
      out.height = canvas.height;
      const octx = out.getContext("2d");

      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.fillStyle = currentCanvasBg();
      octx.fillRect(0,0,rect.width,rect.height);

      octx.setTransform(1,0,0,1,0,0);
      octx.drawImage(canvas, 0, 0);

      const a = document.createElement("a");
      a.href = out.toDataURL("image/png");
      a.download = t("drawingFilename");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus(t("downloadedPng"));
    }

    // Events
    canvas.addEventListener("pointerdown", (e)=>{ e.preventDefault(); start(e); });
    canvas.addEventListener("pointermove", (e)=>{ e.preventDefault(); move(e); });
    canvas.addEventListener("pointerup",   (e)=>{ e.preventDefault(); end(); });
    canvas.addEventListener("pointercancel",(e)=>{ e.preventDefault(); end(); });
    canvas.addEventListener("contextmenu",(e)=>e.preventDefault());

    penBtn.addEventListener("click", ()=>{ tool="pen"; setActive(); });
    eraseBtn.addEventListener("click", ()=>{ tool="eraser"; setActive(); });
    undoBtn?.addEventListener("click", undo);
    redoBtn?.addEventListener("click", redo);

    sizeEl.addEventListener("input", syncSizePreview);

    clearBtn.addEventListener("click", clear);
    saveBtn.addEventListener("click", savePNG);

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

    // Init
    syncSizePreview();
    syncHistoryButtons();
    setActive();

    renderSwatches();
    applyInk();

    resize();
    setStatus(t("ready"));
  })();
