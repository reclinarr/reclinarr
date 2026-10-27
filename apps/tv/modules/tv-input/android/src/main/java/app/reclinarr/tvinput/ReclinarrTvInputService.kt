package app.reclinarr.tvinput

import android.content.Context
import android.graphics.Color
import android.media.tv.TvContract
import android.media.tv.TvInputManager
import android.media.tv.TvInputService
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.Surface
import android.view.View
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import java.util.concurrent.Executors

class ReclinarrTvInputService : TvInputService() {
  override fun onCreateSession(inputId: String): Session = LiveSession(this)
}

private class LiveSession(private val context: Context) : TvInputService.Session(context) {
  private val main = Handler(Looper.getMainLooper())
  // Single thread keeps /play and /stop calls in tune order, so a slow older tune can't steal the viewer slot.
  private val network = Executors.newSingleThreadExecutor()
  private var tuneGeneration = 0
  private var tunedUuid: String? = null
  private var errorView: TextView? = null
  private var errorMessage: String? = null

  // Same live buffering as apps/tv/src/NativeVideoSurface.tsx LIVE_BUFFER_CONFIG.
  private val player = ExoPlayer.Builder(context)
    .setMediaSourceFactory(
      DefaultMediaSourceFactory(
        DefaultHttpDataSource.Factory()
          // The TS route sends no headers until Dispatcharr starts the upstream stream, which
          // regularly takes longer than ExoPlayer's 8s default; the in-app player has no read timeout.
          .setReadTimeoutMs(STREAM_START_TIMEOUT_MS)
          .setConnectTimeoutMs(CONNECT_TIMEOUT_MS),
      ),
    )
    .setLoadControl(
      DefaultLoadControl.Builder()
        .setBufferDurationsMs(2_000, 8_000, 1_000, 2_000)
        .build(),
    )
    .build()

  init {
    player.addListener(object : Player.Listener {
      override fun onRenderedFirstFrame() {
        notifyVideoAvailable()
      }

      override fun onPlayerError(error: PlaybackException) {
        Log.e(TAG, "Playback failed for $tunedUuid", error)
        showError(GENERIC_ERROR)
      }
    })
    setOverlayViewEnabled(true)
  }

  override fun onTune(channelUri: Uri): Boolean {
    val generation = ++tuneGeneration
    player.stop()
    showError(null)
    notifyVideoUnavailable(TvInputManager.VIDEO_UNAVAILABLE_REASON_TUNING)
    network.execute {
      val result = runCatching {
        val credentials = CredentialStore.load(context) ?: throw SignInRequired()
        val uuid = channelUuid(channelUri)
        uuid to ReclinarrApi(credentials).play(uuid)
      }
      main.post {
        if (generation != tuneGeneration) return@post
        result
          .onSuccess { (uuid, url) ->
            tunedUuid = uuid
            player.setMediaItem(
              MediaItem.Builder()
                .setUri(url)
                .setLiveConfiguration(
                  MediaItem.LiveConfiguration.Builder()
                    .setTargetOffsetMs(3_000)
                    .setMinOffsetMs(1_500)
                    .setMaxOffsetMs(10_000)
                    .build(),
                )
                .build(),
            )
            player.prepare()
            player.playWhenReady = true
          }
          .onFailure { e ->
            Log.e(TAG, "Tune failed for $channelUri", e)
            showError(if (e is SignInRequired) SIGN_IN_ERROR else GENERIC_ERROR)
          }
      }
    }
    return true
  }

  override fun onSetSurface(surface: Surface?): Boolean {
    player.setVideoSurface(surface)
    return true
  }

  override fun onSetStreamVolume(volume: Float) {
    player.volume = volume
  }

  override fun onSetCaptionEnabled(enabled: Boolean) = Unit

  override fun onCreateOverlayView(): View =
    TextView(context).apply {
      setTextColor(Color.WHITE)
      textSize = 22f
      gravity = Gravity.CENTER
      text = errorMessage
      visibility = if (errorMessage == null) View.GONE else View.VISIBLE
      errorView = this
    }

  override fun onRelease() {
    tuneGeneration++
    player.release()
    val uuid = tunedUuid
    if (uuid != null) {
      network.execute {
        val credentials = CredentialStore.load(context) ?: return@execute
        runCatching { ReclinarrApi(credentials).stop(uuid) }
          .onFailure { Log.e(TAG, "Stop failed for $uuid", it) }
      }
    }
    network.shutdown()
  }

  private fun channelUuid(channelUri: Uri): String {
    val cursor = requireNotNull(
      context.contentResolver.query(
        channelUri,
        arrayOf(TvContract.Channels.COLUMN_INTERNAL_PROVIDER_ID),
        null,
        null,
        null,
      ),
    ) { "TvProvider returned no cursor for $channelUri" }
    return cursor.use {
      check(it.moveToFirst()) { "Channel $channelUri not found" }
      it.getString(0)
    }
  }

  private fun showError(message: String?) {
    errorMessage = message
    if (message != null) notifyVideoUnavailable(TvInputManager.VIDEO_UNAVAILABLE_REASON_UNKNOWN)
    errorView?.apply {
      text = message
      visibility = if (message == null) View.GONE else View.VISIBLE
    }
  }

  private companion object {
    const val TAG = "ReclinarrTvInput"
    const val GENERIC_ERROR = "This channel is unavailable right now"
    const val SIGN_IN_ERROR = "Open Reclinarr and sign in again"
    const val STREAM_START_TIMEOUT_MS = 60_000
    const val CONNECT_TIMEOUT_MS = 15_000
  }
}
