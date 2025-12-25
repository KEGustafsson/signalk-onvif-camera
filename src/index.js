(function () {
  let scheme;
  let httpScheme;
  let port;
  let snapshotInterval = 100;

  readTextFile('browserdata.json', function (text){
    const browserData = JSON.parse(text);
    port = browserData[0].port;
    snapshotInterval = browserData[0].snapshotInterval || 100;
    if (browserData[0].secure) {
      scheme = 'wss';
      httpScheme = 'https';
    } else {
      scheme = 'ws';
      httpScheme = 'http';
    }
  });

  waitForElement();

  function waitForElement(){
    if(typeof port !== 'undefined'){
      $(document).ready(function () {
        new OnvifManager().init();
      });
    } else {
      setTimeout(waitForElement, 250);
    }
  }

  function readTextFile(file, callback) {
    const rawFile = new XMLHttpRequest();
    rawFile.overrideMimeType('application/json');
    rawFile.open('GET', file, true);
    rawFile.onreadystatechange = function () {
      if (rawFile.readyState === 4 && rawFile.status == '200') {
        callback(rawFile.responseText);
      }
    };
    rawFile.send(null);
  }

  /*-------------------------------------------------------------------
   * Constructor
   * ---------------------------------------------------------------- */

  function OnvifManager() {
    this.ws = null; // WebSocket object
    this.el = {
      // jQuery objects for the HTML elements
      frm_con: $('#connect-form'),
      sel_dev: $('#connect-form select[name="device"]'),
      inp_usr: $('#connect-form input[name="user"]'),
      inp_pas: $('#connect-form input[name="pass"]'),
      btn_con: $('#connect-form button[name="connect"]'),
      div_pnl: $('#connected-device'),
      img_snp: $('#connected-device img.snapshot'),
      btn_dcn: $('#connected-device button[name="disconnect"]'),
      mdl_msg: $('#message-modal'),
      mdl_str: $('#streams-modal'),
      ptz_spd: $('input[name="ptz-speed"]'),
      btn_hme: $('#connected-device div.ptz-pad-box button.ptz-goto-home'),
      btn_hm2: $('#connected-device button.ptz-goto-home'),
      ptz_pad: $('#connected-device div.ptz-pad-box'),
      zom_in: $('#connected-device div.ptz-zom-ctl-box button.ptz-zom-in'),
      zom_out: $('#connected-device div.ptz-zom-ctl-box button.ptz-zom-ot'),
      btn_streams: $('#connected-device .show-streams-btn'),
      stream_mode: $('input[name="stream-mode"]')
    };
    this.selected_address = '';
    this.device_connected = false;
    this.ptz_moving = false;
    this.snapshot_w = 400;
    this.snapshot_h = 300;
    this.stream_mode = 'snapshot'; // 'snapshot' or 'mjpeg'
    this.streams = null;
    this.mjpegUrl = null;
    this.snapshotUrl = null;
  }

  OnvifManager.prototype.init = function () {
    this.initWebSocketConnection();
    $(window).on('resize', this.adjustSize.bind(this));
    this.el['btn_con'].on('click', this.pressedConnectButton.bind(this));
    this.el['btn_dcn'].on('click', this.pressedConnectButton.bind(this));
    $(document.body).on('keydown', this.ptzMove.bind(this));
    $(document.body).on('keyup', this.ptzStop.bind(this));
    this.el['btn_hme'].on('click', this.ptzGotoHome.bind(this));
    this.el['btn_hme'].on('touchstart', this.ptzGotoHome.bind(this));
    this.el['btn_hme'].on('touchend', this.ptzGotoHome.bind(this));
    this.el['btn_hm2'].on('click', this.ptzGotoHome.bind(this));
    this.el['btn_hm2'].on('touchstart', this.ptzGotoHome.bind(this));
    this.el['btn_hm2'].on('touchend', this.ptzGotoHome.bind(this));
    this.el['ptz_pad'].on('mousedown', this.ptzMove.bind(this));
    this.el['ptz_pad'].on('mouseup', this.ptzStop.bind(this));
    this.el['ptz_pad'].on('touchstart', this.ptzMove.bind(this));
    this.el['ptz_pad'].on('touchend', this.ptzStop.bind(this));
    this.el['zom_in'].on('mousedown', this.ptzMove.bind(this));
    this.el['zom_in'].on('mouseup', this.ptzStop.bind(this));
    this.el['zom_in'].on('touchstart', this.ptzMove.bind(this));
    this.el['zom_in'].on('touchend', this.ptzStop.bind(this));
    this.el['zom_out'].on('mousedown', this.ptzMove.bind(this));
    this.el['zom_out'].on('mouseup', this.ptzStop.bind(this));
    this.el['zom_out'].on('touchstart', this.ptzMove.bind(this));
    this.el['zom_out'].on('touchend', this.ptzStop.bind(this));

    // Stream mode change handler
    this.el['stream_mode'].on('change', this.onStreamModeChange.bind(this));

    // Show streams button handler
    this.el['btn_streams'].on('click', this.showStreamsModal.bind(this));

    // Copy URL button handlers
    $('.copy-url-btn').on('click', function() {
      const target = $(this).data('target');
      const input = $(target);
      input.select();
      document.execCommand('copy');
    });
  };

  OnvifManager.prototype.adjustSize = function () {
    const div_dom_el = this.el['div_pnl'].get(0);
    const rect = div_dom_el.getBoundingClientRect();
    // const x = rect.left + window.pageXOffset;
    const y = rect.top + window.pageYOffset;
    const w = rect.width;
    const h = window.innerHeight - y - 10;
    div_dom_el.style.height = h + 'px';
    const aspect_ratio = w / h;
    const snapshot_aspect_ratio = this.snapshot_w / this.snapshot_h;
    const img_dom_el = this.el['img_snp'].get(0);

    if (snapshot_aspect_ratio > aspect_ratio) {
      img_w = w;
      img_h = w / snapshot_aspect_ratio;
      img_dom_el.style.width = img_w + 'px';
      img_dom_el.style.height = img_h + 'px';
      img_dom_el.style.left = '0px';
      img_dom_el.style.top = (h - img_h) / 2 + 'px';
    } else {
      img_h = h;
      img_w = h * snapshot_aspect_ratio;
      img_dom_el.style.height = img_h + 'px';
      img_dom_el.style.width = img_w + 'px';
      img_dom_el.style.left = (w - img_w) / 2 + 'px';
      img_dom_el.style.top = '0px';
    }
  };

  OnvifManager.prototype.initWebSocketConnection = function () {
    const url = scheme + '://' + location.hostname + ':' + port;
    this.ws = new WebSocket(url);
    this.ws.onopen = function () {
      console.log('WebSocket connection established.');
      this.sendRequest('startDiscovery');
    }.bind(this);
    this.ws.onclose = function (_event) {
      console.log('WebSocket connection closed.');
      this.showMessageModal(
        'Error',
        'The WebSocket connection was closed. Check if the server.js is running.'
      );
    }.bind(this);
    this.ws.onerror = function (_error) {
      this.showMessageModal(
        'Error',
        'Failed to establish a WebSocket connection. Check if the server.js is running.'
      );
    }.bind(this);
    this.ws.onmessage = function (res) {
      const data = JSON.parse(res.data);
      const id = data.id;
      if (id === 'startDiscovery') {
        this.startDiscoveryCallback(data);
      } else if (id === 'connect') {
        this.connectCallback(data);
      } else if (id === 'fetchSnapshot') {
        this.fetchSnapshotCallback(data);
      } else if (id === 'ptzMove') {
        this.ptzMoveCallback(data);
      } else if (id === 'ptzStop') {
        this.ptzStopCallback(data);
      } else if (id === 'ptzHome') {
        this.ptzHomeCallback(data);
      } else if (id === 'getStreams') {
        this.getStreamsCallback(data);
      }
    }.bind(this);
  };

  OnvifManager.prototype.sendRequest = function (method, params) {
    this.ws.send(
      JSON.stringify({
        method: method,
        params: params
      })
    );
  };

  OnvifManager.prototype.pressedConnectButton = function (_event) {
    if (this.device_connected === true) {
      this.disconnectDevice();
    } else {
      this.connectDevice();
    }
  };

  OnvifManager.prototype.disconnectDevice = function () {
    // Stop MJPEG stream if active
    this.stopMjpegStream();

    this.el['img_snp'].removeAttr('src');
    this.el['div_pnl'].hide();
    this.el['frm_con'].show();
    this.device_connected = false;
    this.disabledLoginForm(false);
    this.el['btn_con'].text('Connect');

    // Reset stream state
    this.stream_mode = 'snapshot';
    this.streams = null;
    this.mjpegUrl = null;
    this.snapshotUrl = null;

    // Reset UI to snapshot mode
    $('input[name="stream-mode"][value="snapshot"]').prop('checked', true).parent().addClass('active');
    $('input[name="stream-mode"][value="mjpeg"]').parent().removeClass('active');
  };

  OnvifManager.prototype.connectDevice = function () {
    this.disabledLoginForm(true);
    this.el['btn_con'].text('Connecting...');
    this.sendRequest('connect', {
      address: this.el['sel_dev'].val(),
      user: this.el['inp_usr'].val(),
      pass: this.el['inp_pas'].val()
    });
  };

  OnvifManager.prototype.disabledLoginForm = function (disabled) {
    this.el['sel_dev'].prop('disabled', disabled);
    this.el['inp_usr'].prop('disabled', disabled);
    this.el['inp_pas'].prop('disabled', disabled);
    this.el['btn_con'].prop('disabled', disabled);
  };

  OnvifManager.prototype.startDiscoveryCallback = function (data) {
    const devices = data.result;
    const currentSelection = this.el['sel_dev'].val();

    // Get list of existing device addresses in the dropdown (exclude placeholders)
    const existingAddresses = {};
    const placeholders = ['Select a device', 'now searching...'];
    this.el['sel_dev'].find('option').each(function() {
      const val = $(this).val();
      const text = $(this).text();
      // Only count real device entries (has IP-like value)
      if (val && !placeholders.includes(val) && !placeholders.includes(text)) {
        existingAddresses[val] = true;
      }
    });

    // Check if this is the first population (only has placeholder or no real devices)
    const isFirstPopulation = Object.keys(existingAddresses).length === 0;

    if (isFirstPopulation) {
      // First time - clear and add proper placeholder
      this.el['sel_dev'].empty();
      this.el['sel_dev'].append($('<option>Select a device</option>'));
    }

    let n = Object.keys(existingAddresses).length;
    for (const key in devices) {
      const device = devices[key];
      // Only add if not already in the list
      if (!existingAddresses[device.address]) {
        const option_el = $('<option></option>');
        option_el.val(device.address);
        option_el.text(device.name + ' (' + device.address + ')');
        this.el['sel_dev'].append(option_el);
        n++;
      }
    }

    // Restore selection if it was a valid device (not placeholder)
    if (currentSelection && !placeholders.includes(currentSelection)) {
      this.el['sel_dev'].val(currentSelection);
    }

    if (n === 0) {
      this.showMessageModal(
        'Error',
        'No device was found. Reload this page to discover ONVIF devices again.'
      );
    } else {
      this.disabledLoginForm(false);
    }
  };

  OnvifManager.prototype.connectCallback = function (data) {
    this.el['btn_con'].prop('disabled', false);
    if (data.result) {
      this.selected_address = this.el['sel_dev'].val();

      // Store stream info
      if (data.result.streams) {
        this.streams = data.result.streams;
      }
      if (data.result.mjpegUrl) {
        // Use relative URL to work properly behind reverse proxy
        const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
        this.mjpegUrl = basePath + data.result.mjpegUrl;
      }
      if (data.result.snapshotUrl) {
        // Use relative URL to work properly behind reverse proxy
        const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
        this.snapshotUrl = basePath + data.result.snapshotUrl;
      }

      this.showConnectedDeviceInfo(this.selected_address, data.result);
      this.el['btn_con'].text('Disconnect');
      this.el['frm_con'].hide();
      this.el['div_pnl'].show();
      this.device_connected = true;
    } else if (data.error) {
      this.el['div_pnl'].hide();
      this.el['sel_dev'].prop('disabled', false);
      this.el['inp_usr'].prop('disabled', false);
      this.el['inp_pas'].prop('disabled', false);
      this.el['btn_con'].text('Connect');
      this.el['frm_con'].show();
      this.showMessageModal(
        'Error',
        'Failed to connect to the device.' + data.error.toString()
      );
      this.device_connected = false;
    }
  };

  OnvifManager.prototype.getStreamsCallback = function (data) {
    if (data.result) {
      this.streams = data.result;
    }
  };

  OnvifManager.prototype.onStreamModeChange = function (event) {
    this.stream_mode = $(event.target).val();

    if (this.stream_mode === 'mjpeg') {
      this.startMjpegStream();
    } else {
      this.stopMjpegStream();
      if (this.device_connected) {
        this.fetchSnapshot();
      }
    }
  };

  OnvifManager.prototype.startMjpegStream = function () {
    if (this.mjpegUrl) {
      // Stop any existing stream first
      this.el['img_snp'].attr('src', '');
      // Small delay to ensure browser closes old connection
      setTimeout(function() {
        // Add timestamp to prevent caching
        this.el['img_snp'].attr('src', this.mjpegUrl + '&t=' + Date.now());
      }.bind(this), 50);
    }
  };

  OnvifManager.prototype.stopMjpegStream = function () {
    // Remove the src to stop the MJPEG stream
    this.el['img_snp'].attr('src', '');
  };

  OnvifManager.prototype.showStreamsModal = function () {
    // Construct full URLs using current page location (works with reverse proxy)
    const protocol = window.location.protocol;
    const host = window.location.host; // includes port if non-standard

    // Set stream URLs in the modal
    if (this.streams) {
      this.el['mdl_str'].find('.stream-url-rtsp').val(this.streams.rtsp || 'Not available');
      this.el['mdl_str'].find('.stream-url-http').val(this.streams.http || 'Not available');
    }
    // Convert relative URLs to absolute for display
    const mjpegFullUrl = this.mjpegUrl ? (this.mjpegUrl.startsWith('http') ? this.mjpegUrl : protocol + '//' + host + this.mjpegUrl) : 'Not available';
    const snapshotFullUrl = this.snapshotUrl ? (this.snapshotUrl.startsWith('http') ? this.snapshotUrl : protocol + '//' + host + this.snapshotUrl) : 'Not available';
    this.el['mdl_str'].find('.stream-url-mjpeg').val(mjpegFullUrl);
    this.el['mdl_str'].find('.stream-url-snapshot').val(snapshotFullUrl);

    this.el['mdl_str'].modal('show');
  };

  OnvifManager.prototype.showMessageModal = function (title, message) {
    this.el['mdl_msg'].find('.modal-title').text(title);
    this.el['mdl_msg'].find('.modal-message').text(message);
    this.el['mdl_msg'].modal('show');
  };

  OnvifManager.prototype.showConnectedDeviceInfo = function (address, data) {
    this.el['div_pnl']
      .find('span.name')
      .text(data['Manufacturer'] + ' ' + data['Model']);
    this.el['div_pnl'].find('span.address').text(address);
    this.fetchSnapshot();
  };

  OnvifManager.prototype.fetchSnapshot = function () {
    this.sendRequest('fetchSnapshot', {
      address: this.selected_address
    });
  };

  OnvifManager.prototype.fetchSnapshotCallback = function (data) {
    if (data.result) {
      // Only update image if in snapshot mode (not MJPEG)
      if (this.stream_mode === 'snapshot') {
        this.el['img_snp'].attr('src', data.result);
      }
      window.setTimeout(
        function () {
          this.snapshot_w = this.el['img_snp'].get(0).naturalWidth || 400;
          this.snapshot_h = this.el['img_snp'].get(0).naturalHeight || 300;
          this.adjustSize();
          // Only continue fetching if connected and in snapshot mode
          if (this.device_connected === true && this.stream_mode === 'snapshot') {
            this.fetchSnapshot();
          }
        }.bind(this),
        snapshotInterval
      );
    } else if (data.error) {
      console.log(data.error);
      // Retry after error with a longer delay
      if (this.device_connected === true && this.stream_mode === 'snapshot') {
        window.setTimeout(this.fetchSnapshot.bind(this), 1000);
      }
    }
  };

  OnvifManager.prototype.ptzGotoHome = function (event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'touchstart') {
      return;
    }
    if (this.device_connected === false || this.ptz_moving === true) {
      return;
    }
    this.ptz_moving = true;
    this.sendRequest('ptzHome', {
      address: this.selected_address,
      timeout: 30
    });
  };

  OnvifManager.prototype.ptzMove = function (event) {
    if (this.device_connected === false || this.ptz_moving === true) {
      return;
    }
    this.ptz_moving = true;
    const pos = { x: 0, y: 0, z: 0 };
    let speed = 1.0;

    if (event.type === 'keydown') {
      this.el['ptz_spd'].each(
        function (index, el) {
          if ($(el).prop('checked') === true) {
            speed = parseFloat($(el).val());
          }
        }.bind(this)
      );
      const c = event.keyCode;
      // const s = event.shiftKey;
      if (c === 38) {
        // Up
        pos.y = speed;
      } else if (c === 40) {
        // Down
        pos.y = 0 - speed;
      } else if (c === 37) {
        // Left
        pos.x = 0 - speed;
      } else if (c === 39) {
        // Right
        pos.x = speed;
      } else if (c === 107 || c === 187) {
        // Zoom in
        pos.z = speed;
      } else if (c === 109 || c === 189) {
        // Zoom out
        pos.z = 0 - speed;
      } else {
        return;
      }
    } else if (event.type.match(/^(mousedown|touchstart)$/)) {
      if (event.currentTarget.classList.contains('ptz-pad-box')) {
        const rect = event.currentTarget.getBoundingClientRect();
        let cx = event.clientX;
        let cy = event.clientY;
        if (event.type === 'touchstart') {
          if (event.targetTouches[0]) {
            cx = event.targetTouches[0].clientX;
            cy = event.targetTouches[0].clientY;
          } else if (event.changedTouches[0]) {
            cx = event.changedTouches[0].clientX;
            cy = event.changedTouches[0].clientY;
          }
        }
        const mx = cx - rect.left;
        const my = cy - rect.top;
        const w = rect.width;
        const h = rect.height;
        const r = Math.max(w, h) / 2;
        const x = mx - r;
        const y = r - my;
        const d = Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)) / r;
        const rad = Math.atan2(y, x);
        pos.x = d * Math.cos(rad);
        pos.y = d * Math.sin(rad);
      } else if (event.currentTarget.classList.contains('ptz-zom')) {
        if (event.currentTarget.classList.contains('ptz-zom-ot')) {
          pos.z = -1.0;
        } else if (event.currentTarget.classList.contains('ptz-zom-in')) {
          pos.z = 1.0;
        } else {
          return;
        }
      } else {
        return;
      }
    } else {
      return;
    }

    this.sendRequest('ptzMove', {
      address: this.selected_address,
      speed: pos,
      timeout: 30
    });
    event.preventDefault();
    event.stopPropagation();
  };

  OnvifManager.prototype.ptzStop = function (_event) {
    if (!this.selected_address) {
      return;
    }
    this.sendRequest('ptzStop', {
      address: this.selected_address
    });
    this.ptz_moving = false;
  };

  OnvifManager.prototype.ptzMoveCallback = function (_data) {
    // do nothing
  };

  OnvifManager.prototype.ptzStopCallback = function (_data) {
    // do nothing
  };

  OnvifManager.prototype.ptzHomeCallback = function (_data) {
    // do nothing
  };
})();
