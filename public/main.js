!function(){let t,e;var s,i;function o(){this.ws=null,this.el={frm_con:$("#connect-form"),sel_dev:$('#connect-form select[name="device"]'),inp_usr:$('#connect-form input[name="user"]'),inp_pas:$('#connect-form input[name="pass"]'),btn_con:$('#connect-form button[name="connect"]'),div_pnl:$("#connected-device"),img_snp:$("#connected-device img.snapshot"),btn_dcn:$('#connected-device button[name="disconnect"]'),mdl_msg:$("#message-modal"),ptz_spd:$('input[name="ptz-speed"]'),btn_hme:$("#connected-device div.ptz-pad-box button.ptz-goto-home"),ptz_pad:$("#connected-device div.ptz-pad-box"),zom_in:$("#connected-device div.ptz-zom-ctl-box button.ptz-zom-in"),zom_out:$("#connected-device div.ptz-zom-ctl-box button.ptz-zom-ot")},this.selected_address="",this.device_connected=!1,this.ptz_moving=!1,this.snapshot_w=400,this.snapshot_h=300}s=function(s){let i=JSON.parse(s);e=i[0].port,t=i[0].secure?"wss":"ws"},(i=new XMLHttpRequest).overrideMimeType("application/json"),i.open("GET","browserdata.json",!0),i.onreadystatechange=function(){4===i.readyState&&"200"==i.status&&s(i.responseText)},i.send(null),function t(){void 0!==e?$(document).ready((function(){(new o).init()})):setTimeout(t,250)}(),o.prototype.init=function(){this.initWebSocketConnection(),$(window).on("resize",this.adjustSize.bind(this)),this.el.btn_con.on("click",this.pressedConnectButton.bind(this)),this.el.btn_dcn.on("click",this.pressedConnectButton.bind(this)),$(document.body).on("keydown",this.ptzMove.bind(this)),$(document.body).on("keyup",this.ptzStop.bind(this)),this.el.btn_hme.on("click",this.ptzGotoHome.bind(this)),this.el.btn_hme.on("touchstart",this.ptzGotoHome.bind(this)),this.el.btn_hme.on("touchend",this.ptzGotoHome.bind(this)),this.el.ptz_pad.on("mousedown",this.ptzMove.bind(this)),this.el.ptz_pad.on("mouseup",this.ptzStop.bind(this)),this.el.ptz_pad.on("touchstart",this.ptzMove.bind(this)),this.el.ptz_pad.on("touchend",this.ptzStop.bind(this)),this.el.zom_in.on("mousedown",this.ptzMove.bind(this)),this.el.zom_in.on("mouseup",this.ptzStop.bind(this)),this.el.zom_in.on("touchstart",this.ptzMove.bind(this)),this.el.zom_in.on("touchend",this.ptzStop.bind(this)),this.el.zom_out.on("mousedown",this.ptzMove.bind(this)),this.el.zom_out.on("mouseup",this.ptzStop.bind(this)),this.el.zom_out.on("touchstart",this.ptzMove.bind(this)),this.el.zom_out.on("touchend",this.ptzStop.bind(this))},o.prototype.adjustSize=function(){var t=this.el.div_pnl.get(0),e=t.getBoundingClientRect(),s=(e.left,window.pageXOffset,e.top+window.pageYOffset),i=e.width,o=window.innerHeight-s-10;t.style.height=o+"px";var n=i/o,h=this.snapshot_w/this.snapshot_h,c=this.el.img_snp.get(0);h>n?(img_w=i,img_h=i/h,c.style.width=img_w+"px",c.style.height=img_h+"px",c.style.left="0px",c.style.top=(o-img_h)/2+"px"):(img_h=o,img_w=o*h,c.style.height=img_h+"px",c.style.width=img_w+"px",c.style.left=(i-img_w)/2+"px",c.style.top="0px")},o.prototype.initWebSocketConnection=function(){let s=t+"://"+location.hostname+":"+e;this.ws=new WebSocket(s),this.ws.onopen=function(){console.log("WebSocket connection established."),this.sendRequest("startDiscovery")}.bind(this),this.ws.onclose=function(t){console.log("WebSocket connection closed."),this.showMessageModal("Error","The WebSocket connection was closed. Check if the server.js is running.")}.bind(this),this.ws.onerror=function(t){this.showMessageModal("Error","Failed to establish a WebSocket connection. Check if the server.js is running.")}.bind(this),this.ws.onmessage=function(t){var e=JSON.parse(t.data),s=e.id;"startDiscovery"===s?this.startDiscoveryCallback(e):"connect"===s?this.connectCallback(e):"fetchSnapshot"===s?this.fetchSnapshotCallback(e):"ptzMove"===s?this.ptzMoveCallback(e):"ptzStop"===s?this.ptzStopCallback(e):"ptzHome"===s&&this.ptzHomeCallback(e)}.bind(this)},o.prototype.sendRequest=function(t,e){this.ws.send(JSON.stringify({method:t,params:e}))},o.prototype.pressedConnectButton=function(t){!0===this.device_connected?this.disconnectDevice():this.connectDevice()},o.prototype.disconnectDevice=function(){this.el.img_snp.removeAttr("src"),this.el.div_pnl.hide(),this.el.frm_con.show(),this.device_connected=!1,this.disabledLoginForm(!1),this.el.btn_con.text("Connect")},o.prototype.connectDevice=function(){this.disabledLoginForm(!0),this.el.btn_con.text("Connecting..."),this.sendRequest("connect",{address:this.el.sel_dev.val(),user:this.el.inp_usr.val(),pass:this.el.inp_pas.val()})},o.prototype.disabledLoginForm=function(t){this.el.sel_dev.prop("disabled",t),this.el.inp_usr.prop("disabled",t),this.el.inp_pas.prop("disabled",t),this.el.btn_con.prop("disabled",t)},o.prototype.startDiscoveryCallback=function(t){var e=t.result;this.el.sel_dev.empty(),this.el.sel_dev.append($("<option>Select a device</option>"));var s=0;for(var i in e){var o=e[i],n=$("<option></option>");n.val(o.address),n.text(o.name+" ("+o.address+")"),this.el.sel_dev.append(n),s++}0===s?this.showMessageModal("Error","No device was found. Reload this page to discover ONVIF devices again."):this.disabledLoginForm(!1)},o.prototype.connectCallback=function(t){this.el.btn_con.prop("disabled",!1),t.result?(this.selected_address=this.el.sel_dev.val(),this.showConnectedDeviceInfo(this.selected_address,t.result),this.el.btn_con.text("Disconnect"),this.el.frm_con.hide(),this.el.div_pnl.show(),this.device_connected=!0):t.error&&(this.el.div_pnl.hide(),this.el.sel_dev.prop("disabled",!1),this.el.inp_usr.prop("disabled",!1),this.el.inp_pas.prop("disabled",!1),this.el.btn_con.text("Connect"),this.el.frm_con.show(),this.showMessageModal("Error","Failed to connect to the device."+t.error.toString()),this.device_connected=!1)},o.prototype.showMessageModal=function(t,e){this.el.mdl_msg.find(".modal-title").text(t),this.el.mdl_msg.find(".modal-message").text(e),this.el.mdl_msg.modal("show")},o.prototype.showConnectedDeviceInfo=function(t,e){this.el.div_pnl.find("span.name").text(e.Manufacturer+" "+e.Model),this.el.div_pnl.find("span.address").text(t),this.fetchSnapshot()},o.prototype.fetchSnapshot=function(){this.sendRequest("fetchSnapshot",{address:this.selected_address})},o.prototype.fetchSnapshotCallback=function(t){t.result?(this.el.img_snp.attr("src",t.result),window.setTimeout(function(){this.snapshot_w=this.el.img_snp.get(0).naturalWidth,this.snapshot_h=this.el.img_snp.get(0).naturalHeight,this.adjustSize(),!0===this.device_connected&&this.fetchSnapshot()}.bind(this),10)):t.error&&console.log(t.error)},o.prototype.ptzGotoHome=function(t){t.preventDefault(),t.stopPropagation(),"touchstart"!==t.type&&!1!==this.device_connected&&!0!==this.ptz_moving&&(this.ptz_moving=!0,this.sendRequest("ptzHome",{address:this.selected_address,timeout:30}))},o.prototype.ptzMove=function(t){if(!1!==this.device_connected&&!0!==this.ptz_moving){this.ptz_moving=!0;var e={x:0,y:0,z:0},s=1;if("keydown"===t.type){this.el.ptz_spd.each(function(t,e){!0===$(e).prop("checked")&&(s=parseFloat($(e).val()))}.bind(this));var i=t.keyCode;if(t.shiftKey,38===i)e.y=s;else if(40===i)e.y=0-s;else if(37===i)e.x=0-s;else if(39===i)e.x=s;else if(107===i||187===i)e.z=s;else{if(109!==i&&189!==i)return;e.z=0-s}}else{if(!t.type.match(/^(mousedown|touchstart)$/))return;if(t.currentTarget.classList.contains("ptz-pad-box")){var o=t.currentTarget.getBoundingClientRect(),n=t.clientX,h=t.clientY;"touchstart"===t.type&&(t.targetTouches[0]?(n=t.targetTouches[0].clientX,h=t.targetTouches[0].clientY):t.changedTouches[0]&&(n=t.changedTouches[0].clientX,h=t.changedTouches[0].clientY));var c=n-o.left,d=h-o.top,p=o.width,a=o.height,l=Math.max(p,a)/2,r=c-l,u=l-d,m=Math.sqrt(Math.pow(r,2)+Math.pow(u,2))/l,_=Math.atan2(u,r);e.x=m*Math.cos(_),e.y=m*Math.sin(_)}else{if(!t.currentTarget.classList.contains("ptz-zom"))return;if(t.currentTarget.classList.contains("ptz-zom-ot"))e.z=-1;else{if(!t.currentTarget.classList.contains("ptz-zom-in"))return;e.z=1}}}this.sendRequest("ptzMove",{address:this.selected_address,speed:e,timeout:30}),t.preventDefault(),t.stopPropagation()}},o.prototype.ptzStop=function(t){this.selected_address&&(this.sendRequest("ptzStop",{address:this.selected_address}),this.ptz_moving=!1)},o.prototype.ptzMoveCallback=function(t){},o.prototype.ptzStopCallback=function(t){},o.prototype.ptzHomeCallback=function(t){}}();