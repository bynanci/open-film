import os, pathlib, subprocess, json
parent = 'daadc20d149859e663b22b60a5fc6d860ffb5ceb'
original = 'a4244f446c86ae0a32f41979f2bb2d515fa58730'
evidence = pathlib.Path(os.environ['RUNNER_TEMP'])/'openfilm-pr5'
evidence.mkdir(parents=True,exist_ok=True)
def run(args,name,fail=False):
 r=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (evidence/(name+'.log')).write_text(r.stdout)
 print(name,'exit',r.returncode,flush=True)
 if (r.returncode==0)==fail:
  print(r.stdout[-16000:],flush=True);raise RuntimeError(name)
 return r.stdout

def replace(path,before,after):
 p=pathlib.Path(path);s=p.read_text();assert s.count(before)==1,(path,before[:80]);p.write_text(s.replace(before,after))
run(['git','checkout','--detach',parent],'checkout')
run(['pnpm','install','--frozen-lockfile'],'install')
e2e='tests/e2e/geometry-contract.spec.ts'
replace(e2e,'    if (iteration === 0) await toggle.click();\n  }\n});',r'''    if (iteration === 0) await toggle.click();
  }
  // Exercise a direct source-box resize in addition to the inspector toggle.
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await viewport.evaluate(element => {
    const node = element as HTMLElement;
    node.style.width = `${node.clientWidth - 100}px`;
    node.style.alignSelf = "center";
  });
  await expect.poll(async () => {
    const bounds = await viewport.evaluate(el => ({width:el.clientWidth,height:el.clientHeight}));
    const actual = await frame.boundingBox();
    const scale = Math.min(bounds.width / 1920, bounds.height / 1080);
    return Math.max(Math.abs(actual!.width - 1920 * scale), Math.abs(actual!.height - 1080 * scale));
  }).toBeLessThan(1);
});''')
component='apps/desktop/src/components/TimelineEditor.vue'
pathlib.Path(component).write_bytes(subprocess.check_output(['git','show',original+':'+component]))
run(['pnpm','exec','playwright','install','--with-deps','chromium'],'browser-install')
# The reported ResizeObserver fault did not reproduce in this layout. Preserve
# that fact; these interactions are positive coverage, not a red/green claim.
run(['pnpm','exec','playwright','test',e2e,'--grep','preview refits','--retries=0'],'viewport-baseline')
run(['git','restore',component],'restore-reviewed-fix')
render_test='packages/render/tests/render.test.ts'
p=pathlib.Path(render_test);s=p.read_text();idx=s.rindex('\n});')
s=s[:idx]+r'''
  it("preserves display aspect when square-pixelizing anamorphic media", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-sar-"));
    directories.push(directory);
    const source = join(directory, "anamorphic.mp4");
    await runProcess("ffmpeg", ["-v","error","-f","lavfi","-i","color=red:s=80x40:r=10,setsar=2","-t","0.4","-c:v","libx264","-threads","1","-pix_fmt","yuv420p","-y",source]);
    const asset = await inspectMedia({path:source,uri:pathToFileURL(source).href,name:"anamorphic.mp4"});
    const hash = await hashFile(source);
    const composition: Composition = {id:"sar",storyId:"story",duration:0.4,tracks:[{id:"video",type:"video",clips:[{id:"clip",assetId:asset.id,timelineStart:0,timelineDuration:0.4}]}]};
    const output = join(directory,"preview.mp4");
    await new FFmpegRenderer().render(composition,[asset],output,{width:160,height:90,frameRate:10});
    const decoded = await runProcess("ffmpeg",["-v","error","-i",output,"-frames:v","1","-vf","format=rgb24","-f","rawvideo","-"]);
    expect(decoded.stdout.length).toBe(160*90*3);
    // 80x40 coded pixels at SAR 2:1 display as 4:1: fit must be 160x40,
    // with black above y=25. Fitting coded pixels would incorrectly be 160x80.
    expect(decoded.stdout[(10*160+80)*3]).toBeLessThan(25);
    expect(decoded.stdout[(45*160+80)*3]).toBeGreaterThan(180);
    expect(await hashFile(source)).toBe(hash);
  });
'''+s[idx:];p.write_text(s)
run(['pnpm','exec','vitest','run',render_test,'-t','anamorphic'],'sar-red',True)
renderer='packages/render/src/index.ts'
replace(renderer,'''            transform.push(
              `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease`,
            );''',r'''            // Fit display pixels, not coded dimensions: setsar=1 alone would
            // distort anamorphic sources. Auto-orientation precedes this filter.
            const aspect = "if(gt(dar,0),dar,iw/ih)";
            const wide = `gte(${aspect},${settings.width}/${settings.height})`;
            transform.push(
              `scale=w='max(1,round(if(${wide},${settings.width},${settings.height}*${aspect})))':h='max(1,round(if(${wide},${settings.width}/${aspect},${settings.height})))'`,
            );''')
doc='docs/validation-geometry-parity.md'
pathlib.Path(doc).write_text('''# Geometry correctness validation

The original candidate `a4244f446c86ae0a32f41979f2bb2d515fa58730` had green CI
but failed the added real-browser transient-input regression. Inspector toggle
and direct source-box resize cases passed even before direct observation was
added. These are positive interaction coverage, not a reproduced observer fault.
The unsuccessful attempt to demand a red result is retained in Actions run
37569327733 rather than reported as a product failure.

Preview-only input resolution retains committed valid geometry while numeric
fields are temporarily empty or invalid. Domain and command validation remain
strict. Direct viewport observation additionally removes reliance on outer layout
callbacks, handles replaced elements and unregisters old observations.

An independent real-FFmpeg regression uses generated 80x40 coded pixels with
SAR 2:1. Their display aspect is 4:1. The old contain/setsar pipeline produced a
160x80 picture (2:1); the corrected display-aspect fit produces 160x40. Source
hashes remain unchanged. This fixture is not real-camera/HDR/4K certification.

The preceding candidate passed format, i18n, lint, typecheck, 998 unit/integration
tests and two focused browser cases. New SAR before-and-after logs, viewport
baseline, complete verify output and focused browser output are retained as
Actions artifacts. Full release browser/native/interchange CI and an exact-head
review remain separate gates; no workstation QA is implied.
''')
changed=[e2e,render_test,renderer,doc]
run(['pnpm','exec','prettier','--write',*changed],'format')
run(['pnpm','exec','vitest','run',render_test],'render-green')
run(['pnpm','exec','playwright','test',e2e,'--retries=0'],'geometry-green')
run(['pnpm','format:check'],'format-check');run(['pnpm','test:i18n'],'i18n');run(['pnpm','verify'],'verify')
run(['git','diff','--check'],'diff-check');run(['git','add','--',*changed],'stage')
run(['git','-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m','fix(render): preserve display aspect and verify viewport resizing'],'commit')
sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();branch='codex/pr5-sar-verified-'+os.environ['GITHUB_RUN_ID']
run(['git','push','origin','HEAD:refs/heads/'+branch],'publish-candidate')
result={'parent':parent,'candidate':sha,'branch':branch,'verify':'passed','focusedBrowser':'passed','workstationQA':'not-run'}
(evidence/'candidate.json').write_text(json.dumps(result,indent=2)+'\n');print('OPENFILM_CANDIDATE '+json.dumps(result),flush=True)
