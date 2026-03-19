interface JQueryCollection<TElement = HTMLElement> {
  ready(handler: () => void): this;
  on(eventName: string, handler: (event: unknown) => void): this;
  off(eventName: string): this;
  get(index: number): TElement;
  find(selector: string): JQueryCollection<HTMLElement>;
  val(): string;
  val(value: string): this;
  prop(name: string): unknown;
  prop(name: string, value: unknown): this;
  text(): string;
  text(value: string): this;
  append(content: string | Element | JQueryCollection<HTMLElement>): this;
  empty(): this;
  removeAttr(name: string): this;
  hide(): this;
  show(): this;
  attr(name: string): string | undefined;
  attr(name: string, value: string): this;
  modal(action: 'show' | 'hide'): this;
  data(name: string): string | undefined;
  select(): this;
  parent(): JQueryCollection<HTMLElement>;
  addClass(name: string): this;
  removeClass(name: string): this;
  each(callback: (index: number, element: HTMLElement) => void): this;
}

declare function $(selector: string): JQueryCollection<HTMLElement>;
declare function $(selector: Element | Document | Window | EventTarget | object): JQueryCollection<HTMLElement>;
