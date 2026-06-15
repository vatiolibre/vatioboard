const deliveryChecklistTemplate: string = String.raw`
<h1 class="sr-only" data-i18n="deliveryChecklist">Tesla delivery checklist</h1>
<div class="delivery-checklist-app">
  <header class="delivery-checklist-header">
    <div class="delivery-checklist-header-inner">
      <div class="delivery-checklist-toolbar" role="toolbar" data-vb-shell-toolbar aria-label="Delivery checklist tools">
        <div class="delivery-toolbar-strip">
          <button id="deliveryExport" type="button" class="delivery-icon-btn" title="Download checklist" aria-label="Download checklist" aria-haspopup="menu" aria-expanded="false">
            <span class="btn-icon" aria-hidden="true"></span>
          </button>
          <div id="deliveryExportMenu" class="delivery-export-menu" role="menu" hidden>
            <button id="deliveryExportPdf" type="button" role="menuitem">PDF report</button>
            <button id="deliveryExportJson" type="button" role="menuitem">JSON backup</button>
            <button id="deliveryExportText" type="button" role="menuitem">Text report</button>
          </div>
        </div>
      </div>

      <section class="delivery-checklist-overview" aria-label="Checklist summary">
        <div class="delivery-progress-block">
          <div class="delivery-progress-ring" id="deliveryProgressRing" aria-hidden="true">
            <span id="deliveryProgressPercent">0%</span>
          </div>
          <div>
            <h2 id="deliverySessionTitle">Tesla Delivery</h2>
            <p id="deliveryProgressText" class="delivery-progress-text">0 of 0 complete</p>
          </div>
        </div>

        <div class="delivery-vehicle-card" id="deliveryVehicleCard" hidden>
          <img id="deliveryVehicleImage" alt="" loading="lazy" hidden />
          <div>
            <strong id="deliveryVehicleName"></strong>
            <p id="deliveryVehicleDetails"></p>
          </div>
        </div>
      </section>

      <div class="brand" data-i18n-title="tagline" title="Simple full-page drawing board by Vatio Libre">
        <a class="brand-home" href="#/board" data-i18n-aria="openBoard" aria-label="Open Vatio Board">
          <span class="dot" aria-hidden="true"></span>
          <picture class="brand-logo" aria-hidden="true">
            <source srcset="/img/vb_logo_dark.svg" media="(prefers-color-scheme: dark)" />
            <source srcset="/img/vb_logo_light.svg" media="(prefers-color-scheme: light)" />
            <img src="/img/vb_logo_light.svg" alt="" width="757" height="107" decoding="async" />
          </picture>
          <span class="sr-only" data-i18n="brand">Vatio Board</span>
        </a>
        <button id="deliveryLangToggle" type="button" class="lang-toggle" data-i18n-aria="changeLanguage" aria-label="Change language">EN</button>
      </div>

      <span class="route-chip delivery-page-chip" aria-hidden="true">DELIVERY</span>
    </div>
  </header>

  <main class="delivery-checklist-main">
    <p id="deliveryStatus" class="delivery-status" aria-live="polite"></p>

    <section class="delivery-guided-layout">
      <aside class="delivery-step-rail" aria-label="Delivery progress">
        <div class="delivery-rail-summary">
          <span class="delivery-rail-label">Guided flow</span>
          <strong id="deliveryRailProgress">0 of 0</strong>
        </div>
        <nav id="deliverySectionTabs" class="delivery-section-tabs" aria-label="Checklist sections"></nav>
      </aside>

      <section class="delivery-section-panel">
        <div class="delivery-section-heading">
          <div>
            <p id="deliveryStepKicker" class="delivery-step-kicker">Step 1 of 8</p>
            <h2 id="deliverySectionTitle"></h2>
            <p id="deliverySectionDescription"></p>
          </div>
          <div id="deliveryIssueCount" class="delivery-issue-count">0 issues</div>
        </div>
        <section id="deliverySetupPanel" class="delivery-setup-card" aria-label="Vehicle setup" hidden>
          <section class="delivery-vin-scan-card" aria-label="Windshield VIN scan">
            <div class="delivery-vin-scan-copy">
              <h2>Scan windshield VIN</h2>
              <p>Use the windshield QR code to capture the VIN locally before choosing the setup path.</p>
            </div>
            <div id="deliveryVinScanStatus" class="delivery-vin-scan-status" data-state="not-scanned">
              <strong id="deliveryWindshieldVinValue">Not scanned</strong>
              <span id="deliveryWindshieldVinCompare">Scan is optional.</span>
            </div>
            <div class="delivery-vin-scan-actions">
              <button id="deliveryScanVinQr" type="button" class="delivery-action-btn">
                <span class="btn-icon" aria-hidden="true"></span>
                <span>Scan QR</span>
              </button>
              <button id="deliveryEnterVinManual" type="button" class="delivery-action-btn">
                <span>Enter manually</span>
              </button>
              <button id="deliveryClearWindshieldVin" type="button" class="delivery-text-btn" hidden>Clear scanned VIN</button>
            </div>
            <label id="deliveryManualWindshieldVinWrap" class="delivery-manual-vin-wrap" hidden>
              <span>Windshield VIN</span>
              <input id="deliveryManualWindshieldVin" type="text" autocomplete="off" spellcheck="false" maxlength="17" placeholder="17-character VIN" />
            </label>
          </section>

          <div class="delivery-setup-copy">
            <h2>Vehicle details</h2>
            <p>Choose VatioLibre for automatic order details, or keep everything local and fill the checklist manually.</p>
          </div>
          <div id="deliverySetupChoice" class="delivery-setup-choice" role="group" aria-label="Setup method">
            <button id="deliveryUseVatioLibre" type="button" class="delivery-setup-choice-btn" aria-pressed="false">
              <strong>Use VatioLibre</strong>
              <span>Log in or use your connected session to import Tesla order details.</span>
            </button>
            <button id="deliveryUseManual" type="button" class="delivery-setup-choice-btn" aria-pressed="false">
              <strong>Continue manually</strong>
              <span>Keep this checklist local and enter only the details you want.</span>
            </button>
          </div>
          <section id="deliveryImportPanel" class="delivery-import-panel" hidden>
            <div>
              <strong>VatioLibre import</strong>
              <p id="deliveryImportSummary"></p>
            </div>
            <select id="deliveryImportSelect" aria-label="VatioLibre vehicle or order"></select>
            <button id="deliveryApplyImport" type="button" class="delivery-action-btn">
              <span class="btn-icon" aria-hidden="true"></span>
              <span>Use selected</span>
            </button>
          </section>
          <button id="deliveryLogin" type="button" class="delivery-action-btn delivery-login-btn" hidden>
            <span class="btn-icon" aria-hidden="true"></span>
            <span>Log in to import from VatioLibre</span>
          </button>
          <div id="deliverySetupDetailsPanel" class="delivery-setup-details-panel" hidden>
            <p id="deliverySetupModelLock" class="delivery-model-lock" hidden></p>
            <div id="deliverySetupModelSwitch" class="delivery-model-switch delivery-setup-model-switch" role="group" aria-label="Vehicle model"></div>
            <form id="deliveryMetadataForm" class="delivery-metadata-form" aria-label="Vehicle information">
              <label>
                <span>VIN</span>
                <input id="deliveryVin" type="text" autocomplete="off" spellcheck="false" placeholder="VIN" />
              </label>
              <label>
                <span>Order/RN</span>
                <input id="deliveryOrderReference" type="text" autocomplete="off" spellcheck="false" placeholder="Order/RN" />
              </label>
              <label>
                <span>Pickup</span>
                <input id="deliveryPickupLocation" type="text" autocomplete="off" spellcheck="false" placeholder="Pickup location" />
              </label>
            </form>
          </div>
          <button id="deliveryNewSession" type="button" class="delivery-text-btn">Start a fresh local checklist</button>
        </section>
        <div id="deliveryChecklistItems" class="delivery-checklist-items"></div>

        <nav class="delivery-bottom-nav" aria-label="Checklist navigation">
          <button id="deliveryPrevStep" type="button" class="delivery-action-btn delivery-nav-btn">
            <span>Previous</span>
          </button>
          <button id="deliveryNextStep" type="button" class="delivery-action-btn delivery-nav-btn delivery-nav-primary">
            <span>Next Section</span>
          </button>
        </nav>
      </section>

      <aside id="deliveryReviewPanel" class="delivery-review-panel" hidden>
        <div class="delivery-review-header">
          <div>
            <h2>Review</h2>
            <p id="deliveryReviewSummary"></p>
          </div>
          <button id="deliveryCopyReport" type="button" class="delivery-icon-btn" title="Copy report" aria-label="Copy report">
            <span class="btn-icon" aria-hidden="true"></span>
          </button>
          <button id="deliveryPrintReport" type="button" class="delivery-icon-btn" title="Print" aria-label="Print">
            <span class="btn-icon" aria-hidden="true"></span>
          </button>
        </div>
        <div id="deliveryIssueList" class="delivery-issue-list"></div>
        <textarea id="deliveryReportText" class="delivery-report-text" readonly spellcheck="false"></textarea>
      </aside>
    </section>

    <div id="deliveryPhotoPreview" class="delivery-photo-preview" role="dialog" aria-modal="true" aria-label="Photo preview" hidden>
      <button id="deliveryPhotoPreviewClose" type="button" class="delivery-icon-btn" title="Close photo preview" aria-label="Close photo preview">&times;</button>
      <img id="deliveryPhotoPreviewImage" alt="" />
      <p id="deliveryPhotoPreviewCaption"></p>
    </div>

    <div id="deliveryVinScannerSheet" class="delivery-vin-scanner-sheet" role="dialog" aria-modal="true" aria-label="Scan windshield VIN" hidden>
      <div class="delivery-vin-scanner-panel">
        <div class="delivery-vin-scanner-header">
          <div>
            <h2>Scan windshield VIN</h2>
            <p id="deliveryVinScannerStatus">Point the camera at the windshield QR code.</p>
          </div>
          <button id="deliveryVinScannerClose" type="button" class="delivery-icon-btn" title="Close scanner" aria-label="Close scanner">&times;</button>
        </div>
        <div class="delivery-vin-video-wrap">
          <video id="deliveryVinScannerVideo" muted playsinline></video>
          <div class="delivery-vin-scan-frame" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
        <button id="deliveryVinScannerFallback" type="button" class="delivery-action-btn">Enter VIN manually</button>
      </div>
    </div>
  </main>
</div>
`;

export default deliveryChecklistTemplate;
