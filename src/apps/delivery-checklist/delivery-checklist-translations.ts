export const deliveryChecklistTranslations = {
  en: {
    'deliveryChecklist.routeChip': 'DELIVERY',
    'deliveryChecklist.tools': 'Delivery checklist tools',
    'deliveryChecklist.export.download': 'Download checklist',
    'deliveryChecklist.export.pdf': 'PDF report',
    'deliveryChecklist.export.json': 'JSON backup',
    'deliveryChecklist.export.text': 'Text report',
    'deliveryChecklist.overview.summary': 'Checklist summary',
    'deliveryChecklist.defaultTitle': 'Tesla Delivery',
    'deliveryChecklist.progressComplete': '{complete} of {total} complete',
    'deliveryChecklist.progressShort': '{complete} of {total}',
    'deliveryChecklist.issueCount': '{count} {issueWord}',
    'deliveryChecklist.issueWord.one': 'issue',
    'deliveryChecklist.issueWord.other': 'issues',
    'deliveryChecklist.guidedFlow': 'Guided flow',
    'deliveryChecklist.deliveryProgress': 'Delivery progress',
    'deliveryChecklist.checklistSections': 'Checklist sections',
    'deliveryChecklist.stepKicker': 'Step {current} of {total}',
    'deliveryChecklist.sectionTabAria':
      '{title}, step {current} of {total}, {complete} of {progressTotal} complete, {issues} issues',
    'deliveryChecklist.sectionIssueSummary': '{complete}/{total} - {issues} {issueWord}',
    'deliveryChecklist.noIssues': 'No issues',
    'deliveryChecklist.chooseSetup': 'Choose setup',
    'deliveryChecklist.imported': 'Imported',
    'deliveryChecklist.manual': 'Manual',
    'deliveryChecklist.vatioLibre': 'VatioLibre',
    'deliveryChecklist.previous': 'Previous',
    'deliveryChecklist.nextSectionDefault': 'Next Section',
    'deliveryChecklist.previousSection': 'Previous: {section}',
    'deliveryChecklist.nextSection': 'Next: {section}',
    'deliveryChecklist.chooseSetupOption': 'Choose setup option',
    'deliveryChecklist.finishMissing': 'Finish {count} missing',
    'deliveryChecklist.reviewComplete': 'Review Complete',
    'deliveryChecklist.photo': 'Photo',
    'deliveryChecklist.photoCount.one': '{count} photo',
    'deliveryChecklist.photoCount.other': '{count} photos',
    'deliveryChecklist.openPhoto': 'Open {caption}',
    'deliveryChecklist.deliveryPhoto': 'Delivery photo',
    'deliveryChecklist.loadingPhotoPreview': 'Loading photo preview...',
    'deliveryChecklist.photoPreview': 'Photo preview',
    'deliveryChecklist.closePhotoPreview': 'Close photo preview',

    'deliveryChecklist.step.windshieldVin.title': 'Read windshield VIN',
    'deliveryChecklist.step.windshieldVin.shortTitle': 'VIN',
    'deliveryChecklist.step.windshieldVin.description':
      'Capture the windshield VIN first, then choose how to fill vehicle details.',
    'deliveryChecklist.step.vehicleSetup.title': 'Vehicle details',
    'deliveryChecklist.step.vehicleSetup.shortTitle': 'Vehicle',
    'deliveryChecklist.step.vehicleSetup.description':
      'Choose VatioLibre import or a manual local checklist before inspection.',

    'deliveryChecklist.vin.panelAria': 'Windshield VIN',
    'deliveryChecklist.vin.scanAria': 'Windshield VIN scan',
    'deliveryChecklist.vin.scanBody':
      'Use camera OCR to capture the windshield VIN locally before choosing the setup path.',
    'deliveryChecklist.vin.notScanned': 'Not scanned',
    'deliveryChecklist.vin.optional': 'Scan is optional.',
    'deliveryChecklist.vin.matchesVatioLibre': 'Matches VatioLibre VIN.',
    'deliveryChecklist.vin.mismatch': 'Does not match VatioLibre VIN {vin}.',
    'deliveryChecklist.vin.backendUnavailable': 'Saved locally. VatioLibre VIN is not available to compare.',
    'deliveryChecklist.vin.manualOnly': 'Saved locally. Manual setup does not compare VINs.',
    'deliveryChecklist.vin.summaryMismatch': 'Mismatch',
    'deliveryChecklist.vin.summarySaved': 'Saved',
    'deliveryChecklist.vin.summaryOptional': 'Optional',
    'deliveryChecklist.vin.read': 'Read VIN',
    'deliveryChecklist.vin.enterManually': 'Enter manually',
    'deliveryChecklist.vin.clearScanned': 'Clear scanned VIN',
    'deliveryChecklist.vin.field': 'Windshield VIN',
    'deliveryChecklist.vin.placeholder': '17-character VIN',

    'deliveryChecklist.setup.panelAria': 'Vehicle details',
    'deliveryChecklist.setup.body':
      'Choose VatioLibre for automatic order details, or keep everything local and fill the checklist manually.',
    'deliveryChecklist.setup.methodAria': 'Setup method',
    'deliveryChecklist.setup.useVatioLibre': 'Use VatioLibre',
    'deliveryChecklist.setup.useVatioLibreBody':
      'Log in or use your connected session to import Tesla order details.',
    'deliveryChecklist.setup.continueManual': 'Continue manually',
    'deliveryChecklist.setup.continueManualBody':
      'Keep this checklist local and enter only the details you want.',
    'deliveryChecklist.setup.importTitle': 'VatioLibre import',
    'deliveryChecklist.setup.importSelectAria': 'VatioLibre vehicle or order',
    'deliveryChecklist.setup.useSelected': 'Use selected',
    'deliveryChecklist.setup.loginImport': 'Log in to import from VatioLibre',
    'deliveryChecklist.setup.modelLock':
      '{model} imported from VatioLibre. Switch to manual setup to change the checklist model.',
    'deliveryChecklist.setup.vehicleModelAria': 'Vehicle model',
    'deliveryChecklist.setup.vehicleInfoAria': 'Vehicle information',
    'deliveryChecklist.setup.vin': 'VIN',
    'deliveryChecklist.setup.order': 'Order/RN',
    'deliveryChecklist.setup.pickup': 'Pickup',
    'deliveryChecklist.setup.pickupPlaceholder': 'Pickup location',
    'deliveryChecklist.setup.newSession': 'Start a fresh local checklist',
    'deliveryChecklist.vehicleImported': 'Imported from VatioLibre',

    'deliveryChecklist.review.title': 'Review',
    'deliveryChecklist.review.summary': '{issues} {issueWord} - {percent}% complete',
    'deliveryChecklist.review.noIssues': 'No issues marked yet.',
    'deliveryChecklist.review.noNote': 'No note yet.',
    'deliveryChecklist.copyReport': 'Copy report',
    'deliveryChecklist.print': 'Print',
    'deliveryChecklist.navigationAria': 'Checklist navigation',

    'deliveryChecklist.scanner.sheetAria': 'Scan windshield VIN',
    'deliveryChecklist.scanner.liveGuidance':
      'Step back until the VIN fits inside the smaller yellow brackets, then tap Capture frame.',
    'deliveryChecklist.scanner.close': 'Close scanner',
    'deliveryChecklist.scanner.captureFrame': 'Capture frame',
    'deliveryChecklist.scanner.centerImageAria': 'Center windshield VIN image',
    'deliveryChecklist.scanner.centeredPreviewAria': 'Centered VIN image preview',
    'deliveryChecklist.scanner.cropHint': 'Drag to center. Use Zoom to adjust.',
    'deliveryChecklist.scanner.zoom': 'Zoom',
    'deliveryChecklist.scanner.resetCrop': 'Reset crop',
    'deliveryChecklist.scanner.retake': 'Retake',
    'deliveryChecklist.scanner.uploadImage': 'Upload image',
    'deliveryChecklist.scanner.takePhoto': 'Take photo',
    'deliveryChecklist.scanner.chooseImage': 'Choose an image file of the windshield VIN.',
    'deliveryChecklist.scanner.centerThenRead': 'Center the VIN text in the crop, then tap Read VIN.',
    'deliveryChecklist.scanner.startingCamera': 'Starting camera...',
    'deliveryChecklist.scanner.cameraUnavailable':
      'Camera is unavailable here. Upload a VIN photo or enter the VIN manually.',
    'deliveryChecklist.scanner.captureFailed':
      'Could not capture the camera frame. Try again, upload a photo, or enter it manually.',
    'deliveryChecklist.scanner.reading': 'Reading...',
    'deliveryChecklist.scanner.noValidVin':
      'Could not read a valid VIN. Recenter the crop, zoom in, or try a wider scan.',
    'deliveryChecklist.scanner.readFailed':
      'Could not read the VIN. Try again, upload another photo, or enter it manually.',
    'deliveryChecklist.scanner.imageReadFailed':
      'Could not read that image. Try another photo or enter the VIN manually.',
    'deliveryChecklist.ocr.diagnosticsAria': 'OCR diagnostics',
    'deliveryChecklist.ocr.diagnosticsTitle': 'OCR diagnostics',
    'deliveryChecklist.ocr.diagnosticsBody':
      'Debug images stay on this device unless you share them. Use these files to see the captured frame, crop, OCR variants, and raw text.',
    'deliveryChecklist.ocr.previewAria': 'OCR debug image previews',
    'deliveryChecklist.ocr.tryWiderScan': 'Try wider scan',
    'deliveryChecklist.ocr.copyJson': 'Copy JSON',
    'deliveryChecklist.ocr.downloadDebug': 'Download debug files',

    'deliveryChecklist.item.critical': 'Critical',
    'deliveryChecklist.item.unlocked': 'Unlocked',
    'deliveryChecklist.item.pass': 'Pass',
    'deliveryChecklist.item.issue': 'Issue',
    'deliveryChecklist.item.skip': 'Skip',
    'deliveryChecklist.item.note': 'Note',
    'deliveryChecklist.item.notePlaceholder': 'Add advisor-ready notes',

    'deliveryChecklist.status.chooseSetup':
      'Choose VatioLibre import or manual vehicle details before continuing.',
    'deliveryChecklist.status.finishHighlighted': 'Finish the highlighted checklist item before moving on.',
    'deliveryChecklist.status.saveFailed': 'Could not save locally. Browser storage may be full.',
    'deliveryChecklist.status.vinScanCleared': 'Windshield VIN scan cleared.',
    'deliveryChecklist.status.ocrJsonCopied': 'OCR debug JSON copied.',
    'deliveryChecklist.status.ocrDebugDownloaded': 'OCR debug files downloaded.',
    'deliveryChecklist.status.fileNotImage': 'That file is not an image.',
    'deliveryChecklist.status.vinImageLoadFailed': 'VIN image could not be loaded.',
    'deliveryChecklist.status.cameraUnavailable':
      'Camera OCR is unavailable here. Upload a VIN photo or enter it manually.',
    'deliveryChecklist.status.captureFailed': 'Could not capture the VIN image.',
    'deliveryChecklist.status.vinReadSaved': 'Windshield VIN read and saved locally.',
    'deliveryChecklist.status.noValidVin': 'No valid VIN found in the centered image.',
    'deliveryChecklist.status.vinOcrFailed': 'VIN OCR failed; manual entry is still available.',
    'deliveryChecklist.status.photoStorageUnavailable':
      'Photo storage is unavailable here. Notes still save locally.',
    'deliveryChecklist.status.photoSaveFailed': 'Could not save that photo. The issue note is still local.',
    'deliveryChecklist.status.photoSaved': 'Photo saved locally.',
    'deliveryChecklist.status.manualSetupSelected': 'Manual local setup selected.',
    'deliveryChecklist.status.newChecklistStarted': 'New local checklist started.',
    'deliveryChecklist.status.jsonExported': 'Checklist JSON exported.',
    'deliveryChecklist.status.textExported': 'Checklist text report exported.',
    'deliveryChecklist.status.pdfExported': 'Checklist PDF report exported.',
    'deliveryChecklist.status.reportCopied': 'Report copied.',
    'deliveryChecklist.status.reportSelected': 'Report selected for copying.',
    'deliveryChecklist.status.manualModeActive': 'Manual checklist mode is active.',
    'deliveryChecklist.status.checkingVatioLibre': 'Checking VatioLibre Tesla connection...',
    'deliveryChecklist.status.ordersLoaded': 'VatioLibre orders loaded.',
    'deliveryChecklist.status.vehiclesLoaded': 'VatioLibre vehicles loaded.',
    'deliveryChecklist.status.noImportableData': 'No importable Tesla data found.',
    'deliveryChecklist.status.importFailed': 'Import failed; manual checklist mode is still available.',
    'deliveryChecklist.status.metadataImportedAuto': 'VatioLibre metadata imported automatically.',
    'deliveryChecklist.status.metadataImported': 'Imported metadata saved locally. You can edit it here.',
    'deliveryChecklist.status.windshieldVinSaved': 'Windshield VIN saved locally.',
    'deliveryChecklist.status.photoAttachmentsUnavailable':
      'Photo attachments are unavailable here; statuses and notes still save locally.',
    'deliveryChecklist.status.savedLocal': 'Saved locally in this browser.',

    'deliveryChecklist.import.loginPrompt':
      'Log in to import from VatioLibre. Manual setup still works offline.',
    'deliveryChecklist.import.unavailable': 'VatioLibre is not available in this session. Continue manually.',
    'deliveryChecklist.import.checking': 'Checking VatioLibre Tesla connection...',
    'deliveryChecklist.import.notConnected':
      'Tesla data is not connected for this VatioLibre session. Continue manually.',
    'deliveryChecklist.import.selectOrder': 'Select an order to prefill the checklist. Nothing syncs back.',
    'deliveryChecklist.import.selectVehicle':
      'Select a vehicle to prefill the checklist. Sleeping vehicles will not be woken.',
    'deliveryChecklist.import.noneFound': 'No supported Tesla orders or vehicles were found. Continue manually.',
    'deliveryChecklist.import.failed': 'Could not load VatioLibre Tesla data. Continue manually.',
    'deliveryChecklist.import.auto': 'Imported the only matching VatioLibre vehicle/order. Nothing syncs back.',
    'deliveryChecklist.import.saved': 'Imported metadata saved locally. You can edit it here.',

    'deliveryChecklist.report.title': 'Tesla Delivery Checklist: {title}',
    'deliveryChecklist.report.model': 'Model: {model}',
    'deliveryChecklist.report.vin': 'VIN: {vin}',
    'deliveryChecklist.report.windshieldVin': 'Windshield VIN: {vin}',
    'deliveryChecklist.report.windshieldVinManual': 'Windshield VIN comparison: Manual/local only',
    'deliveryChecklist.report.windshieldVinUnavailable': 'Windshield VIN comparison: Backend VIN unavailable',
    'deliveryChecklist.report.windshieldVinMatch': 'Windshield VIN comparison: Match',
    'deliveryChecklist.report.windshieldVinMismatch': 'Windshield VIN comparison: Mismatch (backend {vin})',
    'deliveryChecklist.report.order': 'Order: {order}',
    'deliveryChecklist.report.pickup': 'Pickup: {pickup}',
    'deliveryChecklist.report.progress': 'Progress: {complete}/{total} ({percent}%)',
    'deliveryChecklist.report.issues': 'Issues: {count}',
    'deliveryChecklist.report.issuesHeading': 'Issues',
    'deliveryChecklist.report.noIssues': 'No issues marked.',
    'deliveryChecklist.report.photos.one': '({count} photo)',
    'deliveryChecklist.report.photos.other': '({count} photos)',
    'deliveryChecklist.report.sourcesHeader': 'Sources used for checklist structure:',
    'deliveryChecklist.sessionTitle': '{model} Delivery',

    'deliveryChecklist.section.records.title': 'Records',
    'deliveryChecklist.section.records.shortTitle': 'Records',
    'deliveryChecklist.section.records.description':
      'Confirm that the vehicle and paperwork match before inspecting details.',
    'deliveryChecklist.section.locked-exterior.title': 'Locked Exterior',
    'deliveryChecklist.section.locked-exterior.shortTitle': 'Locked',
    'deliveryChecklist.section.locked-exterior.description':
      'Checks that are usually possible before accepting or unlocking the vehicle.',
    'deliveryChecklist.section.unlocked-exterior.title': 'Unlocked Exterior',
    'deliveryChecklist.section.unlocked-exterior.shortTitle': 'Unlocked',
    'deliveryChecklist.section.unlocked-exterior.description':
      'Open and operate exterior panels, doors, glass, seals, and storage areas.',
    'deliveryChecklist.section.interior.title': 'Interior',
    'deliveryChecklist.section.interior.shortTitle': 'Interior',
    'deliveryChecklist.section.interior.description':
      'Inspect cabin trim, seats, controls, storage, and accessories.',
    'deliveryChecklist.section.electronics.title': 'Electronics',
    'deliveryChecklist.section.electronics.shortTitle': 'Tech',
    'deliveryChecklist.section.electronics.description':
      'Verify the screen, cameras, lighting, software, and comfort systems.',
    'deliveryChecklist.section.charging.title': 'Charging',
    'deliveryChecklist.section.charging.shortTitle': 'Charge',
    'deliveryChecklist.section.charging.description':
      'Check charge equipment, adapters, ports, state of charge, and charging behavior.',
    'deliveryChecklist.section.model-specific.title': 'Model-Specific',
    'deliveryChecklist.section.model-specific.shortTitle': 'Model',
    'deliveryChecklist.section.model-specific.description':
      'Items that differ meaningfully across Model 3, Model Y, and Cybertruck.',
    'deliveryChecklist.section.final-review.title': 'Final Review',
    'deliveryChecklist.section.final-review.shortTitle': 'Review',
    'deliveryChecklist.section.final-review.description':
      'Collect issues, photos, and advisor-ready notes before leaving.',

    'deliveryChecklist.item.records-vin-match.title':
      'VIN matches the app, paperwork, windshield, and vehicle screen.',
    'deliveryChecklist.item.records-vin-match.helper':
      'Treat any mismatch as a stop-and-ask item before accepting delivery.',
    'deliveryChecklist.item.records-name-address.title':
      'Name, registration address, and delivery paperwork are correct.',
    'deliveryChecklist.item.records-config-match.title':
      'Paint, wheels, interior, trim, and ordered options match the order.',
    'deliveryChecklist.item.records-insurance-payment.title':
      'Insurance, payment status, trade-in, and required documents are ready.',
    'deliveryChecklist.item.records-delivery-time.title':
      'Delivery time and lighting are good enough for a careful walkaround.',
    'deliveryChecklist.item.locked-panel-gaps.title':
      'Body panels, doors, hood/frunk, hatch, and charge-port area sit even and flush.',
    'deliveryChecklist.item.locked-panel-gaps.helper':
      'Look for large, uneven, or rubbing gaps rather than tiny cosmetic differences.',
    'deliveryChecklist.item.locked-paint-walkaround.title':
      'Paint or stainless finish is free of obvious chips, dents, stains, scratches, or overspray.',
    'deliveryChecklist.item.locked-glass-alignment.title':
      'Windshield, roof glass, mirrors, and rear glass are aligned and undamaged.',
    'deliveryChecklist.item.locked-lights-fit.title':
      'Headlights, tail lights, light bars, and lenses are seated, clear, and dry.',
    'deliveryChecklist.item.locked-wheels-tires.title':
      'Wheels, tires, hubcaps/covers, lug areas, and valve stems show no visible damage.',
    'deliveryChecklist.item.locked-undercarriage.title':
      'Underside, rocker panels, wheel wells, fasteners, and aero covers are not damaged or loose.',
    'deliveryChecklist.item.locked-cameras-sensors.title':
      'Exterior cameras and sensor covers are clean, seated, and not cracked.',
    'deliveryChecklist.item.unlocked-doors-windows.title':
      'All doors open, close, latch, and window indexing works without scraping.',
    'deliveryChecklist.item.unlocked-frunk-trunk.title':
      'Frunk and trunk/hatch open and close smoothly; lighting and release buttons work.',
    'deliveryChecklist.item.unlocked-seals-weather.title':
      'Door, glass, trunk, frunk, and roof seals are attached, continuous, and not pinched.',
    'deliveryChecklist.item.unlocked-door-jambs.title':
      'Door jambs, hinge areas, sills, and hidden paint edges are clean and undamaged.',
    'deliveryChecklist.item.unlocked-wipers-washer.title':
      'Wipers and washer operate correctly and do not contact painted panels.',
    'deliveryChecklist.item.unlocked-front-license.title':
      'Front plate holder, tow hook, and included loose accessories are present where applicable.',
    'deliveryChecklist.item.interior-screen-trim.title':
      'Screen, dash, console, door trim, headliner, carpet, and sills are clean and undamaged.',
    'deliveryChecklist.item.interior-seats.title':
      'Seats, stitching, bolsters, rear bench, and folding mechanisms are aligned and undamaged.',
    'deliveryChecklist.item.interior-seat-controls.title':
      'Front seat adjustment, lumbar, steering wheel controls, mirrors, and fold functions work.',
    'deliveryChecklist.item.interior-storage.title':
      'Glovebox, center console, cupholders, coat hooks, cargo covers, and storage bins work.',
    'deliveryChecklist.item.interior-pedals-belts.title':
      'Pedals, seat belts, emergency releases, and latch points are secure and easy to reach.',
    'deliveryChecklist.item.interior-floor-mats.title':
      'Floor mats, trunk/frunk liners, and cargo panels fit without loose or damaged edges.',
    'deliveryChecklist.item.electronics-display.title':
      'Touchscreen boots, responds normally, shows no warning messages, and can restart cleanly.',
    'deliveryChecklist.item.electronics-cameras.title':
      'Backup, side, front, and cabin camera views appear clear where available.',
    'deliveryChecklist.item.electronics-lights.title':
      'Headlights, hazards, turn signals, brake lights, reverse lights, fog lights, and interior lights work.',
    'deliveryChecklist.item.electronics-audio.title':
      'Audio plays from all expected speakers without rattles, distortion, or dead zones.',
    'deliveryChecklist.item.electronics-climate.title':
      'HVAC, defrost, seat heaters/ventilation, and fan controls respond without unusual noise.',
    'deliveryChecklist.item.electronics-phone-usb.title':
      'Wireless chargers, USB ports, 12V/low-voltage outlets, Bluetooth, and app key work.',
    'deliveryChecklist.item.electronics-driver-assist.title':
      'Parking visualization, blind-spot camera, driver profiles, and safety settings are available.',
    'deliveryChecklist.item.charging-port-door.title':
      'Charge-port door opens, closes, lights, and sits flush.',
    'deliveryChecklist.item.charging-session.title':
      'Vehicle accepts a charging cable and reports a sane charging state.',
    'deliveryChecklist.item.charging-soc.title':
      'State of charge is reasonable for pickup and enough for the first drive.',
    'deliveryChecklist.item.charging-adapters.title':
      'Included charging adapter, mobile connector, or region-specific charging accessories are present.',
    'deliveryChecklist.item.model3-light-strip.title':
      'Ambient light strip, dash trim, and front door alignment look even.',
    'deliveryChecklist.item.model3-highland-controls.title':
      'Steering wheel buttons, turn controls, drive selection, and screen gestures work as expected.',
    'deliveryChecklist.item.modely-hatch.title':
      'Power liftgate height, rear hatch alignment, cargo covers, and rear water guards are correct.',
    'deliveryChecklist.item.modely-third-row-tow.title':
      'Third-row seats, tow hitch, and Gemini/Induction wheel details match the order if equipped.',
    'deliveryChecklist.item.cybertruck-stainless.title':
      'Stainless panels have consistent finish and no obvious dents, scratches, residue, or edge damage.',
    'deliveryChecklist.item.cybertruck-powered-frunk.title':
      'Powered frunk, front light bar, emergency release, front cameras, and tow hooks check out.',
    'deliveryChecklist.item.cybertruck-vault-bed.title':
      'Vault cover, bed outlets, tailgate, tonneau track, bed lighting, and tie-downs operate cleanly.',
    'deliveryChecklist.item.cybertruck-wipers-wash.title':
      'Large wiper, washer coverage, windshield edge trim, and glass cleaning quality are acceptable.',
    'deliveryChecklist.item.model3y-j1772.title':
      'J1772 adapter and trunk/frunk accessory kit are present if included for the region.',
    'deliveryChecklist.item.final-photos-notes.title': 'All issues have notes and photos where useful.',
    'deliveryChecklist.item.final-advisor-review.title':
      'Delivery advisor has acknowledged serious defects before you leave.',
    'deliveryChecklist.item.final-service-request.title':
      'Minor follow-up items are ready for a service request or documented report.',
    'deliveryChecklist.item.final-first-drive.title':
      'First drive plan includes charge, route, phone key, mirrors, and no blocking warnings.',
  },
  es: {
    'deliveryChecklist.routeChip': 'ENTREGA',
    'deliveryChecklist.tools': 'Herramientas de lista de entrega',
    'deliveryChecklist.export.download': 'Descargar lista',
    'deliveryChecklist.export.pdf': 'Reporte PDF',
    'deliveryChecklist.export.json': 'Respaldo JSON',
    'deliveryChecklist.export.text': 'Reporte de texto',
    'deliveryChecklist.overview.summary': 'Resumen de lista',
    'deliveryChecklist.defaultTitle': 'Entrega Tesla',
    'deliveryChecklist.progressComplete': '{complete} de {total} completados',
    'deliveryChecklist.progressShort': '{complete} de {total}',
    'deliveryChecklist.issueCount': '{count} {issueWord}',
    'deliveryChecklist.issueWord.one': 'incidencia',
    'deliveryChecklist.issueWord.other': 'incidencias',
    'deliveryChecklist.guidedFlow': 'Flujo guiado',
    'deliveryChecklist.deliveryProgress': 'Progreso de entrega',
    'deliveryChecklist.checklistSections': 'Secciones de la lista',
    'deliveryChecklist.stepKicker': 'Paso {current} de {total}',
    'deliveryChecklist.sectionTabAria':
      '{title}, paso {current} de {total}, {complete} de {progressTotal} completados, {issues} incidencias',
    'deliveryChecklist.sectionIssueSummary': '{complete}/{total} - {issues} {issueWord}',
    'deliveryChecklist.noIssues': 'Sin incidencias',
    'deliveryChecklist.chooseSetup': 'Elige configuración',
    'deliveryChecklist.imported': 'Importado',
    'deliveryChecklist.manual': 'Manual',
    'deliveryChecklist.vatioLibre': 'VatioLibre',
    'deliveryChecklist.previous': 'Anterior',
    'deliveryChecklist.nextSectionDefault': 'Siguiente sección',
    'deliveryChecklist.previousSection': 'Anterior: {section}',
    'deliveryChecklist.nextSection': 'Siguiente: {section}',
    'deliveryChecklist.chooseSetupOption': 'Elige una opción',
    'deliveryChecklist.finishMissing': 'Completa {count} pendientes',
    'deliveryChecklist.reviewComplete': 'Revisión completa',
    'deliveryChecklist.photo': 'Foto',
    'deliveryChecklist.photoCount.one': '{count} foto',
    'deliveryChecklist.photoCount.other': '{count} fotos',
    'deliveryChecklist.openPhoto': 'Abrir {caption}',
    'deliveryChecklist.deliveryPhoto': 'Foto de entrega',
    'deliveryChecklist.loadingPhotoPreview': 'Cargando vista previa de foto...',
    'deliveryChecklist.photoPreview': 'Vista previa de foto',
    'deliveryChecklist.closePhotoPreview': 'Cerrar vista previa de foto',

    'deliveryChecklist.step.windshieldVin.title': 'Leer VIN del parabrisas',
    'deliveryChecklist.step.windshieldVin.shortTitle': 'VIN',
    'deliveryChecklist.step.windshieldVin.description':
      'Captura primero el VIN del parabrisas y luego elige cómo llenar los detalles del vehículo.',
    'deliveryChecklist.step.vehicleSetup.title': 'Detalles del vehículo',
    'deliveryChecklist.step.vehicleSetup.shortTitle': 'Vehículo',
    'deliveryChecklist.step.vehicleSetup.description':
      'Elige importar desde VatioLibre o usar una lista manual local antes de inspeccionar.',

    'deliveryChecklist.vin.panelAria': 'VIN del parabrisas',
    'deliveryChecklist.vin.scanAria': 'Escaneo de VIN del parabrisas',
    'deliveryChecklist.vin.scanBody':
      'Usa OCR con la cámara para capturar localmente el VIN del parabrisas antes de elegir el método.',
    'deliveryChecklist.vin.notScanned': 'No escaneado',
    'deliveryChecklist.vin.optional': 'El escaneo es opcional.',
    'deliveryChecklist.vin.matchesVatioLibre': 'Coincide con el VIN de VatioLibre.',
    'deliveryChecklist.vin.mismatch': 'No coincide con el VIN de VatioLibre {vin}.',
    'deliveryChecklist.vin.backendUnavailable':
      'Guardado localmente. El VIN de VatioLibre no está disponible para comparar.',
    'deliveryChecklist.vin.manualOnly': 'Guardado localmente. La configuración manual no compara VIN.',
    'deliveryChecklist.vin.summaryMismatch': 'No coincide',
    'deliveryChecklist.vin.summarySaved': 'Guardado',
    'deliveryChecklist.vin.summaryOptional': 'Opcional',
    'deliveryChecklist.vin.read': 'Leer VIN',
    'deliveryChecklist.vin.enterManually': 'Ingresar manualmente',
    'deliveryChecklist.vin.clearScanned': 'Borrar VIN escaneado',
    'deliveryChecklist.vin.field': 'VIN del parabrisas',
    'deliveryChecklist.vin.placeholder': 'VIN de 17 caracteres',

    'deliveryChecklist.setup.panelAria': 'Detalles del vehículo',
    'deliveryChecklist.setup.body':
      'Elige VatioLibre para detalles automáticos del pedido, o conserva todo local y llena la lista manualmente.',
    'deliveryChecklist.setup.methodAria': 'Método de configuración',
    'deliveryChecklist.setup.useVatioLibre': 'Usar VatioLibre',
    'deliveryChecklist.setup.useVatioLibreBody':
      'Inicia sesión o usa tu sesión conectada para importar detalles del pedido Tesla.',
    'deliveryChecklist.setup.continueManual': 'Continuar manualmente',
    'deliveryChecklist.setup.continueManualBody':
      'Mantén esta lista local e ingresa solo los detalles que quieras.',
    'deliveryChecklist.setup.importTitle': 'Importación de VatioLibre',
    'deliveryChecklist.setup.importSelectAria': 'Vehículo o pedido de VatioLibre',
    'deliveryChecklist.setup.useSelected': 'Usar seleccionado',
    'deliveryChecklist.setup.loginImport': 'Iniciar sesión para importar desde VatioLibre',
    'deliveryChecklist.setup.modelLock':
      '{model} importado desde VatioLibre. Cambia a configuración manual para cambiar el modelo de la lista.',
    'deliveryChecklist.setup.vehicleModelAria': 'Modelo del vehículo',
    'deliveryChecklist.setup.vehicleInfoAria': 'Información del vehículo',
    'deliveryChecklist.setup.vin': 'VIN',
    'deliveryChecklist.setup.order': 'Pedido/RN',
    'deliveryChecklist.setup.pickup': 'Recogida',
    'deliveryChecklist.setup.pickupPlaceholder': 'Lugar de recogida',
    'deliveryChecklist.setup.newSession': 'Iniciar una lista local nueva',
    'deliveryChecklist.vehicleImported': 'Importado desde VatioLibre',

    'deliveryChecklist.review.title': 'Revisión',
    'deliveryChecklist.review.summary': '{issues} {issueWord} - {percent}% completado',
    'deliveryChecklist.review.noIssues': 'Aun no hay incidencias marcadas.',
    'deliveryChecklist.review.noNote': 'Sin nota aun.',
    'deliveryChecklist.copyReport': 'Copiar reporte',
    'deliveryChecklist.print': 'Imprimir',
    'deliveryChecklist.navigationAria': 'Navegación de la lista',

    'deliveryChecklist.scanner.sheetAria': 'Escanear VIN del parabrisas',
    'deliveryChecklist.scanner.liveGuidance':
      'Aléjate hasta que el VIN quede dentro de los corchetes amarillos pequeños, luego toca Capturar cuadro.',
    'deliveryChecklist.scanner.close': 'Cerrar escáner',
    'deliveryChecklist.scanner.captureFrame': 'Capturar cuadro',
    'deliveryChecklist.scanner.centerImageAria': 'Centrar imagen del VIN del parabrisas',
    'deliveryChecklist.scanner.centeredPreviewAria': 'Vista previa centrada del VIN',
    'deliveryChecklist.scanner.cropHint': 'Arrastra para centrar. Usa Zoom para ajustar.',
    'deliveryChecklist.scanner.zoom': 'Zoom',
    'deliveryChecklist.scanner.resetCrop': 'Restablecer recorte',
    'deliveryChecklist.scanner.retake': 'Tomar de nuevo',
    'deliveryChecklist.scanner.uploadImage': 'Subir imagen',
    'deliveryChecklist.scanner.takePhoto': 'Tomar foto',
    'deliveryChecklist.scanner.chooseImage': 'Elige un archivo de imagen del VIN del parabrisas.',
    'deliveryChecklist.scanner.centerThenRead': 'Centra el texto del VIN en el recorte y toca Leer VIN.',
    'deliveryChecklist.scanner.startingCamera': 'Iniciando cámara...',
    'deliveryChecklist.scanner.cameraUnavailable':
      'La cámara no está disponible aquí. Sube una foto del VIN o ingrésalo manualmente.',
    'deliveryChecklist.scanner.captureFailed':
      'No se pudo capturar el cuadro de la cámara. Intenta otra vez, sube una foto o ingrésalo manualmente.',
    'deliveryChecklist.scanner.reading': 'Leyendo...',
    'deliveryChecklist.scanner.noValidVin':
      'No se pudo leer un VIN válido. Re-centra el recorte, acerca el zoom o prueba un escaneo más amplio.',
    'deliveryChecklist.scanner.readFailed':
      'No se pudo leer el VIN. Intenta otra vez, sube otra foto o ingrésalo manualmente.',
    'deliveryChecklist.scanner.imageReadFailed':
      'No se pudo leer esa imagen. Prueba otra foto o ingresa el VIN manualmente.',
    'deliveryChecklist.ocr.diagnosticsAria': 'Diagnóstico OCR',
    'deliveryChecklist.ocr.diagnosticsTitle': 'Diagnóstico OCR',
    'deliveryChecklist.ocr.diagnosticsBody':
      'Las imágenes de depuración se quedan en este dispositivo salvo que las compartas. Usa estos archivos para ver el cuadro capturado, el recorte, variantes OCR y texto sin procesar.',
    'deliveryChecklist.ocr.previewAria': 'Vistas previas de imágenes de depuración OCR',
    'deliveryChecklist.ocr.tryWiderScan': 'Probar escaneo más amplio',
    'deliveryChecklist.ocr.copyJson': 'Copiar JSON',
    'deliveryChecklist.ocr.downloadDebug': 'Descargar archivos de depuración',

    'deliveryChecklist.item.critical': 'Crítico',
    'deliveryChecklist.item.unlocked': 'Desbloqueado',
    'deliveryChecklist.item.pass': 'Correcto',
    'deliveryChecklist.item.issue': 'Incidencia',
    'deliveryChecklist.item.skip': 'Omitir',
    'deliveryChecklist.item.note': 'Nota',
    'deliveryChecklist.item.notePlaceholder': 'Agrega notas listas para el asesor',

    'deliveryChecklist.status.chooseSetup':
      'Elige importar desde VatioLibre o ingresar detalles manuales antes de continuar.',
    'deliveryChecklist.status.finishHighlighted': 'Completa el ítem resaltado antes de avanzar.',
    'deliveryChecklist.status.saveFailed':
      'No se pudo guardar localmente. El almacenamiento del navegador puede estar lleno.',
    'deliveryChecklist.status.vinScanCleared': 'Escaneo de VIN del parabrisas borrado.',
    'deliveryChecklist.status.ocrJsonCopied': 'JSON de depuración OCR copiado.',
    'deliveryChecklist.status.ocrDebugDownloaded': 'Archivos de depuración OCR descargados.',
    'deliveryChecklist.status.fileNotImage': 'Ese archivo no es una imagen.',
    'deliveryChecklist.status.vinImageLoadFailed': 'No se pudo cargar la imagen del VIN.',
    'deliveryChecklist.status.cameraUnavailable':
      'El OCR con cámara no está disponible aquí. Sube una foto del VIN o ingrésalo manualmente.',
    'deliveryChecklist.status.captureFailed': 'No se pudo capturar la imagen del VIN.',
    'deliveryChecklist.status.vinReadSaved': 'VIN del parabrisas leído y guardado localmente.',
    'deliveryChecklist.status.noValidVin': 'No se encontró un VIN válido en la imagen centrada.',
    'deliveryChecklist.status.vinOcrFailed':
      'El OCR del VIN falló; la entrada manual sigue disponible.',
    'deliveryChecklist.status.photoStorageUnavailable':
      'El almacenamiento de fotos no está disponible aquí. Las notas se guardan localmente.',
    'deliveryChecklist.status.photoSaveFailed':
      'No se pudo guardar esa foto. La nota de la incidencia sigue local.',
    'deliveryChecklist.status.photoSaved': 'Foto guardada localmente.',
    'deliveryChecklist.status.manualSetupSelected': 'Configuración manual local seleccionada.',
    'deliveryChecklist.status.newChecklistStarted': 'Nueva lista local iniciada.',
    'deliveryChecklist.status.jsonExported': 'JSON de la lista exportado.',
    'deliveryChecklist.status.textExported': 'Reporte de texto de la lista exportado.',
    'deliveryChecklist.status.pdfExported': 'Reporte PDF de la lista exportado.',
    'deliveryChecklist.status.reportCopied': 'Reporte copiado.',
    'deliveryChecklist.status.reportSelected': 'Reporte seleccionado para copiar.',
    'deliveryChecklist.status.manualModeActive': 'Modo de lista manual activo.',
    'deliveryChecklist.status.checkingVatioLibre': 'Verificando conexión Tesla de VatioLibre...',
    'deliveryChecklist.status.ordersLoaded': 'Pedidos de VatioLibre cargados.',
    'deliveryChecklist.status.vehiclesLoaded': 'Vehículos de VatioLibre cargados.',
    'deliveryChecklist.status.noImportableData': 'No se encontraron datos Tesla importables.',
    'deliveryChecklist.status.importFailed':
      'La importación falló; el modo manual sigue disponible.',
    'deliveryChecklist.status.metadataImportedAuto': 'Metadatos de VatioLibre importados automáticamente.',
    'deliveryChecklist.status.metadataImported': 'Metadatos importados guardados localmente. Puedes editarlos aquí.',
    'deliveryChecklist.status.windshieldVinSaved': 'VIN del parabrisas guardado localmente.',
    'deliveryChecklist.status.photoAttachmentsUnavailable':
      'Los adjuntos de foto no están disponibles aquí; estados y notas se guardan localmente.',
    'deliveryChecklist.status.savedLocal': 'Guardado localmente en este navegador.',

    'deliveryChecklist.import.loginPrompt':
      'Inicia sesión para importar desde VatioLibre. La configuración manual sigue funcionando sin conexión.',
    'deliveryChecklist.import.unavailable': 'VatioLibre no está disponible en esta sesión. Continúa manualmente.',
    'deliveryChecklist.import.checking': 'Verificando conexión Tesla de VatioLibre...',
    'deliveryChecklist.import.notConnected':
      'Los datos Tesla no están conectados para esta sesión de VatioLibre. Continúa manualmente.',
    'deliveryChecklist.import.selectOrder': 'Selecciona un pedido para llenar la lista. Nada se sincroniza de vuelta.',
    'deliveryChecklist.import.selectVehicle':
      'Selecciona un vehículo para llenar la lista. Los vehículos dormidos no se activarán.',
    'deliveryChecklist.import.noneFound': 'No se encontraron pedidos o vehículos Tesla compatibles. Continúa manualmente.',
    'deliveryChecklist.import.failed': 'No se pudieron cargar datos Tesla de VatioLibre. Continúa manualmente.',
    'deliveryChecklist.import.auto': 'Se importó el único vehículo/pedido coincidente de VatioLibre. Nada se sincroniza de vuelta.',
    'deliveryChecklist.import.saved': 'Metadatos importados guardados localmente. Puedes editarlos aquí.',

    'deliveryChecklist.report.title': 'Lista de entrega Tesla: {title}',
    'deliveryChecklist.report.model': 'Modelo: {model}',
    'deliveryChecklist.report.vin': 'VIN: {vin}',
    'deliveryChecklist.report.windshieldVin': 'VIN del parabrisas: {vin}',
    'deliveryChecklist.report.windshieldVinManual': 'Comparación del VIN del parabrisas: Solo manual/local',
    'deliveryChecklist.report.windshieldVinUnavailable':
      'Comparación del VIN del parabrisas: VIN del backend no disponible',
    'deliveryChecklist.report.windshieldVinMatch': 'Comparación del VIN del parabrisas: Coincide',
    'deliveryChecklist.report.windshieldVinMismatch':
      'Comparación del VIN del parabrisas: No coincide (backend {vin})',
    'deliveryChecklist.report.order': 'Pedido: {order}',
    'deliveryChecklist.report.pickup': 'Recogida: {pickup}',
    'deliveryChecklist.report.progress': 'Progreso: {complete}/{total} ({percent}%)',
    'deliveryChecklist.report.issues': 'Incidencias: {count}',
    'deliveryChecklist.report.issuesHeading': 'Incidencias',
    'deliveryChecklist.report.noIssues': 'No hay incidencias marcadas.',
    'deliveryChecklist.report.photos.one': '({count} foto)',
    'deliveryChecklist.report.photos.other': '({count} fotos)',
    'deliveryChecklist.report.sourcesHeader': 'Fuentes usadas para estructurar la lista:',
    'deliveryChecklist.sessionTitle': 'Entrega {model}',

    'deliveryChecklist.section.records.title': 'Registros',
    'deliveryChecklist.section.records.shortTitle': 'Registros',
    'deliveryChecklist.section.records.description':
      'Confirma que el vehículo y los documentos coincidan antes de revisar detalles.',
    'deliveryChecklist.section.locked-exterior.title': 'Exterior cerrado',
    'deliveryChecklist.section.locked-exterior.shortTitle': 'Cerrado',
    'deliveryChecklist.section.locked-exterior.description':
      'Revisiones que normalmente se pueden hacer antes de aceptar o desbloquear el vehículo.',
    'deliveryChecklist.section.unlocked-exterior.title': 'Exterior abierto',
    'deliveryChecklist.section.unlocked-exterior.shortTitle': 'Abierto',
    'deliveryChecklist.section.unlocked-exterior.description':
      'Abre y opera paneles exteriores, puertas, vidrios, sellos y áreas de carga.',
    'deliveryChecklist.section.interior.title': 'Interior',
    'deliveryChecklist.section.interior.shortTitle': 'Interior',
    'deliveryChecklist.section.interior.description':
      'Inspecciona molduras, asientos, controles, almacenamiento y accesorios de cabina.',
    'deliveryChecklist.section.electronics.title': 'Electrónica',
    'deliveryChecklist.section.electronics.shortTitle': 'Tecnología',
    'deliveryChecklist.section.electronics.description':
      'Verifica pantalla, cámaras, luces, software y sistemas de confort.',
    'deliveryChecklist.section.charging.title': 'Carga',
    'deliveryChecklist.section.charging.shortTitle': 'Carga',
    'deliveryChecklist.section.charging.description':
      'Revisa equipo de carga, adaptadores, puertos, estado de carga y comportamiento al cargar.',
    'deliveryChecklist.section.model-specific.title': 'Específico del modelo',
    'deliveryChecklist.section.model-specific.shortTitle': 'Modelo',
    'deliveryChecklist.section.model-specific.description':
      'Ítems que cambian de forma importante entre Model 3, Model Y y Cybertruck.',
    'deliveryChecklist.section.final-review.title': 'Revisión final',
    'deliveryChecklist.section.final-review.shortTitle': 'Revisión',
    'deliveryChecklist.section.final-review.description':
      'Reúne incidencias, fotos y notas listas para el asesor antes de irte.',

    'deliveryChecklist.item.records-vin-match.title':
      'El VIN coincide en la app, documentos, parabrisas y pantalla del vehículo.',
    'deliveryChecklist.item.records-vin-match.helper':
      'Trata cualquier diferencia como un punto para detenerte y preguntar antes de aceptar la entrega.',
    'deliveryChecklist.item.records-name-address.title':
      'Nombre, direccion de registro y documentos de entrega son correctos.',
    'deliveryChecklist.item.records-config-match.title':
      'Pintura, rines, interior, version y opciones pedidas coinciden con el pedido.',
    'deliveryChecklist.item.records-insurance-payment.title':
      'Seguro, estado de pago, vehiculo a cambio y documentos requeridos estan listos.',
    'deliveryChecklist.item.records-delivery-time.title':
      'La hora de entrega y la luz son suficientes para una revision cuidadosa.',
    'deliveryChecklist.item.locked-panel-gaps.title':
      'Paneles, puertas, cofre/frunk, cajuela y area del puerto de carga estan parejos y al ras.',
    'deliveryChecklist.item.locked-panel-gaps.helper':
      'Busca separaciones grandes, disparejas o con roce, no pequenas diferencias cosmeticas.',
    'deliveryChecklist.item.locked-paint-walkaround.title':
      'Pintura o acabado inoxidable sin golpes, abolladuras, manchas, rayones u overspray evidentes.',
    'deliveryChecklist.item.locked-glass-alignment.title':
      'Parabrisas, techo de vidrio, espejos y vidrio trasero estan alineados y sin dano.',
    'deliveryChecklist.item.locked-lights-fit.title':
      'Faros, luces traseras, barras de luz y lentes estan asentados, claros y secos.',
    'deliveryChecklist.item.locked-wheels-tires.title':
      'Rines, llantas, tapas, areas de birlos y valvulas no muestran dano visible.',
    'deliveryChecklist.item.locked-undercarriage.title':
      'Parte inferior, estribos, pasos de rueda, sujetadores y cubiertas aerodinamicas no estan danados ni flojos.',
    'deliveryChecklist.item.locked-cameras-sensors.title':
      'Camaras exteriores y cubiertas de sensores estan limpias, asentadas y sin grietas.',
    'deliveryChecklist.item.unlocked-doors-windows.title':
      'Todas las puertas abren, cierran, aseguran y la indexacion de ventanas funciona sin rozar.',
    'deliveryChecklist.item.unlocked-frunk-trunk.title':
      'Frunk y cajuela/porton abren y cierran suavemente; luces y botones de liberacion funcionan.',
    'deliveryChecklist.item.unlocked-seals-weather.title':
      'Sellos de puertas, vidrios, cajuela, frunk y techo estan sujetos, continuos y sin pellizcos.',
    'deliveryChecklist.item.unlocked-door-jambs.title':
      'Marcos de puerta, bisagras, estribos y bordes ocultos de pintura estan limpios y sin dano.',
    'deliveryChecklist.item.unlocked-wipers-washer.title':
      'Limpiaparabrisas y lavaparabrisas funcionan correctamente y no tocan paneles pintados.',
    'deliveryChecklist.item.unlocked-front-license.title':
      'Portaplaca frontal, gancho de remolque y accesorios sueltos incluidos estan presentes cuando aplique.',
    'deliveryChecklist.item.interior-screen-trim.title':
      'Pantalla, tablero, consola, molduras de puerta, techo, alfombra y estribos estan limpios y sin dano.',
    'deliveryChecklist.item.interior-seats.title':
      'Asientos, costuras, soportes laterales, banca trasera y mecanismos plegables estan alineados y sin dano.',
    'deliveryChecklist.item.interior-seat-controls.title':
      'Ajuste de asientos delanteros, lumbar, controles del volante, espejos y funciones de plegado funcionan.',
    'deliveryChecklist.item.interior-storage.title':
      'Guantera, consola central, portavasos, ganchos, cubiertas de carga y compartimentos funcionan.',
    'deliveryChecklist.item.interior-pedals-belts.title':
      'Pedales, cinturones, liberaciones de emergencia y puntos de anclaje estan firmes y accesibles.',
    'deliveryChecklist.item.interior-floor-mats.title':
      'Tapetes, forros de cajuela/frunk y paneles de carga ajustan sin bordes sueltos o danados.',
    'deliveryChecklist.item.electronics-display.title':
      'La pantalla inicia, responde normal, no muestra advertencias y puede reiniciarse correctamente.',
    'deliveryChecklist.item.electronics-cameras.title':
      'Vistas de camaras trasera, laterales, frontal y de cabina aparecen claras donde esten disponibles.',
    'deliveryChecklist.item.electronics-lights.title':
      'Faros, intermitentes, direccionales, frenos, reversa, niebla y luces interiores funcionan.',
    'deliveryChecklist.item.electronics-audio.title':
      'Audio suena en todas las bocinas esperadas sin vibraciones, distorsion o zonas muertas.',
    'deliveryChecklist.item.electronics-climate.title':
      'Clima, desempanador, calefaccion/ventilacion de asientos y ventilador responden sin ruidos raros.',
    'deliveryChecklist.item.electronics-phone-usb.title':
      'Cargadores inalambricos, USB, tomas de bajo voltaje/12V, Bluetooth y llave en app funcionan.',
    'deliveryChecklist.item.electronics-driver-assist.title':
      'Visualizacion de estacionamiento, camara de punto ciego, perfiles y ajustes de seguridad estan disponibles.',
    'deliveryChecklist.item.charging-port-door.title':
      'Puerta del puerto de carga abre, cierra, ilumina y queda al ras.',
    'deliveryChecklist.item.charging-session.title':
      'El vehiculo acepta un cable de carga y muestra un estado de carga razonable.',
    'deliveryChecklist.item.charging-soc.title':
      'El estado de carga es razonable para la recogida y suficiente para el primer viaje.',
    'deliveryChecklist.item.charging-adapters.title':
      'Adaptador de carga, conector movil o accesorios regionales de carga incluidos estan presentes.',
    'deliveryChecklist.item.model3-light-strip.title':
      'Tira de luz ambiental, moldura del tablero y alineacion de puertas delanteras se ven parejas.',
    'deliveryChecklist.item.model3-highland-controls.title':
      'Botones del volante, controles de direccional, seleccion de marcha y gestos de pantalla funcionan como se espera.',
    'deliveryChecklist.item.modely-hatch.title':
      'Altura del porton electrico, alineacion trasera, cubiertas de carga y guardas de agua traseras son correctas.',
    'deliveryChecklist.item.modely-third-row-tow.title':
      'Tercera fila, enganche de remolque y detalles de rines Gemini/Induction coinciden con el pedido si aplica.',
    'deliveryChecklist.item.cybertruck-stainless.title':
      'Paneles inoxidables tienen acabado consistente y sin abolladuras, rayones, residuos o dano de borde evidentes.',
    'deliveryChecklist.item.cybertruck-powered-frunk.title':
      'Frunk electrico, barra de luz frontal, liberacion de emergencia, camaras frontales y ganchos de remolque estan bien.',
    'deliveryChecklist.item.cybertruck-vault-bed.title':
      'Cubierta del vault, tomas de la cama, compuerta, riel del tonneau, luces y amarres funcionan limpiamente.',
    'deliveryChecklist.item.cybertruck-wipers-wash.title':
      'Limpiaparabrisas grande, cobertura del lavado, moldura del borde del parabrisas y limpieza del vidrio son aceptables.',
    'deliveryChecklist.item.model3y-j1772.title':
      'Adaptador J1772 y kit de accesorios de cajuela/frunk estan presentes si se incluyen en la region.',
    'deliveryChecklist.item.final-photos-notes.title':
      'Todas las incidencias tienen notas y fotos cuando sea util.',
    'deliveryChecklist.item.final-advisor-review.title':
      'El asesor de entrega reconocio defectos serios antes de que te vayas.',
    'deliveryChecklist.item.final-service-request.title':
      'Items menores de seguimiento estan listos para una solicitud de servicio o reporte documentado.',
    'deliveryChecklist.item.final-first-drive.title':
      'El plan del primer viaje incluye carga, ruta, llave del telefono, espejos y ninguna advertencia bloqueante.',
  },
} as const;
