# CALCX

CALCX is a responsive, offline-friendly calculator built with HTML, CSS, and vanilla JavaScript. It includes a safe expression parser, scientific functions, persistent calculation history, and a polished keyboard-accessible interface.

## Run locally

No build step, package manager, or backend is required.

1. Download or clone this project.
2. Open `index.html` in a modern browser.

For a local web server, run `npx serve .` from the project directory or use the Live Server extension in VS Code.

## Features

- Standard arithmetic with operator precedence, grouped expressions, percentages, sign toggle, and chained calculations.
- Scientific functions: square root, square, powers, reciprocal, trigonometry, logarithms, constants, factorial, and scientific notation.
- Degree/radian selection, live expression preview, result formatting, and clipboard copy.
- Calculation history with search, click-to-reuse, timestamps, and confirmation before clearing.
- Memory controls, persistent history and settings, dark/light themes, and four accent colors.
- Mouse, touch, and keyboard controls; fullscreen mode and shortcut guide.
- Responsive layouts, focus indicators, reduced-motion support, and device-local storage.

## How the code is organized

Read these files in this order if you are learning how the app works:

1. **`index.html`** describes the page: header, calculator display, buttons, history panel, and dialogs. The `id` and `data-*` attributes give JavaScript a way to find and respond to controls.
2. **`style.css`** controls the appearance. The `:root` section defines reusable colors, component selectors style individual parts, and the media queries near the bottom adjust the layout for smaller screens.
3. **`script.js`** connects the controls to the calculator. It loads saved settings, parses and calculates expressions, updates the display, and handles history, memory, keyboard input, and preferences.

When a calculator button is clicked, its event handler updates the expression and refreshes the display. When you calculate, the expression is tokenized and parsed according to operator precedence; the result is then displayed and saved to history. The parser is ordinary JavaScript code and does not execute the entered expression as code.

## Screenshots

Add screenshots of the standard and scientific calculator views here.

## Calculation behavior

Expressions are tokenized and parsed in JavaScript; user input is never passed to `eval()` or `Function()`. A percent sign is a postfix percentage (`200 × 10%` evaluates to `20`). Factorials accept integers from 0 through 170. Trigonometric functions use the selected angle mode.

## Preferences and data

History, theme, calculator mode, angle mode, accent color, and memory are stored in the browser's local storage. All calculations happen locally in the browser. Clearing browser site data removes saved CALCX data.

## Deployment

Deploy the project directory to any static hosting provider (for example, GitHub Pages, Netlify, or Cloudflare Pages). Publish `index.html`, `style.css`, and `script.js` together; no server-side configuration is needed.
