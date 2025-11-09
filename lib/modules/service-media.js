/* ------------------------------------------------------------------
* node-onvif - service-media.js
*
* Copyright (c) 2016 - 2017, Futomi Hatano, All rights reserved.
* Released under the MIT license
* Date: 2017-08-26
* ---------------------------------------------------------------- */
'use strict';
const mUrl    = require('url');
const mOnvifSoap = require('./soap.js');

/* ------------------------------------------------------------------
* Constructor: OnvifServiceMedia(params)
* - params:
*    - xaddr   : URL of the entry point for the media service
*                (Required)
*    - user  : User name (Optional)
*    - pass  : Password (Optional)
*    - time_diff: ms
* ---------------------------------------------------------------- */
function OnvifServiceMedia(params) {
  this.xaddr = '';
  this.user = '';
  this.pass = '';

  let err_msg = '';

  if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
    throw new Error('The value of "params" was invalid: ' + err_msg);
  }

  if('xaddr' in params) {
    if((err_msg = mOnvifSoap.isInvalidValue(params['xaddr'], 'string'))) {
      throw new Error('The "xaddr" property was invalid: ' + err_msg);
    } else {
      this.xaddr = params['xaddr'];
    }
  } else {
    throw new Error('The "xaddr" property is required.');
  }

  if('user' in params) {
    if((err_msg = mOnvifSoap.isInvalidValue(params['user'], 'string', true))) {
      throw new Error('The "user" property was invalid: ' + err_msg);
    } else {
      this.user = params['user'] || '';
    }
  }

  if('pass' in params) {
    if((err_msg = mOnvifSoap.isInvalidValue(params['pass'], 'string', true))) {
      throw new Error('The "pass" property was invalid: ' + err_msg);
    } else {
      this.pass = params['pass'] || '';
    }
  }

  this.oxaddr = mUrl.parse(this.xaddr);
  if(this.user) {
    this.oxaddr.auth = this.user + ':' + this.pass;
  }

  this.time_diff = params['time_diff'];
  this.name_space_attr_list = [
    'xmlns:trt="http://www.onvif.org/ver10/media/wsdl"',
    'xmlns:tt="http://www.onvif.org/ver10/schema"'
  ];
}

OnvifServiceMedia.prototype._createRequestSoap = function (body) {
  const soap = mOnvifSoap.createRequestSoap({
    'body': body,
    'xmlns': this.name_space_attr_list,
    'diff': this.time_diff,
    'user': this.user,
    'pass': this.pass
  });
  return soap;
};

/* ------------------------------------------------------------------
* Method: setAuth(user, pass)
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.setAuth = function (user, pass) {
  this.user = user || '';
  this.pass = pass || '';
  if(this.user) {
    this.oxaddr.auth = this.user + ':' + this.pass;
  } else {
    this.oxaddr.auth = '';
  }
};

/* ------------------------------------------------------------------
* Method: getStreamUri(params[, callback])
* - params:
*   - ProfileToken | String | required | a token of the profile
*   - Protocol     | String | required | "UDP", "HTTP", or "RTSP"
*
* {
*   'ProfileToken': 'Profile1,
*   'Protocol'    : 'UDP'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getStreamUri = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['Protocol'], 'string'))) {
      reject(new Error('The "Protocol" property was invalid: ' + err_msg));
      return;
    } else if(!params['Protocol'].match(/^(UDP|HTTP|RTSP)$/)) {
      reject(new Error('The "Protocol" property was invalid: The value must be either "UDP", "HTTP", or "RTSP".'));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetStreamUri>';
    soap_body +=   '<trt:StreamSetup>';
    soap_body +=     '<tt:Stream>RTP-Unicast</tt:Stream>';
    soap_body +=     '<tt:Transport>';
    soap_body +=       '<tt:Protocol>' + params['Protocol'] + '</tt:Protocol>';
    soap_body +=     '</tt:Transport>';
    soap_body +=   '</trt:StreamSetup>';
    soap_body +=   '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '</trt:GetStreamUri>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetStreamUri', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getVideoEncoderConfigurations([callback])
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getVideoEncoderConfigurations = function (callback) {
  const promise = new Promise((resolve, reject) => {
    let soap_body = '';
    soap_body += '<trt:GetVideoEncoderConfigurations />';
    const soap = this._createRequestSoap(soap_body);
    mOnvifSoap.requestCommand(this.oxaddr, 'GetVideoEncoderConfigurations', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getVideoEncoderConfiguration(params[, callback])
* - params:
*   - ConfigurationToken | String | required | a token of the configuration
*
* {
*   'ConfigurationToken': 'Configuration1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getVideoEncoderConfiguration = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
      reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetVideoEncoderConfiguration>';
    soap_body +=   '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    soap_body += '</trt:GetVideoEncoderConfiguration>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetVideoEncoderConfiguration', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getCompatibleVideoEncoderConfigurations(params[, callback])
* - params:
*   - ProfileToken | String | required | a token of the profile
*
* {
*   'ProfileToken': 'Profile1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getCompatibleVideoEncoderConfigurations = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetCompatibleVideoEncoderConfigurations>';
    soap_body +=   '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '</trt:GetCompatibleVideoEncoderConfigurations>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetCompatibleVideoEncoderConfigurations', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getVideoEncoderConfigurationOptions(params[, callback])
* - params:
*   - ProfileToken       | String | optional | a token of the profile
*   - ConfigurationToken | String | optional | a token of the configuration
*
* {
*   'ProfileToken': 'Profile1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getVideoEncoderConfigurationOptions = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if('ProfileToken' in params) {
      if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
        reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
        return;
      }
    }

    if('ConfigurationToken' in params) {
      if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
        reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
        return;
      }
    }

    let soap_body = '';
    soap_body += '<trt:GetVideoEncoderConfigurationOptions>';
    if(params['ProfileToken']) {
      soap_body += '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    }
    if(params['ConfigurationToken']) {
      soap_body += '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    }
    soap_body += '</trt:GetVideoEncoderConfigurationOptions>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetVideoEncoderConfigurationOptions', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getGuaranteedNumberOfVideoEncoderInstances(params[, callback])
* - params:
*   - ConfigurationToken | String | required | a token of the configuration
*
* {
*   'ConfigurationToken': 'Configuration1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getGuaranteedNumberOfVideoEncoderInstances = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
      reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetGuaranteedNumberOfVideoEncoderInstances>';
    soap_body +=   '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    soap_body += '</trt:GetGuaranteedNumberOfVideoEncoderInstances>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetGuaranteedNumberOfVideoEncoderInstances', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getProfiles([callback])
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getProfiles = function (callback) {
  const promise = new Promise((resolve, reject) => {
    const soap_body = '<trt:GetProfiles/>';
    const soap = this._createRequestSoap(soap_body);
    mOnvifSoap.requestCommand(this.oxaddr, 'GetProfiles', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getProfile(params[, callback])
* - params:
*   - ProfileToken | required | a token of the profile
*
* {
*   'ProfileToken': 'Profile1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getProfile = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetProfile>';
    soap_body +=   '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '</trt:GetProfile>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetProfile', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: createProfile(params[, callback])
* - params:
*   - Name  | String | required | a name of the profile
*   - Token | String | optional | a token of the profile
*
* {
*   'Name: 'TestProfile1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.createProfile = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['Name'], 'string'))) {
      reject(new Error('The "Name" property was invalid: ' + err_msg));
      return;
    }

    if('Token' in params) {
      if((err_msg = mOnvifSoap.isInvalidValue(params['Token'], 'string'))) {
        reject(new Error('The "Token" property was invalid: ' + err_msg));
        return;
      }
    }

    let soap_body = '';
    soap_body += '<trt:CreateProfile>';
    soap_body +=   '<trt:Name>' + params['Name'] + '</trt:Name>';
    if('Token' in params) {
      soap_body +=   '<trt:Token>' + params['Token'] + '</trt:Token>';
    }
    soap_body += '</trt:CreateProfile>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'CreateProfile', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: deleteProfile(params[, callback])
* - params:
*   - ProfileToken | String | required |
*
* {
*   'ProfileToken: 'TestProfile1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.deleteProfile = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:DeleteProfile>';
    soap_body +=   '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '</trt:DeleteProfile>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'DeleteProfile', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getVideoSources([callback])
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getVideoSources = function (callback) {
  const promise = new Promise((resolve, reject) => {
    const soap_body = '<trt:GetVideoSources/>';
    const soap = this._createRequestSoap(soap_body);
    mOnvifSoap.requestCommand(this.oxaddr, 'GetVideoSources', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getVideoSourceConfiguration(params[, callback])
* - params:
*   - ConfigurationToken | String | required |
*
* {
*   'ConfigurationToken': 'Profile1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getVideoSourceConfiguration = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
      reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetVideoSourceConfiguration>';
    soap_body +=   '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    soap_body += '</trt:GetVideoSourceConfiguration>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetVideoSourceConfiguration', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getVideoSourceConfigurations([callback])
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getVideoSourceConfigurations = function (callback) {
  const promise = new Promise((resolve, reject) => {
    const soap_body = '<trt:GetVideoSourceConfigurations/>';
    const soap = this._createRequestSoap(soap_body);
    mOnvifSoap.requestCommand(this.oxaddr, 'GetVideoSourceConfigurations', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: addVideoSourceConfiguration(params[, callback])
* - params:
*   - ProfileToken       | String | required | a token of the Profile
*   - ConfigurationToken | String | required |
*
* {
*   'ProfileToken': 'Profile1'
*   'ConfigurationToken': 'Profile1'
* }
*
* No device I own does not support this command
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.addVideoSourceConfiguration = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
      reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:AddVideoSourceConfiguration>';
    soap_body +=   '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body +=   '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    soap_body += '</trt:AddVideoSourceConfiguration>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'AddVideoSourceConfiguration', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getCompatibleVideoSourceConfigurations(params[, callback])
* - params:
*   - ProfileToken | String | required | a token of the targeted PTZ node
*
* {
*   'ProfileToken': 'Profile1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getCompatibleVideoSourceConfigurations = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetCompatibleVideoSourceConfigurations>';
    soap_body +=   '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '</trt:GetCompatibleVideoSourceConfigurations>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetCompatibleVideoSourceConfigurations', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getVideoSourceConfigurationOptions(params[, callback])
* - params:
*   - ProfileToken       | optional | a token of the Profile
*   - ConfigurationToken | optional | a token of the configuration
*
* {
*   'ProfileToken': 'Profile1'
*   'ConfigurationToken': 'Conf1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getVideoSourceConfigurationOptions = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if('ProfileToken' in params) {
      if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
        reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
        return;
      }
    }

    if('ConfigurationToken' in params) {
      if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
        reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
        return;
      }
    }

    let soap_body = '';
    soap_body += '<trt:GetVideoSourceConfigurationOptions>';
    if('ProfileToken' in params) {
      soap_body +=   '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    }
    if('ConfigurationToken' in params) {
      soap_body +=   '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    }
    soap_body += '</trt:GetVideoSourceConfigurationOptions>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetVideoSourceConfigurationOptions', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getMetadataConfiguration(params[, callback])
* - params:
*   - ConfigurationToken | required |
*
* {
*   'ConfigurationToken': 'Conf1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getMetadataConfiguration = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
      reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetMetadataConfiguration>';
    soap_body +=   '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    soap_body += '</trt:GetMetadataConfiguration>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetMetadataConfiguration', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getMetadataConfigurations([callback])
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getMetadataConfigurations = function (callback) {
  const promise = new Promise((resolve, reject) => {
    const soap_body = '<trt:GetMetadataConfigurations/>';
    const soap = this._createRequestSoap(soap_body);
    mOnvifSoap.requestCommand(this.oxaddr, 'GetMetadataConfigurations', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: addMetadataConfiguration(params[, callback])
* - params:
*   - ProfileToken       | String | required | a token of the Profile
*   - ConfigurationToken | String | required |
*
* {
*   'ProfileToken': 'Profile1'
*   'ConfigurationToken': 'Conf1'
* }
*
* No device I own does not support this command
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.addMetadataConfiguration = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
      reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:AddMetadataConfiguration>';
    soap_body +=   '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body +=   '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    soap_body += '</trt:AddMetadataConfiguration>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'AddMetadataConfiguration', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getCompatibleMetadataConfigurations(params[, callback])
* - params:
*   - ProfileToken | String | required | a token of the Profile
*
* {
*   'ProfileToken': 'Profile1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getCompatibleMetadataConfigurations = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetCompatibleMetadataConfigurations>';
    soap_body +=   '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '</trt:GetCompatibleMetadataConfigurations>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetCompatibleMetadataConfigurations', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getMetadataConfigurationOptions(params[, callback])
* - params:
*   - ProfileToken       | String | optional | a token of the Profile
*   - ConfigurationToken | String | optional |
*
* {
*   'ProfileToken': 'Profile1'
*   'ConfigurationToken': 'Conf1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getMetadataConfigurationOptions = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if('ProfileToken' in params) {
      if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
        reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
        return;
      }
    }

    if('ConfigurationToken' in params) {
      if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
        reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
        return;
      }
    }

    let soap_body = '';
    soap_body += '<trt:GetMetadataConfigurationOptions>';
    if('ProfileToken' in params) {
      soap_body += '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    }
    if('ConfigurationToken' in params) {
      soap_body += '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    }
    soap_body += '</trt:GetMetadataConfigurationOptions>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetMetadataConfigurationOptions', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getAudioSources([callback])
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getAudioSources = function (callback) {
  const promise = new Promise((resolve, reject) => {
    const soap_body = '<trt:GetAudioSources/>';
    const soap = this._createRequestSoap(soap_body);
    mOnvifSoap.requestCommand(this.oxaddr, 'GetAudioSources', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getAudioSourceConfiguration(params[, callback])
* - params:
*   - ConfigurationToken | String | required |
*
* {
*   'ConfigurationToken': 'Conf1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getAudioSourceConfiguration = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
      reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetAudioSourceConfiguration>';
    soap_body += '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    soap_body += '</trt:GetAudioSourceConfiguration>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetAudioSourceConfiguration', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getAudioSourceConfigurations([callback])
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getAudioSourceConfigurations = function (callback) {
  const promise = new Promise((resolve, reject) => {
    const soap_body = '<trt:GetAudioSourceConfigurations/>';
    const soap = this._createRequestSoap(soap_body);
    mOnvifSoap.requestCommand(this.oxaddr, 'GetAudioSourceConfigurations', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: addAudioSourceConfiguration(params[, callback])
* - params:
*   - ProfileToken       | String | required | a token of the Profile
*   - ConfigurationToken | String | required |
*
* {
*   'ProfileToken': 'Profile1',
*   'ConfigurationToken': 'Conf1'
* }
*
* No device I own does not support this command
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.addAudioSourceConfiguration = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
      reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:AddAudioSourceConfiguration>';
    soap_body += '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    soap_body += '</trt:AddAudioSourceConfiguration>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'AddAudioSourceConfiguration', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getCompatibleAudioSourceConfigurations(params[, callback])
* - params:
*   - ProfileToken | String | required | a token of the profile
*
* {
*   'ProfileToken': 'Profile1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getCompatibleAudioSourceConfigurations = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetCompatibleAudioSourceConfigurations>';
    soap_body += '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '</trt:GetCompatibleAudioSourceConfigurations>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetCompatibleAudioSourceConfigurations', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getAudioSourceConfigurationOptions(params[, callback])
* - params:
*   - ProfileToken       | String | optional | a token of the Profile
*   - ConfigurationToken | String | optional |
*
* {
*   'ProfileToken': 'Profile1'
*   'ConfigurationToken': 'Conf1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getAudioSourceConfigurationOptions = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if('ProfileToken' in params) {
      if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
        reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
        return;
      }
    }

    if('ConfigurationToken' in params) {
      if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
        reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
        return;
      }
    }

    let soap_body = '';
    soap_body += '<trt:GetAudioSourceConfigurationOptions>';
    if('ProfileToken' in params) {
      soap_body += '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    }
    if('ConfigurationToken' in params) {
      soap_body += '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    }
    soap_body += '</trt:GetAudioSourceConfigurationOptions>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetAudioSourceConfigurationOptions', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getAudioEncoderConfiguration(params[, callback])
* - params:
*   - ConfigurationToken | String | required |
*
* {
*   'ConfigurationToken': 'Profile1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getAudioEncoderConfiguration = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
      reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetAudioEncoderConfiguration>';
    soap_body += '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    soap_body += '</trt:GetAudioEncoderConfiguration>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetAudioEncoderConfiguration', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getAudioEncoderConfigurations([callback])
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getAudioEncoderConfigurations = function (callback) {
  const promise = new Promise((resolve, reject) => {
    const soap_body = '<trt:GetAudioEncoderConfigurations/>';
    const soap = this._createRequestSoap(soap_body);
    mOnvifSoap.requestCommand(this.oxaddr, 'GetAudioEncoderConfigurations', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: addAudioEncoderConfiguration(params[, callback])
* - params:
*   - ProfileToken       | String | required | a token of the Profile
*   - ConfigurationToken | String | required |
*
* {
*   'ProfileToken': 'Profile1',
*   'ConfigurationToken': 'Conf1'
* }
*
* Not device I own does not support this command
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.addAudioEncoderConfiguration = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
      reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:AddAudioEncoderConfiguration>';
    soap_body += '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    soap_body += '</trt:AddAudioEncoderConfiguration>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'AddAudioEncoderConfiguration', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getCompatibleAudioEncoderConfigurations(params[, callback])
* - params:
*   - ProfileToken | String | required | a token of the profile
*
* {
*   'ProfileToken': 'Profile1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getCompatibleAudioEncoderConfigurations = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetCompatibleAudioEncoderConfigurations>';
    soap_body += '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '</trt:GetCompatibleAudioEncoderConfigurations>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetCompatibleAudioEncoderConfigurations', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getAudioEncoderConfigurationOptions(params[, callback])
* - params:
*   - ProfileToken       | String | optional | a token of the Profile
*   - ConfigurationToken | String | optional |
*
* {
*   'ProfileToken': 'Profile1'
*   'ConfigurationToken': 'Conf1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getAudioEncoderConfigurationOptions = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if('ProfileToken' in params) {
      if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
        reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
        return;
      }
    }

    if('ConfigurationToken' in params) {
      if((err_msg = mOnvifSoap.isInvalidValue(params['ConfigurationToken'], 'string'))) {
        reject(new Error('The "ConfigurationToken" property was invalid: ' + err_msg));
        return;
      }
    }

    let soap_body = '';
    soap_body += '<trt:GetAudioEncoderConfigurationOptions>';
    if('ProfileToken' in params) {
      soap_body += '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    }
    if('ConfigurationToken' in params) {
      soap_body += '<trt:ConfigurationToken>' + params['ConfigurationToken'] + '</trt:ConfigurationToken>';
    }
    soap_body += '</trt:GetAudioEncoderConfigurationOptions>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetAudioEncoderConfigurationOptions', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: startMulticastStreaming(params[, callback])
* - params:
*   - ProfileToken | String | required | a token of the Profile
*
* {
*   'ProfileToken': 'Profile1'
* }
*
* No device I own does not support this command
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.startMulticastStreaming = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:StartMulticastStreaming>';
    soap_body += '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '</trt:StartMulticastStreaming>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'StartMulticastStreaming', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: stopMulticastStreaming(params[, callback])
* - params:
*   - ProfileToken | String | required | a token of the Profile
*
* {
*   'ProfileToken': 'Profile1'
* }
*
* No device I own does not support this command
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.stopMulticastStreaming = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:StopMulticastStreaming>';
    soap_body += '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '</trt:StopMulticastStreaming>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'StopMulticastStreaming', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

/* ------------------------------------------------------------------
* Method: getSnapshotUri(params[, callback])
* - params:
*   - ProfileToken | String | required | a token of the Profile
*
* {
*   'ProfileToken': 'Profile1'
* }
* ---------------------------------------------------------------- */
OnvifServiceMedia.prototype.getSnapshotUri = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    let err_msg = '';
    if((err_msg = mOnvifSoap.isInvalidValue(params, 'object'))) {
      reject(new Error('The value of "params" was invalid: ' + err_msg));
      return;
    }

    if((err_msg = mOnvifSoap.isInvalidValue(params['ProfileToken'], 'string'))) {
      reject(new Error('The "ProfileToken" property was invalid: ' + err_msg));
      return;
    }

    let soap_body = '';
    soap_body += '<trt:GetSnapshotUri>';
    soap_body += '<trt:ProfileToken>' + params['ProfileToken'] + '</trt:ProfileToken>';
    soap_body += '</trt:GetSnapshotUri>';
    const soap = this._createRequestSoap(soap_body);

    mOnvifSoap.requestCommand(this.oxaddr, 'GetSnapshotUri', soap).then((result) => {
      resolve(result);
    }).catch((error) => {
      reject(error);
    });
  });
  if(callback) {
    promise.then((result) => {
      callback(null, result);
    }).catch((error) => {
      callback(error);
    });
  } else {
    return promise;
  }
};

module.exports = OnvifServiceMedia;
