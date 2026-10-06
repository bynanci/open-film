import app from "../modules/app/en-US";
import editor from "../modules/editor/en-US";
import media from "../modules/media/en-US";
import precision from "../modules/precision/en-US";
import transcript from "../modules/transcript/en-US";
import system from "./system-en-US";

export default {
  ...system,
  ...app,
  ...editor,
  ...media,
  ...precision,
  ...transcript,
};
