import type { EventEmitter } from 'events';

export type JsonRecord = Record<string, unknown>;

export interface SchemaField extends JsonRecord {
  type?: string;
  default?: unknown;
  minimum?: number;
  properties?: Record<string, SchemaField>;
  items?: {
    properties: Record<string, SchemaField>;
  };
}

export interface PluginLike {
  id: string;
  name: string;
  start(options: JsonRecord): void;
  stop(): void;
  schema: {
    type?: string;
    properties: Record<string, SchemaField>;
  };
  uiSchema: {
    password: {
      'ui:widget'?: string;
    };
    cameras: {
      items: {
        password: {
          'ui:widget'?: string;
        };
      };
    };
  };
}

export interface SecurityStrategy {
  shouldAllowRequest: jest.Mock<boolean, [unknown, unknown?]>;
}

export interface MockApp {
  setPluginStatus?: jest.Mock;
  setProviderStatus?: jest.Mock;
  debug: jest.Mock;
  handleMessage: jest.Mock;
  get: jest.Mock;
  server: EventEmitter | null;
  getDataDirPath: jest.Mock<string, []>;
  securityStrategy?: SecurityStrategy;
}

export type CreatePlugin = (app: MockApp) => PluginLike;

export interface MockSocket extends EventEmitter {
  readyState: number;
  send: jest.Mock<void, [string]>;
  close?: jest.Mock<void, []>;
  terminate?: jest.Mock<void, []>;
}

export type ConnectionHandler = (socket: MockSocket, request?: unknown) => void;
