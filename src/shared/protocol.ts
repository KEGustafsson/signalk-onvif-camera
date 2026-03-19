export type DeviceAddress = string & { readonly __brand: 'DeviceAddress' };
export type CameraNickname = string & { readonly __brand: 'CameraNickname' };
export type ProfileToken = string & { readonly __brand: 'ProfileToken' };

export interface PluginOptions {
  readonly ipAddress?: string;
  readonly userName?: string;
  readonly password?: string;
  readonly autoDiscoveryInterval?: number;
  readonly snapshotInterval?: number;
  readonly enableSignalKIntegration?: boolean;
  readonly discoverOnStart?: boolean;
  readonly startupDiscoveryDelay?: number;
  readonly cameras?: readonly CameraConfig[];
}

export interface CameraConfig {
  readonly address: DeviceAddress;
  readonly name?: string;
  readonly nickname?: CameraNickname;
  readonly userName?: string;
  readonly password?: string;
}

export interface DiscoveredDevice {
  readonly name: string;
  readonly address: DeviceAddress;
}

export interface DeviceInformation {
  readonly Manufacturer?: string;
  readonly Model?: string;
  readonly FirmwareVersion?: string;
  readonly SerialNumber?: string;
  readonly HardwareId?: string;
}

export interface MediaProfile {
  readonly token: ProfileToken;
  readonly name: string;
  readonly resolution: { readonly width: number; readonly height: number } | null;
  readonly framerate?: number | null;
  readonly bitrate?: number | null;
  readonly encoding?: string | null;
}

export interface StreamUris {
  readonly rtsp?: string;
  readonly http?: string;
  readonly udp?: string;
  readonly snapshot?: string;
  readonly mjpeg?: string;
}

export interface SnapshotResponse {
  readonly contentType: string;
  readonly dataUrl: string;
}

export interface PtzSpeed {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}

export interface PtzMoveRequest {
  readonly address: DeviceAddress;
  readonly speed?: PtzSpeed;
  readonly timeout?: number;
}

export type WsRequest =
  | { readonly method: 'startDiscovery'; readonly params?: Record<string, never> }
  | { readonly method: 'connect'; readonly params: { readonly address: DeviceAddress; readonly user?: string; readonly pass?: string } }
  | { readonly method: 'fetchSnapshot'; readonly params: { readonly address: DeviceAddress; readonly profile?: ProfileToken } }
  | { readonly method: 'ptzMove'; readonly params: PtzMoveRequest }
  | { readonly method: 'ptzStop'; readonly params: { readonly address: DeviceAddress } }
  | { readonly method: 'ptzHome'; readonly params: { readonly address: DeviceAddress } }
  | { readonly method: 'getProfiles'; readonly params: { readonly address: DeviceAddress } }
  | { readonly method: 'changeProfile'; readonly params: { readonly address: DeviceAddress; readonly token?: ProfileToken; readonly index?: number } }
  | { readonly method: 'getStreams'; readonly params: { readonly address: DeviceAddress } }
  | { readonly method: 'getDeviceInfo'; readonly params: { readonly address: DeviceAddress } };

export type WsResponse =
  | { readonly id: string; readonly result: unknown }
  | { readonly id: string; readonly error: string }
  | { readonly error: string };

export interface SignalKCameraDelta {
  readonly updates: readonly [{
    readonly source: { readonly label: string };
    readonly timestamp: string;
    readonly values: readonly [{
      readonly path: string;
      readonly value: Record<string, unknown>;
    }];
  }];
}
