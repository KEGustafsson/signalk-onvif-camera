import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';

import type { HttpAuthRequestOptions, OnvifDeviceLike, ProfileInfo, SnapshotResponse } from '../lib/types';

interface MockHttpResponse extends EventEmitter {
  statusCode: number;
  statusMessage: string;
  headers: {
    'content-type': string;
  };
  destroy: jest.Mock<void, [Error?]>;
}

interface MockHttpRequest extends EventEmitter {
  end: jest.Mock<void, []>;
}

interface OnvifDeviceInternal extends OnvifDeviceLike {
  current_profile: ProfileInfo | null;
  _getXaddr(directXaddr: string): string;
  _getUri(directUri: unknown): string;
  _getSnapshotUri(directUri: unknown): string;
  fetchSnapshot(callback?: (error: Error | null, result?: SnapshotResponse) => void): Promise<SnapshotResponse> | void;
}

const mockHttpAuthRequest = jest.fn<import('http').ClientRequest, [HttpAuthRequestOptions, (res: IncomingMessage) => void]>();

jest.mock('../lib/modules/http-auth', () => ({
  request: (...args: Parameters<typeof mockHttpAuthRequest>) => mockHttpAuthRequest(...args)
}));

jest.mock('../lib/modules/service-device', () => jest.fn().mockImplementation(() => ({
  getSystemDateAndTime: jest.fn(),
  getCapabilities: jest.fn(),
  getDeviceInformation: jest.fn(),
  getTimeDiff: jest.fn(() => 0),
  setAuth: jest.fn()
})));

jest.mock('../lib/modules/service-media', () => jest.fn().mockImplementation(() => ({
  setAuth: jest.fn()
})));

jest.mock('../lib/modules/service-ptz', () => jest.fn().mockImplementation(() => ({
  setAuth: jest.fn()
})));

jest.mock('../lib/modules/service-events', () => jest.fn().mockImplementation(() => ({
  setAuth: jest.fn()
})));

function createProfile(snapshotUrl: string): ProfileInfo {
  return {
    token: 'profile-1',
    name: 'Profile 1',
    snapshot: snapshotUrl,
    stream: {
      udp: '',
      http: '',
      rtsp: ''
    },
    video: {
      source: null,
      encoder: null
    },
    audio: {
      source: null,
      encoder: null
    },
    ptz: {
      range: {
        x: { min: 0, max: 0 },
        y: { min: 0, max: 0 },
        z: { min: 0, max: 0 }
      }
    }
  };
}

describe('device module', () => {
  beforeEach(() => {
    mockHttpAuthRequest.mockReset();
  });

  test('fetchSnapshot uses the HTTPS default port and preserves the query string', async () => {
    let capturedOptions: HttpAuthRequestOptions | null = null;
    mockHttpAuthRequest.mockImplementation((options, callback) => {
      capturedOptions = options;
      const req = new EventEmitter() as MockHttpRequest;
      req.end = jest.fn(() => {
        const res = new EventEmitter() as MockHttpResponse;
        res.statusCode = 200;
        res.statusMessage = 'OK';
        res.headers = {
          'content-type': 'image/jpeg'
        };
        res.destroy = jest.fn();
        callback(res as unknown as IncomingMessage);
        res.emit('data', Buffer.from('frame-data'));
        res.emit('end');
      });
      return req as unknown as import('http').ClientRequest;
    });

    const OnvifDevice = require('../lib/modules/device') as new (params: { address?: string; xaddr?: string; user?: string; pass?: string }) => OnvifDeviceInternal;
    const device = new OnvifDevice({ address: '10.0.0.50' });
    device.setAuth('user', 'pass');
    device.current_profile = createProfile('https://192.168.1.20/onvif/snapshot.jpg?profile=main');

    const resultPromise = device.fetchSnapshot();
    const result = await (resultPromise as Promise<SnapshotResponse>);
    if(capturedOptions === null) {
      throw new Error('Expected snapshot request options to be captured');
    }
    const requestOptions = capturedOptions as HttpAuthRequestOptions;

    expect(requestOptions.protocol).toBe('https:');
    expect(requestOptions.port).toBe(443);
    expect(requestOptions.path).toBe('/onvif/snapshot.jpg?profile=main');
    expect(requestOptions.timeout).toBe(5000);
    expect(result.body.toString()).toBe('frame-data');
  });

  test('keep-address URI rewriting preserves protocol, port, and query string', () => {
    const OnvifDevice = require('../lib/modules/device') as new (params: { address?: string; xaddr?: string; user?: string; pass?: string }) => OnvifDeviceInternal;
    const device = new OnvifDevice({ address: '10.0.0.99' });

    expect(device._getXaddr('https://192.168.1.20:8443/onvif/device_service?mode=secure'))
      .toBe('https://10.0.0.99:8443/onvif/device_service?mode=secure');
    expect(device._getUri('rtsp://192.168.1.20:8554/stream/path?profile=1'))
      .toBe('rtsp://10.0.0.99:8554/stream/path?profile=1');
    expect(device._getSnapshotUri({ _: 'https://192.168.1.20/onvif/snapshot.jpg?token=abc' }))
      .toBe('https://10.0.0.99/onvif/snapshot.jpg?token=abc');
  });
});
