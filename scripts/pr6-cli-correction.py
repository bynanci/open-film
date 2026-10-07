import os, pathlib, subprocess, json
parent='bc604ca8881667dc71cc41d076bb0cf5e7b2f311'
evidence=pathlib.Path(os.environ['RUNNER_TEMP'])/'openfilm-pr6-cli';evidence.mkdir(parents=True,exist_ok=True)
def run(args,name,fail=False):
 r=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);(evidence/(name+'.log')).write_text(r.stdout);print(name,'exit',r.returncode,flush=True)
 if (r.returncode==0)==fail:
  print(r.stdout[-16000:],flush=True);raise RuntimeError(name)
 return r.stdout

def replace(path,before,after):
 p=pathlib.Path(path);s=p.read_text();assert s.count(before)==1,(path,before[:80]);p.write_text(s.replace(before,after))
run(['git','checkout','--detach',parent],'checkout');run(['pnpm','install','--frozen-lockfile'],'install')
test='tests/integration/transcript-adapters.test.ts'
replace(test,'describe("transcript REST and CLI adapters", () => {',r'''describe("transcript REST and CLI adapters", () => {
  it("CLI recovery requires and accepts the registered confirmation flag", async () => {
    const setup = await fixture();
    const state = await setup.app.transcriptEditor.get(setup.assetId);
    const owner = createReviewOwner();
    const job: Job = {id:"cli-recovery",type:"language-review",assetId:setup.assetId,status:"running",reviewOwner:{...owner,host:owner.host+":foreign"},updatedAt:"2026-10-07T00:00:00Z"};
    setup.app.catalog.saveJob(job);
    setup.app.catalog.knowledge.saveBatch({jobId:job.id,index:0,assetId:setup.assetId,sourceRevisionId:state.revision!,providerId:"adapter-fixture",segmentIds:["segment-0"],status:"running",attempts:1});
    const originalHash = await hashFile(setup.path);
    setup.close();
    const args = ["--import","tsx",resolve("apps/cli/src/index.ts"),"review","recover",job.id,"--project",setup.app.directory,"--user-data-dir",setup.userDataDirectory];
    await expect(runProcess(process.execPath,args)).rejects.toThrow(/confirm-stopped/);
    const output = await runProcess(process.execPath,[...args,"--confirm-stopped"]);
    const recovered = JSON.parse(output.stdout.toString()).job as Job;
    expect(recovered).toMatchObject({id:job.id,status:"failed",stage:"interrupted"});
    expect(recovered.reviewOwner?.token).not.toBe(owner.token);
    const reopened = await OpenFilmApplication.open(setup.app.directory,{userDataDirectory:setup.userDataDirectory});
    try {
      expect(reopened.catalog.listJobs().find(item=>item.id===job.id)).toEqual(recovered);
      expect(reopened.knowledge.batches(job.id)[0]!.status).toBe("cancelled");
      expect((await reopened.transcriptEditor.get(setup.assetId)).revision).toBe(state.revision);
      expect(await hashFile(setup.path)).toBe(originalHash);
    } finally { reopened.close(); }
  });''')
run(['pnpm','exec','vitest','run',test,'-t','CLI recovery requires'],'cli-red',True)
cli='apps/cli/src/index.ts'
replace(cli,'    "enable",\n    "disable",\n  ]);','    "enable",\n    "disable",\n    "confirm-stopped",\n  ]);')
doc='docs/validation-workstation-readiness.md'
with pathlib.Path(doc).open('a') as out:
 out.write('\n## CLI confirmation flag\n\nAn independent review found that the documented `--confirm-stopped` option was\nnot registered in the CLI parser. A real CLI subprocess regression first fails\nwith the unknown-option error, then passes after registering the boolean flag.\nThe same test rejects omitted confirmation and checks durable batch recovery,\nunchanged transcript revision and unchanged source bytes after reopening.\n')
changed=[test,cli,doc]
run(['pnpm','exec','prettier','--write',*changed],'format');run(['pnpm','exec','vitest','run',test],'cli-green')
run(['pnpm','format:check'],'format-check');run(['pnpm','test:i18n'],'i18n');run(['pnpm','verify'],'verify');run(['git','diff','--check'],'diff-check')
run(['git','add','--',*changed],'stage');run(['git','-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m','fix(cli): register and verify explicit recovery confirmation'],'commit')
sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();branch='codex/pr6-cli-verified-'+os.environ['GITHUB_RUN_ID'];run(['git','push','origin','HEAD:refs/heads/'+branch],'publish-candidate')
result={'parent':parent,'candidate':sha,'branch':branch,'verify':'passed','cliRegression':'passed','workstationQA':'not-run'};(evidence/'candidate.json').write_text(json.dumps(result,indent=2)+'\n');print('OPENFILM_CANDIDATE '+json.dumps(result),flush=True)
