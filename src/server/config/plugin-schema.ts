'use strict';

const pluginUiSchema = {
  password: {
    'ui:widget': 'password'
  },
  cameras: {
    items: {
      password: {
        'ui:widget': 'password'
      }
    }
  }
};

const pluginSchema = {
  type: 'object',
  title: 'Onvif Camera Interface',
  description: 'Make an ONVIF user profile to camera(s) and add camera(s) IP below',
  properties: {
    ipAddress: {
      type: 'string',
      title: 'IP address of LAN, where ONVIF devices are located. Default, leave empty.'
    },
    userName: {
      type: 'string',
      title: 'Default ONVIF username for camera(s)'
    },
    password: {
      type: 'string',
      title: 'Default ONVIF password for camera(s)'
    },
    autoDiscoveryInterval: {
      type: 'number',
      title: 'Auto-discovery interval in seconds (0 to disable)',
      default: 0
    },
    snapshotInterval: {
      type: 'number',
      title: 'Snapshot refresh interval in milliseconds',
      default: 100,
      minimum: 50
    },
    enableSignalKIntegration: {
      type: 'boolean',
      title: 'Publish camera data to Signal K paths',
      default: false
    },
    discoverOnStart: {
      type: 'boolean',
      title: 'Run camera discovery when plugin starts',
      default: true
    },
    startupDiscoveryDelay: {
      type: 'number',
      title: 'Delay before startup discovery in seconds',
      default: 5,
      minimum: 1
    },
    cameras: {
      type: 'array',
      title: 'Camera List',
      items: {
        type: 'object',
        required: [],
        properties: {
          address: {
            type: 'string',
            title: 'Camera address'
          },
          name: {
            type: 'string',
            title: 'Camera display name'
          },
          nickname: {
            type: 'string',
            title: 'Signal K path nickname (e.g., "bow", "stern", "mast"). Used in path: sensors.camera.[nickname]'
          },
          userName: {
            type: 'string',
            title: 'Camera-specific username (overrides default)'
          },
          password: {
            type: 'string',
            title: 'Camera-specific password (overrides default)'
          }
        }
      }
    }
  }
};

module.exports = {
  pluginSchema,
  pluginUiSchema
};
