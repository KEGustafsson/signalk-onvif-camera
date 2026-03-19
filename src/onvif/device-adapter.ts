'use strict';

import type { LegacyOnvifDevice } from './types';
import type { DiscoveredProbeDevice } from '../server/types';

const legacyOnvif = require('../../lib/node-onvif');

function createOnvifAdapter() {
  return {
    startProbe(ipAddress?: string): Promise<DiscoveredProbeDevice[]> {
      return legacyOnvif.startProbe(ipAddress);
    },
    createDevice(device: DiscoveredProbeDevice): LegacyOnvifDevice {
      return new legacyOnvif.OnvifDevice({ xaddr: device.xaddrs[0] });
    },
    isProbeInProgress(): boolean {
      return !!legacyOnvif._probeInProgress;
    }
  };
}

module.exports = {
  createOnvifAdapter
};
