import { el } from "../dom.js";
import { toDisplay } from "./number-format.js";

const HISTORY_RESULT_MAX_LEN = 10;

function formatHistoryResult(value, settings, maxLen = HISTORY_RESULT_MAX_LEN) {
  const formatted = toDisplay(value, settings);
  if (formatted.length <= maxLen) return formatted;
  return formatted.slice(0, maxLen);
}

export function initHistorySheet({
  panel,
  core,
  historySheet,
  historyBtn,
  historyList,
  historyClearBtn,
  historyCloseBtn,
  render,
  settings,
  onOpen,
  t,
  loadHistory,
  clearHistory,
}) {
  const setHistorySheetOpen = (isOpen) => {
    if (isOpen) {
      renderHistoryList();
      historySheet.hidden = false;
      historySheet.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => historySheet.classList.add("is-open"));
      onOpen?.();
      return;
    }

    historySheet.classList.remove("is-open");
    historySheet.setAttribute("aria-hidden", "true");
  };

  historySheet.addEventListener("transitionend", (e) => {
    if (e.propertyName !== "transform") return;
    if (!historySheet.classList.contains("is-open")) {
      historySheet.hidden = true;
    }
  });

  function renderHistoryList() {
    const history = loadHistory();
    historyList.innerHTML = "";
    if (history.length === 0) {
      historyList.appendChild(
        el("div", { class: "calc-history-empty" }, t("noHistory"))
      );
      return;
    }

    for (const item of history) {
      const row = el(
        "button",
        { class: "calc-history-item", type: "button" },
        el("span", { class: "calc-history-item-expr" }, toDisplay(item.expr, settings)),
        el(
          "span",
          { class: "calc-history-item-result" },
          formatHistoryResult(item.result, settings)
        )
      );

      row.addEventListener("click", () => {
        core.setExpr(item.result);
        core.status = item.expr;
        render();
        setHistorySheetOpen(false);
      });

      historyList.appendChild(row);
    }
  }

  historyBtn.addEventListener("click", () => {
    setHistorySheetOpen(!historySheet.classList.contains("is-open"));
  });

  historyClearBtn.addEventListener("click", () => {
    clearHistory();
    renderHistoryList();
  });

  historyCloseBtn.addEventListener("click", () => {
    setHistorySheetOpen(false);
  });

  panel.addEventListener("click", (e) => {
    if (!historySheet.classList.contains("is-open")) return;
    if (!historySheet.contains(e.target) && !historyBtn.contains(e.target)) {
      setHistorySheetOpen(false);
    }
  });

  return { setHistorySheetOpen, refreshHistoryList: renderHistoryList };
}
