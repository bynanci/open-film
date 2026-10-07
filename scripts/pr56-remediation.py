import os, pathlib, subprocess, sys, json

pr = sys.argv[1]
parents = {'5':'a4244f446c86ae0a32f41979f2bb2d515fa58730','6':'b55f1ec0ab42cbc279ab909bd83f8206b0a4e4a5'}
parent = parents[pr]
evidence = pathlib.Path(os.environ['RUNNER_TEMP']) / ('openfilm-pr' + pr)
evidence.mkdir(parents=True, exist_ok=True)

def run(args, name, expect_failure=False):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (evidence / (name + '.log')).write_text(result.stdout)
    print(name, 'exit', result.returncode, flush=True)
    if (result.returncode == 0) == expect_failure:
        print(result.stdout[-15000:], flush=True)
        raise RuntimeError('Unexpected result: ' + name)
    return result.stdout

def write(path, content):
    p = pathlib.Path(path); p.parent.mkdir(parents=True, exist_ok=True); p.write_text(content)

def replace(path, before, after):
    p = pathlib.Path(path); source = p.read_text()
    if source.count(before) != 1:
        raise RuntimeError(f'Expected one replacement in {path}: {before[:120]}')
    p.write_text(source.replace(before, after))

run(['git','checkout','--detach',parent], 'checkout')
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip() == parent
run(['pnpm','install','--frozen-lockfile'], 'install')
changed = []

if pr == '5':
    test = 'tests/e2e/geometry-contract.spec.ts'
    write(test, r'''import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess } from "@openfilm/media";
import { initialLocale, navigate, openFilm, uiText } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310/api";
let root: string;
test.use({ viewport: { width: 1280, height: 1000 } });
test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${base}/project/close`, { data: {} })).ok()).toBe(true);
  root = await mkdtemp(join(tmpdir(), "openfilm-geometry-ui-"));
  const media = join(root, "media");
  await mkdir(media);
  await runProcess("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=red:s=80x40", "-frames:v", "1", "-threads", "1", "-y", join(media, "source.png")]);
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(directory, "Geometry regression");
  try {
    await app.importFolder(media);
    const asset = app.catalog.listAssets()[0]!;
    app.project.stories.push({id:"story",title:"Geometry",targetDuration:2,maxDuration:10,beats:[{id:"beat",title:"Frame",candidateAssetIds:[asset.id]}]});
    app.project.timelines.push({id:"cut",storyId:"story",duration:2,tracks:[{id:"video",type:"video",clips:[{id:"clip",beatId:"beat",assetId:asset.id,timelineStart:0,timelineDuration:2}]}]});
    await app.save();
  } finally { app.close(); }
  await initialLocale(page);
  await page.goto("/");
  await openFilm(page, directory);
  await navigate(page, "edit");
  await page.locator(".editor-clip").first().click();
  await expect.poll(() => page.locator(".editor-composition-frame img").evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});
test.afterEach(async ({ request }) => {
  await request.post(`${base}/project/close`, {data:{}});
  if (root) await rm(root,{recursive:true,force:true});
});

test("transient geometry fields do not throw during preview rendering", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const field of ["scale", "rotation", "x", "y"]) {
    const input = page.getByLabel(uiText("en-US", `editor.clip.${field}Label`), {exact:true});
    const before = await input.inputValue();
    await input.fill("");
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    expect(errors).toEqual([]);
    await expect(page.locator(".editor-composition-frame")).toBeVisible();
    await input.fill(before);
    await input.press("Tab");
  }
  expect(errors).toEqual([]);
});

test("preview refits when only the inspector changes its grid column", async ({ page }) => {
  const viewport = page.locator(".editor-source-screen");
  const frame = page.locator(".editor-composition-frame");
  const toggle = page.locator('button[aria-controls="timeline-inspector"]');
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const before = await viewport.evaluate(el => el.clientWidth);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => viewport.evaluate(el => el.clientWidth)).toBeGreaterThan(before + 10);
  for (let iteration = 0; iteration < 2; iteration++) {
    await expect.poll(async () => {
      const bounds = await viewport.evaluate(el => ({width:el.clientWidth,height:el.clientHeight}));
      const actual = await frame.boundingBox();
      const scale = Math.min(bounds.width / 1920, bounds.height / 1080);
      return Math.max(Math.abs(actual!.width - 1920 * scale), Math.abs(actual!.height - 1080 * scale));
    }).toBeLessThan(1);
    if (iteration === 0) await toggle.click();
  }
});
''')
    run(['pnpm','exec','playwright','install','--with-deps','chromium'], 'browser-install')
    run(['pnpm','exec','playwright','test',test,'--retries=0'], 'geometry-red', True)
    helper = 'apps/desktop/src/previewGeometry.ts'
    write(helper, r'''import { resolveClipGeometry, type ClipTransform } from "@openfilm/core";

/** Draft inputs may temporarily contain strings. Keep committed geometry visible. */
export function previewDraftGeometry(
  draft: { scale?: unknown; rotation?: unknown; x?: unknown; y?: unknown },
  committed?: ClipTransform,
) {
  const result = resolveClipGeometry(committed);
  for (const key of ["scale", "rotation", "x", "y"] as const) {
    const value = draft[key];
    if (typeof value === "number" && Number.isFinite(value) && (key !== "scale" || value > 0)) result[key] = value;
  }
  return result;
}
''')
    component = 'apps/desktop/src/components/TimelineEditor.vue'
    replace(component, 'import { useTimelineEditor } from "../composables/useTimelineEditor";', 'import { useTimelineEditor } from "../composables/useTimelineEditor";\nimport { previewDraftGeometry } from "../previewGeometry";')
    replace(component, '''  resolvePreviewClipGeometry(
    {
      scale: clipFields.value.scale,
      rotation: clipFields.value.rotation,
      x: clipFields.value.x,
      y: clipFields.value.y,
    },''', '''  resolvePreviewClipGeometry(
    previewDraftGeometry(clipFields.value, selectedClip.value?.transform),''')
    replace(component, '''onMounted(() => {
  inspectorOpen.value''', '''watch(sourceScreenElement, (element, previous) => {
  if (previous) layoutObserver?.unobserve(previous);
  if (element) layoutObserver?.observe(element);
  measureWorkspace();
}, { flush: "post" });
onMounted(() => {
  inspectorOpen.value''')
    replace(component, '''  layoutObserver = new ResizeObserver(measureWorkspace);''', '''  layoutObserver = new ResizeObserver(measureWorkspace);
  if (sourceScreenElement.value) layoutObserver.observe(sourceScreenElement.value);''')
    unit = 'tests/unit/preview-geometry.test.ts'
    write(unit, r'''import { describe, expect, it } from "vitest";
import { resolveClipGeometry } from "@openfilm/core";
import { previewDraftGeometry } from "../../apps/desktop/src/previewGeometry";

describe("draft preview geometry", () => {
  it.each(["", "-", "1e", NaN, Infinity, null])("keeps committed geometry for transient input %s", value => {
    const committed = { scale: 1.2, rotation: 30, x: 120, y: -40 };
    expect(previewDraftGeometry({scale:value,rotation:value,x:value,y:value},committed)).toEqual(committed);
  });
  it("updates valid fields independently and rejects nonpositive draft scale", () => {
    expect(previewDraftGeometry({scale:0,rotation:-15,x:12,y:""},{scale:2,y:20})).toEqual({scale:2,rotation:-15,x:12,y:20});
    expect(() => resolveClipGeometry({scale:0})).toThrow();
  });
});
''')
    changed = [test,helper,component,unit]
    run(['pnpm','exec','prettier','--write',*changed], 'format')
    run(['pnpm','exec','playwright','test',test,'--retries=0'], 'geometry-green')
else:
    app_test = 'packages/application/tests/review-owner-recovery.test.ts'
    replace(app_test, '  it("rejects invalid requested job IDs before creating owned review jobs or invoking a provider", async () => {', r'''  it("manual recovery fences late writes from the previous unknown owner", async () => {
    const context = await fixture();
    const owner = createReviewOwner();
    const job: Job = {id:"late-owner",type:"language-review",assetId:"source",status:"running",reviewOwner:{...owner,host:owner.host+":foreign"},updatedAt:"2026-10-07T00:00:00Z"};
    context.app.catalog.saveJob(job);
    const observed = context.app.knowledge.reviewRecoveryStatus(job.id);
    const recovered = context.app.knowledge.manualRecoverReview(job.id,{confirmStopped:true,ownerToken:observed.ownerToken,updatedAt:observed.updatedAt});
    expect(context.app.catalog.knowledge.saveOwnedReviewJob({...job,progress:1,status:"completed"})).toBe(false);
    expect(context.app.catalog.listJobs().find(item => item.id === job.id)).toEqual(recovered);
  });

  it("rejects invalid requested job IDs before creating owned review jobs or invoking a provider", async () => {''')
    panel_test = 'tests/unit/review-manual-recovery.test.ts'
    write(panel_test, r'''import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { beforeAll, afterEach, it, expect, vi } from "vitest";
import { ApiError } from "../../apps/desktop/src/api";
import type { Job } from "@openfilm/core";
import type { ReviewRecoveryState } from "../../apps/desktop/src/api";
const vue = createRequire(new URL("../../apps/desktop/package.json",import.meta.url))("vue");
let code: string;
const cleanup: Array<() => void> = [];
beforeAll(async () => {
  const source = await readFile(new URL("../../apps/desktop/src/components/ReviewPanel.vue",import.meta.url),"utf8");
  code = (await transform(source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!,{loader:"ts",format:"esm"})).code.replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm,"");
});
afterEach(() => { for (const stop of cleanup.splice(0).reverse()) stop(); vi.unstubAllGlobals(); });
function fixture() {
  vi.stubGlobal("localStorage",{getItem:()=>null,setItem:()=>{},removeItem:()=>{}});
  const job: Job = {id:"job",type:"language-review",assetId:"asset",status:"running"};
  const checkpoint: ReviewRecoveryState = {jobId:job.id,ownerState:"unknown",manualRecoveryAllowed:true,ownerToken:"original",updatedAt:"2026-10-07T00:00:00Z"};
  const emit = vi.fn();
  const api = {
    recoverReview:vi.fn(async () => ({job})),
    reviewSuggestions:vi.fn(async () => ({suggestions:[],total:0,offset:0,limit:100})),
    reviewProvider:vi.fn(async () => ({configured:false})),
    reviewBatches:vi.fn(async () => ({batches:[]})),
    reviewRecovery:vi.fn(async () => checkpoint),
  };
  let dispose = () => {};
  const scope = vue.effectScope();
  const dependencies = {...vue,api,ApiError,post:vi.fn(),useI18n:()=>({t:String}),formatNumber:String,localizeError:String,errorDetail:String,defineProps:()=>({projectId:"project",assetId:"asset",jobs:[job],flush:async()=>true}),defineEmits:()=>emit,defineExpose:()=>{},onMounted:()=>{},onBeforeUnmount:(fn:()=>void)=>{dispose=fn;}};
  const panel = scope.run(() => new Function("deps",`const {${Object.keys(dependencies).join(",")}}=deps;\n${code}\nreturn {recoverInterrupted,recoveryStates,uncertainAcceptance,flush:flushPending,select(job){if(typeof beginRecovery==='function')beginRecovery(job);else recoveryConfirmJobId.value=job.id;}};`)(dependencies)) as {
    recoverInterrupted: (job:Job) => Promise<void>;
    recoveryStates:{value:Record<string,ReviewRecoveryState>};
    uncertainAcceptance:{value:unknown};
    flush:()=>Promise<boolean>;
    select:(job:Job)=>void;
  };
  panel.recoveryStates.value = {[job.id]:checkpoint};
  cleanup.push(()=>{dispose();scope.stop();});
  return {job,checkpoint,panel,api,emit,dispose:()=>dispose()};
}
function deferred() { let release!:()=>void; const promise = new Promise<void>(done=>{release=done;}); return {promise,release}; }
it("manual confirmation retains the originally inspected execution",async()=>{
  const {job,checkpoint,panel,api}=fixture();
  panel.select(job);
  panel.recoveryStates.value = {[job.id]:{...checkpoint,ownerToken:"newer"}};
  await panel.recoverInterrupted(job);
  expect(api.recoverReview).toHaveBeenCalledWith(job.id,{confirmStopped:true,ownerToken:"original",updatedAt:checkpoint.updatedAt});
});
it("navigation waits for the owned manual recovery request",async()=>{
  const {job,panel,api}=fixture();const gate=deferred();
  api.recoverReview.mockImplementation(async()=>{await gate.promise;return {job};});
  panel.select(job);const work=panel.recoverInterrupted(job);let settled=false;
  const flushed=panel.flush().then(value=>{settled=true;return value;});
  try { for(let i=0;i<8;i++)await Promise.resolve();expect(settled).toBe(false); }
  finally {gate.release();await work;await flushed;}
});
it("late manual recovery responses do not emit into a disposed panel",async()=>{
  const {job,panel,api,emit,dispose}=fixture();const gate=deferred();
  api.recoverReview.mockImplementation(async()=>{await gate.promise;return {job};});
  panel.select(job);const work=panel.recoverInterrupted(job);
  for(let i=0;i<8;i++)await Promise.resolve();dispose();emit.mockClear();gate.release();await work;
  expect(emit.mock.calls.some(args=>args[0]==="activity")).toBe(false);
});
it("uncertain text acceptance blocks competing manual recovery",async()=>{
  const {job,panel,api}=fixture();panel.uncertainAcceptance.value={suggestionId:"s",receipt:{baseRevision:"r",requestId:"q"}};
  panel.select(job);await panel.recoverInterrupted(job);expect(api.recoverReview).not.toHaveBeenCalled();
});
''')
    run(['pnpm','exec','vitest','run',app_test,panel_test,'-t','manual|navigation waits|late manual|uncertain text'], 'recovery-red',True)
    service = 'packages/application/src/knowledge.ts'
    replace(service, '''    const interrupted: Job = {
      ...job,
      status: "failed",''', '''    const interrupted: Job = {
      ...job,
      // Revoke the old execution before terminalizing its batches. A late writer
      // must fail the existing owner-token CAS even before any retry starts.
      reviewOwner: createReviewOwner(),
      status: "failed",''')
    replace(app_test, '''      stage: "interrupted",
      reviewOwner: job.reviewOwner,
    });''', '''      stage: "interrupted",
    });
    expect(recovered.reviewOwner?.token).not.toBe(job.reviewOwner?.token);
    expect(ownsReviewOwner(recovered.reviewOwner)).toBe(true);''')
    replace(app_test, '''      manualRecoveryAllowed: false,
      ownerState: "unknown",''', '''      manualRecoveryAllowed: false,
      ownerState: "alive",''')
    panel = 'apps/desktop/src/components/ReviewPanel.vue'
    replace(panel,'const recoveryConfirmJobId = ref("");','const recoveryConfirmation = shallowRef<ReviewRecoveryState>();')
    source = pathlib.Path(panel).read_text()
    start = source.index('      if (\n        recoveryConfirmJobId.value &&')
    end = source.index('        recoveryConfirmJobId.value = "";',start)+len('        recoveryConfirmJobId.value = "";')
    source = source[:start]+'''      const confirmed = recoveryConfirmation.value;
      const latest = confirmed && nextRecoveryStates[confirmed.jobId];
      if (confirmed && (!latest?.manualRecoveryAllowed || latest.ownerToken !== confirmed.ownerToken || latest.updatedAt !== confirmed.updatedAt))
        recoveryConfirmation.value = undefined;'''+source[end:]
    start = source.index('async function recoverInterrupted(job: Job) {')
    end = source.index('async function batchAction(',start)
    source = source[:start]+'''function beginRecovery(job: Job) {
  const checkpoint = recoveryStates.value[job.id];
  if (busy.value || uncertainAcceptance.value || !checkpoint?.manualRecoveryAllowed) return;
  recoveryConfirmation.value = { ...checkpoint };
}
async function recoverInterrupted(job: Job) {
  const checkpoint = recoveryConfirmation.value;
  if (!checkpoint?.manualRecoveryAllowed || checkpoint.jobId !== job.id || uncertainAcceptance.value) return;
  await reserve(async ({ current }) => {
    if (!current() || uncertainAcceptance.value) return false;
    await api.recoverReview(job.id, {
      confirmStopped: true,
      ownerToken: checkpoint.ownerToken,
      updatedAt: checkpoint.updatedAt,
    });
    if (!current()) return false;
    recoveryConfirmation.value = undefined;
    emit("activity");
    await refresh();
    return current();
  });
}

'''+source[end:]
    source = source.replace('recoveryConfirmJobId === job.id','recoveryConfirmation?.jobId === job.id').replace("recoveryConfirmJobId = ''",'recoveryConfirmation = undefined').replace('recoveryConfirmJobId = job.id','beginRecovery(job)')
    assert 'recoveryConfirmJobId' not in source
    pathlib.Path(panel).write_text(source)
    barriers = 'tests/unit/review-operation-barriers.test.ts'
    replace(barriers,'''    reviewProvider: vi.fn(async () => app.knowledge.languageProvider()),''','''    reviewProvider: vi.fn(async () => app.knowledge.languageProvider()),
    reviewRecovery: vi.fn(async (jobId: string) => app.knowledge.reviewRecoveryStatus(jobId)),''')
    schema_path = 'schemas/workstation-qa-1.0.0.schema.json'
    schema = json.loads(pathlib.Path(schema_path).read_text())
    nb = {'type':'string','pattern':r'\S'}
    env = schema['properties']['environment']['properties']
    for key in ['platform','release','arch','node']: env[key] = nb
    env['memoryBytes']['maximum'] = 9007199254740991
    gate = schema['$defs']['gate']
    gate['properties']['notes']['items'] = nb
    gate['properties']['blocker'] = {'type':'string'}
    for key in ['label','kind']: gate['properties']['inputs']['items']['properties'][key] = nb
    obs = gate['properties']['observations']['items']
    obs['properties']['check'] = nb
    obs['properties']['evidence']['items'] = nb
    obs['allOf'] = [{'if':{'properties':{'status':{'const':'pass'}},'required':['status']},'then':{'required':['actual','evidence'],'properties':{'actual':nb,'evidence':{'minItems':1}}}}]
    gate['allOf'] = [
      {'if':{'properties':{'status':{'const':'passed'}},'required':['status']},'then':{'properties':{'observations':{'minItems':1,'contains':{'properties':{'status':{'const':'pass'}},'required':['status']},'items':{'not':{'properties':{'status':{'enum':['fail','unavailable']}},'required':['status']}}}}}},
      {'if':{'properties':{'status':{'const':'failed'}},'required':['status']},'then':{'properties':{'observations':{'contains':{'properties':{'status':{'const':'fail'}},'required':['status']}}}}},
      {'if':{'properties':{'status':{'const':'blocked'}},'required':['status']},'then':{'required':['blocker'],'properties':{'blocker':nb}}},
      {'if':{'properties':{'status':{'enum':['passed','failed','blocked']}},'required':['status']},'then':{'required':['completedAt']}}
    ]
    write(schema_path,json.dumps(schema,ensure_ascii=False,indent=2)+'\n')
    doc = 'docs/validation-workstation-readiness.md'
    with pathlib.Path(doc).open('a') as out:
      out.write('\n## Manual recovery fencing\n\nConfirmed recovery rotates execution ownership in the same catalog transaction\nthat cancels unfinished batches. An obsolete writer cannot revive the job before\na retry. Desktop confirmation retains the inspected owner token and timestamp;\nit cannot silently switch to a newer execution during polling. The action shares\nthe existing mutation/disposal barrier and respects uncertain acceptance.\n\nSchema conditionals mirror positive-evidence and terminal-status rules. Runtime\nvalidation additionally checks calendar timestamps and interval ordering. Record\nvalidation is never a certificate of real hardware/model/NLE success.\n')
    changed = [app_test,panel_test,service,panel,barriers,schema_path,doc,'scripts/workstation-qa.ts','tests/unit/workstation-qa-validation.test.ts']
    run(['pnpm','exec','prettier','--write',*changed], 'format')
    run(['pnpm','exec','vitest','run',app_test,panel_test,'tests/unit/workstation-qa-contract.test.ts','tests/unit/workstation-qa-validation.test.ts','tests/integration/transcript-adapters.test.ts','tests/unit/review-operation-barriers.test.ts'], 'recovery-green')

run(['pnpm','format:check'], 'format-check')
run(['pnpm','test:i18n'], 'i18n')
run(['pnpm','verify'], 'verify')
run(['git','diff','--check'], 'diff-check')
actual = subprocess.check_output(['git','status','--porcelain'],text=True)
(evidence/'working-tree.txt').write_text(actual)
run(['git','add','--',*changed], 'stage')
run(['git','-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m',f'fix: close PR #{pr} correctness regressions with verified tests'], 'commit')
sha = subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
branch = f'codex/pr{pr}-verified-{os.environ["GITHUB_RUN_ID"]}'
run(['git','push','origin',f'HEAD:refs/heads/{branch}'], 'publish-candidate')
summary = {'pr':int(pr),'parent':parent,'candidate':sha,'branch':branch,'scopedTests':'passed','verify':'passed','workstationQA':'not-run','fullBrowserSuite':'pending'}
(evidence/'candidate.json').write_text(json.dumps(summary,indent=2)+'\n')
print('OPENFILM_CANDIDATE '+json.dumps(summary),flush=True)
