type TestCallback = () => void | Promise<void>;

declare function describe(name: string, callback: TestCallback): void;
declare function test(name: string, callback?: TestCallback): void;
declare namespace test {
  function todo(name: string): void;
}
declare function beforeEach(callback: TestCallback): void;
declare function afterEach(callback: TestCallback): void;

interface ExpectMatcher {
  not: ExpectMatcher;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeInstanceOf(expected: Function): void;
  toContain(expected: unknown): void;
  toHaveBeenCalled(): void;
  toHaveBeenCalledTimes(expected: number): void;
  toHaveBeenCalledWith(...args: unknown[]): void;
  toHaveLength(expected: number): void;
  toMatch(expected: RegExp | string): void;
  toThrow(expected?: unknown): void;
}

declare function expect(received: unknown): ExpectMatcher;
declare namespace expect {
  function any(constructor: Function): unknown;
  function objectContaining<T extends object>(expected: T): T;
}

interface JestMock {
  (...args: unknown[]): unknown;
  mock: {
    calls: unknown[][];
  };
  mockImplementation(implementation: Function): this;
  mockImplementationOnce(implementation: Function): this;
  mockResolvedValue(value: unknown): this;
  mockReturnValue(value: unknown): this;
  mockReset(): this;
  mockRestore(): void;
}

declare namespace jest {
  function fn(implementation?: Function): JestMock;
  function resetModules(): void;
  function mock(moduleName: string, factory?: Function): void;
  function spyOn<T extends object, K extends keyof T>(object: T, methodName: K): JestMock;
}
