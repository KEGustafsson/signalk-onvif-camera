import { EventEmitter } from 'events';

interface MockDgramSocket extends EventEmitter {
  bind: jest.Mock<void, [(() => void)?]>;
  setMulticastInterface: jest.Mock<void, [string]>;
  send: jest.Mock<void, [Buffer, number, number, number, string, (() => void)?]>;
  close: jest.Mock<void, [(() => void)?]>;
  unref: jest.Mock<void, []>;
}

describe('node-onvif discovery', () => {
  test('rejects when the discovery socket errors after bind', async () => {
    jest.resetModules();

    const mockSocket = new EventEmitter() as MockDgramSocket;
    mockSocket.bind = jest.fn((callback?: () => void) => {
      if(callback) {
        callback();
      }
    });
    mockSocket.setMulticastInterface = jest.fn();
    mockSocket.send = jest.fn((_buf, _offset, _length, _port, _address, callback?: () => void) => {
      if(callback) {
        callback();
      }
    });
    mockSocket.close = jest.fn((callback?: () => void) => {
      if(callback) {
        callback();
      }
    });
    mockSocket.unref = jest.fn();

    jest.doMock('dgram', () => ({
      createSocket: jest.fn(() => mockSocket)
    }));
    jest.doMock('../lib/modules/soap', () => ({
      parse: jest.fn().mockResolvedValue({})
    }));
    jest.doMock('../lib/modules/device', () => jest.fn());

    const onvif = require('../lib/node-onvif') as {
      startProbe(ipAddress?: string): Promise<unknown[]>;
    };

    const probePromise = onvif.startProbe();
    mockSocket.emit('error', new Error('socket failure'));

    await expect(probePromise).rejects.toThrow('socket failure');
  });

  test('parses all ProbeMatch entries from a discovery response', () => {
    jest.resetModules();
    const onvif = require('../lib/node-onvif') as object;
    const parseProbeMatches = Reflect.get(onvif, '_parseProbeMatches') as (result: Record<string, unknown>) => Array<{
      urn: string;
      name: string;
    }>;

    const probes = parseProbeMatches.call(onvif, {
      Body: {
        ProbeMatches: {
          ProbeMatch: [
            {
              EndpointReference: { Address: 'urn:uuid:first' },
              XAddrs: 'http://10.0.0.30/onvif/device_service',
              Scopes: 'onvif://www.onvif.org/name/Camera_One onvif://www.onvif.org/location/Bridge'
            },
            {
              EndpointReference: { Address: 'urn:uuid:second' },
              XAddrs: 'http://10.0.0.31/onvif/device_service',
              Scopes: 'onvif://www.onvif.org/name/Camera_Two onvif://www.onvif.org/location/Cockpit'
            }
          ]
        }
      }
    });

    expect(probes).toEqual([
      expect.objectContaining({
        urn: 'urn:uuid:first',
        name: 'Camera One'
      }),
      expect.objectContaining({
        urn: 'urn:uuid:second',
        name: 'Camera Two'
      })
    ]);
  });
});
