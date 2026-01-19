import "../styles/board.less";
import "../styles/calculator.less";

import { createCalculatorWidget } from "../calculator/calculator-widget.js";
import iro from "@jaames/iro";

const openCalcBtn = document.getElementById("openCalc");
createCalculatorWidget({ button: openCalcBtn, floating: true });

  (function(){
    const canvas = document.getElementById("pad");
    const ctx = canvas.getContext("2d", { alpha: true });
    const statusEl = document.getElementById("status");

    const penBtn = document.getElementById("pen");
    const eraseBtn = document.getElementById("erase");
    const sizeEl = document.getElementById("size");
    const sizeVal = document.getElementById("sizeVal");
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
    const colorChipBtn = document.getElementById("colorChip");
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

    colorChipBtn?.addEventListener("click", openColorPopup);
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

    // Show "More" if popup UI exists
    if (colorChipBtn && colorPopup && hexInput && iroPickerEl) {
      colorChipBtn.hidden = false;
    } else if (colorChipBtn) {
      colorChipBtn.hidden = true;
    }


    let tool = "pen"; // "pen" | "eraser"
    let drawing = false;
    let last = null;

    // Theme-aware colors from CSS variables
    function cssVar(name){
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
    function currentInk(){ return cssVar("--ink") || "#111827"; }
    function currentCanvasBg(){ return cssVar("--canvas-bg") || "#ffffff"; }

    function setStatus(s){ statusEl.textContent = s; }

    function setActive(){
      penBtn.setAttribute("aria-pressed", tool === "pen" ? "true" : "false");
      eraseBtn.setAttribute("aria-pressed", tool === "eraser" ? "true" : "false");
      setStatus(tool === "pen" ? "Pen" : "Eraser");
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
    } catch {}
    }

    function syncColorChip(){
      if (!colorChipBtn) return;

      // show the *raw* selected color as the chip fill
      const raw = normalizeHex(inkRaw) || "#111827";
      colorChipBtn.style.background = raw;

      // nice tooltip + accessibility
      colorChipBtn.title = `More colors (${raw})`;
      colorChipBtn.setAttribute("aria-label", `More colors. Current: ${raw}`);
    }

    // Presets tuned for Tesla-ish minimal look (different per theme)
    const PRESETS = [
      { id: "graphite",  name: "Graphite", light: "#111827", dark: "#e5e7eb" },
      { id: "slate",     name: "Slate",    light: "#334155", dark: "#cbd5e1" },
      { id: "blue",      name: "Blue",     light: "#2563eb", dark: "#60a5fa" },
      { id: "green",     name: "Green",    light: "#10b981", dark: "#34d399" },
      { id: "amber",     name: "Amber",    light: "#f59e0b", dark: "#fbbf24" },
      { id: "rose",      name: "Rose",     light: "#e11d48", dark: "#fb7185" }
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
        b.setAttribute("aria-label", p.name);
        b.setAttribute("title", p.name);
        b.dataset.hex = hex;

        b.style.background = hex;

        b.addEventListener("click", () => {
          setInkRaw(hex);
        });

        swatchesEl.appendChild(b);
      }

      syncColorUI();
      syncColorChip();
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
      syncColorChip();
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

      setStatus("Color updated");
    }

    // Preserve drawings across resize by snapshotting pixels
    function resize(){
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      // Snapshot current drawing
      let snapshot = null;
      if (canvas.width && canvas.height){
        snapshot = document.createElement("canvas");
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        snapshot.getContext("2d").drawImage(canvas, 0, 0);
      }

      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);

      // Work in CSS pixels
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Fill background for visibility + saved PNG background
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = currentCanvasBg();
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.restore();

      // Restore snapshot scaled into new size
      if (snapshot){
        const oldCssW = snapshot.width / dpr;
        const oldCssH = snapshot.height / dpr;

        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(snapshot, 0, 0, oldCssW, oldCssH);
        ctx.restore();
      }
    }

    function styleStroke(){
      const size = parseInt(sizeEl.value || "6", 10);
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if(tool === "eraser"){
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = currentInk();
      }
    }

    function pos(ev){
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    function start(ev){
      drawing = true;
      canvas.setPointerCapture(ev.pointerId);
      last = pos(ev);
      styleStroke();
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
    }

    function move(ev){
      if(!drawing) return;
      const p = pos(ev);
      styleStroke();

      const mx = (last.x + p.x) / 2;
      const my = (last.y + p.y) / 2;
      ctx.quadraticCurveTo(last.x, last.y, mx, my);
      ctx.stroke();
      last = p;
    }

    function end(){
      drawing = false;
      last = null;
      setStatus("Saved locally (not persisted)");
    }

    function clear(){
      const r = canvas.getBoundingClientRect();
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = currentCanvasBg();
      ctx.fillRect(0,0,r.width,r.height);
      ctx.restore();
      setStatus("Cleared");
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
      a.download = "drawing.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus("Downloaded PNG");
    }

    // Events
    canvas.addEventListener("pointerdown", (e)=>{ e.preventDefault(); start(e); });
    canvas.addEventListener("pointermove", (e)=>{ e.preventDefault(); move(e); });
    canvas.addEventListener("pointerup",   (e)=>{ e.preventDefault(); end(); });
    canvas.addEventListener("pointercancel",(e)=>{ e.preventDefault(); end(); });
    canvas.addEventListener("contextmenu",(e)=>e.preventDefault());

    penBtn.addEventListener("click", ()=>{ tool="pen"; setActive(); });
    eraseBtn.addEventListener("click", ()=>{ tool="eraser"; setActive(); });

    sizeEl.addEventListener("input", ()=>{ sizeVal.textContent = sizeEl.value; });

    clearBtn.addEventListener("click", clear);
    saveBtn.addEventListener("click", savePNG);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener){
      mq.addEventListener("change", () => {
        // recompute presets + apply ink contrast for new background
        renderSwatches();
        applyInk();
        resize();
        setStatus("Theme updated");
      });
    }

    window.addEventListener("resize", resize);

    // Init
    sizeVal.textContent = sizeEl.value;
    setActive();

    renderSwatches();
    applyInk();

    resize();
    setStatus("Ready");
  })();