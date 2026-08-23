const deliveryChecklistTemplate: string = String.raw`
<h1 class="sr-only" data-i18n="deliveryChecklist">Tesla delivery checklist</h1>
<div class="delivery-checklist-app">
  <header class="delivery-checklist-header">
    <div class="delivery-checklist-header-inner">
      <div class="delivery-checklist-toolbar" role="toolbar" data-vb-shell-toolbar data-i18n-aria="deliveryChecklist.tools" aria-label="Delivery checklist tools">
        <div class="delivery-toolbar-strip">
          <button id="deliveryExport" type="button" class="delivery-icon-btn" data-i18n-title="deliveryChecklist.export.download" data-i18n-aria="deliveryChecklist.export.download" title="Download checklist" aria-label="Download checklist" aria-haspopup="menu" aria-expanded="false">
            <span class="btn-icon" aria-hidden="true"></span>
          </button>
          <div id="deliveryExportMenu" class="delivery-export-menu" role="menu" hidden>
            <button id="deliveryExportPdf" type="button" role="menuitem" data-i18n="deliveryChecklist.export.pdf">PDF report</button>
            <button id="deliveryExportJson" type="button" role="menuitem" data-i18n="deliveryChecklist.export.json">JSON backup</button>
            <button id="deliveryExportText" type="button" role="menuitem" data-i18n="deliveryChecklist.export.text">Text report</button>
          </div>
        </div>
      </div>

      <section class="delivery-checklist-overview" data-i18n-aria="deliveryChecklist.overview.summary" aria-label="Checklist summary">
        <div class="delivery-progress-block">
          <div class="delivery-progress-ring" id="deliveryProgressRing" aria-hidden="true">
            <span id="deliveryProgressPercent">0%</span>
          </div>
          <div>
            <h2 id="deliverySessionTitle" data-i18n="deliveryChecklist.defaultTitle">Tesla Delivery</h2>
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

      <div class="brand" data-i18n-title="tagline" title="Simple full-page drawing board by VatioLibre">
        <a class="brand-home" href="#/board" data-i18n-aria="openBoard" aria-label="Open VatioLibre drawing board">
          <span class="dot" aria-hidden="true"></span>
          <picture class="brand-logo" aria-hidden="true">
            <source srcset="/img/vb_logo_dark.svg" media="(prefers-color-scheme: dark)" />
            <source srcset="/img/vb_logo_light.svg" media="(prefers-color-scheme: light)" />
            <img src="/img/vb_logo_light.svg" alt="" width="757" height="107" decoding="async" />
          </picture>
          <span class="sr-only" data-i18n="brand">VatioLibre</span>
        </a>
        <button id="deliveryLangToggle" type="button" class="lang-toggle" data-i18n-aria="changeLanguage" aria-label="Change language">EN</button>
      </div>

      <span class="route-chip delivery-page-chip" aria-hidden="true" data-i18n="deliveryChecklist.routeChip">DELIVERY</span>
    </div>
  </header>

  <main class="delivery-checklist-main">
    <p id="deliveryStatus" class="delivery-status" aria-live="polite"></p>

    <section class="delivery-guided-layout">
      <aside class="delivery-step-rail" data-i18n-aria="deliveryChecklist.deliveryProgress" aria-label="Delivery progress">
        <div class="delivery-rail-summary">
          <span class="delivery-rail-label" data-i18n="deliveryChecklist.guidedFlow">Guided flow</span>
          <strong id="deliveryRailProgress">0 of 0</strong>
        </div>
        <nav id="deliverySectionTabs" class="delivery-section-tabs" data-i18n-aria="deliveryChecklist.checklistSections" aria-label="Checklist sections"></nav>
      </aside>

      <section class="delivery-section-panel">
        <div class="delivery-section-heading">
          <div>
            <p id="deliveryStepKicker" class="delivery-step-kicker">Step 1 of 10</p>
            <h2 id="deliverySectionTitle"></h2>
            <p id="deliverySectionDescription"></p>
          </div>
          <div id="deliveryIssueCount" class="delivery-issue-count">0 issues</div>
        </div>
        <section id="deliveryVinStepPanel" class="delivery-setup-card delivery-vin-step-card" data-i18n-aria="deliveryChecklist.vin.panelAria" aria-label="Windshield VIN" hidden>
          <section class="delivery-vin-scan-card" data-i18n-aria="deliveryChecklist.vin.scanAria" aria-label="Windshield VIN scan">
            <div class="delivery-vin-scan-copy">
              <h2 data-i18n="deliveryChecklist.step.windshieldVin.title">Read windshield VIN</h2>
              <p data-i18n="deliveryChecklist.vin.scanBody">Use camera OCR to capture the windshield VIN locally before choosing the setup path.</p>
            </div>
            <div id="deliveryVinScanStatus" class="delivery-vin-scan-status" data-state="not-scanned">
              <strong id="deliveryWindshieldVinValue" data-i18n="deliveryChecklist.vin.notScanned">Not scanned</strong>
              <span id="deliveryWindshieldVinCompare" data-i18n="deliveryChecklist.vin.optional">Scan is optional.</span>
            </div>
            <div class="delivery-vin-scan-actions">
              <button id="deliveryReadVinOcr" type="button" class="delivery-action-btn">
                <span class="btn-icon" aria-hidden="true"></span>
                <span data-i18n="deliveryChecklist.vin.read">Read VIN</span>
              </button>
              <button id="deliveryEnterVinManual" type="button" class="delivery-action-btn">
                <span data-i18n="deliveryChecklist.vin.enterManually">Enter manually</span>
              </button>
              <button id="deliveryClearWindshieldVin" type="button" class="delivery-text-btn" data-i18n="deliveryChecklist.vin.clearScanned" hidden>Clear scanned VIN</button>
            </div>
            <label id="deliveryManualWindshieldVinWrap" class="delivery-manual-vin-wrap" hidden>
              <span data-i18n="deliveryChecklist.vin.field">Windshield VIN</span>
              <input id="deliveryManualWindshieldVin" type="text" autocomplete="off" spellcheck="false" maxlength="17" data-i18n-placeholder="deliveryChecklist.vin.placeholder" placeholder="17-character VIN" />
            </label>
          </section>
        </section>

        <section id="deliverySetupPanel" class="delivery-setup-card" data-i18n-aria="deliveryChecklist.setup.panelAria" aria-label="Vehicle details" hidden>
          <div class="delivery-setup-copy">
            <h2 data-i18n="deliveryChecklist.step.vehicleSetup.title">Vehicle details</h2>
            <p data-i18n="deliveryChecklist.setup.body">Choose VatioLibre for automatic order details, or keep everything local and fill the checklist manually.</p>
          </div>
          <div id="deliverySetupChoice" class="delivery-setup-choice" role="group" data-i18n-aria="deliveryChecklist.setup.methodAria" aria-label="Setup method">
            <button id="deliveryUseVatioLibre" type="button" class="delivery-setup-choice-btn" aria-pressed="false">
              <strong data-i18n="deliveryChecklist.setup.useVatioLibre">Use VatioLibre</strong>
              <span data-i18n="deliveryChecklist.setup.useVatioLibreBody">Log in or use your connected session to import Tesla order details.</span>
            </button>
            <button id="deliveryUseManual" type="button" class="delivery-setup-choice-btn" aria-pressed="false">
              <strong data-i18n="deliveryChecklist.setup.continueManual">Continue manually</strong>
              <span data-i18n="deliveryChecklist.setup.continueManualBody">Keep this checklist local and enter only the details you want.</span>
            </button>
          </div>
          <section id="deliveryImportPanel" class="delivery-import-panel" hidden>
            <div>
              <strong data-i18n="deliveryChecklist.setup.importTitle">VatioLibre import</strong>
              <p id="deliveryImportSummary"></p>
            </div>
            <select id="deliveryImportSelect" data-i18n-aria="deliveryChecklist.setup.importSelectAria" aria-label="VatioLibre vehicle or order"></select>
            <button id="deliveryApplyImport" type="button" class="delivery-action-btn">
              <span class="btn-icon" aria-hidden="true"></span>
              <span data-i18n="deliveryChecklist.setup.useSelected">Use selected</span>
            </button>
          </section>
          <button id="deliveryLogin" type="button" class="delivery-action-btn delivery-login-btn" hidden>
            <span class="btn-icon" aria-hidden="true"></span>
            <span data-i18n="deliveryChecklist.setup.loginImport">Log in to import from VatioLibre</span>
          </button>
          <div id="deliverySetupDetailsPanel" class="delivery-setup-details-panel" hidden>
            <p id="deliverySetupModelLock" class="delivery-model-lock" hidden></p>
            <div id="deliverySetupModelSwitch" class="delivery-model-switch delivery-setup-model-switch" role="group" data-i18n-aria="deliveryChecklist.setup.vehicleModelAria" aria-label="Vehicle model"></div>
            <form id="deliveryMetadataForm" class="delivery-metadata-form" data-i18n-aria="deliveryChecklist.setup.vehicleInfoAria" aria-label="Vehicle information">
              <label>
                <span data-i18n="deliveryChecklist.setup.vin">VIN</span>
                <input id="deliveryVin" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="deliveryChecklist.setup.vin" placeholder="VIN" />
              </label>
              <label>
                <span data-i18n="deliveryChecklist.setup.order">Order/RN</span>
                <input id="deliveryOrderReference" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="deliveryChecklist.setup.order" placeholder="Order/RN" />
              </label>
              <label>
                <span data-i18n="deliveryChecklist.setup.pickup">Pickup</span>
                <input id="deliveryPickupLocation" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="deliveryChecklist.setup.pickupPlaceholder" placeholder="Pickup location" />
              </label>
            </form>
          </div>
          <button id="deliveryNewSession" type="button" class="delivery-text-btn" data-i18n="deliveryChecklist.setup.newSession">Start a fresh local checklist</button>
        </section>
        <div id="deliveryChecklistItems" class="delivery-checklist-items"></div>

        <nav class="delivery-bottom-nav" data-i18n-aria="deliveryChecklist.navigationAria" aria-label="Checklist navigation">
          <button id="deliveryPrevStep" type="button" class="delivery-action-btn delivery-nav-btn">
            <span data-i18n="deliveryChecklist.previous">Previous</span>
          </button>
          <button id="deliveryNextStep" type="button" class="delivery-action-btn delivery-nav-btn delivery-nav-primary">
            <span data-i18n="deliveryChecklist.nextSectionDefault">Next Section</span>
          </button>
        </nav>
      </section>

      <aside id="deliveryReviewPanel" class="delivery-review-panel" hidden>
        <div class="delivery-review-header">
          <div>
            <h2 data-i18n="deliveryChecklist.review.title">Review</h2>
            <p id="deliveryReviewSummary"></p>
          </div>
          <button id="deliveryCopyReport" type="button" class="delivery-icon-btn" data-i18n-title="deliveryChecklist.copyReport" data-i18n-aria="deliveryChecklist.copyReport" title="Copy report" aria-label="Copy report">
            <span class="btn-icon" aria-hidden="true"></span>
          </button>
          <button id="deliveryPrintReport" type="button" class="delivery-icon-btn" data-i18n-title="deliveryChecklist.print" data-i18n-aria="deliveryChecklist.print" title="Print" aria-label="Print">
            <span class="btn-icon" aria-hidden="true"></span>
          </button>
        </div>
        <div id="deliveryIssueList" class="delivery-issue-list"></div>
        <textarea id="deliveryReportText" class="delivery-report-text" readonly spellcheck="false"></textarea>
      </aside>
    </section>

    <div id="deliveryPhotoPreview" class="delivery-photo-preview" role="dialog" aria-modal="true" data-i18n-aria="deliveryChecklist.photoPreview" aria-label="Photo preview" hidden>
      <button id="deliveryPhotoPreviewClose" type="button" class="delivery-icon-btn" data-i18n-title="deliveryChecklist.closePhotoPreview" data-i18n-aria="deliveryChecklist.closePhotoPreview" title="Close photo preview" aria-label="Close photo preview">&times;</button>
      <img id="deliveryPhotoPreviewImage" alt="" />
      <p id="deliveryPhotoPreviewCaption"></p>
    </div>

    <div id="deliveryVinScannerSheet" class="delivery-vin-scanner-sheet" role="dialog" aria-modal="true" data-i18n-aria="deliveryChecklist.scanner.sheetAria" aria-label="Scan windshield VIN" hidden>
      <div class="delivery-vin-scanner-panel">
        <div class="delivery-vin-scanner-header">
          <div>
            <h2 data-i18n="deliveryChecklist.step.windshieldVin.title">Read windshield VIN</h2>
            <p id="deliveryVinScannerStatus" data-i18n="deliveryChecklist.scanner.liveGuidance">Step back until the VIN fits inside the smaller yellow brackets, then tap Capture frame.</p>
          </div>
          <button id="deliveryVinScannerClose" type="button" class="delivery-icon-btn" data-i18n-title="deliveryChecklist.scanner.close" data-i18n-aria="deliveryChecklist.scanner.close" title="Close scanner" aria-label="Close scanner">&times;</button>
        </div>
        <div id="deliveryVinLivePane" class="delivery-vin-live-pane">
          <div class="delivery-vin-video-wrap">
            <video id="deliveryVinScannerVideo" muted playsinline></video>
            <div class="delivery-vin-scan-frame" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
        <div id="deliveryVinLiveActions" class="delivery-vin-scanner-actions">
          <button id="deliveryVinScannerCapture" type="button" class="delivery-action-btn delivery-nav-primary" data-i18n="deliveryChecklist.scanner.captureFrame">Capture frame</button>
        </div>
        <input id="deliveryVinImageInput" type="file" accept="image/*" hidden />
        <input id="deliveryVinNativeCaptureInput" type="file" accept="image/*" capture="environment" hidden />
        <section id="deliveryVinCropEditor" class="delivery-vin-crop-editor" data-i18n-aria="deliveryChecklist.scanner.centerImageAria" aria-label="Center windshield VIN image" hidden>
          <div class="delivery-vin-crop-wrap">
            <canvas id="deliveryVinCropCanvas" width="960" height="200" data-i18n-aria="deliveryChecklist.scanner.centeredPreviewAria" aria-label="Centered VIN image preview"></canvas>
            <div class="delivery-vin-crop-frame" aria-hidden="true"></div>
            <div id="deliveryVinCropHint" class="delivery-vin-crop-hint" data-i18n="deliveryChecklist.scanner.cropHint" hidden>Drag to center. Use Zoom to adjust.</div>
          </div>
          <div class="delivery-vin-crop-controls">
            <label class="delivery-vin-zoom-control">
              <span data-i18n="deliveryChecklist.scanner.zoom">Zoom</span>
              <input id="deliveryVinCropZoom" type="range" min="1" max="2.8" step="0.01" value="1" disabled />
            </label>
            <button id="deliveryVinCropReset" type="button" class="delivery-action-btn" data-i18n="deliveryChecklist.scanner.resetCrop" disabled>Reset crop</button>
          </div>
          <div id="deliveryVinCropActions" class="delivery-vin-crop-actions">
            <button id="deliveryVinCropRead" type="button" class="delivery-action-btn delivery-nav-primary" data-i18n="deliveryChecklist.vin.read">Read VIN</button>
            <button id="deliveryVinCropRetake" type="button" class="delivery-action-btn" data-i18n="deliveryChecklist.scanner.retake">Retake</button>
          </div>
        </section>
        <div id="deliveryVinScannerFallbackActions" class="delivery-vin-scanner-fallback-actions" hidden>
          <button id="deliveryVinScannerUpload" type="button" class="delivery-action-btn" data-i18n="deliveryChecklist.scanner.uploadImage">Upload image</button>
          <button id="deliveryVinScannerFallback" type="button" class="delivery-action-btn" data-i18n="deliveryChecklist.vin.enterManually">Enter manually</button>
        </div>
        <section id="deliveryVinOcrDiagnostics" class="delivery-vin-ocr-diagnostics" data-i18n-aria="deliveryChecklist.ocr.diagnosticsAria" aria-label="OCR diagnostics" hidden>
          <div class="delivery-vin-ocr-diagnostics-copy">
            <strong data-i18n="deliveryChecklist.ocr.diagnosticsTitle">OCR diagnostics</strong>
            <p data-i18n="deliveryChecklist.ocr.diagnosticsBody">Debug images stay on this device unless you share them. Use these files to see the captured frame, crop, OCR variants, and raw text.</p>
          </div>
          <div id="deliveryVinOcrPreview" class="delivery-vin-ocr-preview" data-i18n-aria="deliveryChecklist.ocr.previewAria" aria-label="OCR debug image previews"></div>
          <div class="delivery-vin-ocr-actions">
            <button id="deliveryVinOcrWiderScan" type="button" class="delivery-action-btn" data-i18n="deliveryChecklist.ocr.tryWiderScan">Try wider scan</button>
            <button id="deliveryVinOcrCopyDebug" type="button" class="delivery-action-btn" data-i18n="deliveryChecklist.ocr.copyJson">Copy JSON</button>
            <button id="deliveryVinOcrDownloadDebug" type="button" class="delivery-action-btn" data-i18n="deliveryChecklist.ocr.downloadDebug">Download debug files</button>
          </div>
        </section>
      </div>
    </div>
  </main>
</div>
`;

export default deliveryChecklistTemplate;
