import { useRef } from "react";
import { Pressable, StyleSheet, TextInput, type TextInputProps } from "react-native";
import { isTvFocused } from "@reclinarr/native-ui";

/**
 * TV remote: D-pad must land on a Pressable. A focused TextInput hands keys to the
 * system IME, which on many Google TVs drops them (InputEventSender status=-32).
 */
export function TvTextInput({ hasTVPreferredFocus, style, ...props }: TextInputProps) {
  const ref = useRef<TextInput>(null);
  return (
    <Pressable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={() => ref.current?.focus()}
      style={(state) => [styles.wrap, isTvFocused(state) && styles.wrapFocused]}
    >
      <TextInput ref={ref} {...props} style={style} showSoftInputOnFocus focusable={false} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: 6,
  },
  wrapFocused: {
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.1)",
    transform: [{ scale: 1.02 }],
  },
});
