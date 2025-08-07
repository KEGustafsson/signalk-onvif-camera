# signalk-onvif-camera

ONVIF Camera interface for Signal K. For IP cameras that support ONVIF control, fixed and PTZ.

## ONVIF Camera plugin config in Signal K server.

![config](doc/config.jpg)
- IP address of ONVIF LAN. Default, leave empty
- Select port for server
- Select https/wss if you would like to use secure server
- Enter ONVIF profile username
- Enter ONVIF profile password
- Add camera IP to list (user/pass are used to login to camera)

## ONVIF in IP Camera.

Example of HikVision IP camera ONVIF

![onvif](doc/onvif.jpg)
- Add ONVIF user to IP camera if applicable

## ONVIF Camera Webapp.

![webapp](doc/webapp.jpg)
-  Service can be accessed from Webapps menu, press "Signalk-onvif-camera" button 

## ONVIF Camera service.

![service](doc/service.jpg)
- ONVIF cameras are searched from local network
- When search is ready then "Select a device" is prompted
- Camera is selected from dropdown menu and then press "Connect" button

## ONVIF Camera in Use.

![inuse](doc/inuse.jpg)
- Cursors and home button for PTZ camera
- Zoom in/out
- Control speed
- Disconnect
- Hide/show controls 

## Installation

```
$ npm install signalk-onvif-camera --save
```
or
```
$ npm install https://github.com/KEGustafsson/signalk-onvif-camera.git --save
```
## Version control

- v0.0.1, 1st version for testing
- v0.0.2, license added
- v0.1.0, 1st release
- v0.1.1, ONVIF LAN selection
- v0.1.2, Webpack bundled
- v0.1.3, Webapp icon added
- v0.1.4, updated to npm packages
- v0.2.0, hide controls

## Credits
https://github.com/futomi/node-onvif 
