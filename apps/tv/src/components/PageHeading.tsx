import { StyleSheet, Text, View } from "react-native";
import { useTvLayout } from "../layout";

export function PageHeading({ title }: { title: string }) {
  const layout = useTvLayout();
  return (
    <View style={{ paddingTop: layout.headerH + 28, paddingHorizontal: layout.pageX, paddingBottom: 8 }}>
      <Text style={styles.pageTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pageTitle: { color: "#fff", fontSize: 32, fontWeight: "700", letterSpacing: -0.4 },
});
