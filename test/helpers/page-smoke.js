import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function getPageUrl(htmlFile) {
  return htmlFile === "index.html"
    ? "https://vatioboard.com/"
    : `https://vatioboard.com/${htmlFile}`;
}

export function loadPageDocument(htmlFile) {
  const html = readFileSync(resolve(ROOT, htmlFile), "utf8");
  window.history.replaceState({}, "", getPageUrl(htmlFile));
  document.open();
  document.write(html);
  document.close();
  return html;
}

export function runInlinePageScripts() {
  const scripts = Array.from(document.querySelectorAll("script"));

  for (const script of scripts) {
    const type = script.getAttribute("type");
    if (script.src || type === "module" || type === "application/ld+json") {
      continue;
    }

    window.eval(script.textContent);
  }
}

export async function bootHtmlPage(htmlFile) {
  loadPageDocument(htmlFile);
  runInlinePageScripts();
  await flushTasks();
}

export async function flushTasks() {
  await Promise.resolve();
  await Promise.resolve();
}

export function expectPageSeo({
  title,
  titleIncludes,
  canonical,
  hasDescription = true,
}) {
  if (title) {
    expect(document.title).toBe(title);
  } else if (titleIncludes) {
    expect(document.title).toContain(titleIncludes);
  }

  if (hasDescription) {
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBeTruthy();
  } else {
    expect(document.querySelector('meta[name="description"]')).toBeNull();
  }

  if (canonical) {
    expect(document.querySelector('link[rel="canonical"]')?.href).toBe(canonical);
  } else {
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  }
}
