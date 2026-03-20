declare module 'ws' {
  import type { EventEmitter } from 'events';
  import type { IncomingMessage } from 'http';
  import type { Socket } from 'net';

  export type RawData = string | Buffer | Array<Buffer> | ArrayBuffer | Buffer[];

  export default class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;
    send(data: string | Buffer): void;
    close(callback?: () => void): void;
    on(event: 'message', listener: (data: RawData) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
  }

  export class Server extends EventEmitter {
    constructor(options: { noServer?: boolean });
    close(callback?: () => void): void;
    handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer, callback: (ws: WebSocket) => void): void;
    emit(event: 'connection', ws: WebSocket, request: IncomingMessage): boolean;
    on(event: 'connection', listener: (ws: WebSocket, request: IncomingMessage) => void): this;
  }

  export const OPEN: number;
}
