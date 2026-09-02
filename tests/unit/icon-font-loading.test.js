import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const layout = readFileSync(
  new URL("../../src/app/layout.js", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../../src/app/globals.css", import.meta.url),
  "utf8",
);
const iconNames = readFileSync(
  new URL("../../public/fonts/material-symbols-outlined-subset.txt", import.meta.url),
  "utf8",
).trim().split("\n");
const knownIconNames = new Set(
  [...readFileSync(
    new URL("../../node_modules/material-symbols/index.d.ts", import.meta.url),
    "utf8",
  ).matchAll(/^  "([a-z0-9_]+)",$/gm)].map((match) => match[1]),
);

const iconNamePattern = /^[a-z][a-z0-9_]*$/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:cjs|js|jsx|mjs)$/.test(entry.name) ? [path] : [];
  });
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value?.type) {
      walk(value, visit);
    }
  }
}

function staticRenderValues(node, values = []) {
  if (!node) return values;
  if (node.type === "StringLiteral") values.push(node.value);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    values.push(node.quasis[0].value.cooked);
  }
  if (node.type === "ConditionalExpression") {
    staticRenderValues(node.consequent, values);
    staticRenderValues(node.alternate, values);
  }
  if (node.type === "LogicalExpression") {
    if (node.operator !== "&&") staticRenderValues(node.left, values);
    staticRenderValues(node.right, values);
  }
  if (node.type === "SequenceExpression") {
    staticRenderValues(node.expressions.at(-1), values);
  }
  return values;
}

function containsMaterialClass(node) {
  if (!node) return false;
  if (node.type === "StringLiteral") {
    return node.value.includes("material-symbols-outlined");
  }
  if (node.type === "TemplateLiteral") {
    return node.quasis.some((quasi) =>
      quasi.value.cooked.includes("material-symbols-outlined"));
  }
  if (node.type === "CallExpression") {
    return node.arguments.some(containsMaterialClass);
  }
  if (node.type === "ArrayExpression") {
    return node.elements.some(containsMaterialClass);
  }
  if (node.type === "ConditionalExpression") {
    return containsMaterialClass(node.consequent) ||
      containsMaterialClass(node.alternate);
  }
  return false;
}

function addIconNames(values, names, supportedOnly = false) {
  for (const value of values) {
    if (!iconNamePattern.test(value)) continue;
    if (supportedOnly && !knownIconNames.has(value) && !iconNames.includes(value)) {
      continue;
    }
    names.add(value);
  }
}

function staticallyRenderedIconNames() {
  const names = new Set();
  const root = fileURLToPath(new URL("../../src", import.meta.url));

  for (const file of sourceFiles(root)) {
    const ast = parse(readFileSync(file, "utf8"), {
      plugins: ["jsx"],
      sourceType: "unambiguous",
    });
    walk(ast, (node) => {
      if (node.type === "JSXElement") {
        const className = node.openingElement.attributes.find(
          (attribute) => attribute.type === "JSXAttribute" &&
            attribute.name.name === "className",
        );
        const classValue = className?.value?.type === "JSXExpressionContainer"
          ? className.value.expression
          : className?.value;
        if (containsMaterialClass(classValue)) {
          for (const child of node.children) {
            if (child.type === "JSXText") {
              addIconNames([child.value.trim()], names);
            } else if (child.type === "JSXExpressionContainer") {
              addIconNames(staticRenderValues(child.expression), names);
            }
          }
        }
      }

      if (node.type === "JSXAttribute" &&
          ["icon", "iconRight"].includes(node.name.name)) {
        const value = node.value?.type === "JSXExpressionContainer"
          ? node.value.expression
          : node.value;
        addIconNames(staticRenderValues(value), names);
      }

      if (node.type === "ObjectProperty" &&
          ((node.key.type === "Identifier" && node.key.name === "icon") ||
           (node.key.type === "StringLiteral" && node.key.value === "icon"))) {
        addIconNames(staticRenderValues(node.value), names, true);
      }

      if (node.type === "VariableDeclarator" &&
          node.id.type === "Identifier" && node.id.name === "icon") {
        addIconNames(staticRenderValues(node.init), names, true);
      }

      if (node.type === "AssignmentExpression" &&
          node.left.type === "Identifier" && node.left.name === "icon") {
        addIconNames(staticRenderValues(node.right), names, true);
      }
    });
  }

  return [...names].sort();
}

describe("icon font delivery", () => {
  it("does not ship the full Material Symbols package from the root layout", () => {
    expect(layout).not.toContain('"material-symbols/outlined.css"');
    expect(layout).toContain('addEventListener("load", l, { once: true })');
    expect(styles).toContain('url("/fonts/material-symbols-outlined-subset.woff2")');
    expect(styles).toContain('.fonts-loaded .material-symbols-outlined { font-family: "Material Symbols Outlined", sans-serif;');
  });

  it("covers dynamic theme and runtime-status glyphs as well as static icon names", () => {
    expect(iconNames).toContain("dark_mode");
    expect(iconNames).toContain("light_mode");
    expect(iconNames).toContain("pause_circle");
  });

  it("contains every statically rendered Material Symbol ligature", () => {
    const missing = staticallyRenderedIconNames().filter(
      (iconName) => !iconNames.includes(iconName),
    );

    expect(missing).toEqual([]);
  });
});
