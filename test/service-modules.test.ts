import type { SoapCommandResult } from '../lib/types';

const mockRequestCommand = jest.fn<Promise<SoapCommandResult>, [URL, string, string]>();
const mockCreateRequestSoap = jest.fn((params: { body: string }) => `<soap>${params.body}</soap>`);
const mockEscapeXml = jest.fn((value: string) => value);

function mockIsInvalidValue(value: unknown, type: string, allowEmpty?: boolean): string {
  if (type === 'object') {
    return value && typeof value === 'object' && !Array.isArray(value) ? '' : 'invalid object';
  }
  if (type === 'array') {
    return Array.isArray(value) ? '' : 'invalid array';
  }
  if (type === 'string') {
    if (typeof value !== 'string') {
      return 'invalid string';
    }
    return allowEmpty || value !== '' ? '' : 'invalid string';
  }
  if (type === 'boolean') {
    return typeof value === 'boolean' ? '' : 'invalid boolean';
  }
  if (type === 'integer') {
    return typeof value === 'number' && Number.isInteger(value) ? '' : 'invalid integer';
  }
  if (type === 'float') {
    return typeof value === 'number' && Number.isFinite(value) ? '' : 'invalid float';
  }
  return '';
}

jest.mock('../lib/modules/soap', () => ({
  requestCommand: (...args: Parameters<typeof mockRequestCommand>) => mockRequestCommand(...args),
  createRequestSoap: (...args: Parameters<typeof mockCreateRequestSoap>) => mockCreateRequestSoap(...args),
  escapeXml: (...args: Parameters<typeof mockEscapeXml>) => mockEscapeXml(...args),
  isInvalidValue: mockIsInvalidValue
}));

interface ServiceDeviceInternal {
  _parseGetSystemDateAndTime(payload: Record<string, unknown>): {
    dst: boolean | null;
    date: Date | null;
  } | null;
}

interface ServiceMediaInternal {
  getStreamUri(params: { ProfileToken: string; Protocol: string }): Promise<SoapCommandResult>;
}

interface ServicePtzInternal {
  continuousMove(params: {
    ProfileToken: string;
    Velocity: { x: number; y: number; z: number };
    Timeout?: number;
  }): Promise<SoapCommandResult>;
}

interface ServiceEventsInternal {
  pullMessages(params: {
    subscriptionReference: string;
    timeout?: number;
    messageLimit?: number;
  }): Promise<SoapCommandResult>;
  unsubscribe(params: { subscriptionReference: string }): Promise<SoapCommandResult>;
}

describe('ONVIF service modules', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRequestCommand.mockReset();
    mockCreateRequestSoap.mockClear();
    mockEscapeXml.mockClear();
    mockRequestCommand.mockResolvedValue({
      soap: '<ok/>',
      formatted: '',
      converted: {},
      data: {}
    });
  });

  test('service-device parses midnight timestamps and false daylight savings', () => {
    const ServiceDevice = require('../lib/modules/service-device') as new (params: { xaddr: string }) => ServiceDeviceInternal;
    const service = new ServiceDevice({ xaddr: 'http://camera.local/onvif/device_service' });

    const parsed = service._parseGetSystemDateAndTime({
      Body: {
        GetSystemDateAndTimeResponse: {
          SystemDateAndTime: {
            DateTimeType: 'Manual',
            DaylightSavings: 'false',
            TimeZone: { TZ: 'UTC0' },
            UTCDateTime: {
              Time: { Hour: '0', Minute: '0', Second: '0' },
              Date: { Year: '2025', Month: '1', Day: '2' }
            }
          }
        }
      }
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.dst).toBe(false);
    expect(parsed?.date?.toISOString()).toBe('2025-01-02T00:00:00.000Z');
  });

  test('service-media validates and serializes GetStreamUri requests', async () => {
    const ServiceMedia = require('../lib/modules/service-media') as new (params: { xaddr: string }) => ServiceMediaInternal;
    const service = new ServiceMedia({ xaddr: 'http://camera.local/onvif/media_service' });

    await expect(service.getStreamUri({ ProfileToken: 'Profile1', Protocol: 'BAD' }))
      .rejects.toThrow('The "Protocol" property was invalid');

    await service.getStreamUri({ ProfileToken: 'Profile1', Protocol: 'RTSP' });

    expect(mockRequestCommand).toHaveBeenCalledWith(
      expect.any(URL),
      'GetStreamUri',
      expect.stringContaining('<tt:Protocol>RTSP</tt:Protocol>')
    );
  });

  test('service-ptz serializes ContinuousMove requests', async () => {
    const ServicePtz = require('../lib/modules/service-ptz') as new (params: { xaddr: string }) => ServicePtzInternal;
    const service = new ServicePtz({ xaddr: 'http://camera.local/onvif/ptz_service' });

    await service.continuousMove({
      ProfileToken: 'Profile1',
      Velocity: { x: 0.5, y: -0.25, z: 1 },
      Timeout: 5
    });

    expect(mockRequestCommand).toHaveBeenCalledWith(
      expect.any(URL),
      'ContinuousMove',
      expect.stringContaining('<tptz:Timeout>PT5S</tptz:Timeout>')
    );
  });

  test('service-events uses the subscription URL for event pulls and unsubscribe', async () => {
    const ServiceEvents = require('../lib/modules/service-events') as new (params: { xaddr: string }) => ServiceEventsInternal;
    const service = new ServiceEvents({ xaddr: 'http://camera.local/onvif/events_service' });

    await service.pullMessages({
      subscriptionReference: 'http://camera.local/onvif/subscription/123',
      timeout: 15,
      messageLimit: 4
    });

    expect(mockRequestCommand).toHaveBeenLastCalledWith(
      new URL('http://camera.local/onvif/subscription/123'),
      'PullMessages',
      expect.stringContaining('<tev:MessageLimit>4</tev:MessageLimit>')
    );

    await service.unsubscribe({
      subscriptionReference: 'http://camera.local/onvif/subscription/123'
    });

    expect(mockRequestCommand).toHaveBeenLastCalledWith(
      new URL('http://camera.local/onvif/subscription/123'),
      'Unsubscribe',
      expect.stringContaining('<wsnt:Unsubscribe')
    );
  });
});
