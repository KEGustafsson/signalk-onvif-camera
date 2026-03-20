declare module 'xml2js' {
  export function parseString(
    xml: string,
    options: Record<string, unknown>,
    callback: (error: Error | null, result: Record<string, unknown>) => void
  ): void;
}
