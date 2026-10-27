package app.reclinarr.tvinput

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TvInputModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReclinarrTvInput")

    Function("setCredentials") { serverUrl: String, sessionId: String ->
      val context = context()
      CredentialStore.save(context, Credentials(serverUrl, sessionId))
      SyncJobService.schedulePeriodic(context)
    }

    Function("requestSync") {
      SyncJobService.requestNow(context())
    }

    AsyncFunction("clearCredentials") {
      val context = context()
      SyncJobService.cancelAll(context)
      CredentialStore.clear(context)
      ChannelSync(context).teardown()
    }
  }

  private fun context(): Context = requireNotNull(appContext.reactContext) { "React context unavailable" }
}
