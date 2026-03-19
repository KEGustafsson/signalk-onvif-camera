import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';

import type { HttpAuthRequestOptions } from '../lib/types';

interface MockAuthRequest extends EventEmitter {
  end: jest.Mock<void, []>;
}

interface MockAuthResponse extends EventEmitter {
  statusCode: number;
  headers: {
    'www-authenticate'?: string | string[];
  };
  resume: jest.Mock<void, []>;
}

interface RequestInvocation {
  options: HttpAuthRequestOptions;
  callback: (res: IncomingMessage) => void;
  request: MockAuthRequest;
}

const requestInvocations: RequestInvocation[] = [];
const mockHttpRequest = jest.fn<import('http').ClientRequest, [HttpAuthRequestOptions, (res: IncomingMessage) => void]>();

jest.mock('http', () => ({
  request: (...args: Parameters<typeof mockHttpRequest>) => mockHttpRequest(...args)
}));

jest.mock('https', () => ({
  request: jest.fn()
}));

function cloneOptions(options: HttpAuthRequestOptions): HttpAuthRequestOptions {
  return {
    ...options,
    headers: Array.isArray(options.headers)
      ? [...options.headers]
      : options.headers
        ? { ...options.headers }
        : undefined
  };
}

function createDigestChallengeResponse(): MockAuthResponse {
  const response = new EventEmitter() as MockAuthResponse;
  response.statusCode = 401;
  response.headers = {
    'www-authenticate': 'Digest realm="Test Realm", nonce="abc123", qop="auth", algorithm=MD5'
  };
  response.resume = jest.fn();
  return response;
}

describe('http-auth module', () => {
  beforeEach(() => {
    requestInvocations.length = 0;
    mockHttpRequest.mockReset();
    mockHttpRequest.mockImplementation((options, callback) => {
      const request = new EventEmitter() as MockAuthRequest;
      request.end = jest.fn();
      requestInvocations.push({
        options: cloneOptions(options),
        callback,
        request
      });
      return request as unknown as import('http').ClientRequest;
    });
  });

  test('keeps digest auth state isolated across concurrent requests', () => {
    const auth = require('../lib/modules/http-auth') as {
      request(options: HttpAuthRequestOptions, callback: (res: IncomingMessage) => void): import('http').ClientRequest;
    };

    auth.request({
      protocol: 'http:',
      hostname: 'camera-a',
      path: '/snapshot/a',
      method: 'GET',
      auth: 'user-a:pass-a'
    }, jest.fn());

    auth.request({
      protocol: 'http:',
      hostname: 'camera-b',
      path: '/snapshot/b',
      method: 'GET',
      auth: 'user-b:pass-b'
    }, jest.fn());

    requestInvocations[0].callback(createDigestChallengeResponse() as unknown as IncomingMessage);
    requestInvocations[1].callback(createDigestChallengeResponse() as unknown as IncomingMessage);

    const firstRetryAuthorization = requestInvocations[2].options.headers as { Authorization?: string };
    const secondRetryAuthorization = requestInvocations[3].options.headers as { Authorization?: string };

    expect(firstRetryAuthorization.Authorization).toContain('username="user-a"');
    expect(firstRetryAuthorization.Authorization).toContain('uri="/snapshot/a"');
    expect(secondRetryAuthorization.Authorization).toContain('username="user-b"');
    expect(secondRetryAuthorization.Authorization).toContain('uri="/snapshot/b"');
  });

  test('emits retry request errors on the original request', () => {
    const responseCallback = jest.fn();
    const auth = require('../lib/modules/http-auth') as {
      request(options: HttpAuthRequestOptions, callback: (res: IncomingMessage) => void): import('http').ClientRequest;
    };

    const request = auth.request({
      protocol: 'http:',
      hostname: 'camera-a',
      path: '/snapshot/a',
      method: 'GET',
      auth: 'user-a:pass-a'
    }, responseCallback);

    const errorListener = jest.fn();
    request.on('error', errorListener);

    requestInvocations[0].callback(createDigestChallengeResponse() as unknown as IncomingMessage);
    requestInvocations[1].request.emit('error', new Error('retry failed'));

    expect(errorListener).toHaveBeenCalledWith(expect.objectContaining({
      message: 'retry failed'
    }));
    expect(responseCallback).not.toHaveBeenCalled();
  });

  test('omits qop fields when the digest challenge does not provide qop', () => {
    const auth = require('../lib/modules/http-auth') as {
      request(options: HttpAuthRequestOptions, callback: (res: IncomingMessage) => void): import('http').ClientRequest;
    };

    auth.request({
      protocol: 'http:',
      hostname: 'camera-a',
      path: '/snapshot/a',
      method: 'GET',
      auth: 'user-a:pass-a'
    }, jest.fn());

    const response = new EventEmitter() as MockAuthResponse;
    response.statusCode = 401;
    response.headers = {
      'www-authenticate': 'Digest realm="Test Realm", nonce="abc123", opaque="opaque-token", algorithm=MD5-sess'
    };
    response.resume = jest.fn();

    requestInvocations[0].callback(response as unknown as IncomingMessage);

    const retryAuthorization = requestInvocations[1].options.headers as { Authorization?: string };
    expect(retryAuthorization.Authorization).toContain('opaque="opaque-token"');
    expect(retryAuthorization.Authorization).not.toContain('qop=');
    expect(retryAuthorization.Authorization).not.toContain('nc=');
    expect(retryAuthorization.Authorization).not.toContain('cnonce=');
  });

  test('selects a digest challenge when multiple auth headers are present', () => {
    const auth = require('../lib/modules/http-auth') as {
      request(options: HttpAuthRequestOptions, callback: (res: IncomingMessage) => void): import('http').ClientRequest;
    };

    auth.request({
      protocol: 'http:',
      hostname: 'camera-a',
      path: '/snapshot/a',
      method: 'GET',
      auth: 'user-a:pass-a'
    }, jest.fn());

    const response = new EventEmitter() as MockAuthResponse;
    response.statusCode = 401;
    response.headers = {
      'www-authenticate': [
        'Basic realm="Fallback"',
        'Digest realm="Test Realm", nonce="abc123", qop="auth", algorithm=MD5'
      ]
    };
    response.resume = jest.fn();

    requestInvocations[0].callback(response as unknown as IncomingMessage);

    const retryAuthorization = requestInvocations[1].options.headers as { Authorization?: string };
    expect(retryAuthorization.Authorization).toContain('Digest ');
    expect(retryAuthorization.Authorization).toContain('username="user-a"');
  });
});
