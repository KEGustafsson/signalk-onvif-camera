# signalk-onvif-camera

Onvif Camera interface for Signal K. For IP cameras that support Onvif control, fixed and PTZ.

## Onvif Camera plugin config in Signal K server.

![config](doc/config.jpg)
- Select port for server
- Select https/wss if you would like to use secure server
- Enter Onvif profile username
- Enter Onvif profile password
- Add camera IP to list (user/pass are used to login to camera)


## Onvif Camera Webapp.

![webapp](doc/webapp.jpg)
-  Service can be accessed from Webapps menu, press "Signalk-onvif-camera" button 

## Onvif Camera service.

![service](doc/service.jpg)
- Onvif cameras are searched from local network
- When search is ready then "Select a device" is prompted
- Camera is selected from dropdown menu and then press "Connect" button

## Onvif Camera in Use.

![inuse](doc/inuse.jpg)
- Cursors and home button for PTZ camera
- Zoom in/out
- Control speed
- Disconnect

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

## Credits
https://github.com/futomi/node-onvif 
