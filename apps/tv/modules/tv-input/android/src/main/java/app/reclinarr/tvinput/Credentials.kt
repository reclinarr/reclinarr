package app.reclinarr.tvinput

import android.content.Context

data class Credentials(val serverUrl: String, val sessionId: String)

/** The TV input service and sync job run without React Native, so they cannot read AsyncStorage. */
object CredentialStore {
  private const val PREFS = "reclinarr.tvinput"
  private const val SERVER_URL = "serverUrl"
  private const val SESSION_ID = "sessionId"

  fun load(context: Context): Credentials? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val serverUrl = prefs.getString(SERVER_URL, null) ?: return null
    val sessionId = prefs.getString(SESSION_ID, null) ?: return null
    return Credentials(serverUrl, sessionId)
  }

  fun save(context: Context, credentials: Credentials) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString(SERVER_URL, credentials.serverUrl)
      .putString(SESSION_ID, credentials.sessionId)
      .apply()
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
  }
}
