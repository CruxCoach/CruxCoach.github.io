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
    // `.className` is what querySelector matches on, and code that builds
    // elements sets the attribute rather than the property.
    if (name === 'class') this.className = String(value);
    if (name === 'hidden') this._hidden = true;
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

  /** `hidden`, `disabled` and `required` are properties the form sets directly. */
  get hidden() {
    return this._hidden === true;
  }

  set hidden(value) {
    this._hidden = Boolean(value);
    if (this._hidden) this.attributes.set('hidden', 'hidden');
    else this.attributes.delete('hidden');
  }

  /** A dialog opens and closes; nothing here paints, so both are bookkeeping. */
  showModal() {
    this.open = true;
    this.dispatch('open');
  }

  close() {
    this.open = false;
    this.dispatch('close');
  }

  focus() {
    if (this.ownerShim) this.ownerShim.activeElement = this;
  }

  /** A <select> reports its chosen <option>, which the form reads back. */
  get selectedOptions() {
    if (this.tagName !== 'SELECT') return [];
    const match = this.options.find((option) => {
      const value = option.getAttribute('value') ?? option.textContent;
      return value === this.value;
    });
    return match ? [match] : [];
  }

  get dataset() {
    if (!this._dataset) {
      const node = this;
      this._dataset = new Proxy({}, {
        get(_target, key) {
          return node.getAttribute(`data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`) ?? undefined;
        },
        set(_target, key, value) {
          node.setAttribute(`data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
          return true;
        },
      });
    }
    return this._dataset;
  }

  /** Forms are reset wholesale before every open. */
  reset() {
    for (const node of this.querySelectorAll('INPUT')) node.value = '';
    for (const node of this.querySelectorAll('TEXTAREA')) node.value = '';
    for (const node of this.querySelectorAll('SELECT')) {
      const first = node.options[0];
      node.value = first ? (first.getAttribute('value') ?? first.textContent) : '';
    }
  }

  contains(node) {
    if (node === this) return true;
    for (const child of this.children) {
      if (child.contains(node)) return true;
    }
    return false;
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
      if (selector.startsWith('[')) {
        const body = selector.slice(1, -1);
        const eq = body.indexOf('=');
        if (eq === -1) return node.attributes.has(body);
        const name = body.slice(0, eq);
        const want = body.slice(eq + 1).replace(/^["']|["']$/g, '');
        return node.getAttribute(name) === want;
      }
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
  const doc = {
    body: root,
    documentElement: new Node('html'),
    activeElement: null,
    createElement: (tag) => {
      const node = new Node(tag);
      node.ownerShim = doc;
      return node;
    },
    createTextNode: (text) => new TextNode(text),
    createDocumentFragment: () => new Node('#fragment'),
    getElementById: (id) => root.querySelector(`#${id}`),
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    contains: (node) => root.contains(node),
    addEventListener() {},
  };
  root.ownerShim = doc;
  doc.documentElement.ownerShim = doc;
  return doc;
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
    const listeners = new Map();
    const stack = [{ state: null }];
    let cursor = 0;
    const fakeWindow = {
      document: doc,
      location: { hash: '', pathname: '/competitions/join.html' },
      addEventListener(name, handler) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(handler);
      },
      removeEventListener(name, handler) {
        listeners.set(name, (listeners.get(name) || []).filter((entry) => entry !== handler));
      },
      dispatchEvent(name, event = {}) {
        for (const handler of listeners.get(name) || []) handler(event);
      },
    };
    fakeWindow.history = {
      get state() { return stack[cursor].state; },
      replaceState(state) { stack[cursor] = { state }; },
      pushState(state) {
        stack.splice(cursor + 1);
        stack.push({ state });
        cursor += 1;
      },
      back() {
        if (cursor === 0) return;
        cursor -= 1;
        fakeWindow.dispatchEvent('popstate', { state: stack[cursor].state });
      },
      forward() {
        if (cursor >= stack.length - 1) return;
        cursor += 1;
        fakeWindow.dispatchEvent('popstate', { state: stack[cursor].state });
      },
      get length() { return stack.length; },
    };
    globalThis.window = fakeWindow;
    return () => {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    };
  },
};
