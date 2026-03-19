export interface SecurityStrategy {
  shouldAllowRequest(req: unknown, permission: 'READ'): boolean;
}

export interface SignalKAppLike {
  securityStrategy?: SecurityStrategy;
  debug?: (...args: unknown[]) => void;
}

export interface HttpResponseLike {
  writeHead(statusCode: number, headers: Record<string, string>): void;
  end(body?: string): void;
}

export interface DiscoveredProbeDevice {
  xaddrs: [string, ...string[]];
  name?: string;
}
