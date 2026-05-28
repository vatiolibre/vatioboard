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
    </div>
    <div class="vb-app-manager-grid" data-app-list></div>
  </section>
`;

export default appsTemplate;
