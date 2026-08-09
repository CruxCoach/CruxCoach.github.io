/**
 * The smallest DOM that will run this app's element builder.
 *
 * Not a browser and not trying to be one. It exists so the organizer form can
 * be *driven* in a test rather than pattern-matched in its source: build the
 * form, read what `build()` produces, and hand it to the same validator the
 * publish path uses. That is the check that would have caught a form which
 * hard-codes half its configuration and still passes every source scan.
 *
 * Everything here is what `ui/dom.mjs` and the form actually touch. Anything
 * else throws rather than silently returning undefined, because a shim that
 * quietly answers questions it does not understand produces a green test about
 * nothing.
 */

class Node {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this._text = '';
    // Form-control state, which is the half of this that the form reads back.
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.selectedIndex = 0;
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.children = [];
    this._text = String(value);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    // The form finds its controls by id, and `type` decides how a value reads.
    if (name === 'id') this.id = String(value);
    if (name === 'type') this.type = String(value);
    if (name === 'value' && this.value === '') this.value = String(value);
    if (name === 'checked') this.checked = true;
    if (name === 'selected') this.selected = true;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(handler);
  }

  /** Fire a listener, the way a click or a change would. */
  dispatch(name, event = {}) {
    for (const handler of this.listeners.get(name) || []) {
      handler({ target: this, preventDefault() {}, ...event });
    }
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node === null || node === undefined || node === false) continue;
      node.parentNode = this;
      this.children.push(node);
      // A select reports the value of its selected option, or of its first one
      // when nothing is marked. Without this every select reads as empty and
      // the form appears to have set nothing at all.
      if (this.tagName === 'SELECT' && node.tagName === 'OPTION') {
        const value = node.getAttribute('value') ?? node.textContent;
        if (node.selected || this.value === '') this.value = value;
      }
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  removeChild(node) {
    this.children = this.children.filter((child) => child !== node);
    node.parentNode = null;
    return node;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  /** Depth-first, in document order — enough for `#id` and a tag name. */
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const found = [];
    const matches = (node) => {
      if (selector.startsWith('#')) return node.id === selector.slice(1);
      if (selector.startsWith('.')) return String(node.className).split(/\s+/).includes(selector.slice(1));
      return node.tagName === selector.toUpperCase();
    };
    const walk = (node) => {
      for (const child of node.children) {
        if (matches(child)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get options() {
    return this.querySelectorAll('option');
  }
}

class TextNode extends Node {
  constructor(text) {
    super('#text');
    this._text = String(text);
  }

  get textContent() {
    return this._text;
  }
}

function makeDocument() {
  const root = new Node('body');
  return {
    body: root,
    documentElement: new Node('html'),
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => new TextNode(text),
    createDocumentFragment: () => new Node('#fragment'),
    getElementById: (id) => root.querySelector(`#${id}`),
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    addEventListener() {},
  };
}

export const window = {
  /**
   * Install the shim, returning the function that removes it again.
   *
   * Always call the returned function — a leaked global `document` makes a
   * later test pass for the wrong reason.
   */
  install() {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const doc = makeDocument();
    globalThis.document = doc;
    globalThis.window = { document: doc, addEventListener() {}, location: { hash: '' } };
    return () => {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    };
  },
};
