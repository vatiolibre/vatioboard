const OPERATORS = /[+\-×÷*/()^%]/;
const OPERATOR_CHARS = ["+", "-", "×", "÷", "*", "/", "(", ")", "^", "%"];

function getDecimalSeparator(thousandSeparator) {
  return thousandSeparator === "." ? "," : ".";
}

function isIncomplete(value, settings) {
  if (!value) return false;
  const decimal = getDecimalSeparator(settings?.thousandSeparator ?? "");

  if (value === "-") return true;
  if (value.endsWith(decimal)) return true;

  const lastChar = value.slice(-1);
  if (OPERATOR_CHARS.includes(lastChar)) return true;

  return false;
}

function hasOperators(value) {
  if (!value) return false;
  const withoutLeadingMinus = value.startsWith("-") ? value.slice(1) : value;
  return OPERATORS.test(withoutLeadingMinus) || value.includes("sqrt");
}

function singleNumberToRaw(display, settings) {
  if (!display) return display;

  const thousandSep = settings?.thousandSeparator ?? "";
  const decimalSep = getDecimalSeparator(thousandSep);

  let result = display;

  if (thousandSep) {
    result = result.split(thousandSep).join("");
  }

  if (decimalSep === ",") {
    result = result.replace(",", ".");
  }

  return result;
}

function singleNumberToDisplay(raw, settings) {
  if (!raw) return raw;

  const thousandSep = settings?.thousandSeparator ?? "";
  const decimalSep = getDecimalSeparator(thousandSep);

  const hasTrailingDot = raw.endsWith(".");
  const testValue = hasTrailingDot ? raw.slice(0, -1) : raw;

  if (testValue && !/^[+-]?\d+(?:\.\d*)?$/.test(testValue)) {
    return raw;
  }

  const isNegative = raw.startsWith("-");
  const unsigned = isNegative ? raw.slice(1) : raw;
  const [intPart, fracPart] = unsigned.split(".");

  let formattedInt = intPart || "0";
  if (thousandSep && formattedInt.length > 3) {
    formattedInt = formattedInt.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep);
  }

  let result = (isNegative ? "-" : "") + formattedInt;

  if (fracPart !== undefined) {
    result += decimalSep + fracPart;
  } else if (hasTrailingDot) {
    result += decimalSep;
  }

  return result;
}

function tokenize(str) {
  const tokens = [];
  let current = "";

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (str.slice(i, i + 4) === "sqrt") {
      if (current) tokens.push({ type: "number", value: current });
      current = "";
      tokens.push({ type: "operator", value: "sqrt" });
      i += 3;
      continue;
    }

    const isOperator = OPERATOR_CHARS.includes(char);
    const isLeadingMinus =
      char === "-" &&
      (current === "" ||
        tokens.length === 0 ||
        (tokens.length > 0 && tokens[tokens.length - 1].type === "operator"));

    if (isOperator && !isLeadingMinus) {
      if (current) tokens.push({ type: "number", value: current });
      current = "";
      tokens.push({ type: "operator", value: char });
    } else {
      current += char;
    }
  }
  if (current) tokens.push({ type: "number", value: current });

  return tokens;
}

export function toRaw(display, settings) {
  if (!display) return display;

  const str = String(display);
  const thousandSep = settings?.thousandSeparator ?? "";

  if (!thousandSep) return str;

  if (hasOperators(str)) {
    return tokenize(str)
      .map((t) => {
        if (t.type === "number") return singleNumberToRaw(t.value, settings);
        return t.value;
      })
      .join("");
  }

  return singleNumberToRaw(str, settings);
}

export function toDisplay(raw, settings) {
  if (!raw) return raw;

  const str = String(raw);
  const thousandSep = settings?.thousandSeparator ?? "";

  if (!thousandSep) return str;

  if (hasOperators(str)) {
    return tokenize(str)
      .map((t) => {
        if (t.type === "number")
          return singleNumberToDisplay(t.value, settings);
        return t.value;
      })
      .join("");
  }

  return singleNumberToDisplay(str, settings);
}

export function mapCursorPosition(fromValue, toValue, cursorPos) {
  if (!fromValue || !toValue) return cursorPos;
  if (cursorPos >= fromValue.length) return toValue.length;

  let digitsBefore = 0;
  for (let i = 0; i < cursorPos && i < fromValue.length; i++) {
    if (/\d/.test(fromValue[i])) digitsBefore++;
  }

  let digitsSeen = 0;
  for (let i = 0; i < toValue.length; i++) {
    if (/\d/.test(toValue[i])) {
      digitsSeen++;
      if (digitsSeen === digitsBefore) {
        return i + 1;
      }
    }
  }

  return toValue.length;
}

export function isValidInput(value, settings) {
  if (!value) return true;
  if (isIncomplete(value, settings)) return true;
  return true;
}

export {
  isIncomplete,
  hasOperators,
  getDecimalSeparator,
  singleNumberToRaw,
  singleNumberToDisplay,
};

export const formatNumber = (value, settings) => toDisplay(value, settings);
export const normalizeInput = (value, settings) => toRaw(value, settings);
export const formatExpression = (value, settings) => toDisplay(value, settings);
export const calculateNewCursorPos = mapCursorPosition;
