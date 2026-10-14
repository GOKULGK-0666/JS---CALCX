"use strict";

const STORAGE_KEYS = {
  history: "calcx.history.v1",
  settings: "calcx.settings.v1",
  memory: "calcx.memory.v1",
};
const DEFAULT_SETTINGS = {
  theme: "dark",
  mode: "standard",
  angle: "DEG",
  accent: "violet",
  sound: false,
};
const ACCENTS = {
  violet: { color: "#8b7cff", rgb: "139, 124, 255" },
  blue: { color: "#5b9dff", rgb: "91, 157, 255" },
  cyan: { color: "#37cbd6", rgb: "55, 203, 214" },
  pink: { color: "#ee77bd", rgb: "238, 119, 189" },
};
const MAX_HISTORY = 100;
const MAX_EXPRESSION_LENGTH = 240;
const FUNCTION_NAMES = new Set(["sin", "cos", "tan", "sqrt", "log", "ln"]);
const CONSTANTS = { pi: Math.PI, e: Math.E };

const elements = {
  expression: document.querySelector("#expression-display"),
  result: document.querySelector("#result-display"),
  preview: document.querySelector("#preview-display"),
  scientificKeys: document.querySelector("#scientific-keys"),
  standardMode: document.querySelector("#standard-mode"),
  scientificMode: document.querySelector("#scientific-mode"),
  angle: document.querySelector("#angle-mode"),
  historyPanel: document.querySelector("#history-panel"),
  historyList: document.querySelector("#history-list"),
  historySearch: document.querySelector("#history-search"),
  historyCount: document.querySelector("#history-count"),
  memoryIndicator: document.querySelector("#memory-indicator"),
  memoryLabel: document.querySelector("#memory-value-label"),
  toast: document.querySelector("#toast"),
  shortcutsDialog: document.querySelector("#shortcuts-dialog"),
};

let settings = loadStored(
  STORAGE_KEYS.settings,
  DEFAULT_SETTINGS,
  validateSettings,
);
let history = loadStored(STORAGE_KEYS.history, [], (value) =>
  Array.isArray(value)
    ? value.filter(isHistoryEntry).slice(0, MAX_HISTORY)
    : [],
);
let memory = loadStored(STORAGE_KEYS.memory, null, (value) =>
  Number.isFinite(value) ? value : null,
);
let expression = "";
let result = 0;
let lastWasResult = false;
let toastTimer;
let audioContext;

function loadStored(key, fallback, validate) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return validate(JSON.parse(raw));
  } catch (error) {
    console.error(`Unable to load CALCX setting "${key}".`, error);
    return fallback;
  }
}

function saveStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Unable to save CALCX data "${key}".`, error);
    showToast("Could not save changes to this device.");
  }
}

function validateSettings(value) {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  return {
    theme: value.theme === "light" ? "light" : "dark",
    mode: value.mode === "scientific" ? "scientific" : "standard",
    angle: value.angle === "RAD" ? "RAD" : "DEG",
    accent: Object.hasOwn(ACCENTS, value.accent) ? value.accent : "violet",
    sound: value.sound === true,
  };
}

function isHistoryEntry(item) {
  return (
    item &&
    typeof item.expression === "string" &&
    typeof item.result === "number" &&
    Number.isFinite(item.result) &&
    typeof item.timestamp === "number" &&
    Number.isFinite(item.timestamp)
  );
}

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const numberMatch = source
      .slice(index)
      .match(/^(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?/);
    if (numberMatch) {
      const value = Number(numberMatch[0]);
      if (!Number.isFinite(value))
        throw new Error("Number is outside the supported range.");
      tokens.push({ type: "number", value });
      index += numberMatch[0].length;
      continue;
    }
    const identifierMatch = source.slice(index).match(/^[a-zA-Z]+/);
    if (identifierMatch) {
      const name = identifierMatch[0].toLowerCase();
      if (
        name === "e" &&
        source[index] === "E" &&
        /[+\-\d.]/.test(source[index + 1] || "")
      ) {
        tokens.push({ type: "operator", value: "E" });
      } else if (Object.hasOwn(CONSTANTS, name)) {
        tokens.push({ type: "number", value: CONSTANTS[name] });
      } else if (FUNCTION_NAMES.has(name)) {
        tokens.push({ type: "function", value: name });
      } else {
        throw new Error(`Unknown function or constant: ${identifierMatch[0]}`);
      }
      index += identifierMatch[0].length;
      continue;
    }
    if ("+-*/^()%!".includes(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    throw new Error(`Unsupported character: ${char}`);
  }
  return tokens;
}

function parseExpression(source, angleMode = settings.angle) {
  const tokens = tokenize(source);
  let position = 0;

  function peek(value) {
    return tokens[position]?.value === value;
  }
  function consume(value) {
    if (!peek(value)) throw new Error(`Expected "${value}".`);
    position += 1;
  }
  function parseAdditive() {
    let value = parseMultiplicative();
    while (peek("+") || peek("-")) {
      const operator = tokens[position++].value;
      const right = parseMultiplicative();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  function parseMultiplicative() {
    let value = parseUnary();
    while (peek("*") || peek("/")) {
      const operator = tokens[position++].value;
      const right = parseUnary();
      if (operator === "*") value *= right;
      if (operator === "/") {
        if (right === 0) throw new Error("Cannot divide by zero.");
        value /= right;
      }
    }
    return value;
  }
  function parseUnary() {
    if (peek("+")) {
      position += 1;
      return parseUnary();
    }
    if (peek("-")) {
      position += 1;
      return -parseUnary();
    }
    return parsePower();
  }
  function parsePower() {
    let value = parsePostfix();
    if (peek("^")) {
      position += 1;
      value = Math.pow(value, parseUnary());
    }
    return value;
  }
  function parsePostfix() {
    let value = parsePrimary();
    while (peek("!") || peek("%")) {
      const operator = tokens[position++].value;
      if (operator === "!") value = factorial(value);
      else value /= 100;
    }
    return value;
  }
  function parsePrimary() {
    const token = tokens[position];
    if (!token) throw new Error("Expression is incomplete.");
    if (token.type === "number") {
      position += 1;
      return token.value;
    }
    if (token.type === "function") {
      position += 1;
      consume("(");
      const argument = parseAdditive();
      consume(")");
      return applyFunction(token.value, argument, angleMode);
    }
    if (peek("(")) {
      position += 1;
      const value = parseAdditive();
      consume(")");
      return value;
    }
    throw new Error("Expected a number or grouped expression.");
  }

  if (!tokens.length) throw new Error("Enter a calculation first.");
  const value = parseAdditive();
  if (position !== tokens.length)
    throw new Error("Check the expression and try again.");
  if (!Number.isFinite(value))
    throw new Error("Result is outside the supported range.");
  return value;
}

function factorial(value) {
  if (!Number.isInteger(value) || value < 0)
    throw new Error("Factorial needs a non-negative whole number.");
  if (value > 170) throw new Error("Factorial is limited to 170.");
  let product = 1;
  for (let number = 2; number <= value; number += 1) product *= number;
  return product;
}

function applyFunction(name, value, angleMode) {
  const radians = angleMode === "DEG" ? (value * Math.PI) / 180 : value;
  let resultValue;
  if (name === "sin") resultValue = Math.sin(radians);
  else if (name === "cos") resultValue = Math.cos(radians);
  else if (name === "tan") {
    if (Math.abs(Math.cos(radians)) < 1e-14)
      throw new Error("Tangent is undefined at this angle.");
    resultValue = Math.tan(radians);
  } else if (name === "sqrt") {
    if (value < 0) throw new Error("Square root needs a non-negative number.");
    resultValue = Math.sqrt(value);
  } else if (name === "log" || name === "ln") {
    if (value <= 0)
      throw new Error("Logarithm needs a number greater than zero.");
    resultValue = name === "log" ? Math.log10(value) : Math.log(value);
  }
  if (!Number.isFinite(resultValue))
    throw new Error("Result is outside the supported range.");
  return resultValue;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "Error";
  if (Object.is(value, -0)) value = 0;
  const absolute = Math.abs(value);
  if ((absolute !== 0 && absolute < 1e-9) || absolute >= 1e15) {
    return value
      .toExponential(8)
      .replace(/\.?0+e/, "e")
      .replace("e+", "e");
  }
  return new Intl.NumberFormat("en-US", {
    useGrouping: true,
    maximumFractionDigits: 10,
  }).format(Number(value.toPrecision(12)));
}

function displayExpression(source) {
  return source
    .replace(/pi/gi, "π")
    .replace(/\*/g, "×")
    .replace(/\//g, "÷")
    .replace(/-/g, "−")
    .replace(/sqrt\(/g, "√(");
}

function updateDisplay({ error = "", isResult = false } = {}) {
  elements.expression.textContent = expression
    ? displayExpression(expression)
    : "Ready when you are";
  elements.result.classList.remove("is-error", "result-pop");
  if (error) {
    elements.result.textContent = error;
    elements.result.classList.add("is-error");
    elements.preview.textContent = "";
    return;
  }
  elements.result.textContent = formatNumber(result);
  if (isResult) {
    void elements.result.offsetWidth;
    elements.result.classList.add("result-pop");
  }
  elements.preview.textContent = "";
  if (expression && !lastWasResult) {
    try {
      const preview = parseExpression(expression);
      elements.preview.textContent = `= ${formatNumber(preview)}`;
    } catch {
      // Partial input is expected while the user is entering an expression.
    }
  }
}

function appendInput(value) {
  if (
    lastWasResult &&
    /[0-9.]|pi|e|sin\(|cos\(|tan\(|sqrt\(|log\(|ln\(|\(/.test(value)
  )
    expression = "";
  lastWasResult = false;
  if (expression.length + value.length > MAX_EXPRESSION_LENGTH) {
    showToast("Expression is at the maximum length.");
    return;
  }
  if (value === ".") {
    const currentNumber =
      expression.match(/(?:^|[+\-*/^(])(-?\d*\.?\d*)$/)?.[1] || "";
    if (currentNumber.includes(".")) return;
    if (!currentNumber) value = "0.";
  }
  if (/^[+*/^%]$/.test(value) && (!expression || /[+\-*/^(]$/.test(expression)))
    return;
  if (
    value === ")" &&
    (countChar(expression, "(") <= countChar(expression, ")") ||
      /[+\-*/^(]$/.test(expression))
  )
    return;
  expression += value;
  const operator = expression.match(/[+\-*/^]$/)?.[0];
  setActiveOperator(operator);
  updateDisplay();
  playSound();
}

function countChar(source, char) {
  return source.split(char).length - 1;
}

function clearCalculator() {
  expression = "";
  result = 0;
  lastWasResult = false;
  setActiveOperator("");
  updateDisplay();
}

function deleteLast() {
  if (lastWasResult) {
    expression = "";
    lastWasResult = false;
  } else {
    expression = expression.slice(0, -1);
  }
  result = 0;
  setActiveOperator(expression.match(/[+\-*/^]$/)?.[0] || "");
  updateDisplay();
}

function toggleSign() {
  if (!expression) expression = "0";
  if (expression.endsWith("*(-1)")) expression = expression.slice(0, -5);
  else if (/[0-9.)]$/.test(expression)) expression += "*(-1)";
  else expression = `-(${expression})`;
  lastWasResult = false;
  updateDisplay();
}

function applyUnaryFunction(name) {
  if (lastWasResult) expression = String(result);
  const operandStart = findTrailingOperandStart(expression);
  if (operandStart < 0) expression += `${name}(`;
  else
    expression = `${expression.slice(0, operandStart)}${name}(${expression.slice(operandStart)})`;
  lastWasResult = false;
  setActiveOperator("");
  updateDisplay();
}

function applyReciprocal() {
  if (lastWasResult) expression = String(result);
  const operandStart = findTrailingOperandStart(expression);
  if (operandStart < 0) expression += "1/(";
  else
    expression = `${expression.slice(0, operandStart)}1/(${expression.slice(operandStart)})`;
  lastWasResult = false;
  setActiveOperator("");
  updateDisplay();
}

function applySquare() {
  if (lastWasResult) expression = String(result);
  const operandStart = findTrailingOperandStart(expression);
  if (operandStart >= 0) {
    expression = `${expression.slice(0, operandStart)}(${expression.slice(operandStart)})^2`;
    lastWasResult = false;
    setActiveOperator("");
    updateDisplay();
  }
}

function findTrailingOperandStart(source) {
  if (source.endsWith("*(-1)"))
    return findTrailingOperandStart(source.slice(0, -5));
  const numberOrConstant = source.match(
    /(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|pi|e)(?:[!%])*/i,
  );
  if (
    numberOrConstant &&
    numberOrConstant.index + numberOrConstant[0].length === source.length
  ) {
    let start = numberOrConstant.index;
    while (start > 0 && /[!%]/.test(source[start - 1])) start -= 1;
    if (
      start > 0 &&
      source[start - 1] === "-" &&
      (start === 1 || /[()+*/^]/.test(source[start - 2]))
    )
      start -= 1;
    return start;
  }
  if (!source.endsWith(")")) return -1;
  let depth = 0;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (source[index] === ")") depth += 1;
    else if (source[index] === "(") {
      depth -= 1;
      if (depth === 0) {
        const functionPrefix = source
          .slice(0, index)
          .match(/(?:sin|cos|tan|sqrt|log|ln)$/i);
        return functionPrefix ? index - functionPrefix[0].length : index;
      }
    }
  }
  return -1;
}

function calculate() {
  if (!expression) {
    if (lastWasResult) return;
    showToast("Enter a calculation first.");
    return;
  }
  try {
    const answer = parseExpression(expression);
    const completedExpression = expression;
    result = answer;
    expression = completedExpression;
    lastWasResult = true;
    updateDisplay({ isResult: true });
    addHistory(completedExpression, answer);
    setActiveOperator("");
    playSound(true);
  } catch (error) {
    updateDisplay({
      error: error instanceof Error ? error.message : "Invalid expression.",
    });
  }
}

function formatExpressionForHistory(source) {
  return displayExpression(source);
}

function setActiveOperator(operator) {
  document.querySelectorAll(".operator-key").forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.insert === operator && Boolean(operator),
    );
  });
}

function addHistory(source, answer) {
  history.unshift({
    expression: formatExpressionForHistory(source),
    result: answer,
    timestamp: Date.now(),
  });
  history = history.slice(0, MAX_HISTORY);
  saveStored(STORAGE_KEYS.history, history);
  renderHistory();
}

function renderHistory() {
  const query = elements.historySearch.value.trim().toLowerCase();
  const matches = history.filter(
    (item) =>
      item.expression.toLowerCase().includes(query) ||
      formatNumber(item.result).toLowerCase().includes(query),
  );
  elements.historyCount.textContent = `${history.length} ${history.length === 1 ? "calculation" : "calculations"}`;
  elements.historyList.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"></path><path d="M3 3v5h5m4-1v5l3 2"></path></svg>';
    const title = document.createElement("strong");
    title.textContent = query ? "No matches found" : "Your history is empty";
    const description = document.createElement("p");
    description.textContent = query
      ? "Try another search term."
      : "Your calculations will appear here as you work.";
    empty.append(icon, title, description);
    elements.historyList.append(empty);
    return;
  }
  matches.forEach((item) => {
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "history-item";
    entry.setAttribute(
      "aria-label",
      `${item.expression} equals ${formatNumber(item.result)}. Reuse result.`,
    );
    const expressionText = document.createElement("p");
    expressionText.className = "history-expression";
    expressionText.textContent = item.expression;
    const resultText = document.createElement("p");
    resultText.className = "history-result";
    resultText.textContent = formatNumber(item.result);
    const time = document.createElement("p");
    time.className = "history-time";
    time.textContent = formatTimestamp(item.timestamp);
    entry.append(expressionText, resultText, time);
    entry.addEventListener("click", () => reuseHistoryResult(item.result));
    elements.historyList.append(entry);
  });
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function reuseHistoryResult(value) {
  expression = String(value);
  result = value;
  lastWasResult = false;
  setActiveOperator("");
  updateDisplay();
  closeHistory();
}

function clearHistory() {
  if (!history.length) {
    showToast("There is no history to clear.");
    return;
  }
  if (!window.confirm("Delete all saved calculations? This cannot be undone."))
    return;
  history = [];
  saveStored(STORAGE_KEYS.history, history);
  renderHistory();
  showToast("Calculation history cleared.");
}

function setMode(mode) {
  settings.mode = mode;
  const scientific = mode === "scientific";
  elements.scientificKeys.hidden = !scientific;
  elements.standardMode.classList.toggle("is-selected", !scientific);
  elements.standardMode.setAttribute("aria-pressed", String(!scientific));
  elements.scientificMode.classList.toggle("is-selected", scientific);
  elements.scientificMode.setAttribute("aria-pressed", String(scientific));
  saveStored(STORAGE_KEYS.settings, settings);
}

function setTheme(theme) {
  settings.theme = theme;
  document.body.classList.toggle("light-theme", theme === "light");
  document
    .querySelector("#theme-toggle")
    .setAttribute(
      "aria-label",
      theme === "light" ? "Switch to dark theme" : "Switch to light theme",
    );
  saveStored(STORAGE_KEYS.settings, settings);
}

function setAccent(accent) {
  const selected = ACCENTS[accent];
  if (!selected) return;
  settings.accent = accent;
  document.documentElement.style.setProperty("--accent", selected.color);
  document.documentElement.style.setProperty("--accent-rgb", selected.rgb);
  saveStored(STORAGE_KEYS.settings, settings);
}

function openHistory() {
  elements.historyPanel.classList.remove("is-closed");
  elements.historyPanel.setAttribute("aria-hidden", "false");
  document
    .querySelector("#history-toggle")
    .setAttribute("aria-expanded", "true");
  if (window.innerWidth <= 900) elements.historySearch.focus();
}

function closeHistory() {
  elements.historyPanel.classList.add("is-closed");
  elements.historyPanel.setAttribute("aria-hidden", "true");
  document
    .querySelector("#history-toggle")
    .setAttribute("aria-expanded", "false");
}

async function copyResult() {
  if (!lastWasResult && !expression) {
    showToast("There is no result to copy.");
    return;
  }
  let value = result;
  if (!lastWasResult) {
    try {
      value = parseExpression(expression);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Enter a valid calculation first.",
      );
      return;
    }
  }
  try {
    await navigator.clipboard.writeText(String(value));
    showToast("Result copied to clipboard.");
  } catch (error) {
    console.error("Unable to copy result.", error);
    showToast("Clipboard access is unavailable in this browser.");
  }
}

function updateMemoryIndicator() {
  const active = memory !== null;
  elements.memoryIndicator.classList.toggle("is-active", active);
  elements.memoryIndicator.setAttribute(
    "aria-label",
    active ? `Memory contains ${formatNumber(memory)}` : "Memory is empty",
  );
  elements.memoryLabel.textContent = active
    ? `MEM ${formatNumber(memory)}`
    : "MEMORY OFF";
}

function memoryAction(action) {
  if (action === "memory-clear") memory = null;
  if (action === "memory-recall") {
    if (memory === null) {
      showToast("Memory is empty.");
      return;
    }
    appendInput(`(${memory})`);
  }
  if (action === "memory-add" || action === "memory-subtract") {
    let current;
    try {
      current =
        expression && !lastWasResult ? parseExpression(expression) : result;
    } catch {
      showToast("Finish a valid calculation before using memory.");
      return;
    }
    memory = (memory || 0) + (action === "memory-add" ? current : -current);
  }
  saveStored(STORAGE_KEYS.memory, memory);
  updateMemoryIndicator();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => elements.toast.classList.remove("is-visible"),
    2400,
  );
}

function playSound(isEquals = false) {
  if (!settings.sound) return;
  try {
    audioContext ||= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = isEquals ? 660 : 420;
    gain.gain.setValueAtTime(0.025, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audioContext.currentTime + 0.055,
    );
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.06);
  } catch (error) {
    console.error("Unable to play calculator sound.", error);
  }
}

function handleKeydown(event) {
  const target = event.target;
  const isTyping =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
  if (isTyping) {
    if (event.key === "Escape" && target === elements.historySearch)
      target.blur();
    else if (event.key === "/" && target === elements.historySearch) return;
    else return;
  }
  if (/^[0-9.]$/.test(event.key)) {
    event.preventDefault();
    appendInput(event.key);
  } else if (["+", "-", "*", "/", "^", "%", "(", ")"].includes(event.key)) {
    event.preventDefault();
    appendInput(event.key);
  } else if (event.key === "Enter" || event.key === "=") {
    event.preventDefault();
    calculate();
  } else if (event.key === "Backspace") {
    event.preventDefault();
    deleteLast();
  } else if (event.key === "Escape") {
    clearCalculator();
    if (elements.shortcutsDialog.open) elements.shortcutsDialog.close();
  } else if (
    event.key === "/" &&
    !elements.historyPanel.classList.contains("is-closed")
  ) {
    event.preventDefault();
    elements.historySearch.focus();
  }
}

document.querySelectorAll("[data-insert]").forEach((button) => {
  button.addEventListener("click", () => appendInput(button.dataset.insert));
});
document.querySelectorAll("[data-function]").forEach((button) => {
  button.addEventListener("click", () =>
    applyUnaryFunction(button.dataset.function),
  );
});
document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const { action } = button.dataset;
    if (action === "clear") clearCalculator();
    else if (action === "equals") calculate();
    else if (action === "sign") toggleSign();
    else if (action === "reciprocal") applyReciprocal();
    else if (action === "square") applySquare();
    else memoryAction(action);
  });
});
elements.standardMode.addEventListener("click", () => setMode("standard"));
elements.scientificMode.addEventListener("click", () => setMode("scientific"));
elements.angle.addEventListener("change", () => {
  settings.angle = elements.angle.value;
  saveStored(STORAGE_KEYS.settings, settings);
  updateDisplay();
});
document
  .querySelector("#theme-toggle")
  .addEventListener("click", () =>
    setTheme(settings.theme === "dark" ? "light" : "dark"),
  );
document
  .querySelector("#fullscreen-toggle")
  .addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      console.error("Unable to change fullscreen mode.", error);
      showToast("Fullscreen is unavailable in this browser.");
    }
  });
document.querySelector("#history-toggle").addEventListener("click", () => {
  if (elements.historyPanel.classList.contains("is-closed")) openHistory();
  else closeHistory();
});
document
  .querySelector("#history-close")
  .addEventListener("click", closeHistory);
document
  .querySelector("#history-search")
  .addEventListener("input", renderHistory);
document
  .querySelector("#clear-history")
  .addEventListener("click", clearHistory);
document.querySelector("#copy-result").addEventListener("click", copyResult);
document
  .querySelector("#accent-select")
  .addEventListener("change", (event) => setAccent(event.currentTarget.value));
document.querySelector("#sound-toggle").addEventListener("click", (event) => {
  settings.sound = !settings.sound;
  event.currentTarget.textContent = settings.sound ? "SOUND ON" : "SOUND OFF";
  event.currentTarget.setAttribute("aria-pressed", String(settings.sound));
  saveStored(STORAGE_KEYS.settings, settings);
  if (settings.sound) playSound();
});
document
  .querySelector("#shortcuts-open")
  .addEventListener("click", () => elements.shortcutsDialog.showModal());
document
  .querySelector("#shortcuts-close")
  .addEventListener("click", () => elements.shortcutsDialog.close());
elements.shortcutsDialog.addEventListener("click", (event) => {
  if (event.target === elements.shortcutsDialog)
    elements.shortcutsDialog.close();
});
document.addEventListener("keydown", handleKeydown);
document.addEventListener("fullscreenchange", () => {
  document
    .querySelector("#fullscreen-toggle")
    .setAttribute(
      "aria-label",
      document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen",
    );
});
setAccent(settings.accent);
setTheme(settings.theme);
setMode(settings.mode);
elements.angle.value = settings.angle;
document.querySelector("#accent-select").value = settings.accent;
document.querySelector("#sound-toggle").textContent = settings.sound
  ? "SOUND ON"
  : "SOUND OFF";
document
  .querySelector("#sound-toggle")
  .setAttribute("aria-pressed", String(settings.sound));
updateMemoryIndicator();
renderHistory();
updateDisplay();
closeHistory();
