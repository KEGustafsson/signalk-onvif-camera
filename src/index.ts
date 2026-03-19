import { $, DomCollection } from './dom';
import { buildConnectRequest, hasSelectableAddress } from './connect';
import { normalizePtzPadVector } from './ptz';
import {
  createSnapshotRequestId,
  getNextSnapshotDelay,
  getRemainingSnapshotDelay,
  isExpectedSnapshotResponse,
  normalizeSnapshotInterval
} from './snapshot';

(function () {
  let snapshotInterval = 100;
  let isInitialized = false;

  type JsonRecord = Record<string, unknown>;
  type StreamMode = 'snapshot' | 'mjpeg';
  type WsHeartbeatResult = 'pong';

  interface BrowserDataEntry {
    snapshotInterval?: number;
  }

  interface ManagerResponse {
    id?: string;
    requestId?: unknown;
    result?: unknown;
    error?: unknown;
  }

  interface DeviceSummary {
    address: string;
    name: string;
  }

  type DeviceSummaryMap = Record<string, DeviceSummary>;

  interface StreamUrls {
    rtsp?: string;
    http?: string;
  }

  interface ManagerElements {
    frm_con: DomCollection;
    sel_dev: DomCollection;
    btn_con: DomCollection;
    div_pnl: DomCollection;
    img_snp: DomCollection;
    btn_dcn: DomCollection;
    mdl_msg: DomCollection;
    mdl_str: DomCollection;
    ptz_spd: DomCollection;
    btn_hme: DomCollection;
    btn_hm2: DomCollection;
    btn_hide: DomCollection;
    ptz_pad: DomCollection;
    zom_in: DomCollection;
    zom_out: DomCollection;
    btn_streams: DomCollection;
    stream_mode: DomCollection;
  }

  interface PtzPosition {
    x: number;
    y: number;
    z: number;
  }

  type PtzEvent = Event & {
    keyCode?: number;
    clientX?: number;
    clientY?: number;
    currentTarget: EventTarget | null;
    target: EventTarget | null;
    targetTouches?: TouchList;
    changedTouches?: TouchList;
  };

  function toRecord(value: unknown): JsonRecord | null {
    return typeof value === 'object' && value !== null ? value as JsonRecord : null;
  }

  function toStringValue(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
  }

  function getElementValue(element: DomCollection): string {
    const value = element.val();
    if(Array.isArray(value)) {
      return value.length > 0 ? String(value[0]) : '';
    }
    if(value === undefined || value === null) {
      return '';
    }
    return String(value);
  }

  function toDeviceSummaryMap(value: unknown): DeviceSummaryMap {
    const record = toRecord(value);
    const devices: DeviceSummaryMap = {};
    if(!record) {
      return devices;
    }

    Object.keys(record).forEach((key) => {
      const device = toRecord(record[key]);
      if(device) {
        devices[key] = {
          address: toStringValue(device['address']),
          name: toStringValue(device['name'])
        };
      }
    });
    return devices;
  }

  function showBootstrapModal(element: DomCollection): void {
    element.modal('show');
  }

  function toStreamUrls(value: unknown): StreamUrls | null {
    const record = toRecord(value);
    if(!record) {
      return null;
    }
    return {
      rtsp: toStringValue(record['rtsp']),
      http: toStringValue(record['http'])
    };
  }

  function readTextFile(file: string, callback: (text: string) => void): void {
    const rawFile = new XMLHttpRequest();
    rawFile.overrideMimeType('application/json');
    rawFile.open('GET', file, true);
    rawFile.onreadystatechange = function () {
      if (rawFile.readyState === 4) {
        if (rawFile.status === 200) {
          callback(rawFile.responseText);
        } else {
          console.error('Failed to load ' + file + ', status: ' + rawFile.status);
          initializeManager();
        }
      }
    };
    rawFile.onerror = function () {
      console.error('Error loading ' + file);
      initializeManager();
    };
    rawFile.send(null);
  }

  function initializeManager() {
    if (isInitialized) {
      return;
    }
    isInitialized = true;
    $(document).ready(function () {
      new OnvifManager().init();
    });
  }

  readTextFile('browserdata.json', function (text: string) {
    let browserData: BrowserDataEntry[];
    try {
      browserData = JSON.parse(text) as BrowserDataEntry[];
    } catch (_error) {
      browserData = [{}];
    }
    snapshotInterval = normalizeSnapshotInterval(browserData[0]?.snapshotInterval);
    initializeManager();
  });

  class OnvifManager {
    private ws: WebSocket | null = null;
    private el: ManagerElements;
    private selected_address = '';
    private device_connected = false;
    private ptz_moving = false;
    private _snapshotTimer: number | null = null;
    private _mjpegStartTimer: number | null = null;
    private snapshot_w = 400;
    private snapshot_h = 300;
    private stream_mode: StreamMode = 'snapshot';
    private streams: StreamUrls | null = null;
    private mjpegUrl: string | null = null;
    private snapshotUrl: string | null = null;
    private _reconnectTimer: number | null = null;
    private _heartbeatTimer: number | null = null;
    private _reconnectAttempts = 0;
    private pendingConnectAddress: string | null = null;
    private _snapshotRequestSequence = 0;
    private _activeSnapshotRequestId: string | null = null;
    private _activeSnapshotRequestedAt: number | null = null;

    constructor() {
      this.el = {
        frm_con: $('#connect-form'),
        sel_dev: $('#connect-form select[name="device"]'),
        btn_con: $('#connect-form button[name="connect"]'),
        div_pnl: $('#connected-device'),
        img_snp: $('#connected-device img.snapshot'),
        btn_dcn: $('#connected-device button[name="disconnect"]'),
        mdl_msg: $('#message-modal'),
        mdl_str: $('#streams-modal'),
        ptz_spd: $('input[name="ptz-speed"]'),
        btn_hme: $('#connected-device div.ptz-pad-box button.ptz-goto-home'),
        btn_hm2: $('#connected-device button.ptz-goto-home'),
        btn_hide: $('#connected-device .hide-controls-btn'),
        ptz_pad: $('#connected-device div.ptz-pad-box'),
        zom_in: $('#connected-device div.ptz-zom-ctl-box button.ptz-zom-in'),
        zom_out: $('#connected-device div.ptz-zom-ctl-box button.ptz-zom-ot'),
        btn_streams: $('#connected-device .show-streams-btn'),
        stream_mode: $('input[name="stream-mode"]')
      };
    }

    public init(): void {
      this.ensureWebSocketConnection();
      $(window).off('resize.onvif').on('resize.onvif', () => {
        window.requestAnimationFrame(() => {
          this.adjustSize();
        });
      });
      this.el.btn_con.on('click', this.pressedConnectButton.bind(this));
      this.el.btn_dcn.on('click', this.pressedConnectButton.bind(this));
      $(document.body).off('keydown.onvif').on('keydown.onvif', this.ptzMove.bind(this));
      $(document.body).off('keyup.onvif').on('keyup.onvif', this.ptzStop.bind(this));
      this.el.btn_hme.on('click', this.ptzGotoHome.bind(this));
      this.el.btn_hme.on('touchstart', this.ptzGotoHome.bind(this));
      this.el.btn_hme.on('touchend', this.ptzGotoHome.bind(this));
      this.el.btn_hm2.on('click', this.ptzGotoHome.bind(this));
      this.el.btn_hm2.on('touchstart', this.ptzGotoHome.bind(this));
      this.el.btn_hm2.on('touchend', this.ptzGotoHome.bind(this));
      this.el.btn_hide.on('click', this.toggleControls.bind(this));
      this.el.ptz_pad.on('mousedown', this.ptzMove.bind(this));
      this.el.ptz_pad.on('mouseup', this.ptzStop.bind(this));
      this.el.ptz_pad.on('touchstart', this.ptzMove.bind(this));
      this.el.ptz_pad.on('touchend', this.ptzStop.bind(this));
      this.el.zom_in.on('mousedown', this.ptzMove.bind(this));
      this.el.zom_in.on('mouseup', this.ptzStop.bind(this));
      this.el.zom_in.on('touchstart', this.ptzMove.bind(this));
      this.el.zom_in.on('touchend', this.ptzStop.bind(this));
      this.el.zom_out.on('mousedown', this.ptzMove.bind(this));
      this.el.zom_out.on('mouseup', this.ptzStop.bind(this));
      this.el.zom_out.on('touchstart', this.ptzMove.bind(this));
      this.el.zom_out.on('touchend', this.ptzStop.bind(this));
      this.el.stream_mode.on('change', this.onStreamModeChange.bind(this));
      this.el.btn_streams.on('click', this.showStreamsModal.bind(this));
      $('[data-dismiss="modal"]').on('click', this.dismissModal.bind(this));
      $('.modal').on('click', this.handleModalBackdropClick.bind(this));
      $('[data-toggle="buttons"] input[type="radio"]').on('change', this.syncButtonGroupState.bind(this));

      $('.copy-url-btn').on('click', (event) => {
        const currentTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
        const targetSelector = currentTarget ? String($(currentTarget).data('target') || '') : '';
        const text = targetSelector ? String($(targetSelector).val() || '') : '';
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).catch(() => undefined);
        } else if (targetSelector) {
          $(targetSelector).select();
          document.execCommand('copy');
        }
      });

      $('[data-toggle="buttons"] input[type="radio"]').each((_index, element) => {
        if (element instanceof HTMLInputElement) {
          this.updateButtonGroupState(element);
        }
      });
    }

    private adjustSize(): void {
      const divDomEl = this.el.div_pnl.get(0) as HTMLElement | undefined;
      const imgDomEl = this.el.img_snp.get(0) as HTMLImageElement | undefined;
      if(!divDomEl || !imgDomEl) {
        return;
      }

      const rect = divDomEl.getBoundingClientRect();
      const y = rect.top + window.pageYOffset;
      const width = rect.width;
      const height = window.innerHeight - y - 10;
      divDomEl.style.height = height + 'px';
      const aspectRatio = width / height;
      const snapshotAspectRatio = this.snapshot_w / this.snapshot_h;

      let imageWidth: number;
      let imageHeight: number;
      if (snapshotAspectRatio > aspectRatio) {
        imageWidth = width;
        imageHeight = width / snapshotAspectRatio;
        imgDomEl.style.width = imageWidth + 'px';
        imgDomEl.style.height = imageHeight + 'px';
        imgDomEl.style.left = '0px';
        imgDomEl.style.top = (height - imageHeight) / 2 + 'px';
      } else {
        imageHeight = height;
        imageWidth = height * snapshotAspectRatio;
        imgDomEl.style.height = imageHeight + 'px';
        imgDomEl.style.width = imageWidth + 'px';
        imgDomEl.style.left = (width - imageWidth) / 2 + 'px';
        imgDomEl.style.top = '0px';
      }
    }

    private initWebSocketConnection(): void {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const wsScheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = wsScheme + '://' + location.host + '/plugins/signalk-onvif-camera/ws';
      const socket = new WebSocket(url);
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws !== socket) {
          return;
        }
        console.debug('WebSocket connection established.');
        this.clearReconnectTimer();
        this._reconnectAttempts = 0;
        this.startHeartbeat();
        if (!this.device_connected) {
          this.el.btn_con.text('Connect');
        }
        if (this.selected_address) {
          this.pendingConnectAddress = this.selected_address;
        }
        this.sendRequest('startDiscovery');
      };
      socket.onclose = (_event: CloseEvent) => {
        if (this.ws === socket) {
          this.ws = null;
        }
        console.debug('WebSocket connection closed.');
        this.stopHeartbeat();
        this.scheduleReconnect();
      };
      socket.onerror = (_event: Event) => {
        console.debug('WebSocket connection error.');
      };
      socket.onmessage = (res: MessageEvent<string>) => {
        if (this.ws !== socket) {
          return;
        }
        if(typeof res.data !== 'string') {
          return;
        }
        let data: ManagerResponse;
        try {
          data = JSON.parse(res.data) as ManagerResponse;
        } catch (_error) {
          return;
        }

        const id = toStringValue(data.id);
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
        } else if (id === 'ping') {
          const heartbeat = toStringValue(data.result as WsHeartbeatResult);
          if (heartbeat !== 'pong') {
            console.debug('Unexpected WebSocket heartbeat response:', heartbeat);
          }
        }
      };
    }

    private ensureWebSocketConnection(): void {
      this.initWebSocketConnection();
    }

    private startHeartbeat(): void {
      this.stopHeartbeat();
      this._heartbeatTimer = window.setInterval(() => {
        if (!this.sendRequest('ping')) {
          this.stopHeartbeat();
          this.scheduleReconnect();
        }
      }, 20000);
    }

    private stopHeartbeat(): void {
      if (this._heartbeatTimer !== null) {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
      }
    }

    private clearSnapshotTimer(): void {
      if (this._snapshotTimer !== null) {
        clearTimeout(this._snapshotTimer);
        this._snapshotTimer = null;
      }
    }

    private clearActiveSnapshotRequest(): void {
      this._activeSnapshotRequestId = null;
      this._activeSnapshotRequestedAt = null;
      const imageEl = this.el.img_snp.get(0) as HTMLImageElement | undefined;
      if (imageEl) {
        imageEl.onload = null;
        imageEl.onerror = null;
      }
    }

    private scheduleNextSnapshot(onBeforeFetch?: () => void): void {
      const delay = getNextSnapshotDelay(snapshotInterval, this.device_connected, this.stream_mode);
      this.scheduleSnapshotTimer(delay, onBeforeFetch);
    }

    private scheduleNextSnapshotAfterRequest(requestStartedAt: number, onBeforeFetch?: () => void): void {
      const nextDelay = getNextSnapshotDelay(snapshotInterval, this.device_connected, this.stream_mode);
      const delay = nextDelay === null
        ? null
        : getRemainingSnapshotDelay(nextDelay, requestStartedAt);
      this.scheduleSnapshotTimer(delay, onBeforeFetch);
    }

    private scheduleSnapshotTimer(delay: number | null, onBeforeFetch?: () => void): void {
      this.clearSnapshotTimer();
      if (delay === null) {
        return;
      }

      this._snapshotTimer = window.setTimeout(() => {
        this._snapshotTimer = null;
        if (onBeforeFetch) {
          onBeforeFetch();
        }
        if (getNextSnapshotDelay(snapshotInterval, this.device_connected, this.stream_mode) !== null) {
          this.fetchSnapshot();
        }
      }, delay);
    }

    private buildSnapshotRequestUrl(): string | null {
      if (!this.snapshotUrl) {
        return null;
      }
      const separator = this.snapshotUrl.includes('?') ? '&' : '?';
      return this.snapshotUrl + separator + 't=' + Date.now();
    }

    private clearReconnectTimer(): void {
      if (this._reconnectTimer !== null) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
    }

    private scheduleReconnect(): void {
      if (this._reconnectTimer !== null) {
        return;
      }

      const delay = Math.min(1000 * (2 ** this._reconnectAttempts), 10000);
      this._reconnectAttempts += 1;
      if (!this.device_connected) {
        this.disabledLoginForm(true);
        this.el.btn_con.text('Reconnecting...');
      }
      this._reconnectTimer = window.setTimeout(() => {
        this._reconnectTimer = null;
        this.ensureWebSocketConnection();
      }, delay);
    }

    private sendRequest(method: string, params?: JsonRecord): boolean {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ method, params }));
        return true;
      }
      return false;
    }

    private pressedConnectButton(_event: Event): void {
      if (this.device_connected) {
        this.disconnectDevice();
      } else {
        this.connectDevice();
      }
    }

    private disconnectDevice(): void {
      this.stopMjpegStream();
      this.clearSnapshotTimer();
      this.clearActiveSnapshotRequest();

      this.el.img_snp.removeAttr('src');
      this.el.div_pnl.hide();
      this.el.frm_con.show();
      this.selected_address = '';
      this.device_connected = false;
      this.ptz_moving = false;
      this.disabledLoginForm(false);
      this.el.btn_con.text('Connect');
      this.stream_mode = 'snapshot';
      this.streams = null;
      this.mjpegUrl = null;
      this.snapshotUrl = null;
      this.pendingConnectAddress = null;

      $('input[name="stream-mode"][value="snapshot"]').prop('checked', true).parent().addClass('active');
      $('input[name="stream-mode"][value="mjpeg"]').parent().removeClass('active');
    }

    private connectDevice(): void {
      const address = getElementValue(this.el.sel_dev);
      if (!hasSelectableAddress(address)) {
        this.showMessageModal('Error', 'Select a discovered device before connecting.');
        return;
      }

      this.disabledLoginForm(true);
      this.el.btn_con.text('Connecting...');
      this.pendingConnectAddress = address;
      const sent = this.sendRequest(
        'connect',
        buildConnectRequest(address)
      );
      if (!sent) {
        this.el.btn_con.text('Reconnecting...');
        this.ensureWebSocketConnection();
      }
    }

    private disabledLoginForm(disabled: boolean): void {
      this.el.sel_dev.prop('disabled', disabled);
      this.el.btn_con.prop('disabled', disabled);
    }

    private startDiscoveryCallback(data: ManagerResponse): void {
      const devices = toDeviceSummaryMap(data.result);
      const currentSelection = getElementValue(this.el.sel_dev);
      const existingAddresses: Record<string, boolean> = {};
      const placeholders = ['Select a device', 'now searching...'];

      this.el.sel_dev.find('option').each((_index, element) => {
        const option = $(element);
        const value = getElementValue(option);
        const text = option.text();
        if (value && !placeholders.includes(value) && !placeholders.includes(text)) {
          existingAddresses[value] = true;
        }
      });

      const isFirstPopulation = Object.keys(existingAddresses).length === 0;
      if (isFirstPopulation) {
        this.el.sel_dev.empty();
        this.el.sel_dev.append($('<option>Select a device</option>'));
      }

      let count = Object.keys(existingAddresses).length;
      Object.keys(devices).forEach((key) => {
        const device = devices[key];
        if (device.address && !existingAddresses[device.address]) {
          const optionEl = $('<option></option>');
          optionEl.val(device.address);
          optionEl.text(device.name + ' (' + device.address + ')');
          this.el.sel_dev.append(optionEl);
          count++;
        }
      });

      if (currentSelection && !placeholders.includes(currentSelection)) {
        this.el.sel_dev.val(currentSelection);
      }

      const pendingAddress = this.pendingConnectAddress;
      if (pendingAddress && devices[pendingAddress]) {
        this.pendingConnectAddress = null;
        this.el.sel_dev.val(pendingAddress);
        this.disabledLoginForm(true);
        this.el.btn_con.text('Connecting...');
        this.sendRequest('connect', buildConnectRequest(pendingAddress));
        return;
      }

      if (pendingAddress && count > 0) {
        this.pendingConnectAddress = null;
        this.disabledLoginForm(false);
        this.el.btn_con.text('Connect');
        this.showMessageModal('Error', 'The selected device is no longer available.');
        return;
      }

      if (count === 0) {
        this.showMessageModal(
          'Error',
          'No device was found. Reload this page to discover ONVIF devices again.'
        );
      } else {
        this.disabledLoginForm(false);
        if (!this.device_connected) {
          this.el.btn_con.text('Connect');
        }
      }
    }

    private connectCallback(data: ManagerResponse): void {
      this.el.btn_con.prop('disabled', false);
      const result = toRecord(data.result);
      const errorMessage = toStringValue(data.error);

      if (result) {
        this.pendingConnectAddress = null;
        this.selected_address = getElementValue(this.el.sel_dev);
        this.streams = toStreamUrls(result['streams']);
        this.mjpegUrl = result['mjpegUrl'] ? location.origin + toStringValue(result['mjpegUrl']) : null;
        this.snapshotUrl = result['snapshotUrl'] ? location.origin + toStringValue(result['snapshotUrl']) : null;
        this.clearSnapshotTimer();
        this.clearActiveSnapshotRequest();
        this.el.btn_con.text('Disconnect');
        this.el.frm_con.hide();
        this.el.div_pnl.show();
        this.device_connected = true;
        this.showConnectedDeviceInfo(this.selected_address, result);
      } else if (errorMessage) {
        this.pendingConnectAddress = null;
        this.clearSnapshotTimer();
        this.clearActiveSnapshotRequest();
        this.el.div_pnl.hide();
        this.el.sel_dev.prop('disabled', false);
        this.el.btn_con.text('Connect');
        this.el.frm_con.show();
        this.showMessageModal('Error', 'Failed to connect to the device. ' + errorMessage);
        this.device_connected = false;
      }
    }

    private getStreamsCallback(data: ManagerResponse): void {
      const streams = toStreamUrls(data.result);
      if (streams) {
        this.streams = streams;
      }
    }

    private toggleControls(event: Event): void {
      const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      const connectedDevice = this.el.div_pnl.get(0);
      if (!(button instanceof HTMLElement) || !(connectedDevice instanceof HTMLElement)) {
        return;
      }

      const icon = button.querySelector('.glyphicon');
      const controlsHidden = connectedDevice.classList.toggle('controls-hidden');
      button.setAttribute('title', controlsHidden ? 'Show Controls' : 'Hide Controls');
      if (icon instanceof HTMLElement) {
        icon.classList.toggle('glyphicon-eye-open', !controlsHidden);
        icon.classList.toggle('glyphicon-eye-close', controlsHidden);
      }
    }

    private dismissModal(event: Event): void {
      const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      const modal = target?.closest('.modal');
      if (modal instanceof HTMLElement) {
        $(modal).modal('hide');
      }
    }

    private handleModalBackdropClick(event: Event): void {
      const target = event.target;
      const currentTarget = event.currentTarget;
      if (target instanceof HTMLElement && currentTarget instanceof HTMLElement && target === currentTarget) {
        $(currentTarget).modal('hide');
      }
    }

    private syncButtonGroupState(event: Event): void {
      const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : null;
      if (input) {
        this.updateButtonGroupState(input);
      }
    }

    private updateButtonGroupState(input: HTMLInputElement): void {
      const group = input.closest('[data-toggle="buttons"]');
      if (!(group instanceof HTMLElement)) {
        return;
      }

      Array.from(group.querySelectorAll('label')).forEach((label) => {
        label.classList.remove('active');
      });

      const label = input.closest('label');
      if (label instanceof HTMLElement) {
        label.classList.add('active');
      }
    }

    private onStreamModeChange(event: Event): void {
      const target = event.target instanceof HTMLInputElement ? event.target : null;
      const selectedMode = target ? String(target.value || 'snapshot') : 'snapshot';
      this.stream_mode = selectedMode === 'mjpeg' ? 'mjpeg' : 'snapshot';
      this.clearSnapshotTimer();
      this.clearActiveSnapshotRequest();

      if (this.stream_mode === 'mjpeg') {
        this.startMjpegStream();
      } else {
        this.stopMjpegStream();
        if (this.device_connected) {
          this.fetchSnapshot();
        }
      }
    }

    private startMjpegStream(): void {
      if (!this.mjpegUrl) {
        return;
      }

      if (this._mjpegStartTimer !== null) {
        clearTimeout(this._mjpegStartTimer);
        this._mjpegStartTimer = null;
      }

      this.el.img_snp.attr('src', '');
      this._mjpegStartTimer = window.setTimeout(() => {
        this._mjpegStartTimer = null;
        this.el.img_snp.attr('src', this.mjpegUrl + '&t=' + Date.now());
      }, 50);
    }

    private stopMjpegStream(): void {
      if (this._mjpegStartTimer !== null) {
        clearTimeout(this._mjpegStartTimer);
        this._mjpegStartTimer = null;
      }
      this.el.img_snp.attr('src', '');
    }

    private showStreamsModal(): void {
      if (this.streams) {
        this.el.mdl_str.find('.stream-url-rtsp').val(this.streams.rtsp || 'Not available');
        this.el.mdl_str.find('.stream-url-http').val(this.streams.http || 'Not available');
      }
      this.el.mdl_str.find('.stream-url-mjpeg').val(this.mjpegUrl || 'Not available');
      this.el.mdl_str.find('.stream-url-snapshot').val(this.snapshotUrl || 'Not available');
      showBootstrapModal(this.el.mdl_str);
    }

    private showMessageModal(title: string, message: string): void {
      this.el.mdl_msg.find('.modal-title').text(title);
      this.el.mdl_msg.find('.modal-message').text(message);
      showBootstrapModal(this.el.mdl_msg);
    }

    private showConnectedDeviceInfo(address: string, data: JsonRecord): void {
      this.el.div_pnl.find('span.name').text(toStringValue(data['Manufacturer']) + ' ' + toStringValue(data['Model']));
      this.el.div_pnl.find('span.address').text(address);
      this.fetchSnapshot();
    }

    private fetchSnapshot(): void {
      const requestId = createSnapshotRequestId(this._snapshotRequestSequence, this.selected_address);
      const requestStartedAt = Date.now();
      this._snapshotRequestSequence += 1;
      this.clearActiveSnapshotRequest();
      this._activeSnapshotRequestId = requestId;
      this._activeSnapshotRequestedAt = requestStartedAt;

      const snapshotRequestUrl = this.buildSnapshotRequestUrl();
      const imageEl = this.el.img_snp.get(0) as HTMLImageElement | undefined;
      if (snapshotRequestUrl && imageEl) {
        imageEl.onload = () => {
          if (!isExpectedSnapshotResponse(this._activeSnapshotRequestId, requestId)) {
            return;
          }

          this._activeSnapshotRequestId = null;
          this._activeSnapshotRequestedAt = null;
          if (!this.device_connected || this.stream_mode !== 'snapshot') {
            return;
          }

          this.snapshot_w = imageEl.naturalWidth || 400;
          this.snapshot_h = imageEl.naturalHeight || 300;
          this.scheduleNextSnapshotAfterRequest(requestStartedAt, () => {
            window.requestAnimationFrame(() => {
              this.adjustSize();
            });
          });
        };
        imageEl.onerror = () => {
          if (!isExpectedSnapshotResponse(this._activeSnapshotRequestId, requestId)) {
            return;
          }

          this._activeSnapshotRequestId = null;
          this._activeSnapshotRequestedAt = null;
          console.error('Failed to load snapshot image.');
          this.scheduleNextSnapshotAfterRequest(requestStartedAt);
        };
        imageEl.src = snapshotRequestUrl;
        return;
      }

      this.sendRequest('fetchSnapshot', {
        address: this.selected_address,
        requestId
      });
    }

    private fetchSnapshotCallback(data: ManagerResponse): void {
      if (!isExpectedSnapshotResponse(this._activeSnapshotRequestId, data.requestId)) {
        return;
      }

      const requestStartedAt = this._activeSnapshotRequestedAt ?? Date.now();
      this._activeSnapshotRequestId = null;
      this._activeSnapshotRequestedAt = null;
      const resultUrl = toStringValue(data.result);
      const errorMessage = toStringValue(data.error);

      if (!this.device_connected) {
        return;
      }

      if (resultUrl) {
        if (this.stream_mode === 'snapshot') {
          this.el.img_snp.attr('src', resultUrl);
        }
        this.scheduleNextSnapshotAfterRequest(requestStartedAt, () => {
          const imageEl = this.el.img_snp.get(0) as HTMLImageElement | undefined;
          if (imageEl) {
            this.snapshot_w = imageEl.naturalWidth || 400;
            this.snapshot_h = imageEl.naturalHeight || 300;
            window.requestAnimationFrame(() => {
              this.adjustSize();
            });
          }
        });
      } else if (errorMessage) {
        console.error(errorMessage);
        this.scheduleNextSnapshotAfterRequest(requestStartedAt);
      }
    }

    private ptzGotoHome(event: Event): void {
      event.preventDefault();
      event.stopPropagation();
      if (event.type === 'touchstart') {
        return;
      }
      if (!this.device_connected || this.ptz_moving) {
        return;
      }
      this.ptz_moving = true;
      this.sendRequest('ptzHome', {
        address: this.selected_address,
        timeout: 30
      });
    }

    private ptzMove(event: PtzEvent): void {
      if (!this.device_connected || this.ptz_moving) {
        return;
      }
      this.ptz_moving = true;

      const pos: PtzPosition = { x: 0, y: 0, z: 0 };
      let speed = 1.0;

      if (event.type === 'keydown') {
        this.el.ptz_spd.each((_index, element) => {
          const input = $(element);
          if (input.prop('checked') === true) {
            speed = parseFloat(String(input.val() || '1'));
          }
        });
        const code = event.keyCode || 0;
        if (code === 38) {
          pos.y = speed;
        } else if (code === 40) {
          pos.y = 0 - speed;
        } else if (code === 37) {
          pos.x = 0 - speed;
        } else if (code === 39) {
          pos.x = speed;
        } else if (code === 107 || code === 187) {
          pos.z = speed;
        } else if (code === 109 || code === 189) {
          pos.z = 0 - speed;
        } else {
          this.ptz_moving = false;
          return;
        }
      } else if (/^(mousedown|touchstart)$/.test(event.type)) {
        const currentTarget = event.currentTarget;
        if (!(currentTarget instanceof HTMLElement)) {
          this.ptz_moving = false;
          return;
        }
        if (currentTarget.classList.contains('ptz-pad-box')) {
          const rect = currentTarget.getBoundingClientRect();
          let clientX = event.clientX || 0;
          let clientY = event.clientY || 0;
          if (event.type === 'touchstart') {
            if (event.targetTouches && event.targetTouches.length > 0) {
              clientX = event.targetTouches[0].clientX;
              clientY = event.targetTouches[0].clientY;
            } else if (event.changedTouches && event.changedTouches.length > 0) {
              clientX = event.changedTouches[0].clientX;
              clientY = event.changedTouches[0].clientY;
            }
          }
          const normalized = normalizePtzPadVector(clientX, clientY, rect);
          pos.x = normalized.x;
          pos.y = normalized.y;
        } else if (currentTarget.classList.contains('ptz-zom')) {
          if (currentTarget.classList.contains('ptz-zom-ot')) {
            pos.z = -1.0;
          } else if (currentTarget.classList.contains('ptz-zom-in')) {
            pos.z = 1.0;
          } else {
            this.ptz_moving = false;
            return;
          }
        } else {
          this.ptz_moving = false;
          return;
        }
      } else {
        this.ptz_moving = false;
        return;
      }

      this.sendRequest('ptzMove', {
        address: this.selected_address,
        speed: pos,
        timeout: 30
      });
      event.preventDefault();
      event.stopPropagation();
    }

    private ptzStop(_event: Event): void {
      if (!this.selected_address) {
        return;
      }
      this.sendRequest('ptzStop', {
        address: this.selected_address
      });
      this.ptz_moving = false;
    }

    private ptzMoveCallback(_data: ManagerResponse): void {
      // do nothing
    }

    private ptzStopCallback(_data: ManagerResponse): void {
      // do nothing
    }

    private ptzHomeCallback(_data: ManagerResponse): void {
      this.ptz_moving = false;
    }
  }
})();
