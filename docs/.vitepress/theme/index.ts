import DefaultTheme from "vitepress/theme-without-fonts";
import Layout from "./Layout.vue";
import "../../../design/tokens.css";
import "../../../design/stone-surfaces.css";
import "./custom.css";

export default { extends: DefaultTheme, Layout };
