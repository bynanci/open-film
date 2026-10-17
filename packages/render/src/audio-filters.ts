import { validateAudioAutomation, type AudioAutomation } from "@openfilm/core";
const n = (value: number) => String(Number(value.toFixed(8)));
function lerp(
  start: number,
  end: number,
  before: number,
  after: number,
): string {
  return `(${n(before)}+(${n(after - before)})*(t-${n(start)})/${n(end - start)})`;
}
/** Clip-local timeline seconds, after tempo and before timeline delay. */
export function audioAutomationFilters(
  value: AudioAutomation | undefined,
  duration: number,
): string[] {
  if (!value) return [];
  const automation = validateAudioAutomation(value, duration);
  const filters: string[] = [];
  if (automation.fadeIn)
    filters.push(`afade=t=in:st=0:d=${n(automation.fadeIn)}`);
  if (automation.fadeOut)
    filters.push(
      `afade=t=out:st=${n(duration - automation.fadeOut)}:d=${n(automation.fadeOut)}`,
    );
  const points = automation.points ?? [];
  let gain = points.length ? n(points.at(-1)!.gain) : "1";
  for (let index = points.length - 2; index >= 0; index--) {
    const first = points[index]!,
      last = points[index + 1]!;
    gain = `if(lt(t,${n(last.time)}),${lerp(first.time, last.time, first.gain, last.gain)},${gain})`;
  }
  if (points.length)
    gain = `if(lt(t,${n(points[0]!.time)}),${n(points[0]!.gain)},${gain})`;
  for (const duck of automation.ducking ?? []) {
    const attack =
      duck.attack > 0
        ? lerp(duck.start, duck.start + duck.attack, 1, duck.gain)
        : n(duck.gain);
    const release =
      duck.release > 0
        ? lerp(duck.end - duck.release, duck.end, duck.gain, 1)
        : n(duck.gain);
    gain = `(${gain})*if(lt(t,${n(duck.start)}),1,if(lt(t,${n(duck.start + duck.attack)}),${attack},if(lt(t,${n(duck.end - duck.release)}),${n(duck.gain)},if(lt(t,${n(duck.end)}),${release},1))))`;
  }
  if (points.length || automation.ducking?.length)
    filters.push(`volume='${gain}':eval=frame`);
  return filters;
}
