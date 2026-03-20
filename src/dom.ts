type DomTarget = Element | Document | Window;
type EventHandler = (event: Event) => void;

interface ListenerEntry {
  type: string;
  handler: EventHandler;
}

const listenerRegistry = new WeakMap<EventTarget, Map<string, ListenerEntry[]>>();

function getListenerMap(target: EventTarget): Map<string, ListenerEntry[]> {
  const existing = listenerRegistry.get(target);
  if (existing) {
    return existing;
  }
  const created = new Map<string, ListenerEntry[]>();
  listenerRegistry.set(target, created);
  return created;
}

function parseEventName(eventName: string): { type: string; key: string } {
  const [type] = eventName.split('.');
  return {
    type,
    key: eventName
  };
}

function isElement(value: unknown): value is Element {
  return value instanceof Element;
}

function isHtmlElement(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement;
}

function getStoredDisplay(element: HTMLElement): string | undefined {
  return element.dataset.codexDisplay && element.dataset.codexDisplay !== 'none'
    ? element.dataset.codexDisplay
    : undefined;
}

function isValueElement(value: unknown): value is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLOptionElement {
  return value instanceof HTMLInputElement
    || value instanceof HTMLSelectElement
    || value instanceof HTMLTextAreaElement
    || value instanceof HTMLOptionElement;
}

function toDatasetKey(name: string): string {
  return name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function createElementsFromHtml(html: string): HTMLElement[] {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return Array.from(template.content.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
}

export class DomCollection {
  private readonly elements: DomTarget[];

  constructor(elements: DomTarget[] = []) {
    this.elements = elements;
  }

  public on(eventName: string, handler: EventHandler): this {
    const parsed = parseEventName(eventName);
    this.elements.forEach((element) => {
      const map = getListenerMap(element);
      const listeners = map.get(parsed.key) || [];
      listeners.push({
        type: parsed.type,
        handler
      });
      map.set(parsed.key, listeners);
      element.addEventListener(parsed.type, handler as EventListener);
    });
    return this;
  }

  public off(eventName: string): this {
    const parsed = parseEventName(eventName);
    this.elements.forEach((element) => {
      const map = getListenerMap(element);
      const listeners = map.get(parsed.key) || [];
      listeners.forEach((listener) => {
        element.removeEventListener(listener.type, listener.handler as EventListener);
      });
      map.delete(parsed.key);
    });
    return this;
  }

  public ready(callback: () => void): this {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
    return this;
  }

  public find(selector: string): DomCollection {
    const found = this.elements.flatMap((element) => {
      if (!('querySelectorAll' in element)) {
        return [];
      }
      return Array.from(element.querySelectorAll(selector)).filter((child): child is HTMLElement => child instanceof HTMLElement);
    });
    return new DomCollection(found);
  }

  public get(index: number): DomTarget | undefined {
    return this.elements[index];
  }

  public val(): string | undefined;
  public val(value: string): this;
  public val(value?: string): string | undefined | this {
    if (value === undefined) {
      const element = this.elements[0];
      return isValueElement(element) ? String(element.value) : undefined;
    }

    this.elements.forEach((element) => {
      if (isValueElement(element)) {
        element.value = value;
      }
    });
    return this;
  }

  public prop(name: string): unknown;
  public prop(name: string, value: unknown): this;
  public prop(name: string, value?: unknown): unknown {
    if (value === undefined) {
      const element = this.elements[0] as unknown as Record<string, unknown> | undefined;
      return element ? element[name] : undefined;
    }

    this.elements.forEach((element) => {
      (element as unknown as Record<string, unknown>)[name] = value;
    });
    return this;
  }

  public text(): string;
  public text(value: string): this;
  public text(value?: string): string | this {
    if (value === undefined) {
      const element = this.elements[0];
      return isElement(element) ? (element.textContent || '') : '';
    }

    this.elements.forEach((element) => {
      if (isElement(element)) {
        element.textContent = value;
      }
    });
    return this;
  }

  public show(): this {
    this.elements.forEach((element) => {
      if (isHtmlElement(element)) {
        element.hidden = false;
        element.style.removeProperty('display');
        if (window.getComputedStyle(element).display === 'none') {
          element.style.display = getStoredDisplay(element) || 'block';
        }
      }
    });
    return this;
  }

  public hide(): this {
    this.elements.forEach((element) => {
      if (isHtmlElement(element)) {
        const computedDisplay = window.getComputedStyle(element).display;
        if (computedDisplay !== 'none') {
          element.dataset.codexDisplay = computedDisplay;
        }
        element.hidden = true;
        element.style.display = 'none';
      }
    });
    return this;
  }

  public append(content: DomCollection | HTMLElement | string): this {
    const nodes = typeof content === 'string'
      ? createElementsFromHtml(content)
      : content instanceof DomCollection
        ? content.toArray()
        : [content];

    this.elements.forEach((element) => {
      if (isElement(element)) {
        nodes.forEach((node, index) => {
          const child = index === 0 ? node : node.cloneNode(true);
          element.appendChild(child);
        });
      }
    });
    return this;
  }

  public empty(): this {
    this.elements.forEach((element) => {
      if (isElement(element)) {
        element.innerHTML = '';
      }
    });
    return this;
  }

  public each(callback: (index: number, element: DomTarget) => void): this {
    this.elements.forEach((element, index) => {
      callback(index, element);
    });
    return this;
  }

  public attr(name: string): string | undefined;
  public attr(name: string, value: string): this;
  public attr(name: string, value?: string): string | undefined | this {
    if (value === undefined) {
      const element = this.elements[0];
      return isElement(element) ? (element.getAttribute(name) || undefined) : undefined;
    }

    this.elements.forEach((element) => {
      if (isElement(element)) {
        element.setAttribute(name, value);
      }
    });
    return this;
  }

  public removeAttr(name: string): this {
    this.elements.forEach((element) => {
      if (isElement(element)) {
        element.removeAttribute(name);
      }
    });
    return this;
  }

  public parent(): DomCollection {
    const parents = this.elements
      .map((element) => isElement(element) ? element.parentElement : null)
      .filter((element): element is HTMLElement => element instanceof HTMLElement);
    return new DomCollection(parents);
  }

  public addClass(name: string): this {
    this.elements.forEach((element) => {
      if (isElement(element)) {
        element.classList.add(name);
      }
    });
    return this;
  }

  public removeClass(name: string): this {
    this.elements.forEach((element) => {
      if (isElement(element)) {
        element.classList.remove(name);
      }
    });
    return this;
  }

  public hasClass(name: string): boolean {
    const element = this.elements[0];
    return isElement(element) ? element.classList.contains(name) : false;
  }

  public data(name: string): string | undefined {
    const element = this.elements[0];
    if (!isHtmlElement(element)) {
      return undefined;
    }
    return element.dataset[toDatasetKey(name)] || undefined;
  }

  public select(): this {
    this.elements.forEach((element) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.select();
      }
    });
    return this;
  }

  public modal(action: 'show' | 'hide'): this {
    this.elements.forEach((element) => {
      if (isHtmlElement(element)) {
        element.style.display = action === 'show' ? 'block' : 'none';
        element.classList.toggle('in', action === 'show');
        element.setAttribute('aria-hidden', action === 'show' ? 'false' : 'true');
      }
    });
    return this;
  }

  public toArray(): HTMLElement[] {
    return this.elements.filter((element) => element instanceof HTMLElement) as HTMLElement[];
  }
}

export function $(target: string | DomTarget): DomCollection {
  if (typeof target === 'string') {
    const trimmed = target.trim();
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
      return new DomCollection(createElementsFromHtml(trimmed));
    }
    return new DomCollection(Array.from(document.querySelectorAll(trimmed)).filter((element): element is HTMLElement => element instanceof HTMLElement));
  }
  return new DomCollection([target]);
}
