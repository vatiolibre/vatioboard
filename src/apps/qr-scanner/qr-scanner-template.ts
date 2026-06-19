const qrScannerTemplate: string = String.raw`
<div class="qr-scanner-app" data-qr-scanner-app data-state="idle">
  <header class="qr-scanner-header">
    <div class="qr-scanner-header-inner">
      <div class="qr-scanner-toolbar" aria-label="QR scanner actions">
        <button id="qrScannerCopy" class="qr-scanner-action qr-scanner-action-secondary" type="button" hidden>Copy</button>
      </div>
      <p id="qrScannerStatus" class="qr-scanner-status">Ready</p>
      <div class="brand" aria-hidden="true">
        <span class="dot"></span>
        <span class="brand-wordmark">VatioBoard</span>
      </div>
    </div>
  </header>

  <main class="qr-scanner-main">
    <section class="qr-scanner-panel" aria-label="QR scanner">
      <div class="qr-scanner-preview" data-qr-scanner-preview>
        <video id="qrScannerVideo" muted playsinline></video>
        <div class="qr-scanner-frame" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>

      <div class="qr-scanner-control-row">
        <button id="qrScannerAgain" class="qr-scanner-primary" type="button">Scan QR</button>
        <label class="qr-scanner-file-label" for="qrScannerImageInput">
          Scan image
          <input id="qrScannerImageInput" type="file" accept="image/*" />
        </label>
      </div>

      <section id="qrScannerResultPanel" class="qr-scanner-result" aria-live="polite" hidden>
        <div class="qr-scanner-result-header">
          <h2>Result</h2>
          <a id="qrScannerOpen" class="qr-scanner-open" href="#" target="_blank" rel="noopener noreferrer" hidden>Open link</a>
        </div>
        <pre id="qrScannerResultText"></pre>
      </section>
    </section>
  </main>
</div>
`;

export default qrScannerTemplate;
