const { withAndroidManifest, createRunOncePlugin } = require("expo/config-plugins");

/**
 * RECORD_AUDIO implies android.hardware.microphone. Mark it optional so
 * Leanback / Google TV devices without a built-in mic stay installable;
 * remote microphones still work with SpeechRecognizer.
 */
function withOptionalMicrophone(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (!manifest["uses-feature"]) {
      manifest["uses-feature"] = [];
    }
    const features = manifest["uses-feature"];
    const existing = features.find(
      (f) => f.$?.["android:name"] === "android.hardware.microphone",
    );
    if (existing) {
      existing.$["android:required"] = "false";
    } else {
      features.push({
        $: {
          "android:name": "android.hardware.microphone",
          "android:required": "false",
        },
      });
    }
    return config;
  });
}

module.exports = createRunOncePlugin(
  withOptionalMicrophone,
  "withOptionalMicrophone",
  "1.0.0",
);
