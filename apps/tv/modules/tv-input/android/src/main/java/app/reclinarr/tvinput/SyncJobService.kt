package app.reclinarr.tvinput

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import kotlin.concurrent.thread

class SyncJobService : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    thread(name = "reclinarr-tv-sync") {
      val reschedule = try {
        ChannelSync(applicationContext).run()
        false
      } catch (e: SignInRequired) {
        Log.e(TAG, "Channel sync needs a fresh sign-in", e)
        false
      } catch (e: Exception) {
        Log.e(TAG, "Channel sync failed", e)
        true
      }
      jobFinished(params, reschedule)
    }
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean = true

  companion object {
    private const val TAG = "ReclinarrTvInput"
    private const val PERIODIC_JOB_ID = 0x7ec1
    private const val ONE_SHOT_JOB_ID = 0x7ec2
    // Android's minimum period. Each run is a cheap favourites check; ChannelSync only
    // downloads the guide when channels were added or it is stale.
    private const val PERIOD_MS = 15 * 60_000L

    // NETWORK_TYPE_ANY also demands an internet-validated network; self-hosted servers are often
    // reachable on LANs that never validate (blocked internet, DNS sinkholes, partial connectivity).
    private val LAN_NETWORK = NetworkRequest.Builder()
      .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .build()

    fun schedulePeriodic(context: Context) {
      val scheduler = scheduler(context)
      // Rescheduling an existing periodic job would reset its timer on every app launch;
      // only replace it when an older install scheduled a different period.
      if (scheduler.getPendingJob(PERIODIC_JOB_ID)?.intervalMillis == PERIOD_MS) return
      scheduler.schedule(
        JobInfo.Builder(PERIODIC_JOB_ID, component(context))
          .setRequiredNetwork(LAN_NETWORK)
          .setPeriodic(PERIOD_MS)
          .setPersisted(true)
          .build(),
      )
    }

    /** Scheduling under the same id replaces a pending run, so bursts coalesce into one sync. */
    fun requestNow(context: Context) {
      scheduler(context).schedule(
        JobInfo.Builder(ONE_SHOT_JOB_ID, component(context))
          .setRequiredNetwork(LAN_NETWORK)
          .build(),
      )
    }

    fun cancelAll(context: Context) {
      scheduler(context).cancel(PERIODIC_JOB_ID)
      scheduler(context).cancel(ONE_SHOT_JOB_ID)
    }

    private fun scheduler(context: Context) = context.getSystemService(JobScheduler::class.java)

    private fun component(context: Context) = ComponentName(context, SyncJobService::class.java)
  }
}
