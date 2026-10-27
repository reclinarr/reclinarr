package app.reclinarr.tvinput

import android.app.Activity
import android.os.Bundle

/** Required by TIF. Channels come from the app's favourites, so there is nothing to configure here. */
class SetupActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (CredentialStore.load(this) == null) {
      startActivity(requireNotNull(packageManager.getLeanbackLaunchIntentForPackage(packageName)) {
        "No leanback launch intent for $packageName"
      })
      setResult(RESULT_CANCELED)
    } else {
      SyncJobService.requestNow(this)
      setResult(RESULT_OK)
    }
    finish()
  }
}
