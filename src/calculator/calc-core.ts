import { loadState, saveState, addToHistory } from "./storage.js";
import { create, all } from "mathjs";
import { t } from "../i18n.js";
const math = create(all);
const translate = t as (key: string, params?: Record<string, unknown>) => string;

interface CalcState {
  expr?: string;
  lastResult?: string;
  lastExpr?: string;
  status?: string;
}

export interface CalcEvaluationResult {
  ok: boolean;
  result?: string;
  error?: string;
  toggled?: boolean;
}

function normalizeExpr(expr: string): string {
  return expr
    .replaceAll("×", "*")
    .replaceAll("÷", "/")
    .replaceAll("–", "-")
    .replaceAll("−", "-")
    .replaceAll("√", "sqrt")
    .trim();
}

// LinangData-like percent behavior:
// 1) Binary: 50%10 => (10/100)*50
// 2) Unary: 100+10% => 100 + (10% of 100)
function applyPercentRules(expr: string): string {
  let s = expr;

  // Binary percentage: A%B => (B/100)*A
  s = s.replace(/(\d+(?:\.\d+)?)%(\d+(?:\.\d+)?)/g, "($2/100)*$1");

  // Unary percentage at end of expression: (Left)(op)(X%) => (Left)op((X/100)*(Left))
  // Example: 100+10% => (100)+((10/100)*(100))
  // BUT: avoid cases like 1%+1% (where Left is a plain percent literal)

  // Examples:
  // 100 + 10% → 100 + (10% of 100) ✅
  // 100 - 10% → 100 - (10% of 100) ✅
  // 100 * 10% → 100 * 0.10 ✅ (handled by the “Remaining x%” rule)
  // 10 / 1% → 10 / 0.01 ✅ (handled by the “Remaining x%” rule)

  s = s.replace(/(.*?)([+-])(\d+(?:\.\d+)?)%$/g, (match, left, op, num) => {
    const leftTrim = String(left).trim();

    // If left is a simple percent literal like "1%" or "2.5%", do NOT treat the last % as "of left"
    // so that 1%+1% becomes (1/100)+(1/100) = 0.02
    if (/^\d+(?:\.\d+)?%$/.test(leftTrim)) {
      return match; // leave as-is; it will be handled by the "remaining x%" rule below
    }

    return `(${left})${op}((${num}/100)*(${left}))`;
  });

  // Remaining x% => (x/100)
  s = s.replace(/(\d+(?:\.\d+)?)%/g, "($1/100)");

  return s;
}

function sanitize(expr: string): string | null {
  // Allow only safe characters/operators + the sqrt identifier.
  // We also allow commas because some locales paste them; we convert commas to dots.
  const normalized = expr.replaceAll(",", ".");

  // Allow digits, operators, parentheses, dot, percent, whitespace, power (^), and the letters in "sqrt"
  // (and only those letters).
  const ok = /^[0-9+\-*/().%\s×÷–−sqrt^]*$/.test(normalized);
  if (!ok) return null;

  // Extra safety: if letters appear, they must form only "sqrt" tokens.
  // This blocks things like "sqqrt", "q", etc. even though chars are allowed.
  const letters = normalized.match(/[a-zA-Z]+/g) || [];
  for (const w of letters) {
    if (w !== "sqrt") return null;
  }

  return normalized;
}

export class CalcCore {
  expr: string;
  lastResult: string;
  lastExpr: string;
  status: string;

  constructor() {
    const state = loadState() as CalcState | null;
    this.expr = state?.expr ?? "";
    this.lastResult = state?.lastResult ?? "";
    this.lastExpr = state?.lastExpr ?? "";
    this.status = state?.status ?? "";
    this._persist();
  }

  _persist(): void {
    saveState({ expr: this.expr, lastResult: this.lastResult, lastExpr: this.lastExpr, status: this.status });
  }

  setExpr(v: string | null | undefined): void {
    this.expr = v ?? "";
    this._persist();
  }

  append(token: string): void {
    this.expr = (this.expr ?? "") + token;
    this._persist();
  }

  clear(): void {
    this.expr = "";
    this.status = "";
    this.lastResult = "";
    this.lastExpr = "";
    this._persist();
  }

  backspace(): void {
    this.expr = (this.expr ?? "").slice(0, -1);
    this._persist();
  }

  toggleSign(): void {
    // Toggle sign of the trailing number in the expression
    const s = this.expr ?? "";
    const m = s.match(/(.*?)(\d+(?:\.\d+)?)\s*$/);
    if (!m) return;

    const prefix = m[1];
    const num = m[2];

    // Check if there's already a "-" directly before the number (ignoring spaces)
    const prefixTrim = prefix.replace(/\s+$/,"");
    if (prefixTrim.endsWith("-") && !prefixTrim.endsWith("--")) {
      // remove trailing "-" sign
      this.expr = prefixTrim.slice(0, -1) + num;
    } else {
      this.expr = prefix + "-" + num;
    }
    this._persist();
  }

  sqrtTrailingNumber(): void {
    // Replace trailing number N with sqrt(N)
    const s = this.expr ?? "";
    const m = s.match(/(.*?)(\d+(?:\.\d+)?)\s*$/);
    if (!m) return;
    this.expr = `${m[1]}sqrt(${m[2]})`;
    this._persist();
  }

  squareTrailingNumber(): void {
    const s = this.expr ?? "";
    const m = s.match(/(.*?)(\d+(?:\.\d+)?)\s*$/);
    if (!m) return;
    this.expr = `${m[1]}(${m[2]})^2`;
    this._persist();
  }

  smartParen(): "(" | ")" {
    const s = this.expr ?? "";
    let open = 0;
    let close = 0;
    for (const c of s) {
      if (c === "(") open++;
      else if (c === ")") close++;
    }
    return open > close ? ")" : "(";
  }

  async evaluate(): Promise<CalcEvaluationResult> {
    if (this.expr === this.lastResult && this.lastExpr) {
      this.expr = this.lastExpr;
      this.status = "";
      this._persist();
      return { ok: true, result: this.expr, toggled: true };
    }

    try {
      const raw = normalizeExpr(this.expr || "");
      const safe = sanitize(raw);
      if (safe == null) {
        this.status = translate("blockedChars");
        this._persist();
        return { ok: false, error: this.status };
      }

      const prepared = applyPercentRules(safe);

      // Use bundled mathjs instance (already configured at module scope)
      const result = math.evaluate(prepared).toString();

      this.lastExpr = this.expr;
      this.status = raw;
      this.lastResult = result;
      this.expr = result;
      addToHistory(this.lastExpr, result);
      this._persist();
      return { ok: true, result };
    } catch (e) {
      this.status = translate("error");
      this._persist();
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: String(message || e) };
    }
  }
}
