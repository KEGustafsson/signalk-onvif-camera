/* ------------------------------------------------------------------
* node-onvif - node-onvif.js
*
* Copyright (c) 2016 - 2017, Futomi Hatano, All rights reserved.
* Released under the MIT license
* Date: 2017-09-30
* ---------------------------------------------------------------- */
'use strict';

import type { Socket } from 'dgram';
import type { NodeStyleCallback, OnvifDiscoveryDevice, OnvifDeviceLike, OnvifSoapLike, UnknownRecord, VoidCallback } from './types';

const mDgram = require('dgram') as typeof import('dgram');
const mCrypto = require('crypto') as typeof import('crypto');

type OnvifDeviceConstructor = new (params: {
  address?: string;
  xaddr?: string;
  user?: string;
  pass?: string;
}) => OnvifDeviceLike;

type DiscoveryCallback = (result: OnvifDiscoveryDevice | Error) => void;

function toRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : null;
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toStringList(value: unknown): string[] {
  const rawValue = typeof value === 'string'
    ? value
    : (() => {
      const record = toRecord(value);
      return record && typeof record['_'] === 'string' ? record['_'] : '';
    })();
  return rawValue.split(/\s+/).filter(Boolean);
}

class Onvif {
  public OnvifDevice: OnvifDeviceConstructor;
  private _OnvifSoap: OnvifSoapLike;
  private _MULTICAST_ADDRESS = '239.255.255.250';
  private _PORT = 3702;
  private _udp: Socket | null = null;
  private _devices: Record<string, OnvifDiscoveryDevice> = {};
  private _DISCOVERY_INTERVAL = 150;
  private _DISCOVERY_RETRY_MAX = 3;
  private _DISCOVERY_WAIT = 3000;
  private _discovery_interval_timer: NodeJS.Timeout | null = null;
  private _discovery_wait_timer: NodeJS.Timeout | null = null;
  private _probeInProgress = false;
  private _uuid = '';

  constructor() {
    this.OnvifDevice = require('./modules/device') as OnvifDeviceConstructor;
    this._OnvifSoap = require('./modules/soap') as OnvifSoapLike;
  }

  /* ------------------------------------------------------------------
  * Method: startDiscovery(callback)
  * [Caution]
  *   This method has been depricated.
  *   Use the startProbe() method instead of this method.
  * ---------------------------------------------------------------- */
  public startDiscovery(callback: DiscoveryCallback): void {
    this.startProbe().then((list) => {
      const execCallback = () => {
        const device = list.shift();
        if (device) {
          callback(device);
          setTimeout(() => {
            execCallback();
          }, 100);
        }
      };
      execCallback();
    }).catch((error: Error) => {
      callback(error);
    });
  }

  public startProbe(ipAddress?: string): Promise<OnvifDiscoveryDevice[]>;
  public startProbe(callback?: NodeStyleCallback<OnvifDiscoveryDevice[]>): void;
  public startProbe(
    ipAddressOrCallback?: string | NodeStyleCallback<OnvifDiscoveryDevice[]>,
    callback?: NodeStyleCallback<OnvifDiscoveryDevice[]>
  ): Promise<OnvifDiscoveryDevice[]> | void {
    const ipAddress = typeof ipAddressOrCallback === 'string' ? ipAddressOrCallback : undefined;
    const nodeCallback = typeof ipAddressOrCallback === 'function' ? ipAddressOrCallback : callback;

    const promise = new Promise<OnvifDiscoveryDevice[]>((resolve, reject) => {
      if (this._probeInProgress) {
        reject(new Error('Discovery already in progress'));
        return;
      }
      this._probeInProgress = true;

      this._devices = {};
      this._udp = mDgram.createSocket('udp4');

      this._udp.once('error', (error: Error) => {
        void this.stopProbe().catch(() => undefined).then(() => reject(error));
      });

      this._udp.on('message', (buf: Buffer) => {
        this._OnvifSoap.parse(buf.toString()).then((result) => {
          const probeList = this._parseProbeMatches(result);
          probeList.forEach((probe) => {
            if (!this._devices[probe.urn]) {
              this._devices[probe.urn] = probe;
            }
          });
        }).catch(() => {
          // Do nothing.
        });
      });

      this._udp.bind(() => {
        const udp = this._udp;
        if (!udp) {
          reject(new Error('Discovery socket was not initialized.'));
          return;
        }

        if (ipAddress !== undefined) {
          try {
            udp.setMulticastInterface(ipAddress);
          } catch (_error) {
            // Invalid multicast interface address; discovery continues without it
          }
        }
        this._sendProbe().catch((error: Error) => {
          void this.stopProbe().catch(() => undefined).then(() => reject(error));
        });

        this._discovery_wait_timer = setTimeout(() => {
          this.stopProbe().then(() => {
            resolve(Object.keys(this._devices).map((urn) => this._devices[urn]));
          }).catch((error: Error) => {
            reject(error);
          });
        }, this._DISCOVERY_WAIT);
      });
    });

    if (nodeCallback) {
      promise.then((deviceList) => {
        nodeCallback(null, deviceList);
      }).catch((error: Error) => {
        nodeCallback(error);
      });
    } else {
      return promise;
    }
  }

  private _isValidCallback(callback: unknown): boolean {
    return typeof callback === 'function';
  }

  private _execCallback<TResult>(
    callback: NodeStyleCallback<TResult> | VoidCallback | undefined,
    arg1: Error | null,
    arg2?: TResult
  ): void {
    const cb = callback;
    if (cb) {
      cb(arg1, arg2);
    }
  }

  private _parseProbeMatchRecord(probeMatch: UnknownRecord): OnvifDiscoveryDevice | null {
    const endpointReference = toRecord(probeMatch['EndpointReference']);
    const urn = toStringValue(endpointReference?.['Address']);
    const xaddrs = toStringList(probeMatch['XAddrs']);
    const scopes = toStringList(probeMatch['Scopes']);
    const types = toStringList(probeMatch['Types']);

    if (!urn || xaddrs.length === 0 || scopes.length === 0) {
      return null;
    }

    let name = '';
    let hardware = '';
    let location = '';

    scopes.forEach((scope) => {
      if(scope.indexOf('onvif://www.onvif.org/hardware/') === 0) {
        hardware = scope.split('/').pop() || '';
      } else if(scope.indexOf('onvif://www.onvif.org/location/') === 0) {
        location = scope.split('/').pop() || '';
      } else if(scope.indexOf('onvif://www.onvif.org/name/') === 0) {
        name = (scope.split('/').pop() || '').replace(/_/g, ' ');
      }
    });

    return {
      urn,
      name,
      hardware,
      location,
      types,
      xaddrs,
      scopes
    };
  }

  private _parseProbeMatches(result: UnknownRecord): OnvifDiscoveryDevice[] {
    const probeMatches = toRecord(toRecord(result['Body'])?.['ProbeMatches']);
    const rawProbeMatch = probeMatches?.['ProbeMatch'];
    const probeMatchList = Array.isArray(rawProbeMatch)
      ? rawProbeMatch.map((value) => toRecord(value)).filter((value): value is UnknownRecord => value !== null)
      : (() => {
        const probeMatch = toRecord(rawProbeMatch);
        return probeMatch ? [probeMatch] : [];
      })();

    return probeMatchList
      .map((probeMatch) => this._parseProbeMatchRecord(probeMatch))
      .filter((probe): probe is OnvifDiscoveryDevice => probe !== null);
  }

  private _sendProbe(): Promise<void> {
    let soapTemplate = '';
    soapTemplate += '<?xml version="1.0" encoding="UTF-8"?>';
    soapTemplate += '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">';
    soapTemplate += '  <s:Header>';
    soapTemplate += '    <a:Action s:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>';
    soapTemplate += '    <a:MessageID>uuid:__uuid__</a:MessageID>';
    soapTemplate += '    <a:ReplyTo>';
    soapTemplate += '      <a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address>';
    soapTemplate += '    </a:ReplyTo>';
    soapTemplate += '    <a:To s:mustUnderstand="1">urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>';
    soapTemplate += '  </s:Header>';
    soapTemplate += '  <s:Body>';
    soapTemplate += '    <Probe xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery">';
    soapTemplate += '      <d:Types xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dp0="http://www.onvif.org/ver10/network/wsdl">dp0:__type__</d:Types>';
    soapTemplate += '    </Probe>';
    soapTemplate += '  </s:Body>';
    soapTemplate += '</s:Envelope>';
    soapTemplate = soapTemplate.replace(/>\s+</g, '><');
    soapTemplate = soapTemplate.replace(/\s+/g, ' ');

    const soapSet: string[] = [];
    ['NetworkVideoTransmitter', 'Device', 'NetworkVideoDisplay'].forEach((type) => {
      let soap = soapTemplate;
      soap = soap.replace('__type__', type);
      soap = soap.replace('__uuid__', this._createUuidV4());
      soapSet.push(soap);
    });

    const soapList: string[] = [];
    for(let i = 0; i < this._DISCOVERY_RETRY_MAX; i++) {
      soapSet.forEach((soap) => {
        soapList.push(soap);
      });
    }

    return new Promise<void>((resolve, reject) => {
      if (!this._udp) {
        reject(new Error('No UDP connection is available. The init() method might not be called yet.'));
        return;
      }

      const send = () => {
        const udp = this._udp;
        if (!udp) {
          resolve();
          return;
        }

        const soap = soapList.shift();
        if (!soap) {
          resolve();
          return;
        }

        const buf = Buffer.from(soap, 'utf8');
        try {
          udp.send(buf, 0, buf.length, this._PORT, this._MULTICAST_ADDRESS, () => {
            this._discovery_interval_timer = setTimeout(() => {
              send();
            }, this._DISCOVERY_INTERVAL);
          });
        } catch (_error) {
          resolve();
        }
      };

      send();
    });
  }

  private _createUuidV4(): string {
    const chars = mCrypto.randomBytes(16).toString('hex').toLowerCase().split('');
    chars[12] = '4';
    chars[16] = (parseInt(chars[16], 16) & 3 | 8).toString(16);
    const matched = chars.join('').match(/^(.{8})(.{4})(.{4})(.{4})(.{12})/);
    const uuid = matched
      ? [matched[1], matched[2], matched[3], matched[4], matched[5]].join('-')
      : '';
    this._uuid = uuid;
    return uuid;
  }

  /* ------------------------------------------------------------------
  * Method: stopDiscovery([callback])
  * [Caution]
  *   This method has been depricated.
  *   Use the stopProbe() method instead of this method.
  * ---------------------------------------------------------------- */
  public stopDiscovery(callback?: VoidCallback): void {
    this.stopProbe().then(() => {
      this._execCallback(callback, null);
    }).catch((error: Error) => {
      this._execCallback(callback, error);
    });
  }

  public stopProbe(): Promise<void>;
  public stopProbe(callback?: VoidCallback): void;
  public stopProbe(callback?: VoidCallback): Promise<void> | void {
    if(this._discovery_interval_timer !== null) {
      clearTimeout(this._discovery_interval_timer);
      this._discovery_interval_timer = null;
    }
    if(this._discovery_wait_timer !== null) {
      clearTimeout(this._discovery_wait_timer);
      this._discovery_wait_timer = null;
    }

    const promise = new Promise<void>((resolve) => {
      const udp = this._udp;
      if(udp) {
        try {
          udp.close(() => {
            try {
              udp.unref();
            } catch (_error) {
              // Ignore unref errors
            }
            this._udp = null;
            this._probeInProgress = false;
            resolve();
          });
        } catch (_error) {
          this._udp = null;
          this._probeInProgress = false;
          resolve();
        }
      } else {
        this._probeInProgress = false;
        resolve();
      }
    });

    if(callback) {
      promise.then(() => {
        callback(null);
      }).catch((error: Error) => {
        callback(error);
      });
    } else {
      return promise;
    }
  }
}

module.exports = new Onvif();
