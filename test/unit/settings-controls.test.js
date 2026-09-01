import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSegmentedControl,
  createSelectControl,
  createSettingsSwitch,
} from "../../src/shared/ui/settings-controls.js";

describe("shared settings controls", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app-persistent-layer"></div>';
    document.documentElement.removeAttribute("style");
  });

  it("keeps switch state synchronized without firing callbacks for programmatic updates", () => {
    const onChange = vi.fn();
    const control = createSettingsSwitch({
      label: "Alert audio",
      labelKey: "alertAudio",
      checked: false,
      onChange,
    });
    document.body.append(control.element);

    expect(control.input.getAttribute("role")).toBe("switch");
    expect(document.getElementById(control.input.getAttribute("aria-labelledby")).textContent).toBe("Alert audio");
    control.setChecked(true);
    expect(control.input.checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();

    control.input.click();
    expect(onChange).toHaveBeenCalledWith(false, expect.any(Event));
    control.setDisabled(true);
    expect(control.input.disabled).toBe(true);
    expect(control.element.classList.contains("is-disabled")).toBe(true);
    control.destroy();
    expect(control.element.isConnected).toBe(false);
  });

  it("implements radiogroup semantics and keyboard selection", () => {
    const onChange = vi.fn();
    const control = createSegmentedControl({
      label: "Distance unit",
      value: "km",
      options: [{ value: "km", label: "km" }, { value: "mi", label: "mi" }],
      onChange,
    });
    document.body.append(control.element);

    expect(control.group.getAttribute("role")).toBe("radiogroup");
    expect(control.buttons[0].getAttribute("aria-checked")).toBe("true");
    control.setValue("mi");
    expect(control.getValue()).toBe("mi");
    expect(onChange).not.toHaveBeenCalled();

    control.buttons[1].focus();
    control.buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(control.getValue()).toBe("km");
    expect(onChange).toHaveBeenCalledWith("km", expect.any(KeyboardEvent));
    control.destroy();
  });

  it("provides a custom, keyboard-operable, work-area-clamped listbox", () => {
    document.documentElement.style.setProperty("--vb-work-area-left", "10px");
    document.documentElement.style.setProperty("--vb-work-area-top", "20px");
    document.documentElement.style.setProperty("--vb-work-area-width", "300px");
    document.documentElement.style.setProperty("--vb-work-area-height", "220px");
    const onChange = vi.fn();
    const control = createSelectControl({
      label: "Speed limit",
      value: "20",
      options: [
        { value: "20", label: "20 km/h" },
        { value: "30", label: "30 km/h" },
        { value: "40", label: "40 km/h" },
      ],
      onChange,
    });
    document.body.append(control.element);
    vi.spyOn(control.trigger, "getBoundingClientRect").mockReturnValue({
      x: 220, y: 160, left: 220, top: 160, right: 340, bottom: 204,
      width: 120, height: 44, toJSON() {},
    });

    expect(control.trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(document.querySelector("select")).toBeNull();
    control.open();
    expect(control.menu.hidden).toBe(false);
    expect(control.menu.parentElement.id).toBe("app-persistent-layer");
    expect(Number.parseFloat(control.menu.style.left)).toBeGreaterThanOrEqual(10);
    expect(Number.parseFloat(control.menu.style.left) + Number.parseFloat(control.menu.style.width)).toBeLessThanOrEqual(310);
    expect(Number.parseFloat(control.menu.style.top)).toBeGreaterThanOrEqual(20);

    control.optionElements[0].focus();
    control.menu.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(control.optionElements.at(-1));
    document.activeElement.click();
    expect(control.getValue()).toBe("40");
    expect(onChange).toHaveBeenCalledWith("40", expect.any(Event));
    expect(document.activeElement).toBe(control.trigger);

    control.setOptions([{ value: "50", label: "50 km/h" }, { value: "60", label: "60 km/h" }]);
    expect(control.getValue()).toBe("50");
    expect(onChange).toHaveBeenCalledTimes(1);
    control.trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "6", bubbles: true }));
    expect(document.activeElement.textContent).toContain("60 km/h");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(control.menu.hidden).toBe(true);

    const menu = control.menu;
    control.destroy();
    expect(menu.isConnected).toBe(false);
    expect(control.element.isConnected).toBe(false);
  });
});
