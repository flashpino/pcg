#include "storage.h"
#include <Preferences.h>
#include <WiFi.h>

namespace storage {

static Preferences prefs;
static const char* NAMESPACE = "pcg";

void begin() {
  prefs.begin(NAMESPACE, false);
}

bool hasWifiCredentials() {
  return prefs.isKey("wifi_ssid") && prefs.getString("wifi_ssid").length() > 0;
}

WifiCredentials loadWifiCredentials() {
  WifiCredentials creds;
  creds.ssid = prefs.getString("wifi_ssid", "");
  creds.password = prefs.getString("wifi_pass", "");
  return creds;
}

void saveWifiCredentials(const String& ssid, const String& password) {
  prefs.putString("wifi_ssid", ssid);
  prefs.putString("wifi_pass", password);
}

bool hasDeviceToken() {
  return prefs.isKey("token") && prefs.getString("token").length() > 0;
}

String loadDeviceToken() {
  return prefs.getString("token", "");
}

void saveDeviceToken(const String& token) {
  prefs.putString("token", token);
}

String loadDeviceName() {
  String name = prefs.getString("device_name", "");
  if (name.length() > 0) return name;
  // default: "esp32-" + últimos 4 dígitos hex do MAC (sem UI ainda pra trocar — Task 13)
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  return "esp32-" + mac.substring(mac.length() - 4);
}

void saveDeviceName(const String& name) {
  prefs.putString("device_name", name);
}

StaticIpConfig loadStaticIp() {
  StaticIpConfig cfg;
  cfg.enabled = prefs.getBool("ip_static", false);
  if (!cfg.enabled) return cfg;
  cfg.ip.fromString(prefs.getString("ip_addr", ""));
  cfg.gateway.fromString(prefs.getString("ip_gw", ""));
  cfg.subnet.fromString(prefs.getString("ip_mask", "255.255.255.0"));
  cfg.dns.fromString(prefs.getString("ip_dns", ""));
  return cfg;
}

void saveStaticIp(const StaticIpConfig& cfg) {
  prefs.putBool("ip_static", cfg.enabled);
  if (!cfg.enabled) return;
  prefs.putString("ip_addr", cfg.ip.toString());
  prefs.putString("ip_gw", cfg.gateway.toString());
  prefs.putString("ip_mask", cfg.subnet.toString());
  prefs.putString("ip_dns", cfg.dns.toString());
}

String loadPin() {
  return prefs.getString("pin", "1234");
}

void savePin(const String& pin) {
  prefs.putString("pin", pin);
}

bool hasTouchCalibration() {
  return prefs.getBool("touch_valid", false);
}

TouchCalibration loadTouchCalibration() {
  TouchCalibration cal;
  cal.valid = prefs.getBool("touch_valid", false);
  cal.xMin = prefs.getUShort("touch_x_min", 0);
  cal.xMax = prefs.getUShort("touch_x_max", 4095);
  cal.yMin = prefs.getUShort("touch_y_min", 0);
  cal.yMax = prefs.getUShort("touch_y_max", 4095);
  return cal;
}

void saveTouchCalibration(const TouchCalibration& cal) {
  prefs.putBool("touch_valid", true);
  prefs.putUShort("touch_x_min", cal.xMin);
  prefs.putUShort("touch_x_max", cal.xMax);
  prefs.putUShort("touch_y_min", cal.yMin);
  prefs.putUShort("touch_y_max", cal.yMax);
}

}  // namespace storage
