import { createLegacyView } from "./legacy-view.js";

const boardHtml = `<!doctype html>
<html lang="en">
<head>
  <title>Vatio Board - Free Drawing Board + Calculator</title>
  <meta
    name="description"
    content="Vatio Board is a fast, full-screen drawing board that works great in Tesla browsers. Draw with pen or eraser, adjust brush size, and save private drawings to VatioLibre."
  />
</head>
<body>
  <h1 class="sr-only">Vatio Board drawing board</h1>
  <p class="sr-only">
    Full-screen drawing board optimized for touch and in-car browsers.
  </p>

  <div class="app">
    <header>
      <div class="header-inner">
        <div class="brand" data-i18n-title="tagline" title="Simple full-page drawing board by Vatio Libre">
          <span class="dot" aria-hidden="true"></span>
          <picture class="brand-logo" aria-hidden="true">
            <source srcset="/img/vb_logo_dark.svg" media="(prefers-color-scheme: dark)" />
            <source srcset="/img/vb_logo_light.svg" media="(prefers-color-scheme: light)" />
            <img src="/img/vb_logo_light.svg" alt="" width="757" height="107" decoding="async" />
          </picture>
          <span class="sr-only" data-i18n="brand">Vatio Board</span>
          <button id="langToggle" type="button" class="lang-toggle" aria-label="Change language">EN</button>
        </div>

        <div class="toolbar" role="toolbar" aria-label="Drawing tools">
          <div class="board-action-strip">
            <div class="tools-menu board-tools-menu">
              <button
                id="toolsMenuBtn"
                type="button"
                class="tools-menu-btn board-action-btn board-action-btn-tools"
                data-i18n-aria="pages"
                data-i18n-title="pages"
                aria-label="Pages"
                title="Pages"
                aria-haspopup="true"
                aria-expanded="false"
              >
                <span class="btn-icon" aria-hidden="true"></span>
              </button>
              <div id="toolsMenuList" class="tools-menu-list" hidden>
                <div class="board-tools-menu-brand" data-i18n-title="tagline" title="Simple full-page drawing board by Vatio Libre">
                  <span class="dot" aria-hidden="true"></span>
                  <picture class="brand-logo board-tools-menu-logo" aria-hidden="true">
                    <source srcset="/img/vb_logo_dark.svg" media="(prefers-color-scheme: dark)" />
                    <source srcset="/img/vb_logo_light.svg" media="(prefers-color-scheme: light)" />
                    <img src="/img/vb_logo_light.svg" alt="" width="757" height="107" decoding="async" />
                  </picture>
                  <span class="sr-only" data-i18n="brand">Vatio Board</span>
                  <button id="langToggleMenu" type="button" class="lang-toggle" aria-label="Change language" data-lang-toggle>EN</button>
                </div>
                <button id="openAccelMenu" type="button" class="btn-with-icon">
                  <span class="btn-icon" aria-hidden="true"></span>
                  <span data-i18n="accelerationTest">Acceleration Test</span>
                </button>
                <button id="openLibraryMenu" type="button" class="btn-with-icon">
                  <span class="btn-icon" aria-hidden="true"></span>
                  <span data-i18n="cloudLibrary">Cloud library</span>
                </button>
                <button id="openSpeedMenu" type="button" class="btn-with-icon">
                  <span class="btn-icon" aria-hidden="true"></span>
                  <span data-i18n="speedometer">Speedometer</span>
                </button>
                <button id="openCalcMenu" type="button" class="btn-with-icon">
                  <span class="btn-icon" aria-hidden="true"></span>
                  <span data-i18n="calculator">Calculator</span>
                </button>
                <form class="backend-auth" data-backend-auth novalidate>
                  <p class="backend-auth-title" data-i18n="authTitle">VatioLibre account</p>
                  <p class="backend-auth-status" data-backend-auth-status role="status" aria-live="polite" data-i18n="authCheckingSession">Checking session...</p>
                  <input
                    class="backend-auth-input"
                    data-backend-auth-user
                    data-backend-auth-guest
                    type="text"
                    autocomplete="username"
                    spellcheck="false"
                    aria-label="Email / username"
                    data-i18n-aria="authUsername"
                    placeholder="Email / username"
                    data-i18n-placeholder="authUsername"
                  />
                  <input
                    class="backend-auth-input"
                    data-backend-auth-password
                    data-backend-auth-guest
                    type="password"
                    autocomplete="current-password"
                    aria-label="Password"
                    data-i18n-aria="authPassword"
                    placeholder="Password"
                    data-i18n-placeholder="authPassword"
                  />
                  <button type="submit" data-backend-auth-login data-backend-auth-guest data-i18n="authLogin">Log in</button>
                  <button type="button" data-backend-auth-logout data-backend-auth-authenticated data-i18n="authLogout">Log out</button>
                  <a
                    class="backend-auth-link"
                    data-backend-auth-guest
                    data-backend-auth-signup
                    href="https://www.vatiolibre.com/login#signup"
                    rel="noreferrer"
                    data-i18n="authCreateAccount"
                  >Create account</a>
                  <a
                    class="backend-auth-link"
                    data-backend-auth-guest
                    data-backend-auth-forgot
                    href="https://www.vatiolibre.com/login#forgot"
                    rel="noreferrer"
                    data-i18n="authForgotPassword"
                  >Forgot password</a>
                </form>
              </div>
            </div>
            <button
              id="createNew"
              type="button"
              class="board-action-btn board-action-btn-create"
              data-i18n-aria="createNew"
              data-i18n-title="createNew"
              aria-label="Create new"
              title="Create new"
            >
              <span class="btn-icon" aria-hidden="true"></span>
            </button>
            <button
              id="save"
              type="button"
              class="board-action-btn board-action-btn-save"
              data-i18n-aria="saveBoardTooltip"
              data-i18n-title="saveBoardTooltip"
              aria-label="Save board document"
              title="Save board document"
            >
              <span class="btn-icon" aria-hidden="true"></span>
            </button>
            <button
              id="deleteBoard"
              type="button"
              class="board-action-btn board-action-btn-delete"
              data-i18n-aria="deleteBoardTooltip"
              data-i18n-title="deleteBoardTooltip"
              aria-label="Delete board document"
              title="Delete board document"
            >
              <span class="btn-icon" aria-hidden="true"></span>
            </button>
            <button
              id="undo"
              type="button"
              class="board-action-btn board-action-btn-undo"
              data-i18n-aria="undo"
              data-i18n-title="undo"
              aria-label="Undo"
              title="Undo"
              disabled
            >
              <span class="btn-icon" aria-hidden="true"></span>
            </button>
            <button
              id="redo"
              type="button"
              class="board-action-btn board-action-btn-redo"
              data-i18n-aria="redo"
              data-i18n-title="redo"
              aria-label="Redo"
              title="Redo"
              disabled
            >
              <span class="btn-icon" aria-hidden="true"></span>
            </button>
            <button
              id="erase"
              type="button"
              class="board-action-btn board-action-btn-erase"
              aria-pressed="false"
              data-i18n-aria="eraser"
              data-i18n-title="eraser"
              aria-label="Eraser"
              title="Eraser"
            >
              <span class="btn-icon" aria-hidden="true"></span>
            </button>
            <button
              id="pen"
              type="button"
              class="board-action-btn board-action-btn-pen"
              aria-pressed="true"
              data-i18n-aria="pen"
              data-i18n-title="pen"
              aria-label="Pen"
              title="Pen"
            >
              <span class="btn-icon" aria-hidden="true"></span>
            </button>
          </div>

          <div class="size-label">
            <button
              id="sizePreview"
              type="button"
              class="size-preview"
              data-i18n-aria="moreColors"
              aria-label="More colors"
              title="More colors"
            >
              <span class="size-preview-stroke"></span>
            </button>
            <input id="size" type="range" min="2" max="22" value="6" data-i18n-aria="size" aria-label="Size" />
            <div id="swatches" class="swatches" data-i18n-aria="presetColors" aria-label="Preset colors"></div>
          </div>

          <div id="colorPopup" class="color-popup" hidden>
            <div class="color-popup-card">
              <div id="iroPicker" class="iro-picker" aria-label="Color picker"></div>
              <div class="color-popup-row">
                <span data-i18n="hex">Hex</span>
                <input id="hexInput" class="hex-input" type="text" inputmode="text" autocomplete="off" spellcheck="false" />
                <button id="colorPopupClose" type="button" data-i18n="close">Close</button>
              </div>
            </div>
          </div>

          <div class="tool-buttons">
            <button id="openCalc" type="button" class="btn-with-icon">
              <span class="btn-icon" aria-hidden="true"></span>
              <span data-i18n="calculator">Calculator</span>
            </button>
            <button id="openSpeed" type="button" class="btn-with-icon">
              <span class="btn-icon" aria-hidden="true"></span>
              <span data-i18n="speedometer">Speedometer</span>
            </button>
            <button id="openEnergy" type="button" class="btn-with-icon">
              <span class="btn-icon" aria-hidden="true"></span>
              <span data-i18n="energy">Energy</span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <main>
      <div class="canvas-shell">
        <div class="canvas-frame">
          <canvas id="pad" aria-label="Drawing canvas"></canvas>
          <div class="right-stack board-canvas-meta" aria-label="Status and attribution">
            <span id="status" class="status" data-i18n="ready">Ready</span>
            <span class="attribution" aria-label="Creator attribution">
              <span data-i18n="poweredBy">Powered by</span> <strong>VatioLibre.com</strong>
            </span>
          </div>
        </div>
      </div>
    </main>
  </div>
</body>
</html>`;

const view = createLegacyView({
  html: boardHtml,
  pageName: "board",
  loadModule: () => import("../../board/board.js"),
});

export function mount(root, context) {
  return view.mount(root, context);
}
