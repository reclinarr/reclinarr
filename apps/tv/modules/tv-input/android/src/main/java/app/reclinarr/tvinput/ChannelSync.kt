package app.reclinarr.tvinput

import android.content.ComponentName
import android.content.ContentProviderOperation
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.media.tv.TvContract
import android.util.Log
import java.io.IOException

/** Mirrors the user's favourite live channels and their EPG into TvContract. */
class ChannelSync(context: Context) {
  private val context = context.applicationContext
  private val resolver = this.context.contentResolver
  private val serviceComponent = ComponentName(this.context, ReclinarrTvInputService::class.java)
  private val inputId = TvContract.buildInputId(serviceComponent)
  private val syncPrefs = this.context.getSharedPreferences(SYNC_PREFS, Context.MODE_PRIVATE)

  fun run(): Unit = synchronized(LOCK) {
    val credentials = CredentialStore.load(context)
    if (credentials == null) {
      teardownLocked()
      return
    }
    val api = ReclinarrApi(credentials)
    when (val status = api.dispatcharrStatus()) {
      "ok" -> Unit
      "unconfigured" -> {
        teardownLocked()
        return
      }
      // Don't wipe the guide over a transient outage.
      else -> throw IOException("Dispatcharr is $status; keeping existing channels")
    }
    setInputEnabled(true)

    val channels = api.favouriteChannels()
    val inserted = applyChannels(api, GuideMapping.channelRows(channels))

    val now = System.currentTimeMillis()
    val lastGuideSync = syncPrefs.getLong(LAST_GUIDE_SYNC_MS, 0L).takeIf { it > 0 }
    if (!GuideMapping.guideRefreshDue(inserted, lastGuideSync, now, GUIDE_MAX_AGE_MS)) {
      Log.i(TAG, "Synced ${channels.size} channels; guide still fresh")
      return
    }
    val start = now - GUIDE_PAST_MS
    val end = now + GUIDE_FUTURE_MS
    val programmes = (start until end step GUIDE_WINDOW_MS).flatMap { windowStart ->
      api.guide(windowStart, minOf(windowStart + GUIDE_WINDOW_MS, end))
    }
    applyPrograms(GuideMapping.programRows(channels, programmes))
    syncPrefs.edit().putLong(LAST_GUIDE_SYNC_MS, now).apply()
    Log.i(TAG, "Synced ${channels.size} channels, ${programmes.size} guide items")
  }

  fun teardown(): Unit = synchronized(LOCK) { teardownLocked() }

  private fun teardownLocked() {
    // Programs cascade-delete with their channels.
    resolver.delete(TvContract.buildChannelsUriForInput(inputId), null, null)
    syncPrefs.edit().remove(LAST_GUIDE_SYNC_MS).apply()
    setInputEnabled(false)
  }

  /** Returns how many channels were inserted. */
  private fun applyChannels(api: ReclinarrApi, wanted: List<ChannelRow>): Int {
    val diff = GuideMapping.diff(existingChannels().values.toList(), wanted)
    val ops = ArrayList<ContentProviderOperation>()
    diff.delete.forEach { ops.add(ContentProviderOperation.newDelete(channelUri(it)).build()) }
    diff.update.forEach { ops.add(ContentProviderOperation.newUpdate(channelUri(it.rowId)).withValues(channelValues(it.row)).build()) }
    diff.insert.forEach { ops.add(ContentProviderOperation.newInsert(TvContract.Channels.CONTENT_URI).withValues(channelValues(it)).build()) }
    if (ops.isEmpty()) return 0
    val results = resolver.applyBatch(TvContract.AUTHORITY, ops)

    val insertedIds = results.takeLast(diff.insert.size).map { ContentUris.parseId(requireNotNull(it.uri)) }
    val logos = diff.insert.zip(insertedIds) { row, id -> id to row.logoPath } +
      diff.update.filter { it.logoChanged }.map { it.rowId to it.row.logoPath }
    for ((rowId, logoPath) in logos) {
      if (logoPath == null) continue
      val out = requireNotNull(resolver.openOutputStream(TvContract.buildChannelLogoUri(rowId))) {
        "No logo stream for channel $rowId"
      }
      out.use { api.download(logoPath, it) }
    }
    return diff.insert.size
  }

  private fun applyPrograms(programs: List<ProgramRow>) {
    val channelIds = existingChannels().mapValues { it.value.rowId }
    for (rowId in channelIds.values) {
      resolver.delete(TvContract.buildProgramsUriForChannel(rowId), null, null)
    }
    val values = programs.map { program ->
      ContentValues().apply {
        put(TvContract.Programs.COLUMN_CHANNEL_ID, channelIds.getValue(program.channelUuid))
        put(TvContract.Programs.COLUMN_TITLE, program.title)
        put(TvContract.Programs.COLUMN_SHORT_DESCRIPTION, program.description)
        put(TvContract.Programs.COLUMN_START_TIME_UTC_MILLIS, program.startMs)
        put(TvContract.Programs.COLUMN_END_TIME_UTC_MILLIS, program.endMs)
      }
    }
    if (values.isNotEmpty()) resolver.bulkInsert(TvContract.Programs.CONTENT_URI, values.toTypedArray())
  }

  private fun existingChannels(): Map<String, ExistingChannel> {
    val projection = arrayOf(
      TvContract.Channels._ID,
      TvContract.Channels.COLUMN_INTERNAL_PROVIDER_ID,
      TvContract.Channels.COLUMN_DISPLAY_NUMBER,
      TvContract.Channels.COLUMN_DISPLAY_NAME,
      TvContract.Channels.COLUMN_INTERNAL_PROVIDER_DATA,
    )
    val cursor = requireNotNull(resolver.query(TvContract.buildChannelsUriForInput(inputId), projection, null, null, null)) {
      "TvProvider returned no cursor"
    }
    return cursor.use {
      buildMap {
        while (it.moveToNext()) {
          val row = ChannelRow(
            uuid = it.getString(1),
            displayNumber = it.getString(2),
            displayName = it.getString(3),
            logoPath = it.getBlob(4)?.toString(Charsets.UTF_8),
          )
          put(row.uuid, ExistingChannel(it.getLong(0), row))
        }
      }
    }
  }

  private fun channelValues(row: ChannelRow) = ContentValues().apply {
    put(TvContract.Channels.COLUMN_INPUT_ID, inputId)
    put(TvContract.Channels.COLUMN_TYPE, TvContract.Channels.TYPE_OTHER)
    put(TvContract.Channels.COLUMN_SERVICE_TYPE, TvContract.Channels.SERVICE_TYPE_AUDIO_VIDEO)
    put(TvContract.Channels.COLUMN_DISPLAY_NUMBER, row.displayNumber)
    put(TvContract.Channels.COLUMN_DISPLAY_NAME, row.displayName)
    put(TvContract.Channels.COLUMN_INTERNAL_PROVIDER_ID, row.uuid)
    // Remembered so the next sync only re-downloads logos that changed.
    put(TvContract.Channels.COLUMN_INTERNAL_PROVIDER_DATA, row.logoPath?.toByteArray(Charsets.UTF_8))
  }

  private fun channelUri(rowId: Long) = TvContract.buildChannelUri(rowId)

  private fun setInputEnabled(enabled: Boolean) {
    val state = if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
    if (context.packageManager.getComponentEnabledSetting(serviceComponent) == state) return
    // Without DONT_KILL_APP the system kills our process, including a running app session.
    context.packageManager.setComponentEnabledSetting(serviceComponent, state, PackageManager.DONT_KILL_APP)
  }

  companion object {
    private const val TAG = "ReclinarrTvInput"
    private val LOCK = Any()
    private const val GUIDE_PAST_MS = 60 * 60_000L
    private const val GUIDE_FUTURE_MS = 12 * 60 * 60_000L
    // The guide route returns every channel in the lineup; small windows keep Dispatcharr under its 60s timeout.
    private const val GUIDE_WINDOW_MS = 4 * 60 * 60_000L
    // The guide covers 12h ahead, so a 4h refresh always leaves at least 8h of programmes.
    private const val GUIDE_MAX_AGE_MS = 4 * 60 * 60_000L
    private const val SYNC_PREFS = "reclinarr.tvinput.sync"
    private const val LAST_GUIDE_SYNC_MS = "lastGuideSyncMs"
  }
}
