const FORBIDDEN_NAMES = new Map([
  ["captureVisibleTab", "screenshot capture is forbidden; perception is the accessibility digest only"],
  ["getDisplayMedia", "screen capture is forbidden; perception is the accessibility digest only"],
  ["toDataURL", "canvas rasterisation of the page is forbidden"],
  ["toBlob", "canvas rasterisation of the page is forbidden"],
  ["declarativeNetRequest", "the extension never touches network requests or response headers"],
]);

function nameOf(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
}

function checkExecuteScriptArg(context, callNode, arg) {
  if (arg === undefined || arg.type !== "ObjectExpression") {
    context.report({ node: callNode, messageId: "executeScriptShape" });
    return;
  }
  let hasFiles = false;
  for (const property of arg.properties) {
    if (property.type !== "Property") {
      context.report({ node: property, messageId: "executeScriptShape" });
      continue;
    }
    const key = nameOf(property.key);
    if (key === "files") hasFiles = true;
    if (key === "world") context.report({ node: property, messageId: "world" });
    if (key === "func" || key === "function") {
      context.report({ node: property, messageId: "remoteFunc" });
    }
  }
  if (!hasFiles) context.report({ node: callNode, messageId: "executeScriptShape" });
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid the browser APIs that would create a screenshot, remote-code, or header-manipulation surface.",
    },
    schema: [],
    messages: {
      forbidden: '"{{name}}" is forbidden: {{reason}}.',
      world: "executeScript must never set a world; the isolated world is the only one used.",
      remoteFunc: "executeScript must load packaged files only, never a serialised function.",
      executeScriptShape: "executeScript accepts a single object literal with a files array.",
      dynamicImport: "import() must take a relative string literal; a computed or URL source is remote code.",
    },
  },
  create(context) {
    return {
      Identifier(node) {
        const reason = FORBIDDEN_NAMES.get(node.name);
        if (reason !== undefined) {
          context.report({ node, messageId: "forbidden", data: { name: node.name, reason } });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "MemberExpression" && nameOf(callee.property) === "executeScript") {
          checkExecuteScriptArg(context, node, node.arguments[0]);
        }
      },
      ImportExpression(node) {
        const source = node.source;
        const literal =
          source.type === "Literal" && typeof source.value === "string" ? source.value : null;
        if (literal === null || /^[a-z]+:/i.test(literal)) {
          context.report({ node, messageId: "dynamicImport" });
        }
      },
    };
  },
};
