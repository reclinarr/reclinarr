package app.reclinarr.tvinput

import android.net.Uri
import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import org.json.JSONObject

class SignInRequired : IOException("Reclinarr session missing or expired; sign in again in the app")

class ApiError(val status: Int, message: String) : IOException(message)

class ReclinarrApi(private val credentials: Credentials) {
  fun dispatcharrStatus(): String {
    val providers = JSONObject(request("GET", "/api/health/providers")).getJSONArray("providers")
    for (i in 0 until providers.length()) {
      val provider = providers.getJSONObject(i)
      if (provider.getString("id") == "dispatcharr") return provider.getString("status")
    }
    throw IllegalStateException("Server health has no dispatcharr provider")
  }

  fun favouriteChannels(): List<ApiChannel> {
    val channels = mutableListOf<ApiChannel>()
    var page = 1
    while (true) {
      val body = JSONObject(
        request("GET", "/api/live/channels?favouritesOnly=1&sort=number&pageSize=$PAGE_SIZE&page=$page"),
      )
      val items = body.getJSONArray("items")
      for (i in 0 until items.length()) {
        val item = items.getJSONObject(i)
        channels.add(
          ApiChannel(
            uuid = item.getString("uuid"),
            name = item.getString("name"),
            number = if (item.isNull("number")) null else item.getDouble("number"),
            logoPath = item.stringOrNull("logoUrl"),
            tvgId = item.stringOrNull("tvgId"),
          ),
        )
      }
      if (items.length() == 0 || channels.size >= body.getInt("total")) return channels
      page++
    }
  }

  fun guide(startMs: Long, endMs: Long): List<ApiProgramme> {
    val start = URLEncoder.encode(Instant.ofEpochMilli(startMs).toString(), "UTF-8")
    val end = URLEncoder.encode(Instant.ofEpochMilli(endMs).toString(), "UTF-8")
    val items = JSONObject(request("GET", "/api/live/guide?start=$start&end=$end")).getJSONArray("items")
    return (0 until items.length()).map { i ->
      val item = items.getJSONObject(i)
      ApiProgramme(
        channelId = item.getString("channelId"),
        channelUuid = item.stringOrNull("channelUuid"),
        title = item.getString("title"),
        description = item.stringOrNull("description"),
        startMs = GuideMapping.parseIsoMillis(item.getString("startsAt")),
        endMs = GuideMapping.parseIsoMillis(item.getString("endsAt")),
      )
    }
  }

  /** Tunes the channel server-side and returns the MPEG-TS URL with auth in the query string. */
  fun play(uuid: String): String {
    val body = JSONObject().put("hls", false)
    val response = JSONObject(request("POST", "/api/live/play/${Uri.encode(uuid)}", body))
    return mediaUrl(response.getJSONObject("source").getJSONObject("delivery").getString("url"))
  }

  fun stop(uuid: String) {
    request("POST", "/api/live/stop", JSONObject().put("uuid", uuid))
  }

  fun download(path: String, out: OutputStream) {
    val conn = open("GET", mediaUrl(path))
    try {
      checkStatus(conn, "GET", path)
      conn.inputStream.use { it.copyTo(out) }
    } finally {
      conn.disconnect()
    }
  }

  /** Mirrors playbackMediaUrl in packages/client: only /api/ paths get the session param. */
  private fun mediaUrl(path: String): String {
    val absolute = if (path.startsWith("http://") || path.startsWith("https://")) path else credentials.serverUrl + path
    val uri = Uri.parse(absolute)
    if (uri.path?.startsWith("/api/") != true) return absolute
    return uri.buildUpon().appendQueryParameter(SESSION_PARAM, credentials.sessionId).build().toString()
  }

  private fun request(method: String, path: String, body: JSONObject? = null): String {
    val conn = open(method, credentials.serverUrl + path)
    try {
      conn.setRequestProperty("Accept", "application/json")
      if (body != null) {
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
      }
      checkStatus(conn, method, path)
      return conn.inputStream.bufferedReader().use { it.readText() }
    } finally {
      conn.disconnect()
    }
  }

  private fun open(method: String, url: String): HttpURLConnection =
    (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = CONNECT_TIMEOUT_MS
      // The guide route waits up to 60s on Dispatcharr's grid.
      readTimeout = READ_TIMEOUT_MS
      setRequestProperty(SESSION_HEADER, credentials.sessionId)
    }

  private fun checkStatus(conn: HttpURLConnection, method: String, path: String) {
    val status = conn.responseCode
    if (status == 401) throw SignInRequired()
    if (status !in 200..299) {
      val detail = conn.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
      throw ApiError(status, "$method $path failed: HTTP $status $detail")
    }
  }

  private fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else getString(key)

  private companion object {
    const val PAGE_SIZE = 100
    const val SESSION_HEADER = "x-reclinarr-session"
    const val SESSION_PARAM = "reclinarr_session"
    const val CONNECT_TIMEOUT_MS = 15_000
    const val READ_TIMEOUT_MS = 90_000
  }
}
