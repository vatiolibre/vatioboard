const libraryTemplate: string = String.raw`
<h1 class="sr-only" data-i18n="cloudLibrary">Cloud library</h1>
    <div class="library-app">
      <header class="library-header">
        <div class="header-inner library-header-inner">
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
            <button
              id="langToggle"
              type="button"
              class="lang-toggle"
              data-i18n-aria="changeLanguage"
              aria-label="Change language"
            >
              EN
            </button>
          </div>

          <div class="toolbar library-toolbar" role="toolbar" data-vb-shell-toolbar data-i18n-aria="cloudLibraryTools" aria-label="Cloud library tools">
            <div class="library-toolbar-right">
              <div class="library-toolbar-strip">
                <div id="libraryToolbarVolume" class="library-toolbar-volume" hidden>
                  <button
                    id="libraryToolbarMute"
                    type="button"
                    class="library-toolbar-icon-btn"
                    data-i18n-aria="mediaPlayerMute"
                    data-i18n-title="mediaPlayerMute"
                    aria-label="Mute"
                    title="Mute"
                  >
                    <span class="btn-icon" aria-hidden="true"></span>
                  </button>
                  <input
                    id="libraryToolbarVolumeSlider"
                    type="range"
                    class="library-toolbar-volume-slider"
                    min="0"
                    max="100"
                    value="100"
                    step="1"
                    data-i18n-aria="mediaPlayerVolume"
                    aria-label="Volume"
                  />
                </div>

                <button
                  id="libraryRefresh"
                  type="button"
                  class="library-toolbar-icon-btn"
                  data-i18n-aria="cloudLibraryRefresh"
                  data-i18n-title="cloudLibraryRefresh"
                  aria-label="Refresh"
                  title="Refresh"
                >
                  <span class="btn-icon" aria-hidden="true"></span>
                </button>
              </div>
            </div>
          </div>

          <span class="route-chip library-page-chip" aria-hidden="true" data-i18n="cloudLibraryRoute">LIBRARY</span>
        </div>
      </header>

      <main class="library-main">
        <section class="library-controls">
          <div class="library-tabs" role="tablist" aria-label="Cloud library sections">
            <button type="button" class="library-tab" data-tab="speed" role="tab" aria-selected="false">
              <span class="btn-icon" aria-hidden="true"></span>
              <span data-i18n="cloudLibrarySpeed">Speed</span>
            </button>
            <button type="button" class="library-tab" data-tab="accel" role="tab" aria-selected="false">
              <span class="btn-icon" aria-hidden="true"></span>
              <span data-i18n="cloudLibraryAccel">Accel</span>
            </button>
            <button type="button" class="library-tab" data-tab="board_documents" role="tab" aria-selected="false">
              <span class="btn-icon" aria-hidden="true"></span>
              <span data-i18n="cloudLibraryBoardDocuments">Board Documents</span>
            </button>
            <button type="button" class="library-tab" data-tab="media" role="tab" aria-selected="false">
              <span class="btn-icon" aria-hidden="true"></span>
              <span data-i18n="cloudLibraryMedia">Media</span>
            </button>
          </div>

          <form id="librarySearchForm" class="library-search-form">
            <input
              id="librarySearch"
              type="search"
              spellcheck="false"
              autocomplete="off"
              data-i18n-aria="cloudLibrarySearch"
              data-i18n-placeholder="cloudLibrarySearch"
              aria-label="Search"
              placeholder="Search"
            />
            <select id="librarySort" data-i18n-aria="cloudLibrarySort" aria-label="Sort">
              <option value="newest" data-i18n="cloudLibrarySortNewest">Newest first</option>
              <option value="oldest" data-i18n="cloudLibrarySortOldest">Oldest first</option>
              <option value="title_asc" data-i18n="cloudLibrarySortTitleAsc">Title A-Z</option>
              <option value="title_desc" data-i18n="cloudLibrarySortTitleDesc">Title Z-A</option>
            </select>
          </form>
        </section>

        <p id="libraryStatus" class="library-status" hidden aria-live="polite"></p>
        <button
          id="librarySubscriptionCta"
          type="button"
          class="library-subscription-cta"
          data-i18n="saveActivateSubscription"
          hidden
        >
          Activate subscription
        </button>

        <section class="library-shell">
          <section class="library-list-panel" aria-live="polite">
            <div id="libraryListEmpty" class="library-list-empty" data-i18n="cloudLibraryLoading">
              Loading cloud library...
            </div>
            <div id="libraryList" class="library-list"></div>
            <button id="libraryLoadMore" type="button" class="library-load-more" data-i18n="cloudLibraryLoadMore" hidden>
              Load more
            </button>
          </section>

          <section class="library-detail-panel">
            <div id="libraryDetailEmpty" class="library-detail-empty" data-i18n="cloudLibrarySelectPrompt">
              Select a cloud record to inspect it here.
            </div>

            <article id="libraryDetailCard" class="library-detail-card" hidden>
              <div id="libraryDetailPreview" class="library-detail-preview"></div>
              <div class="library-detail-header">
                <div class="library-detail-copy">
                  <h2 id="libraryDetailTitle" class="library-detail-title"></h2>
                  <p id="libraryDetailSubtitle" class="library-detail-subtitle"></p>
                </div>
                <div class="library-detail-actions">
                  <button id="libraryActionOpen" type="button" class="library-action-primary">
                    <span class="btn-icon" aria-hidden="true"></span>
                    <span data-i18n="cloudLibraryOpen">Open</span>
                  </button>

                  <div class="tools-menu library-overflow-menu">
                    <button
                      id="libraryOverflowBtn"
                      type="button"
                      class="library-overflow-btn"
                      data-i18n-aria="cloudLibraryMoreActions"
                      data-i18n-title="cloudLibraryMoreActions"
                      aria-label="More actions"
                      title="More actions"
                      aria-haspopup="true"
                      aria-expanded="false"
                    >
                      <span class="btn-icon" aria-hidden="true"></span>
                    </button>
                    <div id="libraryOverflowList" class="tools-menu-list library-overflow-list" hidden>
                      <button id="libraryActionDownload" type="button" class="btn-with-icon" hidden>
                        <span class="btn-icon" aria-hidden="true"></span>
                        <span data-i18n="cloudLibraryDownload">Download</span>
                      </button>
                      <button id="libraryActionPin" type="button" class="btn-with-icon" hidden>
                        <span class="btn-icon" aria-hidden="true"></span>
                        <span data-i18n="cloudLibraryPin">Pin offline</span>
                      </button>
                      <button id="libraryActionRename" type="button" class="btn-with-icon" hidden>
                        <span class="btn-icon" aria-hidden="true"></span>
                        <span data-i18n="cloudLibraryRename">Rename</span>
                      </button>
                      <button id="libraryActionDelete" type="button" class="btn-with-icon btn-danger" hidden>
                        <span class="btn-icon" aria-hidden="true"></span>
                        <span data-i18n="cloudLibraryDelete">Delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <dl id="libraryDetailMeta" class="library-detail-meta"></dl>
            </article>
          </section>
        </section>
      </main>
    </div>
`;

export default libraryTemplate;
