import { EventEmitter } from 'events';
import type { IncomingMessage, RequestOptions } from 'http';

interface MockSoapResponse extends EventEmitter {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  setEncoding: jest.Mock<void, [BufferEncoding]>;
}

interface MockSoapRequest extends EventEmitter {
  setTimeout: jest.Mock<void, [number]>;
  write: jest.Mock<void, [string, BufferEncoding]>;
  end: jest.Mock<void, []>;
  destroy: jest.Mock<void, []>;
}

interface OnvifSoapInternal {
  _request(oxaddr: URL, soap: string): Promise<string>;
}

const mockHttpsRequest = jest.fn<import('http').ClientRequest, [RequestOptions, (res: IncomingMessage) => void]>();

jest.mock('http', () => ({
  request: jest.fn()
}));

jest.mock('https', () => ({
  request: (...args: Parameters<typeof mockHttpsRequest>) => mockHttpsRequest(...args)
}));

describe('soap module', () => {
  beforeEach(() => {
    mockHttpsRequest.mockReset();
  });

  test('_request uses the HTTPS default port and preserves the query string', async () => {
    let capturedOptions: RequestOptions | null = null;
    mockHttpsRequest.mockImplementation((options, callback) => {
      capturedOptions = options;
      const req = new EventEmitter() as MockSoapRequest;
      req.setTimeout = jest.fn();
      req.write = jest.fn();
      req.destroy = jest.fn();
      req.end = jest.fn(() => {
        const res = new EventEmitter() as MockSoapResponse;
        res.statusCode = 200;
        res.statusMessage = 'OK';
        res.headers = {};
        res.setEncoding = jest.fn();
        callback(res as unknown as IncomingMessage);
        res.emit('data', '<ok/>');
        res.emit('end');
      });
      return req as unknown as import('http').ClientRequest;
    });

    const soap = require('../lib/modules/soap') as OnvifSoapInternal;
    const response = await soap._request(new URL('https://camera.example/onvif/device_service?mode=1'), '<soap/>');

    if(capturedOptions === null) {
      throw new Error('Expected SOAP request options to be captured');
    }
    const requestOptions = capturedOptions as RequestOptions;

    expect(requestOptions.protocol).toBe('https:');
    expect(requestOptions.port).toBe(443);
    expect(requestOptions.path).toBe('/onvif/device_service?mode=1');
    expect(response).toBe('<ok/>');
  });

  test('_request rejects when the response is aborted mid-stream', async () => {
    mockHttpsRequest.mockImplementation((_options, callback) => {
      const req = new EventEmitter() as MockSoapRequest;
      req.setTimeout = jest.fn();
      req.write = jest.fn();
      req.destroy = jest.fn();
      req.end = jest.fn(() => {
        const res = new EventEmitter() as MockSoapResponse;
        res.statusCode = 200;
        res.statusMessage = 'OK';
        res.headers = {};
        res.setEncoding = jest.fn();
        callback(res as unknown as IncomingMessage);
        res.emit('aborted');
      });
      return req as unknown as import('http').ClientRequest;
    });

    const soap = require('../lib/modules/soap') as OnvifSoapInternal;

    await expect(soap._request(new URL('https://camera.example/onvif/device_service'), '<soap/>'))
      .rejects.toThrow('Network Error: Response aborted');
  });
});
