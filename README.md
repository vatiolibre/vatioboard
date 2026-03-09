# VatioBoard

**VatioBoard** is a fast, full-screen drawing board with a built-in calculator, designed to work great on modern browsers—including in-car browsers like Tesla’s.

This project is part of the **VatioLibre.com** community and is shared for **educational purposes**.

- Production URL: https://www.vatioboard.com
- Repository: https://github.com/vatiolibre/vatioboard  
- Creator: **Oscar Perez**
- Community: **VatioLibre.com** (https://vatiolibre.com)

---

## Features

- ✍️ Full-screen drawing canvas (pen + eraser)
- 🎚️ Brush size control
- 🎨 Color presets + custom color picker
- 🖼️ Export drawing as PNG
- 🧮 Embeddable calculator widget (floating panel / button-triggered)
- 🌗 Light/Dark mode friendly UI
- 📱 Touch optimized (great for tablets and in-car browsers)

---

## Tech Stack

- **Vite** (build + dev server)
- **Vanilla JavaScript** (ES Modules)
- **LESS** (styling)

---

## Project Structure (high level)

```txt
.
├─ index.html                 # Main drawing board page
├─ calculator.html            # Calculator demo page
├─ src/
│  ├─ board/board.js          # Drawing board logic + calculator integration
│  ├─ calculator/             # Calculator widget + core logic
│  └─ styles/                 # LESS styles for board and calculator
└─ vite.config.js             # Vite multi-page build configuration
````

---

## Getting Started

### Requirements

* Node.js 24+ recommended
* npm (or pnpm/yarn if you prefer)

### Install

```bash
npm install
```

### Run locally (dev mode)

```bash
npm run dev
```

Then open the URL shown in the terminal (usually `http://localhost:5173`).

### Production build

```bash
npm run build
```

### Preview production build

```bash
npm run preview
```

---

## Pages

* **Board**: `index.html` (drawing board + calculator button)
* **Calculator demo**: `calculator.html` (standalone calculator demo)

Vite is configured as a **multi-page app** via `rollupOptions.input` in `vite.config.js`.

---

## Educational Use

This repository is published as part of the **VatioLibre.com community** for learning and educational exploration.
You’re welcome to study it, fork it, and build on it—please provide attribution.

---

## Contributing

Contributions are welcome—especially bug fixes, UI improvements, and Tesla/in-car usability enhancements.

1. Fork the repo
2. Create a feature branch
3. Commit your changes
4. Open a Pull Request

---

## License

* **MIT License**

---

## Credits

Created by **Oscar Perez**.
Part of the **VatioLibre.com** community.
Logos and branding contribution by **Mauricio Pradilla**: https://mauriciopradilla.com/
Contributions to **vatioboard.com** and **vatiolibre.com** by **Santiago Jimenez Moncada**: https://github.com/ssantss
