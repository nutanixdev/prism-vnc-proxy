/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2013 Samuel Mannehed for Cendio AB
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

"use strict";
/*jslint white: false, browser: true */
/*global window, $D, Util, WebUtil, RFB, Display */

// Load supporting scripts
window.onscriptsload = function () { UI.load(); };
Util.load_scripts(["webutil.js", "base64.js", "websock.js", "des.js",
                   "keysymdef.js", "keyboard.js", "input.js", "display.js",
                   "jsunzip.js", "rfb.js", "keysym.js"]);

var UI = {

rfb_state : 'loaded',
settingsOpen : false,
connSettingsOpen : false,
popupStatusOpen : false,
clipboardOpen: false,
keyboardVisible: false,
hideKeyboardTimeout: null,
extraKeysVisible: false,
ctrlOn: false,
altOn: false,
isTouchDevice: false,

// Setup rfb object, load settings from browser storage, then call
// UI.init to setup the UI/menus
load: function (callback) {
    WebUtil.initSettings(UI.start, callback);
},

// Render default UI and initialize settings menu
start: function(callback) {
    var html = '', i, sheet, sheets, llevels, port, autoconnect;

    UI.isTouchDevice = 'ontouchstart' in document.documentElement;

    // Stylesheet selection dropdown
    sheet = WebUtil.selectStylesheet();
    sheets = WebUtil.getStylesheets();
    for (i = 0; i < sheets.length; i += 1) {
        UI.addOption($D('noVNC_stylesheet'),sheets[i].title, sheets[i].title);
    }

    // Logging selection dropdown
    llevels = ['error', 'warn', 'info', 'debug'];
    for (i = 0; i < llevels.length; i += 1) {
        UI.addOption($D('noVNC_logging'),llevels[i], llevels[i]);
    }

    // Settings with immediate effects
    UI.initSetting('logging', 'warn');
    WebUtil.init_logging(UI.getSetting('logging'));

    UI.initSetting('stylesheet', 'default');
    WebUtil.selectStylesheet(null);
    // call twice to get around webkit bug
    WebUtil.selectStylesheet(UI.getSetting('stylesheet'));

    // if port == 80 (or 443) then it won't be present and should be
    // set manually
    port = window.location.port;
    if (!port) {
        if (window.location.protocol.substring(0,5) == 'https') {
            port = 443;
        }
        else if (window.location.protocol.substring(0,4) == 'http') {
            port = 80;
        }
    }

    /* Populate the controls if defaults are provided in the URL */
    UI.initSetting('host', window.location.hostname);
    UI.initSetting('port', port);
    UI.initSetting('password', '');
    UI.initSetting('encrypt', (window.location.protocol === "https:"));
    UI.initSetting('true_color', true);
    UI.initSetting('cursor', !UI.isTouchDevice);
    UI.initSetting('shared', true);
    UI.initSetting('view_only', false);
    UI.initSetting('path', 'websockify');
    UI.initSetting('repeaterID', '');

    UI.rfb = RFB({'target': $D('noVNC_canvas'),
                  'onUpdateState': UI.updateState,
                  'onClipboard': UI.clipReceive,
                  'onDesktopName': UI.updateDocumentTitle});

    autoconnect = WebUtil.getQueryVar('autoconnect', false);
    if (autoconnect === 'true' || autoconnect == '1') {
        autoconnect = true;
        UI.connect();
    } else {
        autoconnect = false;
    }

    UI.updateVisualState();

    // Unfocus clipboard when over the VNC area
    //$D('VNC_screen').onmousemove = function () {
    //         var keyboard = UI.rfb.get_keyboard();
    //        if ((! keyboard) || (! keyboard.get_focused())) {
    //            $D('VNC_clipboard_text').blur();
    //         }
    //    };

    // Show mouse selector buttons on touch screen devices
    if (UI.isTouchDevice) {
        // Show mobile buttons
        $D('noVNC_mobile_buttons').style.display = "inline";
        UI.setMouseButton();
        // Remove the address bar
        setTimeout(function() { window.scrollTo(0, 1); }, 100);
        UI.forceSetting('clip', true);
        $D('noVNC_clip').disabled = true;
    } else {
        UI.initSetting('clip', false);
    }

    //iOS Safari does not support CSS position:fixed.
    //This detects iOS devices and enables javascript workaround.
    if ((navigator.userAgent.match(/iPhone/i)) ||
        (navigator.userAgent.match(/iPod/i)) ||
        (navigator.userAgent.match(/iPad/i))) {
        //UI.setOnscroll();
        //UI.setResize();
    }
    UI.setBarPosition();

    $D('noVNC_host').focus();

    UI.setViewClip();
    Util.addEvent(window, 'resize', UI.setViewClip);

    Util.addEvent(window, 'beforeunload', function () {
        if (UI.rfb_state === 'normal') {
            return "You are currently connected.";
        }
    } );

    // Show description by default when hosted at for kanaka.github.com
    if (location.host === "kanaka.github.io") {
        // Open the description dialog
        $D('noVNC_description').style.display = "block";
    } else {
        // Show the connect panel on first load unless autoconnecting
        if (autoconnect === UI.connSettingsOpen) {
            UI.toggleConnectPanel();
        }
    }

    // Add mouse event click/focus/blur event handlers to the UI
    UI.addMouseHandlers();

    if (typeof callback === "function") {
        callback(UI.rfb);
    }
},

addMouseHandlers: function() {
    // Setup interface handlers that can't be inline
    $D("noVNC_view_drag_button").onclick = UI.setViewDrag;
    $D("noVNC_mouse_button0").onclick = function () { UI.setMouseButton(1); };
    $D("noVNC_mouse_button1").onclick = function () { UI.setMouseButton(2); };
    $D("noVNC_mouse_button2").onclick = function () { UI.setMouseButton(4); };
    $D("noVNC_mouse_button4").onclick = function () { UI.setMouseButton(0); };
    $D("showKeyboard").onclick = UI.showKeyboard;

    $D("keyboardinput").oninput = UI.keyInput;
    $D("keyboardinput").onblur = UI.keyInputBlur;

    $D("showExtraKeysButton").onclick = UI.showExtraKeys;
    $D("toggleCtrlButton").onclick = UI.toggleCtrl;
    $D("toggleAltButton").onclick = UI.toggleAlt;
    $D("sendTabButton").onclick = UI.sendTab;
    $D("sendEscButton").onclick = UI.sendEsc;

    $D("sendCtrlAltDelButton").onclick = UI.sendCtrlAltDel;
    $D("noVNC_status").onclick = UI.togglePopupStatusPanel;
    $D("noVNC_popup_status_panel").onclick = UI.togglePopupStatusPanel;
    $D("clipboardButton").onclick = UI.toggleClipboardPanel;
    $D("settingsButton").onclick = UI.toggleSettingsPanel;
    $D("connectButton").onclick = UI.toggleConnectPanel;
    $D("disconnectButton").onclick = UI.disconnect;
    $D("descriptionButton").onclick = UI.toggleConnectPanel;

    $D("noVNC_clipboard_text").onfocus = UI.displayBlur;
    $D("noVNC_clipboard_text").onblur = UI.displayFocus;
    $D("noVNC_clipboard_text").onchange = UI.clipSend;
    $D("noVNC_clipboard_clear_button").onclick = UI.clipClear;

    $D("noVNC_settings_menu").onmouseover = UI.displayBlur;
    $D("noVNC_settings_menu").onmouseover = UI.displayFocus;
    $D("noVNC_apply").onclick = UI.settingsApply;

    $D("noVNC_connect_button").onclick = UI.connect;
},

// Read form control compatible setting from cookie
getSetting: function(name) {
    var val, ctrl = $D('noVNC_' + name);
    val = WebUtil.readSetting(name);
    if (val !== null && ctrl.type === 'checkbox') {
        if (val.toString().toLowerCase() in {'0':1, 'no':1, 'false':1}) {
            val = false;
        } else {
            val = true;
        }
    }
    return val;
},

// Update cookie and form control setting. If value is not set, then
// updates from control to current cookie setting.
updateSetting: function(name, value) {

    var i, ctrl = $D('noVNC_' + name);
    // Save the cookie for this session
    if (typeof value !== 'undefined') {
        WebUtil.writeSetting(name, value);
    }

    // Update the settings control
    value = UI.getSetting(name);

    if (ctrl.type === 'checkbox') {
        ctrl.checked = value;

    } else if (typeof ctrl.options !== 'undefined') {
        for (i = 0; i < ctrl.options.length; i += 1) {
            if (ctrl.options[i].value === value) {
                ctrl.selectedIndex = i;
                break;
            }
        }
    } else {
        /*Weird IE9 error leads to 'null' appearring
        in textboxes instead of ''.*/
        if (value === null) {
            value = "";
        }
        ctrl.value = value;
    }
},

// Save control setting to cookie
saveSetting: function(name) {
    var val, ctrl = $D('noVNC_' + name);
    if (ctrl.type === 'checkbox') {
        val = ctrl.checked;
    } else if (typeof ctrl.options !== 'undefined') {
        val = ctrl.options[ctrl.selectedIndex].value;
    } else {
        val = ctrl.value;
    }
    WebUtil.writeSetting(name, val);
    //Util.Debug("Setting saved '" + name + "=" + val + "'");
    return val;
},

// Initial page load read/initialization of settings
initSetting: function(name, defVal) {
    var val;

    // Check Query string followed by cookie
    val = WebUtil.getQueryVar(name);
    if (val === null) {
        val = WebUtil.readSetting(name, defVal);
    }
    UI.updateSetting(name, val);
 //Util.Debug("Setting '" + name + "' initialized to '" + val + "'");
    return val;
},

// Force a setting to be a certain value
forceSetting: function(name, val) {
    UI.updateSetting(name, val);
    return val;
},


// Show the popup status panel
togglePopupStatusPanel: function() {
    var psp = $D('noVNC_popup_status_panel');
    if (UI.popupStatusOpen === true) {
        psp.style.display = "none";
        UI.popupStatusOpen = false;
    } else {
        psp.innerHTML = $D('noVNC_status').innerHTML;
        psp.style.display = "block";
        psp.style.left = window.innerWidth/2 -
            parseInt(window.getComputedStyle(psp, false).width)/2 -30 + "px";
        UI.popupStatusOpen = true;
    }
},

// Show the clipboard panel
toggleClipboardPanel: function() {
    // Close the description panel
    $D('noVNC_description').style.display = "none";
    // Close settings if open
    if (UI.settingsOpen === true) {
        UI.settingsApply();
        UI.closeSettingsMenu();
    }
    // Close connection settings if open
    if (UI.connSettingsOpen === true) {
        UI.toggleConnectPanel();
    }
    // Close popup status panel if open
    if (UI.popupStatusOpen === true) {
        UI.togglePopupStatusPanel();
    }
    // Toggle Clipboard Panel
    if (UI.clipboardOpen === true) {
        $D('noVNC_clipboard').style.display = "none";
        $D('clipboardButton').className = "noVNC_status_button";
        UI.clipboardOpen = false;
    } else {
        $D('noVNC_clipboard').style.display = "block";
        $D('clipboardButton').className = "noVNC_status_button_selected";
        UI.clipboardOpen = true;
    }
},

// Show the connection settings panel/menu
toggleConnectPanel: function() {
    // Close the description panel
    $D('noVNC_description').style.display = "none";
    // Close connection settings if open
    if (UI.settingsOpen === true) {
        UI.settingsApply();
        UI.closeSettingsMenu();
        $D('connectButton').className = "noVNC_status_button";
    }
    // Close clipboard panel if open
    if (UI.clipboardOpen === true) {
        UI.toggleClipboardPanel();
    }
    // Close popup status panel if open
    if (UI.popupStatusOpen === true) {
        UI.togglePopupStatusPanel();
    }

    // Toggle Connection Panel
    if (UI.connSettingsOpen === true) {
        $D('noVNC_controls').style.display = "none";
        $D('connectButton').className = "noVNC_status_button";
        UI.connSettingsOpen = false;
        UI.saveSetting('host');
        UI.saveSetting('port');
        //UI.saveSetting('password');
    } else {
        $D('noVNC_controls').style.display = "block";
        $D('connectButton').className = "noVNC_status_button_selected";
        UI.connSettingsOpen = true;
        $D('noVNC_host').focus();
    }
},

// Toggle the settings menu:
//   On open, settings are refreshed from saved cookies.
//   On close, settings are applied
toggleSettingsPanel: function() {
    // Close the description panel
    $D('noVNC_description').style.display = "none";
    if (UI.settingsOpen) {
        UI.settingsApply();
        UI.closeSettingsMenu();
    } else {
        UI.updateSetting('encrypt');
        UI.updateSetting('true_color');
        if (UI.rfb.get_display().get_cursor_uri()) {
            UI.updateSetting('cursor');
        } else {
            UI.updateSetting('cursor', !UI.isTouchDevice);
            $D('noVNC_cursor').disabled = true;
        }
        UI.updateSetting('clip');
        UI.updateSetting('shared');
        UI.updateSetting('view_only');
        UI.updateSetting('path');
        UI.updateSetting('repeaterID');
        UI.updateSetting('stylesheet');
        UI.updateSetting('logging');

        UI.openSettingsMenu();
    }
},

// Open menu
openSettingsMenu: function() {
    // Close the description panel
    $D('noVNC_description').style.display = "none";
    // Close clipboard panel if open
    if (UI.clipboardOpen === true) {
        UI.toggleClipboardPanel();
    }
    // Close connection settings if open
    if (UI.connSettingsOpen === true) {
        UI.toggleConnectPanel();
    }
    // Close popup status panel if open
    if (UI.popupStatusOpen === true) {
        UI.togglePopupStatusPanel();
    }
    $D('noVNC_settings').style.display = "block";
    $D('settingsButton').className = "noVNC_status_button_selected";
    UI.settingsOpen = true;
},

// Close menu (without applying settings)
closeSettingsMenu: function() {
    $D('noVNC_settings').style.display = "none";
    $D('settingsButton').className = "noVNC_status_button";
    UI.settingsOpen = false;
},

// Save/apply settings when 'Apply' button is pressed
settingsApply: function() {
    //Util.Debug(">> settingsApply");
    UI.saveSetting('encrypt');
    UI.saveSetting('true_color');
    if (UI.rfb.get_display().get_cursor_uri()) {
        UI.saveSetting('cursor');
    }
    UI.saveSetting('clip');
    UI.saveSetting('shared');
    UI.saveSetting('view_only');
    UI.saveSetting('path');
    UI.saveSetting('repeaterID');
    UI.saveSetting('stylesheet');
    UI.saveSetting('logging');

    // Settings with immediate (non-connected related) effect
    WebUtil.selectStylesheet(UI.getSetting('stylesheet'));
    WebUtil.init_logging(UI.getSetting('logging'));
    UI.setViewClip();
    UI.setViewDrag(UI.rfb.get_viewportDrag());
    //Util.Debug("<< settingsApply");
},



setPassword: function() {
    UI.rfb.sendPassword($D('noVNC_password').value);
    //Reset connect button.
    $D('noVNC_connect_button').value = "Connect";
    $D('noVNC_connect_button').onclick = UI.Connect;
    //Hide connection panel.
    UI.toggleConnectPanel();
    return false;
},

sendCtrlAltDel: function() {
    UI.rfb.sendCtrlAltDel();
},

setMouseButton: function(num) {
    var b, blist = [0, 1,2,4], button;

    if (typeof num === 'undefined') {
        // Disable mouse buttons
        num = -1;
    }
    if (UI.rfb) {
        UI.rfb.get_mouse().set_touchButton(num);
    }

    for (b = 0; b < blist.length; b++) {
        button = $D('noVNC_mouse_button' + blist[b]);
        if (blist[b] === num) {
            button.style.display = "";
        } else {
            button.style.display = "none";
            /*
            button.style.backgroundColor = "black";
            button.style.color = "lightgray";
            button.style.backgroundColor = "";
            button.style.color = "";
            */
        }
    }
},

updateState: function(rfb, state, oldstate, msg) {
    var s, sb, c, d, cad, vd, klass;
    UI.rfb_state = state;
    switch (state) {
        case 'failed':
        case 'fatal':
            klass = "noVNC_status_error";
            break;
        case 'normal':
            klass = "noVNC_status_normal";
            break;
        case 'disconnected':
            $D('noVNC_logo').style.display = "block";
            // Fall through
        case 'loaded':
            klass = "noVNC_status_normal";
            break;
        case 'password':
            UI.toggleConnectPanel();

            $D('noVNC_connect_button').value = "Send Password";
            $D('noVNC_connect_button').onclick = UI.setPassword;
            $D('noVNC_password').focus();

            klass = "noVNC_status_warn";
            break;
        default:
            klass = "noVNC_status_warn";
            break;
    }

    if (typeof(msg) !== 'undefined') {
        $D('noVNC-control-bar').setAttribute("class", klass);
        $D('noVNC_status').innerHTML = msg;
    }

    UI.updateVisualState();
},

// Disable/enable controls depending on connection state
updateVisualState: function() {
    var connected = UI.rfb_state === 'normal' ? true : false;

    //Util.Debug(">> updateVisualState");
    $D('noVNC_encrypt').disabled = connected;
    $D('noVNC_true_color').disabled = connected;
    if (UI.rfb && UI.rfb.get_display() &&
        UI.rfb.get_display().get_cursor_uri()) {
        $D('noVNC_cursor').disabled = connected;
    } else {
        UI.updateSetting('cursor', !UI.isTouchDevice);
        $D('noVNC_cursor').disabled = true;
    }
    $D('noVNC_shared').disabled = connected;
    $D('noVNC_view_only').disabled = connected;
    $D('noVNC_path').disabled = connected;
    $D('noVNC_repeaterID').disabled = connected;

    if (connected) {
        UI.setViewClip();
        UI.setMouseButton(1);
        $D('clipboardButton').style.display = "inline";
        $D('showKeyboard').style.display = "inline";
        $D('noVNC_extra_keys').style.display = "";
        $D('sendCtrlAltDelButton').style.display = "inline";
    } else {
        UI.setMouseButton();
        $D('clipboardButton').style.display = "none";
        $D('showKeyboard').style.display = "none";
        $D('noVNC_extra_keys').style.display = "none";
        $D('sendCtrlAltDelButton').style.display = "none";
    }

    // State change disables viewport dragging.
    // It is enabled (toggled) by direct click on the button
    UI.setViewDrag(false);

    switch (UI.rfb_state) {
        case 'fatal':
        case 'failed':
        case 'loaded':
        case 'disconnected':
            $D('connectButton').style.display = "";
            $D('disconnectButton').style.display = "none";
            break;
        default:
            $D('connectButton').style.display = "none";
            $D('disconnectButton').style.display = "";
            break;
    }

    //Util.Debug("<< updateVisualState");
},


// Display the desktop name in the document title
updateDocumentTitle: function(rfb, name) {
    document.title = name + " - noVNC";
},


clipReceive: function(rfb, text) {
    Util.Debug(">> UI.clipReceive: " + text.substr(0,40) + "...");
    $D('noVNC_clipboard_text').value = text;
    Util.Debug("<< UI.clipReceive");
},


connect: function() {
    var host, port, password, path;

    UI.closeSettingsMenu();
    UI.toggleConnectPanel();

    host = $D('noVNC_host').value;
    port = $D('noVNC_port').value;
    password = $D('noVNC_password').value;
    path = $D('noVNC_path').value;
    if ((!host) || (!port)) {
        throw("Must set host and port");
    }

    UI.rfb.set_encrypt(UI.getSetting('encrypt'));
    UI.rfb.set_true_color(UI.getSetting('true_color'));
    UI.rfb.set_local_cursor(UI.getSetting('cursor'));
    UI.rfb.set_shared(UI.getSetting('shared'));
    UI.rfb.set_view_only(UI.getSetting('view_only'));
    UI.rfb.set_repeaterID(UI.getSetting('repeaterID'));

    UI.rfb.connect(host, port, password, path);

    //Close dialog.
    setTimeout(UI.setBarPosition, 100);
    $D('noVNC_logo').style.display = "none";
},

disconnect: function() {
    UI.closeSettingsMenu();
    UI.rfb.disconnect();

    $D('noVNC_logo').style.display = "block";
    UI.connSettingsOpen = false;
    UI.toggleConnectPanel();
},

displayBlur: function() {
    UI.rfb.get_keyboard().set_focused(false);
    UI.rfb.get_mouse().set_focused(false);
},

displayFocus: function() {
    UI.rfb.get_keyboard().set_focused(true);
    UI.rfb.get_mouse().set_focused(true);
},

clipClear: function() {
    $D('noVNC_clipboard_text').value = "";
    UI.rfb.clipboardPasteFrom("");
},

clipSend: function() {
    var text = $D('noVNC_clipboard_text').value;
    Util.Debug(">> UI.clipSend: " + text.substr(0,40) + "...");
    UI.rfb.clipboardPasteFrom(text);
    Util.Debug("<< UI.clipSend");
},


// Enable/disable and configure viewport clipping
setViewClip: function(clip) {
    var display, cur_clip, pos, new_w, new_h;

    if (UI.rfb) {
        display = UI.rfb.get_display();
    } else {
        return;
    }

    cur_clip = display.get_viewport();

    if (typeof(clip) !== 'boolean') {
        // Use current setting
        clip = UI.getSetting('clip');
    }

    if (clip && !cur_clip) {
        // Turn clipping on
        UI.updateSetting('clip', true);
    } else if (!clip && cur_clip) {
        // Turn clipping off
        UI.updateSetting('clip', false);
        display.set_viewport(false);
        $D('noVNC_canvas').style.position = 'static';
        display.viewportChange();
    }
    if (UI.getSetting('clip')) {
        // If clipping, update clipping settings
        $D('noVNC_canvas').style.position = 'absolute';
        pos = Util.getPosition($D('noVNC_canvas'));
        new_w = window.innerWidth - pos.x;
        new_h = window.innerHeight - pos.y;
        display.set_viewport(true);
        display.viewportChange(0, 0, new_w, new_h);
    }
},

// Toggle/set/unset the viewport drag/move button
setViewDrag: function(drag) {
    var vmb = $D('noVNC_view_drag_button');
    if (!UI.rfb) { return; }

    if (UI.rfb_state === 'normal' &&
        UI.rfb.get_display().get_viewport()) {
        vmb.style.display = "inline";
    } else {
        vmb.style.display = "none";
    }

    if (typeof(drag) === "undefined" ||
        typeof(drag) === "object") {
        // If not specified, then toggle
        drag = !UI.rfb.get_viewportDrag();
    }
    if (drag) {
        vmb.className = "noVNC_status_button_selected";
        UI.rfb.set_viewportDrag(true);
    } else {
        vmb.className = "noVNC_status_button";
        UI.rfb.set_viewportDrag(false);
    }
},

// On touch devices, show the OS keyboard
showKeyboard: function() {
    var kbi, skb, l;
    kbi = $D('keyboardinput');
    skb = $D('showKeyboard');
    l = kbi.value.length;
    if(UI.keyboardVisible === false) {
        kbi.focus();
        kbi.setSelectionRange(l, l); // Move the caret to the end
        UI.keyboardVisible = true;
        skb.className = "noVNC_status_button_selected";
    } else if(UI.keyboardVisible === true) {
        kbi.blur();
        skb.className = "noVNC_status_button";
        UI.keyboardVisible = false;
    }
},

keepKeyboard: function() {
    clearTimeout(UI.hideKeyboardTimeout);
    if(UI.keyboardVisible === true) {
        $D('keyboardinput').focus();
        $D('showKeyboard').className = "noVNC_status_button_selected";
    } else if(UI.keyboardVisible === false) {
        $D('keyboardinput').blur();
        $D('showKeyboard').className = "noVNC_status_button";
    }
},

// When keypress events are left uncought, catch the input events from
// the keyboardinput element instead and send the corresponding key events.
keyInput: function(event) {
    var elem, input, len;
    elem = $D('keyboardinput');
    input = event.target.value;
    len = (elem.selectionStart > input.length) ? elem.selectionStart : input.length;

    if (len < 1) { // something removed?
        UI.rfb.sendKey(0xff08); // send BACKSPACE
    } else if (len > 1) { // new input?
        for (var i = len-1; i > 0; i -= 1) {
            // HTML does not consider trailing whitespaces as a part of the string
            // and they are therefore undefined.
            if (input[len-i] !== undefined) {
                UI.rfb.sendKey(input.charCodeAt(len-i)); // send charCode
            } else {
                UI.rfb.sendKey(0x0020); // send SPACE
            }
        }
    }

    // In order to be able to delete text which has been written in
    // another session there has to always be text in the
    // keyboardinput element with which backspace can interact.
    // We also need to reset the input field text to avoid overflow.
    elem.value = "x";
},

keyInputBlur: function() {
    $D('showKeyboard').className = "noVNC_status_button";
    //Weird bug in iOS if you change keyboardVisible
    //here it does not actually occur so next time
    //you click keyboard icon it doesnt work.
    UI.hideKeyboardTimeout = setTimeout(function() { UI.setKeyboard(); },100);
},

showExtraKeys: function() {
    UI.keepKeyboard();
    if(UI.extraKeysVisible === false) {
        $D('toggleCtrlButton').style.display = "inline";
        $D('toggleAltButton').style.display = "inline";
        $D('sendTabButton').style.display = "inline";
        $D('sendEscButton').style.display = "inline";
        $D('showExtraKeysButton').className = "noVNC_status_button_selected";
        UI.extraKeysVisible = true;
    } else if(UI.extraKeysVisible === true) {
        $D('toggleCtrlButton').style.display = "";
        $D('toggleAltButton').style.display = "";
        $D('sendTabButton').style.display = "";
        $D('sendEscButton').style.display = "";
        $D('showExtraKeysButton').className = "noVNC_status_button";
        UI.extraKeysVisible = false;
    }
},

toggleCtrl: function() {
    UI.keepKeyboard();
    if(UI.ctrlOn === false) {
        UI.rfb.sendKey(XK_Control_L, true);
        $D('toggleCtrlButton').className = "noVNC_status_button_selected";
        UI.ctrlOn = true;
    } else if(UI.ctrlOn === true) {
        UI.rfb.sendKey(XK_Control_L, false);
        $D('toggleCtrlButton').className = "noVNC_status_button";
        UI.ctrlOn = false;
    }
},

toggleAlt: function() {
    UI.keepKeyboard();
    if(UI.altOn === false) {
        UI.rfb.sendKey(XK_Alt_L, true);
        $D('toggleAltButton').className = "noVNC_status_button_selected";
        UI.altOn = true;
    } else if(UI.altOn === true) {
        UI.rfb.sendKey(XK_Alt_L, false);
        $D('toggleAltButton').className = "noVNC_status_button";
        UI.altOn = false;
    }
},

sendTab: function() {
    UI.keepKeyboard();
    UI.rfb.sendKey(XK_Tab);
},

sendEsc: function() {
    UI.keepKeyboard();
    UI.rfb.sendKey(XK_Escape);
},

setKeyboard: function() {
    UI.keyboardVisible = false;
},

// iOS < Version 5 does not support position fixed. Javascript workaround:
setOnscroll: function() {
    window.onscroll = function() {
        UI.setBarPosition();
    };
},

setResize: function () {
    window.onResize = function() {
        UI.setBarPosition();
    };
},

//Helper to add options to dropdown.
addOption: function(selectbox,text,value )
{
    var optn = document.createElement("OPTION");
    optn.text = text;
    optn.value = value;
    selectbox.options.add(optn);
},

setBarPosition: function() {
    $D('noVNC-control-bar').style.top = (window.pageYOffset) + 'px';
    $D('noVNC_mobile_buttons').style.left = (window.pageXOffset) + 'px';

    var vncwidth = $D('noVNC_screen').style.offsetWidth;
    $D('noVNC-control-bar').style.width = vncwidth + 'px';
}

};
