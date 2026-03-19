/* ------------------------------------------------------------------
* node-onvif - device.js
*
* Copyright (c) 2016-2018, Futomi Hatano, All rights reserved.
* Released under the MIT license
* Date: 2018-08-13
* ---------------------------------------------------------------- */
'use strict';

import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';
import type {
  DeviceInformation,
  DeviceServices,
  HttpAuthRequestOptions,
  NodeStyleCallback,
  OnvifHttpAuthLike,
  ProfileInfo,
  SnapshotResponse,
  SoapCommandResult,
  UnknownRecord,
  VoidCallback
} from '../types';

const mConfig = require('../config/defaults') as { snapshot: { maxSize: number; timeout: number } };
const mUtil = require('util') as typeof import('util');

type DeviceServiceInstance = DeviceServices['device'];
type EventsServiceInstance = NonNullable<DeviceServices['events']>;
type MediaServiceInstance = NonNullable<DeviceServices['media']>;
type PtzServiceInstance = NonNullable<DeviceServices['ptz']>;

type ServiceConstructor<T> = new (params: {
  xaddr: string;
  user?: string;
  pass?: string;
  time_diff?: number;
}) => T;

const mOnvifServiceDevice = require('./service-device') as ServiceConstructor<DeviceServiceInstance>;
const mOnvifServiceMedia = require('./service-media') as ServiceConstructor<MediaServiceInstance>;
const mOnvifServicePtz = require('./service-ptz') as ServiceConstructor<PtzServiceInstance>;
const mOnvifServiceEvents = require('./service-events') as ServiceConstructor<EventsServiceInstance>;
const mOnvifHttpAuth = require('./http-auth') as OnvifHttpAuthLike;

interface OnvifDeviceParams {
  address?: string;
  xaddr?: string;
  user?: string;
  pass?: string;
}

interface SpeedVector {
  x?: number;
  y?: number;
  z?: number;
  [key: string]: number | undefined;
}

interface PtzMoveParams extends UnknownRecord {
  speed?: SpeedVector;
  timeout?: number;
}

interface OnvifDeviceState extends EventEmitter {
  address: string;
  xaddr: string;
  user: string;
  pass: string;
  keepAddr: boolean;
  lastResponse: SoapCommandResult | null;
  oxaddr: URL;
  time_diff: number;
  information: DeviceInformation | null;
  services: DeviceServices;
  profile_list: ProfileInfo[];
  current_profile: ProfileInfo | null;
  ptz_moving: boolean;
  _isValidCallback(callback: unknown): boolean;
  _execCallback<TResult>(callback: NodeStyleCallback<TResult> | undefined, arg1: Error | null, arg2?: TResult): void;
  getInformation(): DeviceInformation | null;
  getCurrentProfile(): ProfileInfo | null;
  getProfileList(): ProfileInfo[];
  getProfile(index: number | string): ProfileInfo | null;
  changeProfile(index: number | string): ProfileInfo | null;
  getUdpStreamUrl(): string;
  fetchSnapshot(callback?: NodeStyleCallback<SnapshotResponse>): Promise<SnapshotResponse> | void;
  fetchSnapshotForProfile(index: number | string, callback?: NodeStyleCallback<SnapshotResponse>): Promise<SnapshotResponse> | void;
  ptzMove(params: PtzMoveParams, callback?: VoidCallback): Promise<void> | void;
  ptzStop(callback?: NodeStyleCallback<SoapCommandResult>): Promise<SoapCommandResult> | void;
  setAuth(user?: string, pass?: string): void;
  init(callback?: NodeStyleCallback<DeviceInformation | null>): Promise<DeviceInformation | null> | void;
  _getSystemDateAndTime(): Promise<void>;
  _getCapabilities(): Promise<void>;
  _getDeviceInformation(): Promise<void>;
  _mediaGetProfiles(): Promise<void>;
  _mediaGetStreamURI(): Promise<void>;
  _mediaGetSnapshotUri(): Promise<void>;
  _getXaddr(directXaddr: string): string;
  _getUri(directUri: unknown): string;
  _getSnapshotUri(directUri: unknown): string;
}

function toRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : null;
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toInteger(value: unknown): number {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFloatValue(value: unknown): number {
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function unwrapTextValue(value: unknown): string {
  if(typeof value === 'string') {
    return value;
  }
  const record = toRecord(value);
  return record && typeof record['_'] === 'string' ? record['_'] : '';
}

function getRequestPort(protocol: string, port: string): number {
  const parsedPort = parseInt(port, 10);
  if(Number.isFinite(parsedPort)) {
    return parsedPort;
  }
  return protocol === 'https:' ? 443 : 80;
}

function rewriteUriHost(address: string, directUri: string): string {
  try {
    const uri = new URL(directUri);
    uri.hostname = address;
    return uri.toString();
  } catch (_error) {
    return directUri;
  }
}

function resolveProfile(profileList: ProfileInfo[], indexOrToken: number | string): ProfileInfo | null {
  if (typeof indexOrToken === 'number' && indexOrToken >= 0 && indexOrToken % 1 === 0) {
    return profileList[indexOrToken] || null;
  }

  if (typeof indexOrToken === 'string' && indexOrToken.length > 0) {
    for (let i = 0; i < profileList.length; i++) {
      if (profileList[i]['token'] === indexOrToken) {
        return profileList[i];
      }
    }
  }

  return null;
}

function createEmptyProfile(token: string, name: string): ProfileInfo {
  return {
    token,
    name,
    snapshot: '',
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

function parseVideoSourceConfiguration(value: unknown): ProfileInfo['video']['source'] {
  const config = toRecord(value);
  const meta = toRecord(config?.['$']);
  const bounds = toRecord(toRecord(config?.['Bounds'])?.['$']);
  if(!config || !meta || !bounds) {
    return null;
  }
  return {
    token: toStringValue(meta['token']),
    name: toStringValue(config['Name']),
    bounds: {
      width: toInteger(bounds['width']),
      height: toInteger(bounds['height']),
      x: toInteger(bounds['x']),
      y: toInteger(bounds['y'])
    }
  };
}

function parseVideoEncoderConfiguration(value: unknown): ProfileInfo['video']['encoder'] {
  const config = toRecord(value);
  const meta = toRecord(config?.['$']);
  const resolution = toRecord(config?.['Resolution']);
  const rateControl = toRecord(config?.['RateControl']);
  if(!config || !meta || !resolution || !rateControl) {
    return null;
  }
  return {
    token: toStringValue(meta['token']),
    name: toStringValue(config['Name']),
    resolution: {
      width: toInteger(resolution['Width']),
      height: toInteger(resolution['Height'])
    },
    quality: toInteger(config['Quality']),
    framerate: toInteger(rateControl['FrameRateLimit']),
    bitrate: toInteger(rateControl['BitrateLimit']),
    encoding: toStringValue(config['Encoding'])
  };
}

function parseAudioSourceConfiguration(value: unknown): ProfileInfo['audio']['source'] {
  const config = toRecord(value);
  const meta = toRecord(config?.['$']);
  if(!config || !meta) {
    return null;
  }
  return {
    token: toStringValue(meta['token']),
    name: toStringValue(config['Name'])
  };
}

function parseAudioEncoderConfiguration(value: unknown): ProfileInfo['audio']['encoder'] {
  const config = toRecord(value);
  if(!config) {
    return null;
  }
  const meta = toRecord(config['$']);
  return {
    token: toStringValue(meta?.['token']),
    name: toStringValue(config['Name']),
    bitrate: toInteger(config['Bitrate']),
    samplerate: toInteger(config['SampleRate']),
    encoding: toStringValue(config['Encoding'])
  };
}

function applyAxisRange(profile: ProfileInfo, axis: 'x' | 'y' | 'z', rangeValue: unknown): void {
  const range = toRecord(rangeValue);
  if(!range) {
    return;
  }
  profile.ptz.range[axis].min = toFloatValue(range['Min']);
  profile.ptz.range[axis].max = toFloatValue(range['Max']);
}

function applyPtzConfiguration(profile: ProfileInfo, value: unknown): void {
  const config = toRecord(value);
  if(!config) {
    return;
  }

  const panTiltRange = toRecord(toRecord(config['PanTiltLimits'])?.['Range']);
  if(panTiltRange) {
    applyAxisRange(profile, 'x', toRecord(panTiltRange['XRange']));
    applyAxisRange(profile, 'y', toRecord(panTiltRange['YRange']));
  }

  const zoomRange = toRecord(toRecord(config['ZoomLimits'])?.['Range']);
  if(zoomRange) {
    applyAxisRange(profile, 'z', toRecord(zoomRange['XRange']));
  }
}

function requestSnapshot(
  profile: ProfileInfo,
  user: string,
  pass: string,
  callback?: NodeStyleCallback<SnapshotResponse>
): Promise<SnapshotResponse> | void {
  const promise = new Promise<SnapshotResponse>((resolve, reject) => {
    if (!profile.snapshot) {
      reject(new Error('The device does not support snapshot or you have not authorized by the device.'));
      return;
    }

    const ourl = new URL(profile.snapshot);
    const options: HttpAuthRequestOptions = {
      protocol: ourl.protocol,
      auth: user + ':' + pass,
      hostname: ourl.hostname,
      port: getRequestPort(ourl.protocol, ourl.port),
      path: ourl.pathname + ourl.search,
      method: 'GET',
      timeout: mConfig.snapshot.timeout
    };

    let settled = false;
    const resolveOnce = (result: SnapshotResponse): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const rejectOnce = (error: Error): void => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    const req = mOnvifHttpAuth.request(options, (res: IncomingMessage) => {
      const bufferList: Buffer[] = [];
      let bufferSize = 0;
      const maxSize = mConfig.snapshot.maxSize;

      res.on('data', (buf: Buffer) => {
        bufferSize += buf.length;
        if (bufferSize > maxSize) {
          res.destroy(new Error('Snapshot size limit exceeded (' + maxSize + ' bytes)'));
          return;
        }
        bufferList.push(buf);
      });

      res.on('error', (error: Error) => {
        rejectOnce(error);
      });

      res.on('aborted', () => {
        rejectOnce(new Error('Snapshot response was aborted.'));
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          const buffer = Buffer.concat(bufferList);
          const contentTypeHeader = res.headers['content-type'];
          const contentType = Array.isArray(contentTypeHeader)
            ? (contentTypeHeader[0] || 'image/jpeg')
            : (contentTypeHeader || 'image/jpeg');

          if (contentType.match(/image\//)) {
            resolveOnce({ headers: res.headers, body: buffer });
          } else if (contentType.match(/^text\//)) {
            rejectOnce(new Error(buffer.toString()));
          } else {
            rejectOnce(new Error('Unexpected data: ' + contentType));
          }
        } else {
          rejectOnce(new Error(String(res.statusCode) + ' ' + (res.statusMessage || '')));
        }
      });
    });

    req.on('error', (error: Error) => {
      rejectOnce(error);
    });
    req.end();
  });

  const cb = callback;
  if (cb) {
    promise.then((res) => {
      cb(null, res);
    }).catch((error: Error) => {
      cb(error);
    });
  } else {
    return promise;
  }
}

/* ------------------------------------------------------------------
* Constructor: OnvifDevice(params)
* - params:
*    - address : IP address of the targeted device
*                (Required if the `xaddr` is not specified)
*    - xaddr   : URL of the entry point for the device management service
*                (Required if the `address' is not specified)
*                If the `xaddr` is specified, the `address` is ignored.
*    - user  : User name (Optional)
*    - pass  : Password (Optional)
* ---------------------------------------------------------------- */
function OnvifDevice(this: OnvifDeviceState, params: OnvifDeviceParams) {
  if (!params || typeof params !== 'object') {
    throw new Error('The parameter was invalid.');
  }

  this.address = '';
  this.xaddr = '';
  this.user = '';
  this.pass = '';
  this.keepAddr = false;
  this.lastResponse = null;

  if (typeof params['xaddr'] === 'string') {
    this.xaddr = params['xaddr'];
    const ourl = new URL(this.xaddr);
    this.address = ourl.hostname;
  } else if (typeof params['address'] === 'string') {
    this.keepAddr = true;
    this.address = params['address'];
    this.xaddr = 'http://' + this.address + '/onvif/device_service';
  } else {
    throw new Error('The parameter was invalid.');
  }

  if (typeof params['user'] === 'string') {
    this.user = params['user'] || '';
  }
  if (typeof params['pass'] === 'string') {
    this.pass = params['pass'] || '';
  }

  this.oxaddr = new URL(this.xaddr);
  this.time_diff = 0;
  this.information = null;
  this.services = {
    device: new mOnvifServiceDevice({ xaddr: this.xaddr, user: this.user, pass: this.pass }),
    events: null,
    imaging: null,
    media: null,
    ptz: null
  };
  this.profile_list = [];
  this.current_profile = null;
  this.ptz_moving = false;

  EventEmitter.call(this);
}

mUtil.inherits(OnvifDevice, EventEmitter);

OnvifDevice.prototype._isValidCallback = function (this: OnvifDeviceState, callback: unknown) {
  return typeof callback === 'function';
};

OnvifDevice.prototype._execCallback = function <TResult> (
  this: OnvifDeviceState,
  callback: NodeStyleCallback<TResult> | undefined,
  arg1: Error | null,
  arg2?: TResult
) {
  const cb = callback;
  if (cb) {
    cb(arg1, arg2);
  }
};

/* ------------------------------------------------------------------
* Method: getInformation()
* ---------------------------------------------------------------- */
OnvifDevice.prototype.getInformation = function (this: OnvifDeviceState) {
  const information = this.information;
  return information ? cloneValue(information) : null;
};

/* ------------------------------------------------------------------
* Method: getCurrentProfile()
* ---------------------------------------------------------------- */
OnvifDevice.prototype.getCurrentProfile = function (this: OnvifDeviceState) {
  const profile = this.current_profile;
  return profile ? cloneValue(profile) : null;
};

/* ------------------------------------------------------------------
* Method: getProfileList()
* ---------------------------------------------------------------- */
OnvifDevice.prototype.getProfileList = function (this: OnvifDeviceState) {
  return cloneValue(this.profile_list);
};

/* ------------------------------------------------------------------
* Method: getProfile(index|token)
* ---------------------------------------------------------------- */
OnvifDevice.prototype.getProfile = function (this: OnvifDeviceState, index: number | string) {
  const profile = resolveProfile(this.profile_list, index);
  return profile ? cloneValue(profile) : null;
};

/* ------------------------------------------------------------------
* Method: changeProfile(index|token)
* ---------------------------------------------------------------- */
OnvifDevice.prototype.changeProfile = function (this: OnvifDeviceState, index: number | string) {
  const profile = resolveProfile(this.profile_list, index);
  if (profile) {
    this.current_profile = profile;
    return this.getCurrentProfile();
  }

  return null;
};

/* ------------------------------------------------------------------
* Method: getUdpStreamUrl()
* ---------------------------------------------------------------- */
OnvifDevice.prototype.getUdpStreamUrl = function (this: OnvifDeviceState) {
  return this.current_profile?.stream.udp || '';
};

/* ------------------------------------------------------------------
* Method: fetchSnapshot()
* ---------------------------------------------------------------- */
OnvifDevice.prototype.fetchSnapshot = function (this: OnvifDeviceState, callback?: NodeStyleCallback<SnapshotResponse>) {
  const currentProfile = this.current_profile;
  if (!currentProfile) {
    const error = new Error('No media profile is selected.');
    if (callback) {
      callback(error);
      return;
    }
    return Promise.reject(error);
  }

  return requestSnapshot(currentProfile, this.user, this.pass, callback);
};

/* ------------------------------------------------------------------
* Method: fetchSnapshotForProfile(index|token)
* ---------------------------------------------------------------- */
OnvifDevice.prototype.fetchSnapshotForProfile = function (
  this: OnvifDeviceState,
  index: number | string,
  callback?: NodeStyleCallback<SnapshotResponse>
) {
  const profile = resolveProfile(this.profile_list, index);
  if (!profile) {
    const error = new Error('Profile not found: ' + String(index));
    if (callback) {
      callback(error);
      return;
    }
    return Promise.reject(error);
  }

  return requestSnapshot(profile, this.user, this.pass, callback);
};

/* ------------------------------------------------------------------
* Method: ptzMove(params[, callback])
* - params:
*   - speed:
*     - x     | Float   | required | speed for pan (in the range of -1.0 to 1.0)
*     - y     | Float   | required | speed for tilt (in the range of -1.0 to 1.0)
*     - z     | Float   | required | speed for zoom (in the range of -1.0 to 1.0)
*   - timeout | Integer | optional | seconds (Default 1)
* ---------------------------------------------------------------- */
OnvifDevice.prototype.ptzMove = function (this: OnvifDeviceState, params: PtzMoveParams, callback?: VoidCallback) {
  const promise = new Promise<void>((resolve, reject) => {
    const currentProfile = this.current_profile;
    if (!currentProfile) {
      reject(new Error('No media profile is selected.'));
      return;
    }

    const ptzService = this.services.ptz;
    if (!ptzService) {
      reject(new Error('The device does not support PTZ.'));
      return;
    }

    const speed = params['speed'] || {};
    const x = speed['x'] || 0;
    const y = speed['y'] || 0;
    const z = speed['z'] || 0;
    const timeout = typeof params['timeout'] === 'number' ? params['timeout'] : 1;

    this.ptz_moving = true;
    ptzService.continuousMove({
      ProfileToken: currentProfile.token,
      Velocity: { x, y, z },
      Timeout: timeout
    }).then(() => {
      resolve();
    }).catch((error: Error) => {
      reject(error);
    });
  });

  const cb = callback;
  if (cb) {
    promise.then(() => {
      cb(null);
    }).catch((error: Error) => {
      cb(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: ptzStop([callback])
* ---------------------------------------------------------------- */
OnvifDevice.prototype.ptzStop = function (this: OnvifDeviceState, callback?: NodeStyleCallback<SoapCommandResult>) {
  const promise = new Promise<SoapCommandResult>((resolve, reject) => {
    const currentProfile = this.current_profile;
    if (!currentProfile) {
      reject(new Error('No media profile is selected.'));
      return;
    }

    const ptzService = this.services.ptz;
    if (!ptzService) {
      reject(new Error('The device does not support PTZ.'));
      return;
    }

    this.ptz_moving = false;
    ptzService.stop({
      ProfileToken: currentProfile.token,
      PanTilt: true,
      Zoom: true
    }).then((result) => {
      resolve(result);
    }).catch((error: Error) => {
      reject(error);
    });
  });

  const cb = callback;
  if (cb) {
    promise.then((res) => {
      cb(null, res);
    }).catch((error: Error) => {
      cb(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: setAuth(user, pass)
* ---------------------------------------------------------------- */
OnvifDevice.prototype.setAuth = function (this: OnvifDeviceState, user?: string, pass?: string) {
  this.user = user || '';
  this.pass = pass || '';
  for (const key in this.services) {
    const service = this.services[key];
    if (service) {
      service.setAuth(user, pass);
    }
  }
};

/* ------------------------------------------------------------------
* Method: init([callback])
* ---------------------------------------------------------------- */
OnvifDevice.prototype.init = function (this: OnvifDeviceState, callback?: NodeStyleCallback<DeviceInformation | null>) {
  const promise = new Promise<DeviceInformation | null>((resolve, reject) => {
    this._getSystemDateAndTime().then(() => {
      return this._getCapabilities();
    }).then(() => {
      return this._getDeviceInformation();
    }).then(() => {
      return this._mediaGetProfiles();
    }).then(() => {
      return this._mediaGetStreamURI();
    }).then(() => {
      return this._mediaGetSnapshotUri();
    }).then(() => {
      resolve(this.getInformation());
    }).catch((error: Error) => {
      reject(error);
    });
  });

  const cb = callback;
  if (cb) {
    promise.then((info) => {
      cb(null, info);
    }).catch((error: Error) => {
      cb(error);
    });
  } else {
    return promise;
  }
};

// GetSystemDateAndTime (Access Class: PRE_AUTH)
OnvifDevice.prototype._getSystemDateAndTime = function (this: OnvifDeviceState) {
  return new Promise<void>((resolve) => {
    this.services.device.getSystemDateAndTime((error) => {
      // Ignore the error becase some devices do not support
      // the GetSystemDateAndTime command and the error does
      // not cause any trouble.
      if (!error) {
        this.time_diff = this.services.device.getTimeDiff();
      }
      resolve();
    });
  });
};

// GetCapabilities (Access Class: PRE_AUTH)
OnvifDevice.prototype._getCapabilities = function (this: OnvifDeviceState) {
  return new Promise<void>((resolve, reject) => {
    this.services.device.getCapabilities((error, result) => {
      this.lastResponse = result || null;
      if (error || !result) {
        reject(new Error('Failed to initialize the device: ' + (error ? error.toString() : 'Unknown error')));
        return;
      }

      const capabilities = toRecord(toRecord(result['data']['GetCapabilitiesResponse'])?.['Capabilities']);
      if (!capabilities) {
        reject(new Error('Failed to initialize the device: No capabilities were found.'));
        return;
      }

      const events = toRecord(capabilities['Events']);
      const eventsXaddr = toStringValue(events?.['XAddr']);
      if (eventsXaddr) {
        this.services.events = new mOnvifServiceEvents({
          xaddr: this._getXaddr(eventsXaddr),
          time_diff: this.time_diff,
          user: this.user,
          pass: this.pass
        });
      }

      const media = toRecord(capabilities['Media']);
      const mediaXaddr = toStringValue(media?.['XAddr']);
      if (mediaXaddr) {
        this.services.media = new mOnvifServiceMedia({
          xaddr: this._getXaddr(mediaXaddr),
          time_diff: this.time_diff,
          user: this.user,
          pass: this.pass
        });
      }

      const ptz = toRecord(capabilities['PTZ']);
      const ptzXaddr = toStringValue(ptz?.['XAddr']);
      if (ptzXaddr) {
        this.services.ptz = new mOnvifServicePtz({
          xaddr: this._getXaddr(ptzXaddr),
          time_diff: this.time_diff,
          user: this.user,
          pass: this.pass
        });
      }

      resolve();
    });
  });
};

// GetDeviceInformation (Access Class: READ_SYSTEM)
OnvifDevice.prototype._getDeviceInformation = function (this: OnvifDeviceState) {
  return new Promise<void>((resolve, reject) => {
    this.services.device.getDeviceInformation((error, result) => {
      if (error || !result) {
        reject(new Error('Failed to initialize the device: ' + (error ? error.toString() : 'Unknown error')));
        return;
      }

      const information = toRecord(result['data']['GetDeviceInformationResponse']);
      this.information = information as DeviceInformation | null;
      resolve();
    });
  });
};

// Media::GetProfiles (Access Class: READ_MEDIA)
OnvifDevice.prototype._mediaGetProfiles = function (this: OnvifDeviceState) {
  return new Promise<void>((resolve, reject) => {
    const mediaService = this.services.media;
    if (!mediaService) {
      reject(new Error('Failed to initialize the device: Media service is not available.'));
      return;
    }

    mediaService.getProfiles((error, result) => {
      this.lastResponse = result || null;
      if (error || !result) {
        reject(new Error('Failed to initialize the device: ' + (error ? error.toString() : 'Unknown error')));
        return;
      }

      const response = toRecord(result['data']['GetProfilesResponse']);
      const rawProfiles = response?.['Profiles'];
      const profiles = Array.isArray(rawProfiles)
        ? rawProfiles.map((item) => toRecord(item)).filter((item): item is UnknownRecord => item !== null)
        : (() => {
          const profile = toRecord(rawProfiles);
          return profile ? [profile] : [];
        })();

      if (profiles.length === 0) {
        reject(new Error('Failed to initialize the device: The targeted device does not any media profiles.'));
        return;
      }

      this.profile_list = [];
      this.current_profile = null;

      profiles.forEach((profileRecord) => {
        const meta = toRecord(profileRecord['$']);
        const profile = createEmptyProfile(
          toStringValue(meta?.['token']),
          toStringValue(profileRecord['Name'])
        );

        const videoSource = parseVideoSourceConfiguration(profileRecord['VideoSourceConfiguration']);
        if (videoSource) {
          profile.video.source = videoSource;
        }

        const videoEncoder = parseVideoEncoderConfiguration(profileRecord['VideoEncoderConfiguration']);
        if (videoEncoder) {
          profile.video.encoder = videoEncoder;
        }

        const audioSource = parseAudioSourceConfiguration(profileRecord['AudioSourceConfiguration']);
        if (audioSource) {
          profile.audio.source = audioSource;
        }

        const audioEncoder = parseAudioEncoderConfiguration(profileRecord['AudioEncoderConfiguration']);
        if (audioEncoder) {
          profile.audio.encoder = audioEncoder;
        }

        applyPtzConfiguration(profile, profileRecord['PTZConfiguration']);

        this.profile_list.push(profile);
        if (!this.current_profile) {
          this.current_profile = profile;
        }
      });

      resolve();
    });
  });
};

// Media::GetStreamURI (Access Class: READ_MEDIA)
OnvifDevice.prototype._mediaGetStreamURI = function (this: OnvifDeviceState) {
  const protocolList: Array<keyof ProfileInfo['stream'] | 'UDP' | 'HTTP' | 'RTSP'> = ['UDP', 'HTTP', 'RTSP'];
  return new Promise<void>((resolve, reject) => {
    const mediaService = this.services.media;
    if (!mediaService) {
      reject(new Error('Failed to initialize the device: Media service is not available.'));
      return;
    }

    let profileIndex = 0;
    let protocolIndex = 0;

    const getStreamUri = () => {
      const profile = this.profile_list[profileIndex];
      if (!profile) {
        resolve();
        return;
      }

      const protocol = protocolList[protocolIndex];
      if (!protocol) {
        profileIndex++;
        protocolIndex = 0;
        getStreamUri();
        return;
      }

      mediaService.getStreamUri({
        ProfileToken: profile.token,
        Protocol: protocol
      }, (error, result) => {
        this.lastResponse = result || null;
        if (!error && result) {
          const mediaUri = toRecord(toRecord(result['data']['GetStreamUriResponse'])?.['MediaUri']);
          const uri = this._getUri(mediaUri?.['Uri']);
          profile.stream[protocol.toLowerCase() as keyof ProfileInfo['stream']] = uri;
        }

        protocolIndex++;
        getStreamUri();
      });
    };

    getStreamUri();
  });
};

// Media::GetSnapshotUri (Access Class: READ_MEDIA)
OnvifDevice.prototype._mediaGetSnapshotUri = function (this: OnvifDeviceState) {
  return new Promise<void>((resolve, reject) => {
    const mediaService = this.services.media;
    if (!mediaService) {
      reject(new Error('Failed to initialize the device: Media service is not available.'));
      return;
    }

    let profileIndex = 0;
    const getSnapshotUri = () => {
      const profile = this.profile_list[profileIndex];
      if (!profile) {
        resolve();
        return;
      }

      mediaService.getSnapshotUri({ ProfileToken: profile.token }, (error, result) => {
        this.lastResponse = result || null;
        if (!error && result) {
          try {
            const mediaUri = toRecord(toRecord(result['data']['GetSnapshotUriResponse'])?.['MediaUri']);
            profile.snapshot = this._getSnapshotUri(mediaUri?.['Uri']);
          } catch (_error) {
            // Snapshot URI parsing failed; profile will have no snapshot URL
          }
        }

        profileIndex++;
        getSnapshotUri();
      });
    };

    getSnapshotUri();
  });
};

OnvifDevice.prototype._getXaddr = function (this: OnvifDeviceState, directXaddr: string) {
  if (!this.keepAddr) {
    return directXaddr;
  }
  return rewriteUriHost(this.address, directXaddr);
};

OnvifDevice.prototype._getUri = function (this: OnvifDeviceState, directUri: unknown) {
  const resolvedDirectUri = unwrapTextValue(directUri);
  if (!this.keepAddr) {
    return resolvedDirectUri;
  }
  return rewriteUriHost(this.address, resolvedDirectUri);
};

OnvifDevice.prototype._getSnapshotUri = function (this: OnvifDeviceState, directUri: unknown) {
  const resolvedDirectUri = unwrapTextValue(directUri);
  if (!this.keepAddr) {
    return resolvedDirectUri;
  }
  return rewriteUriHost(this.address, resolvedDirectUri);
};

module.exports = OnvifDevice;
