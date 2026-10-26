import { mergeConfig } from "vite";
import baseConfig from "../../vite.config.js";

export default mergeConfig(baseConfig, {
  server: { hmr: false },
  plugins: [{
    name: "retained-document-browser-tests",
    enforce: "post",
    transform(code, id) {
      if (!id.endsWith("/vite/dist/client/client.mjs")) return;
      // hmr:false disables updates, but Vite 7's client still opens a socket
      // and reloads on reconnect. Keep its CSS helpers without that connection.
      const connect = "transport.connect(createHMRHandler(handleMessage));";
      if (!code.includes(connect)) throw new Error("Update the browser-test Vite client guard after upgrading Vite");
      return { code: code.replace(connect, "/* HMR connection disabled for retained-page tests. */"), map: null };
    },
  }],
});
