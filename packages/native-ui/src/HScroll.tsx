import type { ReactNode } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

type Props = {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
};

/**
 * Horizontal strip for web rails / cast rows.
 *
 * Axis separation matches the browser (and Netflix browse):
 * - vertical wheel / trackpad → page scroll (we do not intercept it)
 * - horizontal trackpad swipe / shift+wheel → this strip via overflow-x
 */
export function HScroll({ children, contentContainerStyle, style }: Props) {
  if (Platform.OS !== "web") {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={style}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.wrap, style]}>
      <View
        {...({ dataSet: { seHscroll: "1" } } as object)}
        style={[styles.scroller, contentContainerStyle] as StyleProp<ViewStyle>}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
  },
  scroller: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
});
