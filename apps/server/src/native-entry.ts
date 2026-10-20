import { runNativeLauncher } from "./native-launcher.js";
const [root, data, projects] = process.argv.slice(2);
if (!root || !data || !projects || process.argv.length !== 5)
  throw new Error("runtime.arguments");
await runNativeLauncher(root, data, projects);
