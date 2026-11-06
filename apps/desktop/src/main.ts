import { createApp } from "vue";
import RuntimeGate from "./components/RuntimeGate.vue";
import { i18n, initializeLocale } from "./i18n";
import "./preferences";
import "./tokens.css";
import "../../../design/stone-surfaces.css";
import "./style.css";
import "./editor.css";
import "./relink.css";
import "./source.css";
import "./export-report.css";
import "./product.css";
import "./versions.css";
import "./tobiishi.css";

async function start() {
  await initializeLocale();
  createApp(RuntimeGate).use(i18n).mount("#app");
}

void start();
