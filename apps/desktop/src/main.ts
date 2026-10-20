import { createApp } from "vue";
import RuntimeGate from "./components/RuntimeGate.vue";
import { i18n } from "./i18n";
import "./preferences";
import "./tokens.css";
import "./style.css";
import "./editor.css";
import "./relink.css";
import "./source.css";
import "./export-report.css";
import "./product.css";
import "./versions.css";

createApp(RuntimeGate).use(i18n).mount("#app");
