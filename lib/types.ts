import type { IncomingHttpHeaders, IncomingMessage, RequestOptions } from 'http';

export type UnknownRecord = Record<string, unknown>;
export type StringRecord = Record<string, string>;

export type NodeStyleCallback<TResult> = (error: Error | null, result?: TResult) => void;
export type VoidCallback = (error: Error | null) => void;

export interface AuthParams {
  xaddr: string;
  user?: string;
  pass?: string;
  time_diff?: number;
}

export interface AxisRange {
  min: number;
  max: number;
}

export interface VideoSourceConfig {
  token: string;
  name: string;
  bounds: {
    width: number;
    height: number;
    x: number;
    y: number;
  };
}

export interface VideoEncoderConfig {
  token: string;
  name: string;
  resolution: {
    width: number;
    height: number;
  };
  quality: number;
  framerate: number;
  bitrate: number;
  encoding: string;
}

export interface AudioSourceConfig {
  token: string;
  name: string;
}

export interface AudioEncoderConfig {
  token: string;
  name: string;
  bitrate: number;
  samplerate: number;
  encoding: string;
}

export interface StreamInfo {
  udp: string;
  http: string;
  rtsp: string;
}

export interface ProfileInfo {
  token: string;
  name: string;
  snapshot: string;
  stream: StreamInfo;
  video: {
    source: VideoSourceConfig | null;
    encoder: VideoEncoderConfig | null;
  };
  audio: {
    source: AudioSourceConfig | null;
    encoder: AudioEncoderConfig | null;
  };
  ptz: {
    range: {
      x: AxisRange;
      y: AxisRange;
      z: AxisRange;
    };
  };
}

export interface DeviceInformation {
  Manufacturer?: string;
  Model?: string;
  [key: string]: unknown;
}

export interface SnapshotResponse {
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface OnvifDiscoveryDevice {
  urn: string;
  name: string;
  hardware: string;
  location: string;
  types: string[];
  xaddrs: string[];
  scopes: string[];
}

export interface SoapCommandResult {
  soap: string;
  formatted: string;
  converted: UnknownRecord;
  data: UnknownRecord;
}

export interface RequestSoapParams {
  body: string;
  xmlns?: string[];
  diff?: number;
  user?: string;
  pass?: string;
}

export interface ServiceModuleParams {
  xaddr: string;
  user?: string;
  pass?: string;
  time_diff?: number;
}

export interface OnvifSoapLike {
  parse(soap: string): Promise<UnknownRecord>;
  requestCommand(oxaddr: URL, methodName: string, soap: string): Promise<SoapCommandResult>;
  createRequestSoap(params: RequestSoapParams): string;
  escapeXml(str: string): string;
  isInvalidValue(value: unknown, type: string, allowEmpty?: boolean): string;
}

export interface DigestAuthHeader {
  realm?: string;
  opaque?: string;
  algorithm?: string;
  nonce?: string;
  qop?: string;
  'Digest realm'?: string;
  [key: string]: string | undefined;
}

export interface HttpAuthRequestOptions extends RequestOptions {
  auth?: string;
  protocol?: string;
}

export interface OnvifHttpAuthLike {
  request(options: HttpAuthRequestOptions, callback: (res: IncomingMessage) => void): import('http').ClientRequest;
}

export interface PtzService {
  continuousMove(params: UnknownRecord): Promise<SoapCommandResult>;
  stop(params: UnknownRecord): Promise<SoapCommandResult>;
  gotoHomePosition(params: UnknownRecord, callback: NodeStyleCallback<SoapCommandResult>): void;
  setAuth(user?: string, pass?: string): void;
}

export interface DeviceServices {
  device: {
    getSystemDateAndTime(callback: NodeStyleCallback<unknown>): void;
    getCapabilities(callback: NodeStyleCallback<SoapCommandResult>): void;
    getDeviceInformation(callback: NodeStyleCallback<SoapCommandResult>): void;
    getTimeDiff(): number;
    setAuth(user?: string, pass?: string): void;
  };
  events: { setAuth(user?: string, pass?: string): void } | null;
  imaging: { setAuth(user?: string, pass?: string): void } | null;
  media: {
    getProfiles(callback: NodeStyleCallback<SoapCommandResult>): void;
    getStreamUri(params: UnknownRecord, callback: NodeStyleCallback<SoapCommandResult>): void;
    getSnapshotUri(params: UnknownRecord, callback: NodeStyleCallback<SoapCommandResult>): void;
    setAuth(user?: string, pass?: string): void;
  } | null;
  ptz: PtzService | null;
  [key: string]: { setAuth(user?: string, pass?: string): void } | PtzService | null;
}

export interface OnvifDeviceLike {
  address: string;
  services: DeviceServices;
  setAuth(user?: string, pass?: string): void;
  init(callback: NodeStyleCallback<DeviceInformation | null>): void;
  getProfile(indexOrToken: number | string): ProfileInfo | null;
  changeProfile(indexOrToken: number | string): ProfileInfo | null;
  fetchSnapshot(callback: NodeStyleCallback<SnapshotResponse>): void;
  fetchSnapshotForProfile(indexOrToken: number | string, callback: NodeStyleCallback<SnapshotResponse>): void;
  ptzMove(params: UnknownRecord, callback: VoidCallback): void;
  ptzStop(callback: NodeStyleCallback<SoapCommandResult>): void;
  getCurrentProfile(): ProfileInfo | null;
  getProfileList(): ProfileInfo[];
  getInformation(): DeviceInformation | null;
}
