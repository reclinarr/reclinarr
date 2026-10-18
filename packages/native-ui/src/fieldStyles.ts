import { Platform, StyleSheet } from "react-native";
import { colors } from "./theme.js";

/** Shared TextInput look — fixed height so RN-web placeholders stay vertically centered. */
export const fieldStyles = StyleSheet.create({
  input: {
    backgroundColor: colors.bg2,
    color: colors.text,
    fontSize: 16,
    height: 48,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "web" ? 0 : 12,
    borderRadius: 8,
    marginBottom: 12,
    textAlignVertical: "center",
    ...(Platform.OS === "web"
      ? ({
          outlineStyle: "none",
          lineHeight: 20,
        } as object)
      : null),
  },
});
