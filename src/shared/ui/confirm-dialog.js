/**
 * Reusable premium confirmation dialog.
 *
 * Accessible (role=alertdialog, aria-modal, focus trap, ESC, backdrop-click),
 * touch-first, mobile-friendly (bottom-sheet on small viewport, centered card on large),
 * and framework-free.
 *
 * @example
 *   const confirmed = await showConfirmDialog({
 *     title: 'Delete document?',
 *     message: 'This action cannot be undone.',
 *     confirmLabel: 'Delete',
 *     cancelLabel: 'Cancel',
 *     destructive: true,
 *   });
 */

const DIALOG_CLASS = "vb-confirm-dialog";
const BACKDROP_CLASS = "vb-confirm-backdrop";
const CARD_CLASS = "vb-confirm-card";

let activeDialog = null;

function createEl(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") {
      el.className = value;
    } else if (key === "textContent") {
      el.textContent = value;
    } else if (key === "innerHTML") {
      el.innerHTML = value;
    } else {
      el.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (typeof child === "string") {
      el.appendChild(document.createTextNode(child));
    } else if (child) {
      el.appendChild(child);
    }
  }
  return el;
}

function getFocusableElements(container) {
  return Array.from(
    container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
}

function trapFocus(container, event) {
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * @param {Object} options
 * @param {string}  options.title          - Dialog title
 * @param {string}  options.message        - Primary body text
 * @param {string}  [options.description]  - Secondary descriptive text
 * @param {string}  [options.confirmLabel] - Confirm button label (default: "Confirm")
 * @param {string}  [options.cancelLabel]  - Cancel button label (default: "Cancel")
 * @param {boolean} [options.destructive]  - Red/destructive visual variant
 * @param {string}  [options.icon]         - SVG icon HTML string
 * @returns {Promise<boolean>} true if confirmed, false if cancelled
 */
export function showConfirmDialog({
  title = "",
  message = "",
  description = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  icon = "",
} = {}) {
  // Dismiss any existing dialog first
  if (activeDialog) {
    activeDialog.dismiss(false);
  }

  return new Promise((resolve) => {
    const triggerElement = document.activeElement;

    // Build DOM
    const backdrop = createEl("div", {
      className: `${BACKDROP_CLASS}${destructive ? ` ${BACKDROP_CLASS}--destructive` : ""}`,
    });

    const card = createEl("div", {
      className: `${CARD_CLASS}${destructive ? ` ${CARD_CLASS}--destructive` : ""}`,
      role: "alertdialog",
      "aria-modal": "true",
      "aria-labelledby": "vb-confirm-title",
      "aria-describedby": "vb-confirm-message",
    });

    if (icon) {
      const iconEl = createEl("div", {
        className: "vb-confirm-icon",
        innerHTML: icon,
        "aria-hidden": "true",
      });
      card.appendChild(iconEl);
    }

    const titleEl = createEl("h2", {
      id: "vb-confirm-title",
      className: "vb-confirm-title",
      textContent: title,
    });
    card.appendChild(titleEl);

    if (message) {
      const messageEl = createEl("p", {
        id: "vb-confirm-message",
        className: "vb-confirm-message",
        textContent: message,
      });
      card.appendChild(messageEl);
    }

    if (description) {
      const descEl = createEl("p", {
        className: "vb-confirm-description",
        textContent: description,
      });
      card.appendChild(descEl);
    }

    const actions = createEl("div", { className: "vb-confirm-actions" });

    const cancelBtn = createEl("button", {
      type: "button",
      className: "vb-confirm-btn vb-confirm-btn--cancel",
      textContent: cancelLabel,
    });

    const confirmBtn = createEl("button", {
      type: "button",
      className: `vb-confirm-btn vb-confirm-btn--confirm${destructive ? " vb-confirm-btn--destructive" : ""}`,
      textContent: confirmLabel,
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    card.appendChild(actions);
    backdrop.appendChild(card);

    let resolved = false;

    function dismiss(result) {
      if (resolved) return;
      resolved = true;

      backdrop.classList.add("vb-confirm-exiting");
      card.classList.add("vb-confirm-exiting");

      const cleanup = () => {
        backdrop.remove();
        if (activeDialog?.backdrop === backdrop) {
          activeDialog = null;
        }
        // Restore focus to trigger element
        try {
          triggerElement?.focus?.();
        } catch {
          // Safe to ignore if element is gone.
        }
        resolve(result);
      };

      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (prefersReducedMotion) {
        cleanup();
      } else {
        backdrop.addEventListener("animationend", cleanup, { once: true });
        // Fallback in case animation doesn't fire
        setTimeout(cleanup, 300);
      }
    }

    confirmBtn.addEventListener("click", () => dismiss(true));
    cancelBtn.addEventListener("click", () => dismiss(false));

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) dismiss(false);
    });

    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss(false);
      }
      if (e.key === "Tab") {
        trapFocus(card, e);
      }
    });

    document.body.appendChild(backdrop);
    activeDialog = { backdrop, dismiss };

    // Entrance animation trigger
    requestAnimationFrame(() => {
      backdrop.classList.add("vb-confirm-entering");
      card.classList.add("vb-confirm-entering");
      // Focus confirm button for destructive, cancel for neutral
      const initialFocus = destructive ? cancelBtn : confirmBtn;
      initialFocus.focus();
    });
  });
}

/**
 * Prompt the user for a text value.
 *
 * @param {Object} options
 * @param {string}  options.title         - Dialog title
 * @param {string}  [options.message]     - Descriptive text
 * @param {string}  [options.placeholder] - Input placeholder
 * @param {string}  [options.value]       - Initial input value
 * @param {string}  [options.confirmLabel]
 * @param {string}  [options.cancelLabel]
 * @returns {Promise<string|null>} The entered string, or null if cancelled
 */
export function showPromptDialog({
  title = "",
  message = "",
  placeholder = "",
  value = "",
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  inputLabel = "",
  maxLength = null,
} = {}) {
  if (activeDialog) {
    activeDialog.dismiss(false);
  }

  return new Promise((resolve) => {
    const triggerElement = document.activeElement;

    const backdrop = createEl("div", {
      className: BACKDROP_CLASS,
    });

    const card = createEl("div", {
      className: CARD_CLASS,
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "vb-prompt-title",
    });

    const titleEl = createEl("h2", {
      id: "vb-prompt-title",
      className: "vb-confirm-title",
      textContent: title,
    });
    card.appendChild(titleEl);

    if (message) {
      const messageEl = createEl("p", {
        className: "vb-confirm-message",
        textContent: message,
      });
      card.appendChild(messageEl);
    }

    const input = createEl("input", {
      type: "text",
      className: "vb-confirm-input",
      placeholder,
      value,
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": inputLabel || placeholder || title || confirmLabel,
    });
    if (Number.isFinite(maxLength) && maxLength > 0) {
      input.maxLength = maxLength;
    }
    card.appendChild(input);

    const actions = createEl("div", { className: "vb-confirm-actions" });

    const cancelBtn = createEl("button", {
      type: "button",
      className: "vb-confirm-btn vb-confirm-btn--cancel",
      textContent: cancelLabel,
    });

    const confirmBtn = createEl("button", {
      type: "button",
      className: "vb-confirm-btn vb-confirm-btn--confirm",
      textContent: confirmLabel,
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    card.appendChild(actions);
    backdrop.appendChild(card);

    let resolved = false;

    function dismiss(result) {
      if (resolved) return;
      resolved = true;

      backdrop.classList.add("vb-confirm-exiting");
      card.classList.add("vb-confirm-exiting");

      const cleanup = () => {
        backdrop.remove();
        if (activeDialog?.backdrop === backdrop) {
          activeDialog = null;
        }
        try {
          triggerElement?.focus?.();
        } catch {
          // Safe to ignore.
        }
        resolve(result);
      };

      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (prefersReducedMotion) {
        cleanup();
      } else {
        backdrop.addEventListener("animationend", cleanup, { once: true });
        setTimeout(cleanup, 300);
      }
    }

    function submit() {
      const trimmed = input.value.trim();
      if (trimmed) {
        dismiss(trimmed);
      } else {
        input.focus();
      }
    }

    function syncSubmitState() {
      confirmBtn.disabled = input.value.trim().length === 0;
    }

    confirmBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", () => dismiss(null));
    input.addEventListener("input", syncSubmitState);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) dismiss(null);
    });

    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss(null);
      }
      if (e.key === "Tab") {
        trapFocus(card, e);
      }
    });

    document.body.appendChild(backdrop);
    activeDialog = { backdrop, dismiss };
    syncSubmitState();

    requestAnimationFrame(() => {
      backdrop.classList.add("vb-confirm-entering");
      card.classList.add("vb-confirm-entering");
      input.focus();
      input.select();
    });
  });
}
