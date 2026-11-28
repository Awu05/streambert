package com.awu05.streambert

import android.content.Context

class Prefs(context: Context) {
    private val preferences = context.getSharedPreferences("streambert", Context.MODE_PRIVATE)

    var serverOrigin: String?
        get() = preferences.getString("serverOrigin", null)
        set(value) = preferences.edit().putString("serverOrigin", value).apply()

    var lastUpdateCheck: Long
        get() = preferences.getLong("lastUpdateCheck", 0)
        set(value) = preferences.edit().putLong("lastUpdateCheck", value).apply()

    var readyUpdateFile: String?
        get() = preferences.getString("readyUpdateFile", null)
        set(value) = preferences.edit().putString("readyUpdateFile", value).apply()
}
