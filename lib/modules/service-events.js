/* ------------------------------------------------------------------
* node-onvif - service-events.js
*
* Copyright (c) 2016 - 2017, Futomi Hatano, All rights reserved.
* Released under the MIT license
* Date: 2017-08-26
* ---------------------------------------------------------------- */
'use strict';
const mUrl    = require('url');
const mOnvifSoap = require('./soap.js');

/* ------------------------------------------------------------------
* Constructor: OnvifServiceEvents(params)
* - params:
*    - xaddr   : URL of the entry point for the media service
*                (Required)
*    - user  : User name (Optional)
*    - pass  : Password (Optional)
*    - time_diff: ms
* ---------------------------------------------------------------- */
function OnvifServiceEvents(params) {
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
    'xmlns:wsa="http://www.w3.org/2005/08/addressing"',
    'xmlns:tev="http://www.onvif.org/ver10/events/wsdl"'
  ];
}

OnvifServiceEvents.prototype._createRequestSoap = function (body) {
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
OnvifServiceEvents.prototype.setAuth = function (user, pass) {
  this.user = user || '';
  this.pass = pass || '';
  if(this.user) {
    this.oxaddr.auth = this.user + ':' + this.pass;
  } else {
    this.oxaddr.auth = '';
  }
};

/* ------------------------------------------------------------------
* Method: getEventProperties([callback])
* ---------------------------------------------------------------- */
OnvifServiceEvents.prototype.getEventProperties = function (callback) {
  const promise = new Promise((resolve, reject) => {
    let soap_body = '';
    soap_body += '<tev:GetEventProperties/>';
    const soap = this._createRequestSoap(soap_body);
    mOnvifSoap.requestCommand(this.oxaddr, 'GetEventProperties', soap).then((result) => {
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
* Method: createPullPointSubscription([callback])
* Creates a pull point subscription for receiving events
* ---------------------------------------------------------------- */
OnvifServiceEvents.prototype.createPullPointSubscription = function (callback) {
  const promise = new Promise((resolve, reject) => {
    let soap_body = '';
    soap_body += '<tev:CreatePullPointSubscription>';
    soap_body += '<tev:InitialTerminationTime>PT60S</tev:InitialTerminationTime>';
    soap_body += '</tev:CreatePullPointSubscription>';
    const soap = this._createRequestSoap(soap_body);
    mOnvifSoap.requestCommand(this.oxaddr, 'CreatePullPointSubscription', soap).then((result) => {
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
* Method: pullMessages(params[, callback])
* Pulls messages from a subscription
* - params:
*   - subscriptionReference: URL of the subscription endpoint
*   - timeout: timeout in seconds (default 60)
*   - messageLimit: max messages to retrieve (default 10)
* ---------------------------------------------------------------- */
OnvifServiceEvents.prototype.pullMessages = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    if (!params || !params.subscriptionReference) {
      reject(new Error('subscriptionReference is required'));
      return;
    }

    const timeout = params.timeout || 60;
    const messageLimit = params.messageLimit || 10;

    let soap_body = '';
    soap_body += '<tev:PullMessages>';
    soap_body += `<tev:Timeout>PT${timeout}S</tev:Timeout>`;
    soap_body += `<tev:MessageLimit>${messageLimit}</tev:MessageLimit>`;
    soap_body += '</tev:PullMessages>';

    const soap = this._createRequestSoap(soap_body);
    const subUrl = mUrl.parse(params.subscriptionReference);
    if(this.user) {
      subUrl.auth = this.user + ':' + this.pass;
    }

    mOnvifSoap.requestCommand(subUrl, 'PullMessages', soap).then((result) => {
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
* Method: unsubscribe(params[, callback])
* Unsubscribes from events
* - params:
*   - subscriptionReference: URL of the subscription endpoint
* ---------------------------------------------------------------- */
OnvifServiceEvents.prototype.unsubscribe = function (params, callback) {
  const promise = new Promise((resolve, reject) => {
    if (!params || !params.subscriptionReference) {
      reject(new Error('subscriptionReference is required'));
      return;
    }

    let soap_body = '';
    soap_body += '<wsnt:Unsubscribe xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"/>';

    const soap = this._createRequestSoap(soap_body);
    const subUrl = mUrl.parse(params.subscriptionReference);
    if(this.user) {
      subUrl.auth = this.user + ':' + this.pass;
    }

    mOnvifSoap.requestCommand(subUrl, 'Unsubscribe', soap).then((result) => {
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
* Method: getServiceCapabilities([callback])
* Gets the capabilities of the events service
* ---------------------------------------------------------------- */
OnvifServiceEvents.prototype.getServiceCapabilities = function (callback) {
  const promise = new Promise((resolve, reject) => {
    let soap_body = '';
    soap_body += '<tev:GetServiceCapabilities/>';
    const soap = this._createRequestSoap(soap_body);
    mOnvifSoap.requestCommand(this.oxaddr, 'GetServiceCapabilities', soap).then((result) => {
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

module.exports = OnvifServiceEvents;








