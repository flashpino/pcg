#ifndef LV_CONF_H
#define LV_CONF_H

// Minimal: lv_conf_internal.h preenche todo o resto com #ifndef/#define default —
// só o que diverge do padrão da LVGL 8.3 está aqui.

#define LV_COLOR_DEPTH 16
#define LV_COLOR_16_SWAP 0

#define LV_MEM_CUSTOM 0
#define LV_MEM_SIZE (48U * 1024U)

#define LV_TICK_CUSTOM 1
#define LV_TICK_CUSTOM_INCLUDE "Arduino.h"
#define LV_TICK_CUSTOM_SYS_TIME_EXPR (millis())

#define LV_USE_LOG 0
#define LV_USE_PERF_MONITOR 0

#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_20 1
#define LV_FONT_MONTSERRAT_32 1
#define LV_FONT_DEFAULT &lv_font_montserrat_14

#define LV_USE_CHART 1
#define LV_USE_BTNMATRIX 1
#define LV_USE_KEYBOARD 1
#define LV_USE_TEXTAREA 1
#define LV_USE_LIST 1
#define LV_USE_MSGBOX 1

#endif
