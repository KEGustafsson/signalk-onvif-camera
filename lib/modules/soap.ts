/* ------------------------------------------------------------------
* node-onvif - soap.js
*
* Copyright (c) 2016-2018, Futomi Hatano, All rights reserved.
* Released under the MIT license
* Date: 2018-08-13
 * ---------------------------------------------------------------- */
'use strict';
import type { IncomingMessage, RequestOptions } from 'http';

import type { OnvifSoapLike, RequestSoapParams, SoapCommandResult, UnknownRecord } from '../types';

const mXml2Js = require('xml2js') as typeof import('xml2js');
const mHttp = require('http') as typeof import('http');
const mHttps = require('https') as typeof import('https');
const mCrypto = require('crypto') as typeof import('crypto');
let mHtml: { prettyPrint(value: string, options: { indent_size: number }): string } | null = null;
try {
  mHtml = require('html') as { prettyPrint(value: string, options: { indent_size: number }): string };
} catch (_error) {
  // Optional dependency
}

interface SoapFaultText extends UnknownRecord {
  _: string;
}

interface OnvifSoapState extends OnvifSoapLike {
  HTTP_TIMEOUT: number;
  _request(oxaddr: URL, soap: string): Promise<string>;
  _parseResponseResult(methodName: string, response: UnknownRecord): UnknownRecord | null;
  _getFaultReason(response: UnknownRecord): string;
  _createSoapUserToken(diff: number | undefined, user: string, pass?: string): string;
  _createNonce(digit: number): Buffer;
  _getTypeOfValue(value: unknown): string;
}

interface OnvifSoapConstructor {
  new (): OnvifSoapState;
  prototype: OnvifSoapState;
}

function getRequestPort(protocol: string, port: string): number {
  const parsedPort = parseInt(port, 10);
  if(Number.isFinite(parsedPort)) {
    return parsedPort;
  }
  return protocol === 'https:' ? 443 : 80;
}

/* ------------------------------------------------------------------
* Constructor: OnvifSoap()
* ---------------------------------------------------------------- */
const OnvifSoap = function (this: OnvifSoapState) {
  this.HTTP_TIMEOUT = 3000; // ms
} as unknown as OnvifSoapConstructor;

/* ------------------------------------------------------------------
* Method: parse(soap)
* ---------------------------------------------------------------- */
OnvifSoap.prototype.parse = function (this: OnvifSoapState, soap: string) {
  const promise = new Promise<UnknownRecord>((resolve, reject) => {
    const opts = {
      'explicitRoot'     : false,
      'explicitArray'    : false,
      'ignoreAttrs'      : false, // Never change to `true`
      'tagNameProcessors': [function (name: string) {
        const m = name.match(/^([^:]+):([^:]+)$/);
        return (m ? m[2] : name);
      }]
    };
    mXml2Js.parseString(soap, opts, (error: Error | null, result: UnknownRecord) => {
      if(error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
  return promise;
};

/* ------------------------------------------------------------------
* Method: requestCommand(oxaddr, method_name, soap)
* ---------------------------------------------------------------- */
OnvifSoap.prototype.requestCommand = function (this: OnvifSoapState, oxaddr: URL, method_name: string, soap: string) {
  const promise = new Promise<SoapCommandResult>((resolve, reject) => {
    let xml = '';
    this._request(oxaddr, soap).then((res: string) => {
      xml = res;
      return this.parse(xml);
    }).then((result: UnknownRecord) => {
      const fault = this._getFaultReason(result);
      if(fault) {
        const err = new Error(fault);
        reject(err);
      } else {
        const parsed = this._parseResponseResult(method_name, result);
        if(parsed) {
          const res = {
            'soap'     : xml,
            'formatted': mHtml ? mHtml.prettyPrint(xml, { indent_size: 2 }) : '',
            'converted': result,
            'data': parsed
          };
          resolve(res);
        } else {
          const err = new Error('The device seems to not support the ' + method_name + '() method.');
          reject(err);
        }
      }
    }).catch((error) => {
      reject(error);
    });
  });
  return promise;
};

OnvifSoap.prototype._parseResponseResult = function (method_name: string, res: UnknownRecord): UnknownRecord | null {
  const s0 = res['Body'];
  if(!s0 || typeof s0 !== 'object') {return null;}
  if((method_name + 'Response') in s0) {
    return s0 as UnknownRecord;
  } else {
    return null;
  }
};

OnvifSoap.prototype._request = function (this: OnvifSoapState, oxaddr: URL, soap: string) {
  const promise = new Promise<string>((resolve, reject) => {
    let settled = false;
    const resolveOnce = (value: string): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const rejectOnce = (error: Error): void => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const post_opts: RequestOptions = {
      protocol: oxaddr.protocol,
      //auth    : oxaddr.auth,
      hostname: oxaddr.hostname,
      port    : getRequestPort(oxaddr.protocol, oxaddr.port),
      path    : oxaddr.pathname + oxaddr.search,
      method  : 'POST',
      headers: {
        //'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.onvif.org/ver10/device/wsdl/GetScopes"',
        'Content-Type': 'application/soap+xml; charset=utf-8;',
        'Content-Length': Buffer.byteLength(soap)
      }
    };

    const httpModule = (oxaddr.protocol === 'https:') ? mHttps : mHttp;
    let req: import('http').ClientRequest | null = httpModule.request(post_opts, (res: IncomingMessage) => {
      res.setEncoding('utf8');
      let xml = '';
      res.on('data', (chunk: string) => {
        xml += chunk;
      });
      res.on('error', (error: Error) => {
        rejectOnce(new Error('Network Error: ' + error.message));
      });
      res.on('aborted', () => {
        rejectOnce(new Error('Network Error: Response aborted'));
      });
      res.on('end', () => {
        if(req) {
          req.removeAllListeners('error');
          req.removeAllListeners('timeout');
          req = null;
        }
        if(res.statusCode === 200) {
          resolveOnce(xml);
        } else {
          const err = new Error(res.statusCode + ' ' + res.statusMessage);
          const code = res.statusCode;
          const text = res.statusMessage;
          if(xml) {
            this.parse(xml).then((parsed: UnknownRecord) => {
              let msg = '';
              try {
                const faultText = (((parsed['Body'] as UnknownRecord)?.['Fault'] as UnknownRecord)?.['Reason'] as UnknownRecord)?.['Text'];
                if (typeof(faultText) === 'string') {
                  msg = faultText;
                } else if (faultText && typeof(faultText) === 'object') {
                  msg = (faultText as SoapFaultText)['_'] || '';
                }
              } catch(_error) {
                // Ignore parsing errors
              }
              if(msg) {
                rejectOnce(new Error(code + ' ' + text + ' - ' + msg));
              } else {
                rejectOnce(err);
              }
            }).catch((_error) => {
              rejectOnce(err);
            });
          } else {
            rejectOnce(err);
          }
        }
      });
    });

    req.setTimeout(this.HTTP_TIMEOUT);

    req.on('timeout', () => {
      req?.destroy();
    });

    req.on('error', (error: Error) => {
      req?.removeAllListeners('error');
      req?.removeAllListeners('timeout');
      req = null;
      rejectOnce(new Error('Network Error: ' + (error ? error.message : '')));
    });

    req?.write(soap, 'utf8');
    req?.end();
  });
  return promise;
};

OnvifSoap.prototype._getFaultReason = function (r: UnknownRecord): string {
  let reason = '';
  try {
    const reason_el = ((r['Body'] as UnknownRecord)?.['Fault'] as UnknownRecord)?.['Reason'] as UnknownRecord;
    if(reason_el['Text']) {
      reason = String(reason_el['Text']);
    } else {
      const code_el = ((r['Body'] as UnknownRecord)?.['Fault'] as UnknownRecord)?.['Code'] as UnknownRecord;
      if(code_el['Value']) {
        reason = String(code_el['Value']);
        const subcode_el = code_el['Subcode'] as UnknownRecord;
        if(subcode_el['Value']) {
          reason += ' ' + String(subcode_el['Value']);
        }
      }
    }
  } catch(_error) {
    // Ignore parsing errors
  }
  return reason;
};

/* ------------------------------------------------------------------
* Method: createRequestSoap(params)
* - params:
*   - body: description in the <s:Body>
*   - xmlns: a list of xmlns attributes used in the body
*       e.g., xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
*   - diff: Time difference [ms]
*   - user: user name
*   - pass: password
* ---------------------------------------------------------------- */
OnvifSoap.prototype.createRequestSoap = function (this: OnvifSoapState, params: RequestSoapParams): string {
  let soap = '';
  soap += '<?xml version="1.0" encoding="UTF-8"?>';
  soap += '<s:Envelope';
  soap += '  xmlns:s="http://www.w3.org/2003/05/soap-envelope"';
  if(params.xmlns && Array.isArray(params.xmlns)) {
    params.xmlns.forEach((ns) => {
      soap += ' ' + ns;
    });
  }
  soap += '>';
  soap += '<s:Header>';
  if(params.user) {
    soap += this._createSoapUserToken(params.diff, params.user, params.pass);
  }
  soap += '</s:Header>';
  soap += '<s:Body>' + params.body + '</s:Body>';
  soap += '</s:Envelope>';

  soap = soap.replace(/>\s+</g, '><');
  return soap;
};

OnvifSoap.prototype._createSoapUserToken = function (this: OnvifSoapState, diff: number | undefined, user: string, pass?: string): string {
  if(!diff) {diff = 0;}
  if(!pass) {pass = '';}
  const date = (new Date(Date.now() + diff)).toISOString();
  const nonce_buffer = this._createNonce(16);
  const nonce_base64 = nonce_buffer.toString('base64');
  const shasum = mCrypto.createHash('sha1');
  shasum.update(Buffer.concat([nonce_buffer, Buffer.from(date), Buffer.from(pass)]));
  const digest = shasum.digest('base64');
  let soap = '';
  soap += '<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">';
  soap += '  <UsernameToken>';
  soap += '    <Username>' + this.escapeXml(user) + '</Username>';
  soap += '    <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">' + digest + '</Password>';
  soap += '    <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">' + nonce_base64 + '</Nonce>';
  soap += '    <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">' + date + '</Created>';
  soap += '  </UsernameToken>';
  soap += '</Security>';
  return soap;
};

OnvifSoap.prototype._createNonce = function (digit: number): Buffer {
  return mCrypto.randomBytes(digit);
};

OnvifSoap.prototype.escapeXml = function (str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

/* ------------------------------------------------------------------
* Method: isInvalidValue(value, type, allow_empty)
* - type: 'undefined', 'null', 'array', 'integer', 'float', 'boolean', 'object'
* ---------------------------------------------------------------- */
OnvifSoap.prototype.isInvalidValue = function (this: OnvifSoapState, value: unknown, type: string, allow_empty?: boolean): string {
  const vt = this._getTypeOfValue(value);
  if(type === 'float') {
    if(!vt.match(/^(float|integer)$/)) {
      return 'The type of the value must be "' + type + '".';
    }
  } else {
    if(vt !== type) {
      return 'The type of the value must be "' + type + '".';
    }
  }

  if(!allow_empty) {
    if(vt === 'array' && Array.isArray(value) && value.length === 0) {
      return 'The value must not be an empty array.';
    } else if(vt === 'string' && value === '') {
      return 'The value must not be an empty string.';
    }
  }
  if(typeof(value) === 'string') {
    if(value.match(/[^\x20-\x7e]/)) {
      return 'The value must consist of ascii characters.';
    }
    if(value.match(/[<>]/)) {
      return 'Invalid characters were found in the value ("<", ">")';
    }
  }
  return '';
};

OnvifSoap.prototype._getTypeOfValue = function (value: unknown): string {
  if(value === undefined) {
    return 'undefined';
  } else if(value === null) {
    return 'null';
  } else if(Array.isArray(value)) {
    return 'array';
  }
  const t = typeof(value);
  if(t === 'boolean') {
    return 'boolean';
  } else if(t === 'string') {
    return 'string';
  } else if(t === 'number') {
    if((value as number) % 1 === 0) {
      return 'integer';
    } else {
      return 'float';
    }
  } else if(t === 'object') {
    if(Object.prototype.toString.call(value) === '[object Object]') {
      return 'object';
    } else {
      return 'unknown';
    }
  } else {
    return 'unknown';
  }
};

module.exports = new OnvifSoap();
