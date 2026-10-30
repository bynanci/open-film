// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import * as state from "../../apps/desktop/src/local-presets.js";
import { presetPackage } from "../fixtures/local-presets/package.js";
it("new request, cancel and project switch invalidate earlier async recipe results",()=>{
 const scope=state.createPresetTaskScope(),first=scope.begin(),second=scope.begin();expect(first.signal.aborted).toBe(true);expect(first.current()).toBe(false);expect(second.current()).toBe(true);scope.cancel();expect(second.signal.aborted).toBe(true);expect(second.current()).toBe(false);
});
it("validates bounded local File bytes and stops after cancellation before a response",async()=>{
 const document=JSON.stringify(presetPackage()),bytes=new TextEncoder().encode(document);expect(await state.readPresetFileSelection({size:bytes.length,arrayBuffer:async()=>bytes.buffer} as File)).toBe(document);await expect(state.readPresetFileSelection({size:262145,arrayBuffer:async()=>new ArrayBuffer(0)} as File)).rejects.toThrow();const controller=new AbortController();controller.abort();await expect(state.readPresetFileSelection({size:0,arrayBuffer:async()=>new ArrayBuffer(0)} as File,controller.signal)).rejects.toThrow();
});
