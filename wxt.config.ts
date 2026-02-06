import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "OLI Error Assistant",
    description: "Captures error messages from pages and suggests known fixes.",
    permissions: ["activeTab", "storage"],
    host_permissions: ["https://fc.hive.app/*"],
  },
});
