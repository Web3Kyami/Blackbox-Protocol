// =============================================================================
// Studio DOM mount — browser-only
// =============================================================================
//
// This module turns the pure node tree produced by `wizard.mjs` into a
// real DOM and wires up the events. It is browser-only: it references
// `document` and `Event`. Tests do NOT import this file (the test runs
// in Node, which has no DOM).
//
// Why a separate mount layer? Two reasons:
//   1. Keeps `wizard.mjs` pure and testable in Node without jsdom.
//   2. Lets us swap the renderer (e.g. to SSR for a server-side
//      pre-render) without rewriting wizard logic.
//
// The mount layer is intentionally minimal: it knows about three
// node kinds (`#text`, ordinary tags, and inputs) and one event
// kind (a "synthetic" event object that the wizard emitted in the
// tree's attrs).
//
// Contract with the caller:
//   mount(tree, container, {
//     onEvent: (event) => void,  // called for every synthetic event
//   })
//   - `tree` is the initial node tree (a wizard render result).
//   - `container` is the DOM element to render into.
//   - `onEvent` is the dispatch sink. The caller owns the state and
//     decides what to do with the event (typically: reduce the state
//     and call `mount.setTree(newTree)` to re-render).
//
// Returns an object with:
//   - `setTree(newTree)`: re-render the container with a new tree.
//   - `destroy()`: remove all listeners and the rendered DOM.
// =============================================================================

// Build a real DOM element from a node tree. Recursive.
function buildElement(node, doc) {
  if (!node) return null;
  if (node.tag === "#text") {
    return doc.createTextNode(String(node.children?.[0] ?? ""));
  }
  const el = doc.createElement(node.tag);
  if (node.attrs) {
    for (const [k, v] of Object.entries(node.attrs)) {
      if (v == null || v === false) continue;
      // Synthetic event attrs are wired separately by attachEvents.
      if (k.startsWith("on") && typeof v === "object") continue;
      // Boolean DOM attributes (checked, disabled, selected) — set when truthy.
      if (
        (k === "checked" || k === "disabled" || k === "selected") &&
        (v === true || v === k || v === "")
      ) {
        if (k === "checked") el.defaultChecked = true;
        if (k === "disabled") el.disabled = true;
        if (k === "selected") el.defaultSelected = true;
        el.setAttribute(k, "");
        continue;
      }
      el.setAttribute(k, String(v));
    }
  }
  if (node.children) {
    for (const child of node.children) {
      if (child == null || child === false) continue;
      if (typeof child === "string") {
        el.appendChild(doc.createTextNode(child));
        continue;
      }
      // Skip stray event objects placed in children (defensive).
      if (typeof child === "object" && child.type && !child.tag) continue;
      const built = buildElement(child, doc);
      if (built) el.appendChild(built);
    }
  }
  return el;
}

// Walk the tree in parallel with the DOM, attaching one event
// listener per matching on* attribute. The walker uses positional
// matching between tree children and DOM child nodes, which works
// because buildElement preserves the child order.
function walkAndAttach(treeNode, domNode, onEvent) {
  if (!treeNode || !domNode) return;
  if (treeNode.attrs) {
    for (const [k, v] of Object.entries(treeNode.attrs)) {
      if (!k.startsWith("on") || typeof v !== "object") continue;
      const eventName = k.slice(2); // "oninput" -> "input"
      domNode.addEventListener(eventName, (realEvent) => {
        onEvent(synthFromAttr(v, realEvent, domNode));
      });
    }
  }
  if (!treeNode.children || !domNode.childNodes) return;
  // Walk children in parallel, skipping text-node children on the
  // DOM side and string children on the tree side.
  let di = 0;
  for (const child of treeNode.children) {
    if (child == null || child === false) continue;
    if (typeof child === "string") {
      // advance through one text DOM child
      while (di < domNode.childNodes.length && domNode.childNodes[di].nodeType === 3 /* text */) {
        di += 1;
      }
      continue;
    }
    if (typeof child === "object" && child.type && !child.tag) continue;
    // Skip past any text/comment DOM nodes to find the next element
    // child that corresponds to `child`.
    while (di < domNode.childNodes.length && domNode.childNodes[di].nodeType !== 1) {
      di += 1;
    }
    if (di >= domNode.childNodes.length) break;
    walkAndAttach(child, domNode.childNodes[di], onEvent);
    di += 1;
  }
}

// Translate a synthetic event stored in the tree (and the real DOM
// event/element) into the reducer event the wizard expects.
//
// Conventions (defined in wizard.mjs):
//   oninput:   {type:"update-draft", patch:{field: "@"}}   -> reads element.value
//   onchange:  {type:"update-draft", patch:{field: "@"}}   -> reads element.value
//   onchange:  {type:"update-draft", patch:{field: "v"}}   -> literal "v"
//   onchange:  {type:"..."}                                -> passthrough
//   onclick:   {type:"back"|"next"|"submit-skeleton"|"toggle-ack"} -> passthrough
function synthFromAttr(stored, realEvent, el) {
  if (!stored || typeof stored !== "object") return stored;
  if (stored.patch) {
    const patch = {};
    for (const [k, v] of Object.entries(stored.patch)) {
      if (v === "@") {
        if (el.type === "checkbox") {
          patch[k] = el.checked;
        } else if (el.type === "radio") {
          if (el.checked) patch[k] = el.value;
        } else {
          patch[k] = el.value;
        }
      } else {
        patch[k] = v;
      }
    }
    return { type: "update-draft", patch };
  }
  // No patch: expand a "@" placeholder used directly as a field value
  // (e.g. {type:"issuance-field", field:"x", value:"@"}). Keeps custom
  // event types intact while still reading the live element value.
  let expanded = false;
  const out = {};
  for (const [k, v] of Object.entries(stored)) {
    if (v === "@") {
      out[k] = el.value;
      expanded = true;
    } else {
      out[k] = v;
    }
  }
  return expanded ? out : stored;
}

// Public mount.
export function mount(tree, container, opts) {
  opts = opts || {};
  const doc = opts.document || (typeof document !== "undefined" ? document : null);
  if (!doc) {
    throw new Error("mount: no document available (this module is browser-only)");
  }
  if (!container) {
    throw new Error("mount: container is required");
  }
  const onEvent = opts.onEvent || (() => {});

  function render(newTree) {
    // Clear the container and re-render. We don't diff — for a small
    // wizard, full re-render is simpler and fine.
    while (container.firstChild) container.removeChild(container.firstChild);
    const el = buildElement(newTree, doc);
    if (el) {
      container.appendChild(el);
      walkAndAttach(newTree, el, onEvent);
    }
  }

  // Initial render.
  render(tree);

  return {
    setTree(newTree) {
      render(newTree);
    },
    destroy() {
      while (container.firstChild) container.removeChild(container.firstChild);
    },
  };
}
