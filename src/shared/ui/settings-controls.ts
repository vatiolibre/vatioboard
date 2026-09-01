import "./settings-controls.less";

import { SHELL_Z_INDEX } from "../shell-layers.js";

export interface SettingsControlOption {
  value: string;
  label: string;
  labelKey?: string;
  disabled?: boolean;
}

type ControlClassNames = {
  root?: string;
  input?: string;
  control?: string;
  option?: string;
};

type LabelOptions = {
  label: string;
  labelKey?: string;
  classNames?: ControlClassNames;
};

export interface SettingsSwitchOptions extends LabelOptions {
  checked?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean, event: Event) => void;
}

export interface SettingsSwitchController {
  element: HTMLLabelElement;
  input: HTMLInputElement;
  focus(): void;
  setChecked(checked: boolean): void;
  setDisabled(disabled: boolean): void;
  setLabel(label: string, labelKey?: string): void;
  destroy(): void;
}

export interface SegmentedControlOptions extends LabelOptions {
  value: string;
  options: SettingsControlOption[];
  disabled?: boolean;
  optionDataAttribute?: string;
  onChange?: (value: string, event: Event) => void;
}

export interface SegmentedControlController {
  element: HTMLDivElement;
  group: HTMLDivElement;
  readonly buttons: HTMLButtonElement[];
  focus(): void;
  getValue(): string;
  setValue(value: string): void;
  setDisabled(disabled: boolean): void;
  setLabel(label: string, labelKey?: string): void;
  destroy(): void;
}

export interface SelectControlOptions extends LabelOptions {
  value: string;
  options: SettingsControlOption[];
  disabled?: boolean;
  popupMount?: HTMLElement | null;
  onChange?: (value: string, event: Event) => void;
}

export interface SelectControlController {
  element: HTMLDivElement;
  trigger: HTMLButtonElement;
  menu: HTMLDivElement;
  readonly optionElements: HTMLButtonElement[];
  focus(): void;
  getValue(): string;
  isOpen(): boolean;
  open(): void;
  close(options?: { restoreFocus?: boolean }): void;
  setValue(value: string): void;
  setOptions(options: SettingsControlOption[]): void;
  setDisabled(disabled: boolean): void;
  setLabel(label: string, labelKey?: string): void;
  destroy(): void;
}

let nextControlId = 0;

function joinClasses(...values: Array<string | null | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

function setTranslatedText(element: HTMLElement, label: string, labelKey?: string) {
  element.textContent = label;
  if (labelKey) element.dataset.i18n = labelKey;
  else delete element.dataset.i18n;
}

function createControlLabel(label: string, labelKey: string | undefined, id: string) {
  const element = document.createElement("span");
  element.id = id;
  element.className = "vb-settings-control-label";
  setTranslatedText(element, label, labelKey);
  return element;
}

function setDataAttribute(element: HTMLElement, name: string | undefined, value: string) {
  if (!name) return;
  element.setAttribute(`data-${name}`, value);
}

export function createSettingsSwitch(options: SettingsSwitchOptions): SettingsSwitchController {
  const id = `vb-settings-switch-${++nextControlId}`;
  const element = document.createElement("label");
  element.className = joinClasses("vb-settings-control", "vb-settings-switch-row", options.classNames?.root);
  const label = createControlLabel(options.label, options.labelKey, `${id}-label`);
  const track = document.createElement("span");
  track.className = joinClasses("vb-settings-switch", options.classNames?.control);
  const input = document.createElement("input");
  input.type = "checkbox";
  input.role = "switch";
  input.className = joinClasses("vb-settings-switch-input", options.classNames?.input);
  input.checked = Boolean(options.checked);
  input.disabled = Boolean(options.disabled);
  input.setAttribute("aria-labelledby", label.id);
  const thumb = document.createElement("span");
  thumb.className = "vb-settings-switch-thumb";
  thumb.setAttribute("aria-hidden", "true");
  track.append(input, thumb);
  element.append(label, track);
  element.classList.toggle("is-disabled", input.disabled);

  const handleChange = (event: Event) => options.onChange?.(input.checked, event);
  input.addEventListener("change", handleChange);

  return {
    element,
    input,
    focus: () => input.focus(),
    setChecked(checked) {
      input.checked = Boolean(checked);
    },
    setDisabled(disabled) {
      input.disabled = Boolean(disabled);
      element.classList.toggle("is-disabled", input.disabled);
    },
    setLabel(nextLabel, labelKey) {
      setTranslatedText(label, nextLabel, labelKey);
    },
    destroy() {
      input.removeEventListener("change", handleChange);
      element.remove();
    },
  };
}

export function createSegmentedControl(options: SegmentedControlOptions): SegmentedControlController {
  const id = `vb-settings-segmented-${++nextControlId}`;
  const element = document.createElement("div");
  element.className = joinClasses("vb-settings-control", "vb-settings-segmented-row", options.classNames?.root);
  const label = createControlLabel(options.label, options.labelKey, `${id}-label`);
  const group = document.createElement("div");
  group.className = joinClasses("vb-settings-segmented", options.classNames?.control);
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-labelledby", label.id);
  let currentValue = String(options.value);
  let disabled = Boolean(options.disabled);
  const buttons: HTMLButtonElement[] = [];

  const update = () => {
    for (const button of buttons) {
      const active = button.dataset.value === currentValue;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
      button.tabIndex = active ? 0 : -1;
      button.disabled = disabled || button.dataset.optionDisabled === "true";
    }
  };

  const selectButton = (button: HTMLButtonElement, event: Event) => {
    if (button.disabled) return;
    const nextValue = button.dataset.value || "";
    const changed = currentValue !== nextValue;
    currentValue = nextValue;
    update();
    if (changed) options.onChange?.(currentValue, event);
  };

  for (const option of options.options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = joinClasses("vb-settings-segmented-option", options.classNames?.option);
    button.setAttribute("role", "radio");
    button.dataset.value = String(option.value);
    button.dataset.optionDisabled = String(Boolean(option.disabled));
    setDataAttribute(button, options.optionDataAttribute, String(option.value));
    setTranslatedText(button, option.label, option.labelKey);
    buttons.push(button);
    group.append(button);
  }

  const moveFocus = (direction: number, event: KeyboardEvent) => {
    const enabled = buttons.filter((button) => !button.disabled);
    if (!enabled.length) return;
    const activeIndex = Math.max(0, enabled.indexOf(document.activeElement as HTMLButtonElement));
    const next = enabled[(activeIndex + direction + enabled.length) % enabled.length];
    event.preventDefault();
    next.focus();
    selectButton(next, event);
  };
  const handleClick = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(".vb-settings-segmented-option");
    if (button && group.contains(button)) selectButton(button, event);
  };
  const handleKeydown = (event: KeyboardEvent) => {
    if (["ArrowRight", "ArrowDown"].includes(event.key)) moveFocus(1, event);
    else if (["ArrowLeft", "ArrowUp"].includes(event.key)) moveFocus(-1, event);
    else if (event.key === "Home" || event.key === "End") {
      const enabled = buttons.filter((button) => !button.disabled);
      const next = event.key === "Home" ? enabled[0] : enabled.at(-1);
      if (!next) return;
      event.preventDefault();
      next.focus();
      selectButton(next, event);
    }
  };
  group.addEventListener("click", handleClick);
  group.addEventListener("keydown", handleKeydown);
  element.append(label, group);
  element.classList.toggle("is-disabled", disabled);
  update();

  return {
    element,
    group,
    buttons,
    focus() {
      (buttons.find((button) => button.dataset.value === currentValue && !button.disabled)
        || buttons.find((button) => !button.disabled))?.focus();
    },
    getValue: () => currentValue,
    setValue(value) {
      if (buttons.some((button) => button.dataset.value === String(value))) currentValue = String(value);
      update();
    },
    setDisabled(nextDisabled) {
      disabled = Boolean(nextDisabled);
      element.classList.toggle("is-disabled", disabled);
      update();
    },
    setLabel(nextLabel, labelKey) {
      setTranslatedText(label, nextLabel, labelKey);
    },
    destroy() {
      group.removeEventListener("click", handleClick);
      group.removeEventListener("keydown", handleKeydown);
      element.remove();
    },
  };
}

function getPopupMount(owner: HTMLElement, requested?: HTMLElement | null) {
  return requested
    || owner.ownerDocument.getElementById("app-persistent-layer")
    || owner.ownerDocument.body;
}

function readWorkArea(doc: Document) {
  const style = getComputedStyle(doc.documentElement);
  const number = (name: string, fallback: number, allowZero = false) => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) ? value : fallback;
  };
  const viewport = doc.defaultView?.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportWidth = viewport?.width || doc.documentElement.clientWidth || globalThis.innerWidth || 1024;
  const viewportHeight = viewport?.height || doc.documentElement.clientHeight || globalThis.innerHeight || 768;
  return {
    left: number("--vb-work-area-left", viewportLeft, true),
    top: number("--vb-work-area-top", viewportTop, true),
    width: number("--vb-work-area-width", Math.max(1, viewportWidth - 16)),
    height: number("--vb-work-area-height", Math.max(1, viewportHeight - 16)),
  };
}

export function createSelectControl(options: SelectControlOptions): SelectControlController {
  const id = `vb-settings-select-${++nextControlId}`;
  const element = document.createElement("div");
  element.className = joinClasses("vb-settings-control", "vb-settings-select-row", options.classNames?.root);
  const label = createControlLabel(options.label, options.labelKey, `${id}-label`);
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = `${id}-trigger`;
  trigger.className = joinClasses("vb-settings-select-trigger", options.classNames?.control);
  trigger.setAttribute("aria-labelledby", `${label.id} ${id}-value`);
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", `${id}-menu`);
  const valueLabel = document.createElement("span");
  valueLabel.id = `${id}-value`;
  valueLabel.className = "vb-settings-select-value";
  const chevron = document.createElement("span");
  chevron.className = "vb-settings-select-chevron";
  chevron.setAttribute("aria-hidden", "true");
  trigger.append(valueLabel, chevron);
  element.append(label, trigger);

  const menu = document.createElement("div");
  menu.id = `${id}-menu`;
  menu.className = joinClasses("vb-settings-select-menu", options.classNames?.option ? `${options.classNames.option}-menu` : "");
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-labelledby", label.id);
  menu.hidden = true;
  menu.style.zIndex = String(SHELL_Z_INDEX.popover);
  getPopupMount(element, options.popupMount).append(menu);

  let currentValue = String(options.value);
  let currentOptions = [...options.options];
  let disabled = Boolean(options.disabled);
  let destroyed = false;
  let typeahead = "";
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  const getOptionElements = () => Array.from(menu.querySelectorAll<HTMLButtonElement>(".vb-settings-select-option"));
  const getSelectedOption = () => currentOptions.find((option) => String(option.value) === currentValue);
  const updateSelection = () => {
    const selected = getSelectedOption() || currentOptions.find((option) => !option.disabled) || currentOptions[0];
    if (selected) currentValue = String(selected.value);
    setTranslatedText(valueLabel, selected?.label || "—", selected?.labelKey);
    for (const option of getOptionElements()) {
      const active = option.dataset.value === currentValue;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", String(active));
      option.tabIndex = active ? 0 : -1;
    }
  };
  const buildOptions = () => {
    const fragment = document.createDocumentFragment();
    for (const option of currentOptions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = joinClasses("vb-settings-select-option", options.classNames?.option);
      button.setAttribute("role", "option");
      button.dataset.value = String(option.value);
      button.disabled = Boolean(option.disabled);
      setTranslatedText(button, option.label, option.labelKey);
      fragment.append(button);
    }
    menu.replaceChildren(fragment);
    updateSelection();
  };
  const positionMenu = () => {
    if (menu.hidden || destroyed) return;
    const area = readWorkArea(element.ownerDocument);
    const anchor = trigger.getBoundingClientRect();
    const gap = 6;
    const below = Math.max(0, area.top + area.height - anchor.bottom - gap);
    const above = Math.max(0, anchor.top - area.top - gap);
    const placeBelow = below >= Math.min(176, menu.scrollHeight) || below >= above;
    const maxHeight = Math.max(44, Math.min(320, placeBelow ? below : above, area.height));
    const width = Math.min(area.width, Math.max(anchor.width, 180));
    menu.style.width = `${Math.round(width)}px`;
    menu.style.maxHeight = `${Math.floor(maxHeight)}px`;
    const measuredHeight = Math.min(menu.scrollHeight, maxHeight);
    const left = Math.min(Math.max(anchor.left, area.left), area.left + area.width - width);
    const top = placeBelow
      ? Math.min(anchor.bottom + gap, area.top + area.height - measuredHeight)
      : Math.max(area.top, anchor.top - gap - measuredHeight);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.visibility = "visible";
  };
  const focusSelected = (fallback: "first" | "last" = "first") => {
    const enabled = getOptionElements().filter((option) => !option.disabled);
    const fallbackOption = fallback === "last" ? enabled.at(-1) : enabled[0];
    (enabled.find((option) => option.dataset.value === currentValue) || fallbackOption)?.focus();
  };
  const syncPopupTheme = () => {
    const style = getComputedStyle(element);
    for (const property of [
      "--vb-settings-accent",
      "--vb-settings-surface",
      "--vb-settings-control-bg",
      "--vb-settings-border",
      "--vb-settings-text",
      "--vb-settings-muted",
    ]) {
      const value = style.getPropertyValue(property).trim();
      if (value) menu.style.setProperty(property, value);
    }
  };
  const open = () => {
    if (disabled || trigger.disabled || destroyed || !currentOptions.length) return;
    menu.hidden = false;
    menu.style.visibility = "hidden";
    trigger.setAttribute("aria-expanded", "true");
    element.classList.add("is-open");
    syncPopupTheme();
    positionMenu();
    focusSelected();
  };
  const close = ({ restoreFocus = false } = {}) => {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.style.visibility = "hidden";
    trigger.setAttribute("aria-expanded", "false");
    element.classList.remove("is-open");
    if (restoreFocus) trigger.focus({ preventScroll: true });
  };
  const selectOption = (button: HTMLButtonElement, event: Event) => {
    if (button.disabled) return;
    const nextValue = button.dataset.value || "";
    const changed = nextValue !== currentValue;
    currentValue = nextValue;
    updateSelection();
    close({ restoreFocus: true });
    if (changed) options.onChange?.(currentValue, event);
  };
  const moveOptionFocus = (direction: number, event: KeyboardEvent) => {
    const enabled = getOptionElements().filter((option) => !option.disabled);
    if (!enabled.length) return;
    const currentIndex = Math.max(0, enabled.indexOf(document.activeElement as HTMLButtonElement));
    event.preventDefault();
    enabled[(currentIndex + direction + enabled.length) % enabled.length]?.focus();
  };
  const handleTypeahead = (event: KeyboardEvent) => {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return false;
    typeahead += event.key.toLocaleLowerCase();
    if (typeaheadTimer) globalThis.clearTimeout(typeaheadTimer);
    typeaheadTimer = globalThis.setTimeout(() => { typeahead = ""; }, 500);
    const match = getOptionElements().find((option) => (
      !option.disabled && option.textContent?.trim().toLocaleLowerCase().startsWith(typeahead)
    ));
    if (!match) return false;
    event.preventDefault();
    if (menu.hidden) open();
    match.focus();
    return true;
  };
  const handleTriggerClick = () => (menu.hidden ? open() : close({ restoreFocus: true }));
  const handleTriggerKeydown = (event: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      open();
      if (event.key === "ArrowUp") focusSelected("last");
    } else if (event.key === "Escape") close({ restoreFocus: true });
    else handleTypeahead(event);
  };
  const handleMenuClick = (event: MouseEvent) => {
    const option = (event.target as Element | null)?.closest<HTMLButtonElement>(".vb-settings-select-option");
    if (option && menu.contains(option)) selectOption(option, event);
  };
  const handleMenuKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
    } else if (event.key === "Tab") close();
    else if (event.key === "ArrowDown") moveOptionFocus(1, event);
    else if (event.key === "ArrowUp") moveOptionFocus(-1, event);
    else if (event.key === "Home" || event.key === "End") {
      const enabled = getOptionElements().filter((option) => !option.disabled);
      const next = event.key === "Home" ? enabled[0] : enabled.at(-1);
      if (next) {
        event.preventDefault();
        next.focus();
      }
    } else if (["Enter", " "].includes(event.key)) {
      const option = (event.target as Element | null)?.closest<HTMLButtonElement>(".vb-settings-select-option");
      if (option) {
        event.preventDefault();
        selectOption(option, event);
      }
    } else handleTypeahead(event);
  };
  const handleDocumentPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (!menu.hidden && target && !element.contains(target) && !menu.contains(target)) close();
  };
  const handleViewportChange = () => positionMenu();

  trigger.addEventListener("click", handleTriggerClick);
  trigger.addEventListener("keydown", handleTriggerKeydown);
  menu.addEventListener("click", handleMenuClick);
  menu.addEventListener("keydown", handleMenuKeydown);
  element.ownerDocument.addEventListener("pointerdown", handleDocumentPointerDown, true);
  globalThis.addEventListener?.("resize", handleViewportChange);
  globalThis.addEventListener?.("orientationchange", handleViewportChange);
  globalThis.addEventListener?.("scroll", handleViewportChange, true);
  globalThis.visualViewport?.addEventListener?.("resize", handleViewportChange);
  globalThis.visualViewport?.addEventListener?.("scroll", handleViewportChange);
  buildOptions();
  trigger.disabled = disabled;
  element.classList.toggle("is-disabled", disabled);

  element.ownerDocument.addEventListener("pointermove", handleViewportChange, true);
  element.ownerDocument.addEventListener("vatioboard:shell-work-area-reflowed", handleViewportChange);
  element.ownerDocument.addEventListener("vatioboard:shell-window-layout-changed", handleViewportChange);

  return {
    element,
    trigger,
    menu,
    get optionElements() {
      return getOptionElements();
    },
    focus: () => trigger.focus(),
    getValue: () => currentValue,
    isOpen: () => !menu.hidden,
    open,
    close,
    setValue(value) {
      if (currentOptions.some((option) => String(option.value) === String(value))) currentValue = String(value);
      updateSelection();
    },
    setOptions(nextOptions) {
      currentOptions = [...nextOptions];
      buildOptions();
      if (!menu.hidden) positionMenu();
    },
    setDisabled(nextDisabled) {
      disabled = Boolean(nextDisabled);
      trigger.disabled = disabled;
      element.classList.toggle("is-disabled", disabled);
      if (disabled) close();
    },
    setLabel(nextLabel, labelKey) {
      setTranslatedText(label, nextLabel, labelKey);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (typeaheadTimer) globalThis.clearTimeout(typeaheadTimer);
      trigger.removeEventListener("click", handleTriggerClick);
      trigger.removeEventListener("keydown", handleTriggerKeydown);
      menu.removeEventListener("click", handleMenuClick);
      menu.removeEventListener("keydown", handleMenuKeydown);
      element.ownerDocument.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      element.ownerDocument.removeEventListener("pointermove", handleViewportChange, true);
      element.ownerDocument.removeEventListener("vatioboard:shell-work-area-reflowed", handleViewportChange);
      element.ownerDocument.removeEventListener("vatioboard:shell-window-layout-changed", handleViewportChange);
      globalThis.removeEventListener?.("resize", handleViewportChange);
      globalThis.removeEventListener?.("orientationchange", handleViewportChange);
      globalThis.removeEventListener?.("scroll", handleViewportChange, true);
      globalThis.visualViewport?.removeEventListener?.("resize", handleViewportChange);
      globalThis.visualViewport?.removeEventListener?.("scroll", handleViewportChange);
      menu.remove();
      element.remove();
    },
  };
}
