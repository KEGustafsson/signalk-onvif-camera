/* ------------------------------------------------------------------
* node-onvif - http-auth.js
*
* Copyright (c) 2016, Futomi Hatano, All rights reserved.
* Released under the MIT license
* Date: 2017-08-26
 * ---------------------------------------------------------------- */
'use strict';
import type { IncomingMessage } from 'http';

import type { DigestAuthHeader, HttpAuthRequestOptions } from '../types';

const mHttp = require('http') as typeof import('http');
const mHttps = require('https') as typeof import('https');
const mCrypto = require('crypto') as typeof import('crypto');

interface DigestRequestState {
  user: string;
  pass: string;
  method: string;
  path: string;
  nonceCount: number;
  options: HttpAuthRequestOptions;
}

interface OnvifHttpAuthState {
  request(options: HttpAuthRequestOptions, callback: (res: IncomingMessage) => void): import('http').ClientRequest;
  _createState(options: HttpAuthRequestOptions): DigestRequestState;
  _handleHttpDigest(
    http: typeof mHttp | typeof mHttps,
    state: DigestRequestState,
    authHeader: string,
    callback: (res: IncomingMessage) => void,
    initialRequest: import('http').ClientRequest
  ): void;
  _emitRequestError(request: import('http').ClientRequest, error: Error): void;
  _createAuthReqHeaderValue(state: DigestRequestState, o: DigestAuthHeader): string;
  _createCnonce(digit: number): string;
  _createHash(algo: string | undefined, data: string): string;
  _parseAuthHeader(h: string): DigestAuthHeader;
}

interface OnvifHttpAuthConstructor {
  new (): OnvifHttpAuthState;
  prototype: OnvifHttpAuthState;
}

function getRealm(header: DigestAuthHeader): string {
  return header.realm || header['Digest realm'] || '';
}

function getSelectedQop(qop: string | undefined): string | undefined {
  if (!qop) {
    return undefined;
  }

  const qopList = qop.split(',').map((value) => value.trim()).filter(Boolean);
  if (qopList.includes('auth')) {
    return 'auth';
  }
  return qopList[0];
}

function isSessionAlgorithm(algorithm: string): boolean {
  return algorithm.toUpperCase().endsWith('-SESS');
}

function getHashAlgorithmName(algorithm: string | undefined): string {
  const normalized = (algorithm || 'MD5').toUpperCase();
  const digestAlgorithm = normalized.endsWith('-SESS')
    ? normalized.slice(0, -5)
    : normalized;
  const candidates = Array.from(new Set([
    digestAlgorithm.toLowerCase(),
    digestAlgorithm.toLowerCase().replace(/^md-?5$/, 'md5'),
    digestAlgorithm.toLowerCase().replace(/^sha-(\d+)$/, 'sha$1'),
    digestAlgorithm.toLowerCase().replace(/^sha-(\d+)-(\d+)$/, 'sha$1-$2')
  ]));
  const supportedAlgorithms = mCrypto.getHashes();
  const hashAlgorithm = candidates.find((candidate) => supportedAlgorithms.includes(candidate));
  if (!hashAlgorithm) {
    throw new Error('Unsupported digest algorithm: ' + digestAlgorithm);
  }
  return hashAlgorithm;
}

/* ------------------------------------------------------------------
* Constructor: OnvifHttpAuth()
* ---------------------------------------------------------------- */
const OnvifHttpAuth = function (this: OnvifHttpAuthState) {
} as unknown as OnvifHttpAuthConstructor;

/* ------------------------------------------------------------------
* Method: request(options, callback)
* ---------------------------------------------------------------- */
OnvifHttpAuth.prototype.request = function (this: OnvifHttpAuthState, options: HttpAuthRequestOptions, callback: (res: IncomingMessage) => void) {
  const state = this._createState(options);
  const http = (options && options.protocol === 'https:') ? mHttps : mHttp;
  const req = http.request(options, (res: IncomingMessage) => {
    if(res.statusCode === 401 && res.headers['www-authenticate']) {
      const authHeaderValue = res.headers['www-authenticate'];
      const authHeaderList = Array.isArray(authHeaderValue)
        ? authHeaderValue
        : [authHeaderValue];
      const authHeader = authHeaderList.find((header): header is string => typeof header === 'string' && header.match(/^Digest\b/i) !== null);
      if(authHeader) {
        res.resume();
        this._handleHttpDigest(http, state, authHeader, callback, req);
      } else {
        callback(res);
      }
    } else {
      callback(res);
    }
  });
  return req;
};

OnvifHttpAuth.prototype._createState = function (this: OnvifHttpAuthState, options: HttpAuthRequestOptions): DigestRequestState {
  let user = '';
  let pass = '';
  if(options.auth && typeof options.auth === 'string') {
    const colonIdx = options.auth.indexOf(':');
    user = colonIdx >= 0 ? options.auth.slice(0, colonIdx) : options.auth;
    pass = colonIdx >= 0 ? options.auth.slice(colonIdx + 1) : '';
  }

  return {
    user,
    pass,
    method: options.method && typeof options.method === 'string' ? options.method.toUpperCase() : 'GET',
    path: options.path && typeof options.path === 'string' ? options.path : '',
    nonceCount: 0,
    options: {
      ...options
    }
  };
};

OnvifHttpAuth.prototype._handleHttpDigest = function (
  this: OnvifHttpAuthState,
  http: typeof mHttp | typeof mHttps,
  state: DigestRequestState,
  authHeader: string,
  callback: (res: IncomingMessage) => void,
  initialRequest: import('http').ClientRequest
) {
  const o = this._parseAuthHeader(authHeader);
  const existingHeaders = state.options.headers;
  const headers = (!existingHeaders || Array.isArray(existingHeaders) ? {} : { ...existingHeaders }) as import('http').OutgoingHttpHeaders;
  headers.Authorization = this._createAuthReqHeaderValue(state, o);
  const retryOptions: HttpAuthRequestOptions = {
    ...state.options,
    headers
  };
  const retryRequest = http.request(retryOptions, callback);
  retryRequest.on('error', (error: Error) => {
    this._emitRequestError(initialRequest, error);
  });
  retryRequest.end();
};

OnvifHttpAuth.prototype._emitRequestError = function (this: OnvifHttpAuthState, request: import('http').ClientRequest, error: Error): void {
  if(request.listenerCount('error') > 0) {
    request.emit('error', error);
  }
};

OnvifHttpAuth.prototype._createAuthReqHeaderValue = function (this: OnvifHttpAuthState, state: DigestRequestState, o: DigestAuthHeader): string {
  const algorithm = o.algorithm || 'MD5';
  const realm = getRealm(o);
  const nonce = o.nonce || '';
  const qop = getSelectedQop(o.qop);
  const cnonce = this._createCnonce(8);
  let ha1 = this._createHash(algorithm, [state.user, realm, state.pass].join(':'));
  if (isSessionAlgorithm(algorithm)) {
    ha1 = this._createHash(algorithm, [ha1, nonce, cnonce].join(':'));
  }
  const ha2 = this._createHash(algorithm, [state.method, state.path].join(':'));
  state.nonceCount++;
  const nc = ('0000000' + state.nonceCount.toString(16)).slice(-8);
  const response = qop
    ? this._createHash(algorithm, [ha1, nonce, nc, cnonce, qop, ha2].join(':'))
    : this._createHash(algorithm, [ha1, nonce, ha2].join(':'));

  const hvalueList = [
    'username="' + state.user + '"',
    'realm="' + realm + '"',
    'nonce="' + nonce + '"',
    'uri="' + state.path + '"'
  ];
  if (o.opaque) {
    hvalueList.push('opaque="' + o.opaque + '"');
  }
  if (algorithm) {
    hvalueList.push('algorithm=' + algorithm);
  }
  if (qop) {
    hvalueList.push('qop=' + qop);
    hvalueList.push('nc=' + nc);
    hvalueList.push('cnonce="' + cnonce + '"');
  }
  hvalueList.push(
    'response="' + response + '"'
  );

  let hvalue = hvalueList.join(', ');
  hvalue = 'Digest ' + hvalue;
  return hvalue;
};

OnvifHttpAuth.prototype._createCnonce = function (digit: number): string {
  return mCrypto.randomBytes(digit).toString('hex');
};

OnvifHttpAuth.prototype._createHash = function (algo: string | undefined, data: string): string {
  const hash = mCrypto.createHash(getHashAlgorithmName(algo));
  hash.update(data, 'utf8');
  return hash.digest('hex');
};

OnvifHttpAuth.prototype._parseAuthHeader = function (h: string): DigestAuthHeader {
  const o: DigestAuthHeader = {};
  // Use a regex to tokenize key=value pairs, correctly handling quoted values
  // that may contain commas (e.g. realm="Cameras, Office").
  const re = /(\w[\w\s-]*)=(?:"([^"]*)"|([^,\s]*))/g;
  let m;
  while ((m = re.exec(h)) !== null) {
    const k = m[1].trim();
    const v = (m[2] !== undefined) ? m[2] : m[3];
    if (k) {
      o[k] = v;
      if (k === 'realm') {
        o.realm = v;
        o['Digest realm'] = v;
      } else if (k === 'Digest realm') {
        o.realm = v;
      }
    }
  }
  if(!o['algorithm']) { // workaround for DBPOWER
    o['algorithm'] = 'MD5';
  }
  return o;
};

module.exports = new OnvifHttpAuth();
