const appsTemplate = `
  <section class="vb-app-manager" data-vb-app-manager>
    <header class="vb-app-manager-header">
      <div class="vb-app-manager-title-block">
        <p class="vb-app-manager-eyebrow">VatioBoard OS</p>
        <h1 data-i18n="appManagerTitle">Apps</h1>
      </div>
      <output class="vb-app-manager-count" data-app-count aria-live="polite"></output>
    </header>
    <div class="vb-app-manager-toolbar">
      <label class="vb-app-manager-search">
        <span class="sr-only" data-i18n="appManagerSearch">Search apps</span>
        <input data-app-search type="search" autocomplete="off" spellcheck="false" placeholder="Search apps" data-i18n-placeholder="appManagerSearch" />
      </label>
      <label class="vb-app-manager-filter">
        <span class="sr-only" data-i18n="appManagerSurface">Surface</span>
        <select data-app-surface-filter aria-label="Surface" data-i18n-aria="appManagerSurface">
          <option value="all" data-i18n="appManagerAllSurfaces">All surfaces</option>
          <option value="main-route">Route</option>
          <option value="shell-window">Window</option>
          <option value="start-menu">Start menu</option>
          <option value="taskbar">Taskbar</option>
          <option value="launcher">Launcher</option>
        </select>
      </label>
      <label class="vb-app-manager-filter">
        <span class="sr-only">Kind</span>
        <select data-app-kind-filter aria-label="Kind">
          <option value="all">All kinds</option>
          <option value="core-app">Core</option>
          <option value="tool-app">Tools</option>
          <option value="media-app">Media</option>
          <option value="visualizer-app">Visualizer</option>
          <option value="system-app">System</option>
          <option value="background-service">Background</option>
        </select>
      </label>
      <label class="vb-app-manager-filter">
        <span class="sr-only">Status</span>
        <select data-app-status-filter aria-label="Status">
          <option value="all">All statuses</option>
          <option value="stable">Stable</option>
          <option value="beta">Beta</option>
          <option value="experimental">Experimental</option>
          <option value="internal">Internal</option>
        </select>
      </label>
      <label class="vb-app-manager-filter">
        <span class="sr-only">Permission</span>
        <select data-app-permission-filter aria-label="Permission">
          <option value="all">All permissions</option>
          <option value="gps.read">GPS</option>
          <option value="media.camera">Camera</option>
          <option value="audio.playback">Audio</option>
          <option value="tts.speak">Voice</option>
          <option value="storage.app">App-private storage</option>
          <option value="settings.read">Settings</option>
          <option value="cloud.sync">Cloud sync</option>
          <option value="shell.launchApp">Launch apps</option>
        </select>
      </label>
    </div>
    <div class="vb-app-manager-grid" data-app-list></div>
  </section>
`;

export default appsTemplate;
